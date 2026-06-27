import { sqlite } from "../../../db";
import { extractTwitchVideoId } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";

type VideoDownloadDuplicateGroup = {
  sourceVideoId: string;
  platform: string;
  count: number;
};

type VideoDownloadRecord = {
  id: string;
  status: string;
  downloadedAt: number | null;
};

type TwitchVideoDownloadRow = {
  id: string;
  sourceVideoId: string;
  sourceUrl: string;
  platform: string;
  videoId: string | null;
  title: string | null;
  author: string | null;
  status: string;
  downloadedAt: number | null;
  deletedAt: number | null;
};

export function deduplicateVideoDownloadsBySourceAndPlatform(): void {
  const duplicateGroups = sqlite
    .prepare(
      `
      SELECT
        source_video_id AS sourceVideoId,
        platform,
        COUNT(*) AS count
      FROM video_downloads
      GROUP BY source_video_id, platform
      HAVING COUNT(*) > 1
      `
    )
    .all() as VideoDownloadDuplicateGroup[];

  if (duplicateGroups.length === 0) {
    return;
  }

  logger.warn(
    `Found ${duplicateGroups.length} duplicated video_downloads groups, deduplicating before unique index migration`
  );

  const getRecordsStatement = sqlite.prepare(
    `
    SELECT
      id,
      status,
      downloaded_at AS downloadedAt
    FROM video_downloads
    WHERE source_video_id = ? AND platform = ?
    ORDER BY
      CASE WHEN status = 'exists' THEN 0 ELSE 1 END ASC,
      COALESCE(downloaded_at, 0) DESC,
      id ASC
    `
  );

  const deleteDuplicatesStatement = sqlite.prepare(
    `
    DELETE FROM video_downloads
    WHERE source_video_id = ? AND platform = ? AND id <> ?
    `
  );

  for (const group of duplicateGroups) {
    const records = getRecordsStatement.all(
      group.sourceVideoId,
      group.platform
    ) as VideoDownloadRecord[];

    if (records.length <= 1) {
      continue;
    }

    const keepRecord = records[0];
    const deletedCount = deleteDuplicatesStatement.run(
      group.sourceVideoId,
      group.platform,
      keepRecord.id
    ).changes;

    logger.warn(
      `Deduplicated video_downloads (${group.sourceVideoId}, ${group.platform}), kept ${keepRecord.id}, removed ${deletedCount} records`
    );
  }
}

function mergeTwitchVideoDownloadRows(
  existingRecord: TwitchVideoDownloadRow | undefined,
  legacyRecord: TwitchVideoDownloadRow,
  targetVideoId: string
): TwitchVideoDownloadRow {
  const preferredSourceUrl =
    existingRecord?.sourceUrl?.trim() || legacyRecord.sourceUrl;
  const preferredVideoId =
    existingRecord?.videoId || legacyRecord.videoId || null;
  const preferredTitle =
    existingRecord?.title?.trim() || legacyRecord.title?.trim() || null;
  const preferredAuthor =
    existingRecord?.author?.trim() || legacyRecord.author?.trim() || null;
  const earliestDownloadedAt = [existingRecord?.downloadedAt, legacyRecord.downloadedAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right)[0] ?? Date.now();
  const mergedStatus =
    existingRecord?.status === "exists" || legacyRecord.status === "exists"
      ? "exists"
      : "deleted";

  return {
    id: existingRecord?.id || legacyRecord.id,
    sourceVideoId: targetVideoId,
    sourceUrl: preferredSourceUrl,
    platform: "twitch",
    videoId: preferredVideoId,
    title: preferredTitle,
    author: preferredAuthor,
    status: mergedStatus,
    downloadedAt: earliestDownloadedAt,
    deletedAt: mergedStatus === "exists"
      ? null
      : existingRecord?.deletedAt || legacyRecord.deletedAt || null,
  };
}

export function normalizeLegacyTwitchDownloads(): void {
  sqlite
    .prepare(
      "UPDATE videos SET source = 'twitch' WHERE source_url LIKE '%twitch.tv/videos/%' AND COALESCE(source, '') <> 'twitch'"
    )
    .run();

  const selectLegacyRows = sqlite.prepare(`
    SELECT
      id,
      source_video_id AS sourceVideoId,
      source_url AS sourceUrl,
      platform,
      video_id AS videoId,
      title,
      author,
      status,
      downloaded_at AS downloadedAt,
      deleted_at AS deletedAt
    FROM video_downloads
    WHERE platform = 'other'
    ORDER BY COALESCE(downloaded_at, 0) ASC, id ASC
  `);
  const selectExistingTwitchRow = sqlite.prepare(`
    SELECT
      id,
      source_video_id AS sourceVideoId,
      source_url AS sourceUrl,
      platform,
      video_id AS videoId,
      title,
      author,
      status,
      downloaded_at AS downloadedAt,
      deleted_at AS deletedAt
    FROM video_downloads
    WHERE source_video_id = ? AND platform = 'twitch'
    LIMIT 1
  `);
  const updateRow = sqlite.prepare(`
    UPDATE video_downloads
    SET
      source_video_id = ?,
      source_url = ?,
      platform = ?,
      video_id = ?,
      title = ?,
      author = ?,
      status = ?,
      downloaded_at = ?,
      deleted_at = ?
    WHERE id = ?
  `);
  const deleteRow = sqlite.prepare(`
    DELETE FROM video_downloads
    WHERE id = ?
  `);
  const updateVideosSource = sqlite.prepare(`
    UPDATE videos
    SET source = 'twitch'
    WHERE source_url = ? AND COALESCE(source, '') <> 'twitch'
  `);

  const runNormalization = sqlite.transaction(() => {
    const legacyRows = selectLegacyRows.all() as TwitchVideoDownloadRow[];
    let normalizedCount = 0;
    let mergedCount = 0;

    for (const legacyRow of legacyRows) {
      const twitchVideoId = extractTwitchVideoId(legacyRow.sourceUrl);
      if (!twitchVideoId) {
        continue;
      }

      updateVideosSource.run(legacyRow.sourceUrl);

      const existingTwitchRow = selectExistingTwitchRow.get(
        twitchVideoId
      ) as TwitchVideoDownloadRow | undefined;
      const mergedRecord = mergeTwitchVideoDownloadRows(
        existingTwitchRow,
        legacyRow,
        twitchVideoId
      );

      if (existingTwitchRow) {
        updateRow.run(
          mergedRecord.sourceVideoId,
          mergedRecord.sourceUrl,
          mergedRecord.platform,
          mergedRecord.videoId,
          mergedRecord.title,
          mergedRecord.author,
          mergedRecord.status,
          mergedRecord.downloadedAt,
          mergedRecord.deletedAt,
          existingTwitchRow.id
        );

        if (legacyRow.id !== existingTwitchRow.id) {
          deleteRow.run(legacyRow.id);
          mergedCount += 1;
        }
      } else {
        updateRow.run(
          mergedRecord.sourceVideoId,
          mergedRecord.sourceUrl,
          mergedRecord.platform,
          mergedRecord.videoId,
          mergedRecord.title,
          mergedRecord.author,
          mergedRecord.status,
          mergedRecord.downloadedAt,
          mergedRecord.deletedAt,
          legacyRow.id
        );
      }

      normalizedCount += 1;
    }

    return { normalizedCount, mergedCount };
  });

  const result = runNormalization();
  if (result.normalizedCount > 0) {
    logger.info(
      `Normalized ${result.normalizedCount} legacy Twitch video_downloads rows (${result.mergedCount} merged into existing twitch rows)`
    );
  }
}
