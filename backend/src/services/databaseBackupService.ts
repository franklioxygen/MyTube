import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { reinitializeDatabase as reinitDb, sqlite } from "../db";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { invalidateSettingsCache } from "./storageService/settings";
import { generateTimestamp } from "../utils/helpers";
import { logger } from "../utils/logger";
import {
  copyFileSafeSync,
  isPathWithinDirectory,
  pathExistsSafeSync,
  readdirSafeSync,
  resolveSafePath,
  statSafeSync,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../utils/security";
const dbPath = path.join(DATA_DIR, "mytube.db");
const backupPattern = /^mytube-backup-(.+)\.db\.backup$/;
const RESOLVED_DATA_DIR = path.resolve(DATA_DIR);
const RESOLVED_DB_PATH = path.resolve(dbPath);

type MergeCount = {
  merged: number;
  skipped: number;
};

export type DatabaseMergeSummary = {
  videos: MergeCount;
  collections: MergeCount;
  collectionLinks: MergeCount;
  subscriptions: MergeCount;
  downloadHistory: MergeCount;
  videoDownloads: MergeCount;
  tags: MergeCount;
};

type MergeRow = Record<string, unknown>;

type MergeExecutionOptions = {
  applyChanges: boolean;
  persistTagSettings: boolean;
};

const MERGEABLE_TABLES = [
  "videos",
  "collections",
  "collection_videos",
  "subscriptions",
  "download_history",
  "video_downloads",
  "settings",
] as const;

function createEmptyMergeSummary(): DatabaseMergeSummary {
  return {
    videos: { merged: 0, skipped: 0 },
    collections: { merged: 0, skipped: 0 },
    collectionLinks: { merged: 0, skipped: 0 },
    subscriptions: { merged: 0, skipped: 0 },
    downloadHistory: { merged: 0, skipped: 0 },
    videoDownloads: { merged: 0, skipped: 0 },
    tags: { merged: 0, skipped: 0 },
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName);
  return Boolean(row);
}

function getTableColumns(
  db: Database.Database,
  tableName: string
): string[] {
  if (!hasTable(db, tableName)) {
    return [];
  }

  return (
    db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

function getSharedColumns(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  tableName: string
): string[] {
  const sourceColumns = new Set(getTableColumns(sourceDb, tableName));
  return getTableColumns(targetDb, tableName).filter((column) =>
    sourceColumns.has(column)
  );
}

function readTableRows(
  db: Database.Database,
  tableName: string,
  columns: string[]
): MergeRow[] {
  if (columns.length === 0 || !hasTable(db, tableName)) {
    return [];
  }

  const selectColumns = columns.map(quoteIdentifier).join(", ");
  return db
    .prepare(
      `SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)}`
    )
    .all() as MergeRow[];
}

function buildInsertStatement(
  db: Database.Database,
  tableName: string,
  columns: string[]
): Database.Statement {
  if (columns.length === 0) {
    throw new ValidationError(
      `No compatible columns found for table ${tableName}.`,
      "file"
    );
  }

  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map((column) => `@${column}`).join(", ");
  return db.prepare(
    `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES (${placeholders})`
  );
}

function toLookupKey(
  value: unknown,
  options: { caseInsensitive?: boolean } = {}
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return options.caseInsensitive ? normalized.toLowerCase() : normalized;
}

function getRequiredString(row: MergeRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(
      `Database merge failed because ${key} is missing from ${String(
        row.id ?? "a row"
      )}.`,
      "file"
    );
  }
  return value;
}

function remapRow(
  row: MergeRow,
  columns: string[],
  overrides: Record<string, unknown> = {}
): MergeRow {
  const remapped: MergeRow = {};
  for (const column of columns) {
    remapped[column] =
      Object.prototype.hasOwnProperty.call(overrides, column)
        ? overrides[column]
        : row[column];
  }
  return remapped;
}

function prepareTempImportFile(fileBuffer: Buffer): string {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new ValidationError("Invalid uploaded database file", "file");
  }

  const tempFilename = `import-${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}.db.tmp`;
  const tempImportPath = resolveSafePath(
    path.join(DATA_DIR, tempFilename),
    DATA_DIR
  );
  const isSafeDbPath = isPathWithinDirectory(RESOLVED_DB_PATH, RESOLVED_DATA_DIR);
  if (!isSafeDbPath) {
    throw new ValidationError("Invalid database path", "file");
  }

  writeFileSafeSync(tempImportPath, DATA_DIR, fileBuffer);
  validateDatabase(tempImportPath);
  return tempImportPath;
}

function cleanupTempImportFile(tempImportPath: string): void {
  if (pathExistsSafeSync(tempImportPath, DATA_DIR)) {
    try {
      unlinkSafeSync(tempImportPath, DATA_DIR);
    } catch (error) {
      logger.error("Error cleaning up temp file:", error);
    }
  }
}

function getInsertId(existingIds: Set<string>, sourceId: string): string {
  if (!existingIds.has(sourceId)) {
    return sourceId;
  }

  let generatedId = crypto.randomUUID();
  while (existingIds.has(generatedId)) {
    generatedId = crypto.randomUUID();
  }

  return generatedId;
}

function buildHistoryMergeKey(row: MergeRow): string | null {
  const finishedAt = row.finished_at;
  const status = toLookupKey(row.status, { caseInsensitive: true });

  if (
    (typeof finishedAt !== "number" && typeof finishedAt !== "string") ||
    !status
  ) {
    return null;
  }

  const sourceUrl = toLookupKey(row.source_url);
  if (sourceUrl) {
    return `url:${sourceUrl}::${finishedAt}::${status}`;
  }

  const title = toLookupKey(row.title, { caseInsensitive: true });
  if (title) {
    return `title:${title}::${finishedAt}::${status}`;
  }

  return null;
}

function buildVideoDownloadKey(row: MergeRow): string | null {
  const sourceVideoId = toLookupKey(row.source_video_id);
  const platform = toLookupKey(row.platform, { caseInsensitive: true });

  if (!sourceVideoId || !platform) {
    return null;
  }

  return `${sourceVideoId}::${platform}`;
}

function parseTagList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function collectImportedTags(sourceDb: Database.Database): string[] {
  const importedTags: string[] = [];
  const seenTags = new Set<string>();

  const addTag = (tag: string): void => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) {
      return;
    }

    const lookupKey = normalizedTag.toLowerCase();
    if (seenTags.has(lookupKey)) {
      return;
    }

    seenTags.add(lookupKey);
    importedTags.push(tag);
  };

  if (hasTable(sourceDb, "settings")) {
    const sourceTagsRow = sourceDb
      .prepare("SELECT value FROM settings WHERE key = 'tags' LIMIT 1")
      .get() as { value?: string } | undefined;

    for (const tag of parseTagList(sourceTagsRow?.value)) {
      addTag(tag);
    }
  }

  if (hasTable(sourceDb, "videos") && getTableColumns(sourceDb, "videos").includes("tags")) {
    const videoTagRows = sourceDb
      .prepare('SELECT tags FROM "videos" WHERE "tags" IS NOT NULL')
      .all() as Array<{ tags?: string }>;

    for (const row of videoTagRows) {
      for (const tag of parseTagList(row.tags)) {
        addTag(tag);
      }
    }
  }

  return importedTags;
}

