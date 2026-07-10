import Database from "better-sqlite3";
import { invalidateSettingsCache } from "../storageService/settings";
import {
  buildHistoryMergeKey,
  buildInsertStatement,
  buildVideoDownloadKey,
  collectImportedTags,
  getInsertId,
  getRequiredString,
  getSharedColumns,
  hasTable,
  parseTagList,
  readTableRows,
  remapRow,
  toLookupKey,
} from "./sqliteHelpers";
import {
  createEmptyMergeSummary,
  DatabaseMergeSummary,
  MergeExecutionOptions,
  MergeRow,
} from "./types";

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
      "SELECT id, source_video_id AS source_video_id, platform, media_type AS media_type FROM video_downloads"
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

export function executeDatabaseMerge(
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
