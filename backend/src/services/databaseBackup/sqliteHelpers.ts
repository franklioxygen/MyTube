import Database from "better-sqlite3";
import crypto from "crypto";
import { ValidationError } from "../../errors/DownloadErrors";
import { MergeRow } from "./types";

export function getMergeRowValue(row: MergeRow, key: string): unknown {
  for (const [entryKey, entryValue] of Object.entries(row)) {
    if (entryKey === key) {
      return entryValue;
    }
  }

  return undefined;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName);
  return Boolean(row);
}

export function getTableColumns(
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

export function getSharedColumns(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  tableName: string
): string[] {
  const sourceColumns = new Set(getTableColumns(sourceDb, tableName));
  return getTableColumns(targetDb, tableName).filter((column) =>
    sourceColumns.has(column)
  );
}

export function readTableRows(
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

export function buildInsertStatement(
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

export function toLookupKey(
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

export function getRequiredString(row: MergeRow, key: string): string {
  const value = getMergeRowValue(row, key);
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

export function remapRow(
  row: MergeRow,
  columns: string[],
  overrides: Record<string, unknown> = {}
): MergeRow {
  return Object.fromEntries(
    columns.map((column) => {
      const value = Object.prototype.hasOwnProperty.call(overrides, column)
        ? getMergeRowValue(overrides, column)
        : getMergeRowValue(row, column);
      return [column, value];
    })
  );
}

export function getInsertId(existingIds: Set<string>, sourceId: string): string {
  if (!existingIds.has(sourceId)) {
    return sourceId;
  }

  let generatedId = crypto.randomUUID();
  while (existingIds.has(generatedId)) {
    generatedId = crypto.randomUUID();
  }

  return generatedId;
}

export function buildHistoryMergeKey(row: MergeRow): string | null {
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

export function buildVideoDownloadKey(row: MergeRow): string | null {
  const sourceVideoId = toLookupKey(row.source_video_id);
  const platform = toLookupKey(row.platform, { caseInsensitive: true });

  if (!sourceVideoId || !platform) {
    return null;
  }

  return `${sourceVideoId}::${platform}`;
}

export function parseTagList(value: unknown): string[] {
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

export function collectImportedTags(sourceDb: Database.Database): string[] {
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