function mergeVideos(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  videoIdMap: Map<string, string>,
  options: MergeExecutionOptions
): void {
  const sharedColumns = getSharedColumns(sourceDb, targetDb, "videos");
  const sourceRows = readTableRows(sourceDb, "videos", sharedColumns);

  if (sourceRows.length === 0) {
    return;
  }

  const existingRows = targetDb
    .prepare("SELECT id, source_url AS source_url FROM videos")
    .all() as MergeRow[];

  const existingIds = new Set<string>();
  const existingBySourceUrl = new Map<string, string>();

  for (const row of existingRows) {
    const rowId = getRequiredString(row, "id");
    existingIds.add(rowId);

    const sourceUrlKey = toLookupKey(row.source_url);
    if (sourceUrlKey) {
      existingBySourceUrl.set(sourceUrlKey, rowId);
    }
  }

  const insertStatement = options.applyChanges
    ? buildInsertStatement(targetDb, "videos", sharedColumns)
    : null;

  for (const row of sourceRows) {
    const sourceId = getRequiredString(row, "id");
    const sourceUrlKey = toLookupKey(row.source_url);
    const targetId = (sourceUrlKey && existingBySourceUrl.get(sourceUrlKey)) || null;

    if (!targetId) {
      const insertId = getInsertId(existingIds, sourceId);
      if (insertStatement) {
        insertStatement.run(remapRow(row, sharedColumns, { id: insertId }));
      }

      existingIds.add(insertId);

      if (sourceUrlKey) {
        existingBySourceUrl.set(sourceUrlKey, insertId);
      }

      summary.videos.merged += 1;
      videoIdMap.set(sourceId, insertId);
    } else {
      summary.videos.skipped += 1;
      videoIdMap.set(sourceId, targetId);
    }
  }
}

function getCollectionMergeName(row: MergeRow): string {
  const sourceName = toLookupKey(row.name, { caseInsensitive: true });
  const sourceTitle = toLookupKey(row.title, { caseInsensitive: true });
  return sourceName || sourceTitle || `imported-collection-${String(row.id)}`;
}

function mergeCollections(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  collectionIdMap: Map<string, string>,
  options: MergeExecutionOptions
): void {
  const sharedColumns = getSharedColumns(sourceDb, targetDb, "collections");
  const sourceRows = readTableRows(sourceDb, "collections", sharedColumns);

  if (sourceRows.length === 0) {
    return;
  }

  const existingRows = targetDb
    .prepare("SELECT id, name, title FROM collections")
    .all() as MergeRow[];
  const existingIds = new Set<string>();
  const existingByName = new Map<string, string>();

  for (const row of existingRows) {
    const rowId = getRequiredString(row, "id");
    existingIds.add(rowId);
    existingByName.set(getCollectionMergeName(row), rowId);
  }

  const insertStatement = buildInsertStatement(
    targetDb,
    "collections",
    sharedColumns
  );

  for (const row of sourceRows) {
    const sourceId = getRequiredString(row, "id");
    const collectionName = getCollectionMergeName(row);
    let targetId = existingByName.get(collectionName) || null;

    if (!targetId) {
      const insertId = getInsertId(existingIds, sourceId);

      const collectionLabel =
        typeof row.name === "string" && row.name.trim().length > 0
          ? row.name
          : typeof row.title === "string" && row.title.trim().length > 0
            ? row.title
            : `Imported Collection ${insertId}`;

      const createdAt =
        typeof row.created_at === "string" && row.created_at.trim().length > 0
          ? row.created_at
          : new Date().toISOString();

      if (options.applyChanges) {
        insertStatement.run(
          remapRow(row, sharedColumns, {
            id: insertId,
            name: collectionLabel,
            created_at: createdAt,
          })
        );
      }

      targetId = insertId;
      existingIds.add(targetId);
      existingByName.set(collectionName, targetId);
      summary.collections.merged += 1;
    } else {
      summary.collections.skipped += 1;
    }

    collectionIdMap.set(sourceId, targetId);
  }
}

function mergeCollectionLinks(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  videoIdMap: Map<string, string>,
  collectionIdMap: Map<string, string>,
  options: MergeExecutionOptions
): void {
  const sharedColumns = getSharedColumns(sourceDb, targetDb, "collection_videos");
  const sourceRows = readTableRows(sourceDb, "collection_videos", sharedColumns);

  if (sourceRows.length === 0) {
    return;
  }

  const existingPairs = new Set<string>(
    (
      targetDb
        .prepare(
          "SELECT collection_id AS collection_id, video_id AS video_id FROM collection_videos"
        )
        .all() as MergeRow[]
    ).map((row) => {
      const collectionId = getRequiredString(row, "collection_id");
      const videoId = getRequiredString(row, "video_id");
      return `${collectionId}::${videoId}`;
    })
  );

  const insertStatement = buildInsertStatement(
    targetDb,
    "collection_videos",
    sharedColumns
  );

  for (const row of sourceRows) {
    const sourceCollectionId = getRequiredString(row, "collection_id");
    const sourceVideoId = getRequiredString(row, "video_id");
    const targetCollectionId = collectionIdMap.get(sourceCollectionId);
    const targetVideoId = videoIdMap.get(sourceVideoId);

    if (!targetCollectionId || !targetVideoId) {
      summary.collectionLinks.skipped += 1;
      continue;
    }

    const pairKey = `${targetCollectionId}::${targetVideoId}`;
    if (existingPairs.has(pairKey)) {
      summary.collectionLinks.skipped += 1;
      continue;
    }

    if (options.applyChanges) {
      insertStatement.run(
        remapRow(row, sharedColumns, {
          collection_id: targetCollectionId,
          video_id: targetVideoId,
        })
      );
    }
    existingPairs.add(pairKey);
    summary.collectionLinks.merged += 1;
  }
}

function mergeSubscriptions(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  collectionIdMap: Map<string, string>,
  subscriptionIdMap: Map<string, string>,
  options: MergeExecutionOptions
): void {
  const sharedColumns = getSharedColumns(sourceDb, targetDb, "subscriptions");
  const sourceRows = readTableRows(sourceDb, "subscriptions", sharedColumns);

  if (sourceRows.length === 0) {
    return;
  }

  const existingRows = targetDb
    .prepare("SELECT id, author_url AS author_url FROM subscriptions")
    .all() as MergeRow[];
  const existingIds = new Set<string>();
  const existingByAuthorUrl = new Map<string, string>();

  for (const row of existingRows) {
    const rowId = getRequiredString(row, "id");
    existingIds.add(rowId);
    const authorUrlKey = toLookupKey(row.author_url);
    if (authorUrlKey) {
      existingByAuthorUrl.set(authorUrlKey, rowId);
    }
  }

  const insertStatement = buildInsertStatement(
    targetDb,
    "subscriptions",
    sharedColumns
  );

  for (const row of sourceRows) {
    const sourceId = getRequiredString(row, "id");
    const authorUrlKey = toLookupKey(row.author_url);
    let targetId = (authorUrlKey && existingByAuthorUrl.get(authorUrlKey)) || null;

    if (!targetId) {
      const insertId = getInsertId(existingIds, sourceId);
      const mappedCollectionId =
        typeof row.collection_id === "string"
          ? (collectionIdMap.get(row.collection_id) ?? null)
          : null;

      if (options.applyChanges) {
        insertStatement.run(
          remapRow(row, sharedColumns, {
            id: insertId,
            collection_id: mappedCollectionId,
          })
        );
      }

      targetId = insertId;
      existingIds.add(targetId);
      if (authorUrlKey) {
        existingByAuthorUrl.set(authorUrlKey, targetId);
      }
      summary.subscriptions.merged += 1;
    } else {
      summary.subscriptions.skipped += 1;
    }

    subscriptionIdMap.set(sourceId, targetId);
  }
}

function mergeDownloadHistory(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  videoIdMap: Map<string, string>,
  subscriptionIdMap: Map<string, string>,
  options: MergeExecutionOptions
): void {
  const sharedColumns = getSharedColumns(sourceDb, targetDb, "download_history");
  const sourceRows = readTableRows(sourceDb, "download_history", sharedColumns);

  if (sourceRows.length === 0) {
    return;
  }

  const existingRows = targetDb
    .prepare(
      "SELECT id, title, source_url AS source_url, finished_at AS finished_at, status FROM download_history"
    )
    .all() as MergeRow[];
  const existingIds = new Set<string>();
  const existingKeys = new Set<string>();

  for (const row of existingRows) {
    existingIds.add(getRequiredString(row, "id"));
    const mergeKey = buildHistoryMergeKey(row);
    if (mergeKey) {
      existingKeys.add(mergeKey);
    }
  }

  const insertStatement = buildInsertStatement(
    targetDb,
    "download_history",
    sharedColumns
  );

  for (const row of sourceRows) {
    const sourceId = getRequiredString(row, "id");
    const mergeKey = buildHistoryMergeKey(row);

    if (mergeKey && existingKeys.has(mergeKey)) {
      summary.downloadHistory.skipped += 1;
      continue;
    }

    const insertId = getInsertId(existingIds, sourceId);
    const mappedVideoId =
      typeof row.video_id === "string"
        ? (videoIdMap.get(row.video_id) ?? null)
        : null;
    const mappedSubscriptionId =
      typeof row.subscription_id === "string"
        ? (subscriptionIdMap.get(row.subscription_id) ?? null)
        : null;

    if (options.applyChanges) {
      insertStatement.run(
        remapRow(row, sharedColumns, {
          id: insertId,
          video_id: mappedVideoId,
          subscription_id: mappedSubscriptionId,
          task_id: null,
        })
      );
    }

    existingIds.add(insertId);
    if (mergeKey) {
      existingKeys.add(mergeKey);
    }
    summary.downloadHistory.merged += 1;
  }
}

function mergeVideoDownloads(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  videoIdMap: Map<string, string>,
  options: MergeExecutionOptions
): void {
  const sharedColumns = getSharedColumns(sourceDb, targetDb, "video_downloads");
  const sourceRows = readTableRows(sourceDb, "video_downloads", sharedColumns);

  if (sourceRows.length === 0) {
    return;
  }

  const existingRows = targetDb
    .prepare(
      "SELECT id, source_video_id AS source_video_id, platform FROM video_downloads"
    )
    .all() as MergeRow[];
  const existingIds = new Set<string>();
  const existingKeys = new Set<string>();

  for (const row of existingRows) {
    existingIds.add(getRequiredString(row, "id"));
    const mergeKey = buildVideoDownloadKey(row);
    if (mergeKey) {
      existingKeys.add(mergeKey);
    }
  }

  const insertStatement = buildInsertStatement(
    targetDb,
    "video_downloads",
    sharedColumns
  );

  for (const row of sourceRows) {
    const sourceId = getRequiredString(row, "id");
    const mergeKey = buildVideoDownloadKey(row);

    if (mergeKey && existingKeys.has(mergeKey)) {
      summary.videoDownloads.skipped += 1;
      continue;
    }

    const insertId = getInsertId(existingIds, sourceId);
    const mappedVideoId =
      typeof row.video_id === "string"
        ? (videoIdMap.get(row.video_id) ?? null)
        : null;

    if (options.applyChanges) {
      insertStatement.run(
        remapRow(row, sharedColumns, {
          id: insertId,
          video_id: mappedVideoId,
        })
      );
    }

    existingIds.add(insertId);
    if (mergeKey) {
      existingKeys.add(mergeKey);
    }
    summary.videoDownloads.merged += 1;
  }
}

function mergeTagSettings(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  summary: DatabaseMergeSummary,
  options: MergeExecutionOptions
): void {
  if (!hasTable(targetDb, "settings")) {
    return;
  }

  const importedTags = collectImportedTags(sourceDb);
  if (importedTags.length === 0) {
    return;
  }

  const targetTagsRow = targetDb
    .prepare("SELECT value FROM settings WHERE key = 'tags' LIMIT 1")
    .get() as { value?: string } | undefined;
  const existingTags = parseTagList(targetTagsRow?.value);

  const seenTags = new Set(
    existingTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)
  );
  const mergedTags = [...existingTags];

  for (const importedTag of importedTags) {
    const normalizedTag = importedTag.trim().toLowerCase();
    if (!normalizedTag) {
      summary.tags.skipped += 1;
      continue;
    }

    if (seenTags.has(normalizedTag)) {
      summary.tags.skipped += 1;
      continue;
    }

    seenTags.add(normalizedTag);
    mergedTags.push(importedTag);
    summary.tags.merged += 1;
  }

  if (options.applyChanges && summary.tags.merged > 0) {
    targetDb
      .prepare(
        "INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run({
        key: "tags",
        value: JSON.stringify(mergedTags),
      });
    if (options.persistTagSettings) {
      invalidateSettingsCache();
    }
  }
}

function executeDatabaseMerge(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  options: MergeExecutionOptions
): DatabaseMergeSummary {
  const summary = createEmptyMergeSummary();
  const videoIdMap = new Map<string, string>();
  const collectionIdMap = new Map<string, string>();
  const subscriptionIdMap = new Map<string, string>();

  mergeVideos(sourceDb, targetDb, summary, videoIdMap, options);
  mergeCollections(sourceDb, targetDb, summary, collectionIdMap, options);
  mergeCollectionLinks(
    sourceDb,
    targetDb,
    summary,
    videoIdMap,
    collectionIdMap,
    options
  );
  mergeSubscriptions(
    sourceDb,
    targetDb,
    summary,
    collectionIdMap,
    subscriptionIdMap,
    options
  );
  mergeDownloadHistory(
    sourceDb,
    targetDb,
    summary,
    videoIdMap,
    subscriptionIdMap,
    options
  );
  mergeVideoDownloads(sourceDb, targetDb, summary, videoIdMap, options);
  mergeTagSettings(sourceDb, targetDb, summary, options);

  return summary;
}

/**
 * Validate that a file is a valid SQLite database
 */
function validateDatabase(filePath: string): void {
  let sourceDb: any = null;
  try {
    sourceDb = new Database(filePath, { readonly: true });
    // Try to query the database to verify it's valid
    sourceDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
      .get();
    sourceDb.close();
  } catch (validationError) {
    if (sourceDb) {
      sourceDb.close();
    }
    throw new ValidationError(
      "Invalid database file. The file is not a valid SQLite database.",
      "file"
    );
  }
}

/**
 * Get all backup files with their metadata
 */
function getBackupFiles(): Array<{
  filename: string;
  timestamp: string;
  mtime: number;
  filePath: string;
}> {
  const files = readdirSafeSync(DATA_DIR, DATA_DIR);
  const backupFiles: Array<{
    filename: string;
    timestamp: string;
    mtime: number;
    filePath: string;
  }> = [];

  for (const file of files) {
    const match = file.match(backupPattern);
    if (match) {
      const timestamp = match[1];
      const filePath = resolveSafePath(path.join(DATA_DIR, file), DATA_DIR);
      const stats = statSafeSync(filePath, DATA_DIR);
      backupFiles.push({
        filename: file,
        timestamp,
        mtime: stats.mtimeMs,
        filePath,
      });
    }
  }

  // Sort by modification time (most recent first)
  backupFiles.sort((a, b) => b.mtime - a.mtime);
  return backupFiles;
}

/**
 * Create a backup of the current database
 */
function createBackup(): string {
  const backupFilename = `mytube-backup-${generateTimestamp()}.db.backup`;
  const backupPath = resolveSafePath(path.join(DATA_DIR, backupFilename), DATA_DIR);
  const resolvedBackupPath = path.resolve(backupPath);
  const isSafeBackupPath = isPathWithinDirectory(
    resolvedBackupPath,
    RESOLVED_DATA_DIR,
  );
  if (!isSafeBackupPath) {
    throw new ValidationError("Invalid backup file path", "file");
  }

  if (pathExistsSafeSync(dbPath, DATA_DIR)) {
    copyFileSafeSync(
      RESOLVED_DB_PATH,
      DATA_DIR,
      resolvedBackupPath,
      DATA_DIR,
    );
    logger.info(`Created backup of current database at ${resolvedBackupPath}`);
  }

  return resolvedBackupPath;
}

/**
 * Close database connection and reinitialize it
 */
function reinitializeDatabase(): void {
  sqlite.close();
  logger.info("Closed current database connection");
  reinitDb();
  logger.info("Database connection reinitialized");
}

/**
 * Export database as backup file
 * Returns the path to the database file
 */
export function exportDatabase(): string {
  if (!pathExistsSafeSync(dbPath, DATA_DIR)) {
    throw new NotFoundError("Database file", "mytube.db");
  }
  return dbPath;
}

/**
 * Import database from backup file
 * @param fileBuffer - Uploaded SQLite database bytes
 */
export function importDatabase(fileBuffer: Buffer): void {
  const tempImportPath = prepareTempImportFile(fileBuffer);

  // Create backup of current database before import
  const backupPath = createBackup();

  try {
    // Close the current database connection before replacing the file
    sqlite.close();
    logger.info("Closed current database connection for import");

    // Simply copy the uploaded file to replace the database
    copyFileSafeSync(tempImportPath, DATA_DIR, RESOLVED_DB_PATH, DATA_DIR);
    logger.info(`Database file replaced successfully`);

    // Reinitialize the database connection with the new file
    reinitializeDatabase();
  } catch (error: any) {
    // Restore backup if import failed
    if (pathExistsSafeSync(backupPath, DATA_DIR)) {
      try {
        const resolvedBackupPath = path.resolve(backupPath);
        const isSafeBackupPath = isPathWithinDirectory(
          resolvedBackupPath,
          RESOLVED_DATA_DIR,
        );
        if (!isSafeBackupPath) {
          throw new ValidationError("Invalid backup file path", "file");
        }
        copyFileSafeSync(
          resolvedBackupPath,
          DATA_DIR,
          RESOLVED_DB_PATH,
          DATA_DIR,
        );
        logger.info("Restored database from backup after failed import");
      } catch (restoreError) {
        logger.error("Failed to restore database from backup:", restoreError);
      }
    }

    // Log the actual error for debugging
    logger.error(
      "Database import failed:",
      error instanceof Error ? error : new Error(String(error))
    );

    throw error;
  } finally {
    cleanupTempImportFile(tempImportPath);
  }
}

/**
 * Preview what a database merge would add or skip without mutating current data.
 */
export function previewMergeDatabase(fileBuffer: Buffer): DatabaseMergeSummary {
  const tempImportPath = prepareTempImportFile(fileBuffer);
  let sourceDb: Database.Database | null = null;

  try {
    const openedSourceDb = new Database(tempImportPath, { readonly: true });
    sourceDb = openedSourceDb;

    const hasMergeableData = MERGEABLE_TABLES.some((tableName) =>
      hasTable(openedSourceDb, tableName)
    );
    if (!hasMergeableData) {
      throw new ValidationError(
        "Uploaded database does not contain compatible MyTube tables to merge.",
        "file"
      );
    }

    return executeDatabaseMerge(openedSourceDb, sqlite, {
      applyChanges: false,
      persistTagSettings: false,
    });
  } catch (error) {
    logger.error(
      "Database merge preview failed:",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
    cleanupTempImportFile(tempImportPath);
  }
}

/**
 * Merge another database backup into the current database
 * Current instance settings, credentials, and runtime download/task state are preserved.
 */
export function mergeDatabase(fileBuffer: Buffer): DatabaseMergeSummary {
  const tempImportPath = prepareTempImportFile(fileBuffer);
  let sourceDb: Database.Database | null = null;

  try {
    const openedSourceDb = new Database(tempImportPath, { readonly: true });
    sourceDb = openedSourceDb;

    const hasMergeableData = MERGEABLE_TABLES.some((tableName) =>
      hasTable(openedSourceDb, tableName)
    );
    if (!hasMergeableData) {
      throw new ValidationError(
        "Uploaded database does not contain compatible MyTube tables to merge.",
        "file"
      );
    }

    createBackup();

    const summary = sqlite.transaction(() =>
      executeDatabaseMerge(openedSourceDb, sqlite, {
        applyChanges: true,
        persistTagSettings: true,
      })
    )();

    logger.info(
      `Merged database backup successfully: ${JSON.stringify(summary)}`
    );

    return summary;
  } catch (error) {
    logger.error(
      "Database merge failed:",
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
    cleanupTempImportFile(tempImportPath);
  }
}

/**
 * Get last backup database file info
 */
export function getLastBackupInfo(): {
  exists: boolean;
  filename?: string;
  timestamp?: string;
} {
  const backupFiles = getBackupFiles();

  if (backupFiles.length === 0) {
    return { exists: false };
  }

  const lastBackup = backupFiles[0];
  return {
    exists: true,
    filename: lastBackup.filename,
    timestamp: lastBackup.timestamp,
  };
}

/**
 * Restore database from last backup file
 */
export function restoreFromLastBackup(): void {
  const backupFiles = getBackupFiles();

  if (backupFiles.length === 0) {
    throw new NotFoundError(
      "Backup database file",
      "mytube-backup-*.db.backup"
    );
  }

  const lastBackup = backupFiles[0];
  const backupPath = lastBackup.filePath;
  const resolvedBackupPath = path.resolve(backupPath);
  const isSafeBackupPath = isPathWithinDirectory(
    resolvedBackupPath,
    RESOLVED_DATA_DIR,
  );
  if (!isSafeBackupPath) {
    throw new ValidationError("Invalid backup file path", "file");
  }

  // Validate the backup file is a valid SQLite database
  validateDatabase(resolvedBackupPath);

  // Create backup of current database before restore
  createBackup();

  // Close the current database connection before replacing the file
  sqlite.close();
  logger.info("Closed current database connection for restore");

  // Copy the backup file to replace the database
  copyFileSafeSync(resolvedBackupPath, DATA_DIR, RESOLVED_DB_PATH, DATA_DIR);
  logger.info(
    `Database file restored successfully from ${lastBackup.filename}`
  );

  // Reinitialize the database connection with the restored file
  reinitializeDatabase();
}

/**
 * Clean up backup database files
 */
export function cleanupBackupDatabases(): {
  deleted: number;
  failed: number;
  errors: string[];
} {
  let deletedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  try {
    const files = readdirSafeSync(DATA_DIR, DATA_DIR);

    for (const file of files) {
      if (backupPattern.test(file)) {
        const filePath = resolveSafePath(path.join(DATA_DIR, file), DATA_DIR);
        try {
          unlinkSafeSync(filePath, DATA_DIR);
          deletedCount++;
          logger.info(`Deleted backup database file: ${file}`);
        } catch (error: any) {
          failedCount++;
          const errorMsg = `Failed to delete ${file}: ${error.message}`;
          errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }
    }
  } catch (error: any) {
    logger.error("Error cleaning up backup databases:", error);
    throw error;
  }

  return {
    deleted: deletedCount,
    failed: failedCount,
    errors,
  };
}
