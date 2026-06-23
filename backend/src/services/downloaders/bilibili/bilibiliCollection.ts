import axios from "axios";
import { logger } from "../../../utils/logger";
import {
  isCancellationError,
  throwIfCancelled,
} from "../../../utils/downloadUtils";
import type { DownloadRetryMetadata } from "../../downloadRetryMetadata";
import * as storageService from "../../storageService";
import { Collection } from "../../storageService";
import { resolveAuthorOrganizationMode } from "../../../types/settings";
import { downloadSinglePart } from "./bilibiliVideo";
import {
  BILIBILI_COOKIE_REFRESH_HINT,
  isLikelyBilibiliAuthFailure,
} from "./bilibiliConfig";
import type { FilenameTemplateSourceOptions } from "../../filenameTemplate/types";
import {
  BilibiliAggregateDownloadResult,
  BilibiliCollectionCheckResult,
  BilibiliVideoItem,
  BilibiliVideosResult,
  CollectionDownloadResult,
} from "./types";

// When a collection episode is rejected for what looks like Bilibili risk
// control, wait this long before the single retry — longer than the normal
// 2s inter-part delay to let a transient throttle clear (issue #295).
const RISK_CONTROL_RETRY_DELAY_MS = 15000;

async function waitForRiskControlRetry(downloadId: string): Promise<void> {
  throwIfCancelled(downloadId);
  await new Promise((resolve) =>
    setTimeout(resolve, RISK_CONTROL_RETRY_DELAY_MS),
  );
  throwIfCancelled(downloadId);
}

const buildAggregateErrorMessage = (
  label: string,
  expectedCount: number,
  downloadedCount: number,
  skippedCount: number,
  failedPartNumbers: number[],
): string => {
  if (failedPartNumbers.length === 0) {
    return "";
  }

  const completedCount = downloadedCount + skippedCount;
  return `Bilibili ${label} incomplete: processed ${completedCount}/${expectedCount}; downloaded ${downloadedCount}, skipped ${skippedCount}, failed ${failedPartNumbers.length} (${failedPartNumbers.join(", ")})`;
};

const normalizeUploadDate = (value: unknown): string | undefined => {
  if (typeof value === "string" && /^\d{8}$/.test(value)) {
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  const milliseconds = value > 1e12 ? value : value * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
};

const normalizeViewCount = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const cleaned = value.trim().toLowerCase().replace(/,/g, "");
  if (!cleaned || cleaned === "--") {
    return undefined;
  }

  const unitMatch = cleaned.match(/^([\d.]+)\s*([kmb]|万|亿)?$/);
  if (unitMatch) {
    const numeric = Number.parseFloat(unitMatch[1]);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return undefined;
    }
    const unit = unitMatch[2];
    const multiplier =
      unit === "k"
        ? 1e3
        : unit === "m"
          ? 1e6
          : unit === "b"
            ? 1e9
            : unit === "万"
              ? 1e4
              : unit === "亿"
                ? 1e8
                : 1;
    return Math.floor(numeric * multiplier);
  }

  const digits = cleaned.replace(/[^\d]/g, "");
  if (!digits) {
    return undefined;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getCollectionDisplayName = (collection: Collection): string =>
  collection.name || collection.title || "";

type BilibiliSourceKey = {
  sourcePlatform: string;
  sourceType: string;
  sourceMid: string;
  sourceId: string;
};

const hasBilibiliSourceKey = (collection: Collection): boolean =>
  Boolean(
    collection.sourcePlatform ||
      collection.sourceType ||
      collection.sourceMid ||
      collection.sourceId,
  );

const matchesBilibiliSourceKey = (
  collection: Collection,
  sourceKey: BilibiliSourceKey,
): boolean =>
  collection.sourcePlatform === sourceKey.sourcePlatform &&
  collection.sourceType === sourceKey.sourceType &&
  collection.sourceMid === sourceKey.sourceMid &&
  collection.sourceId === sourceKey.sourceId;

const canReuseCollectionForSource = (
  collection: Collection,
  sourceKey?: BilibiliSourceKey,
): boolean =>
  !hasBilibiliSourceKey(collection) ||
  (sourceKey != null && matchesBilibiliSourceKey(collection, sourceKey));

function resolveExistingBilibiliCollection(
  videos: BilibiliVideoItem[],
  preferredCollectionName: string,
  sourceKey?: BilibiliSourceKey,
): Collection | undefined {
  const candidateCounts = new Map<
    string,
    { collection: Collection; count: number }
  >();

  for (const video of videos) {
    const existingVideo = storageService.getVideoBySourceUrl(
      `https://www.bilibili.com/video/${video.bvid}`,
    );
    if (!existingVideo?.id) {
      continue;
    }

    const memberships = storageService.getCollectionsByVideoId(existingVideo.id);
    const sourceCompatibleMemberships = memberships.filter((collection) =>
      canReuseCollectionForSource(collection, sourceKey),
    );
    const preferredMemberships = sourceCompatibleMemberships.filter(
      (collection) => collection.origin !== "author_auto",
    );
    const collectionsToCount =
      preferredMemberships.length > 0
        ? preferredMemberships
        : sourceCompatibleMemberships;

    for (const collection of collectionsToCount) {
      const existing = candidateCounts.get(collection.id);
      candidateCounts.set(collection.id, {
        collection,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  const rankedCandidates = Array.from(candidateCounts.values()).sort(
    (left, right) => {
      const leftMatchesName =
        getCollectionDisplayName(left.collection) === preferredCollectionName;
      const rightMatchesName =
        getCollectionDisplayName(right.collection) === preferredCollectionName;
      if (leftMatchesName !== rightMatchesName) {
        return leftMatchesName ? -1 : 1;
      }

      const leftIsManual = left.collection.origin !== "author_auto";
      const rightIsManual = right.collection.origin !== "author_auto";
      if (leftIsManual !== rightIsManual) {
        return leftIsManual ? -1 : 1;
      }

      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return getCollectionDisplayName(left.collection).localeCompare(
        getCollectionDisplayName(right.collection),
      );
    },
  );

  if (rankedCandidates.length > 0) {
    return rankedCandidates[0].collection;
  }

  const namedCollection = storageService.getCollectionByName(preferredCollectionName);
  if (
    namedCollection &&
    namedCollection.origin !== "author_auto" &&
    canReuseCollectionForSource(namedCollection, sourceKey)
  ) {
    return namedCollection;
  }

  return undefined;
}

/**
 * Get all videos from a Bilibili collection
 */
export async function getCollectionVideos(
  mid: number,
  seasonId: number
): Promise<BilibiliVideosResult> {
  try {
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;
    const pageSize = 30;
    let hasMore = true;

    logger.info(
      `Fetching collection videos for mid=${mid}, season_id=${seasonId}`
    );

    while (hasMore) {
      const apiUrl = `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list`;
      const params = {
        mid: mid,
        season_id: seasonId,
        page_num: pageNum,
        page_size: pageSize,
        sort_reverse: false,
      };

      logger.info(`Fetching page ${pageNum} of collection...`);

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (response.data && response.data.data) {
        const data = response.data.data;
        const archives = data.archives || [];

        logger.info(`Got ${archives.length} videos from page ${pageNum}`);

        archives.forEach((video: any) => {
          allVideos.push({
            bvid: video.bvid,
            title: video.title,
            aid: video.aid,
            uploadDate: normalizeUploadDate(video.pubdate ?? video.ctime ?? video.created),
            viewCount: normalizeViewCount(video.stat?.view ?? video.play),
          });
        });

        // Check if there are more pages
        const total = data.page?.total || 0;
        hasMore = allVideos.length < total;
        pageNum++;
      } else {
        hasMore = false;
      }
    }

    logger.info(`Total videos in collection: ${allVideos.length}`);
    return { success: true, videos: allVideos };
  } catch (error) {
    logger.error("Error fetching collection videos:", error);
    return { success: false, videos: [] };
  }
}

/**
 * Get all videos from a Bilibili series
 */
export async function getSeriesVideos(
  mid: number,
  seriesId: number
): Promise<BilibiliVideosResult> {
  try {
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;
    const pageSize = 30;
    let hasMore = true;

    logger.info(`Fetching series videos for mid=${mid}, series_id=${seriesId}`);

    while (hasMore) {
      const apiUrl = `https://api.bilibili.com/x/series/archives`;
      const params = {
        mid: mid,
        series_id: seriesId,
        pn: pageNum,
        ps: pageSize,
      };

      logger.info(`Fetching page ${pageNum} of series...`);

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (response.data && response.data.data) {
        const data = response.data.data;
        const archives = data.archives || [];

        logger.info(`Got ${archives.length} videos from page ${pageNum}`);

        archives.forEach((video: any) => {
          allVideos.push({
            bvid: video.bvid,
            title: video.title,
            aid: video.aid,
            uploadDate: normalizeUploadDate(video.pubdate ?? video.ctime ?? video.created),
            viewCount: normalizeViewCount(video.stat?.view ?? video.play),
          });
        });

        // Check if there are more pages
        const page = data.page || {};
        hasMore =
          archives.length === pageSize && allVideos.length < (page.total || 0);
        pageNum++;
      } else {
        hasMore = false;
      }
    }

    logger.info(`Total videos in series: ${allVideos.length}`);
    return { success: true, videos: allVideos };
  } catch (error) {
    logger.error("Error fetching series videos:", error);
    return { success: false, videos: [] };
  }
}

/**
 * Download all videos from a Bilibili collection or series
 */
export async function downloadCollection(
  collectionInfo: BilibiliCollectionCheckResult,
  collectionName: string,
  downloadId: string,
  onStart?: (cancel: () => void) => void,
  retryMetadata?: DownloadRetryMetadata,
): Promise<CollectionDownloadResult> {
  try {
    const { type, id, mid, title, count } = collectionInfo;

    logger.info(`Starting download of ${type}: ${title} (${count} videos)`);

    if (downloadId) {
      storageService.updateActiveDownloadTitle(
        downloadId,
        `Downloading ${type}: ${title}`
      );
    }

    // Fetch all videos from the collection/series
    let videosResult: BilibiliVideosResult;
    if (type === "collection" && mid && id) {
      videosResult = await getCollectionVideos(mid, id);
    } else if (type === "series" && mid && id) {
      videosResult = await getSeriesVideos(mid, id);
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    if (!videosResult.success || videosResult.videos.length === 0) {
      throw new Error(`Failed to fetch videos from ${type}`);
    }

    const videos = videosResult.videos;
    logger.info(`Found ${videos.length} videos to download`);
    const retryCollectionMetadata =
      retryMetadata?.shape === "bilibili_collection" ? retryMetadata : undefined;
    if (retryCollectionMetadata) {
      retryCollectionMetadata.collectionName =
        collectionName || retryCollectionMetadata.collectionName || title || "Collection";
      retryCollectionMetadata.expectedCount = videos.length;
      retryCollectionMetadata.expectedVideoBvids = videos.map((video) => video.bvid);
      retryCollectionMetadata.completedVideoBvids = undefined;
      retryCollectionMetadata.failedVideoBvids = undefined;
      retryCollectionMetadata.lastAttemptedAt = Date.now();
    }

    const resolvedCollectionName = collectionName || title || "Collection";

    // Stable Bilibili source identity for this collection/series (issue #295).
    // Used to reuse the same MyTube collection on re-download/repair instead of
    // creating a duplicate. Only valid when type/mid/id are all present.
    const sourceKey =
      (type === "collection" || type === "series") &&
      mid != null &&
      id != null
        ? {
            sourcePlatform: "bilibili",
            sourceType: type,
            sourceMid: String(mid),
            sourceId: String(id),
          }
        : undefined;

    let mytubeCollection: Collection | undefined;
    if (retryCollectionMetadata?.linkedCollectionId) {
      mytubeCollection = storageService.getCollectionById(
        retryCollectionMetadata.linkedCollectionId,
      );
    }

    // Prefer the stable source key: this reliably re-finds the existing collection
    // even after renames, cleanup, or membership changes.
    if (!mytubeCollection && sourceKey) {
      mytubeCollection = storageService.getCollectionBySourceKey(
        sourceKey.sourcePlatform,
        sourceKey.sourceType,
        sourceKey.sourceMid,
        sourceKey.sourceId,
      );
      if (mytubeCollection) {
        logger.info(
          `Reusing existing MyTube collection by source key: ${getCollectionDisplayName(mytubeCollection)}`,
        );
      }
    }

    if (!mytubeCollection) {
      mytubeCollection = resolveExistingBilibiliCollection(
        videos,
        resolvedCollectionName,
        sourceKey,
      );
      if (mytubeCollection) {
        logger.info(
          `Reusing existing MyTube collection: ${getCollectionDisplayName(mytubeCollection)}`,
        );
      }
    }

    // Safety net: before creating a brand-new collection, reuse a same-named
    // non-author collection if one already exists. This prevents two collections
    // with the same name when the legacy resolver fails to match.
    if (!mytubeCollection) {
      const namedCollection = storageService.getCollectionByName(
        resolvedCollectionName,
      );
      if (
        namedCollection &&
        namedCollection.origin !== "author_auto" &&
        canReuseCollectionForSource(namedCollection, sourceKey)
      ) {
        mytubeCollection = namedCollection;
        logger.info(
          `Reusing existing same-named MyTube collection: ${getCollectionDisplayName(namedCollection)}`,
        );
      }
    }

    if (!mytubeCollection) {
      mytubeCollection = {
        id: Date.now().toString(),
        name: resolvedCollectionName,
        videos: [],
        createdAt: new Date().toISOString(),
        title: resolvedCollectionName,
        ...(sourceKey ?? {}),
      };
      storageService.saveCollection(mytubeCollection);
    } else if (sourceKey) {
      // Backfill the stable source key onto a reused legacy collection so future
      // re-downloads can match it directly.
      const needsBackfill =
        mytubeCollection.sourcePlatform !== sourceKey.sourcePlatform ||
        mytubeCollection.sourceType !== sourceKey.sourceType ||
        mytubeCollection.sourceMid !== sourceKey.sourceMid ||
        mytubeCollection.sourceId !== sourceKey.sourceId;
      if (needsBackfill) {
        mytubeCollection = { ...mytubeCollection, ...sourceKey };
        storageService.saveCollection(mytubeCollection);
        logger.info(
          `Backfilled source key on collection: ${getCollectionDisplayName(mytubeCollection)}`,
        );
      }
    }

    const mytubeCollectionId = mytubeCollection.id;
    if (retryCollectionMetadata) {
      retryCollectionMetadata.linkedCollectionId = mytubeCollectionId;
    }

    logger.info(`Using MyTube collection: ${mytubeCollection.name}`);
    let downloadedCount = 0;
    const failedPartNumbers: number[] = [];
    let sawRiskControlFailure = false;
    let firstVideo: CollectionDownloadResult["firstVideo"];

    // Download each video sequentially
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoNumber = i + 1;

      // Update status
      if (downloadId) {
        storageService.updateActiveDownloadTitle(
          downloadId,
          `Downloading ${videoNumber}/${videos.length}: ${video.title}`
        );
      }

      logger.info(
        `Downloading video ${videoNumber}/${videos.length}: ${video.title}`
      );

      // Construct video URL
      const videoUrl = `https://www.bilibili.com/video/${video.bvid}`;
      const existingVideo = storageService.getVideoBySourceUrl(videoUrl);
      if (existingVideo) {
        storageService.linkVideoToCollection(mytubeCollectionId, existingVideo.id, {
          moveFiles: false,
          order: videoNumber,
        });
        downloadedCount += 0;
        if (!firstVideo) {
          firstVideo = existingVideo;
        }
        if (retryCollectionMetadata) {
          retryCollectionMetadata.completedVideoBvids = Array.from(
            new Set([
              ...(retryCollectionMetadata.completedVideoBvids ?? []),
              video.bvid,
            ]),
          );
        }
        logger.info(
          `Video ${videoNumber}/${videos.length} already exists, skipping. Video ID: ${existingVideo.id}`
        );
        // Small delay between downloads to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      try {
        // Download this video
        const collectionName = mytubeCollection.name || mytubeCollection.title;
        const sourceOptions: FilenameTemplateSourceOptions = {
          sourceCollectionName: collectionName || title || "Collection",
          sourceCollectionType: "playlist",
          mediaPlaylistIndex: videoNumber,
        };
        const downloadPart = () =>
          downloadSinglePart(
            videoUrl,
            videoNumber,
            videos.length,
            title || "Collection",
            downloadId,
            onStart,
            collectionName, // collectionName
            sourceOptions, // filenameTemplateSourceOptions
          );

        let result = await downloadPart();

        // Bilibili sometimes rejects individual episodes mid-collection for risk
        // control even with a valid cookie. Back off once and retry the part
        // before marking it failed (issue #295). Cancellations throw rather than
        // returning a failure result, so they are never retried here.
        if (!result.success && isLikelyBilibiliAuthFailure(result.error)) {
          logger.warn(
            `Video ${videoNumber}/${videos.length} hit a possible Bilibili risk-control/cookie rejection; ` +
              `backing off ${RISK_CONTROL_RETRY_DELAY_MS / 1000}s and retrying once. ` +
              `If episodes keep failing, refresh your Bilibili cookie and re-download.`,
          );
          await waitForRiskControlRetry(downloadId);
          result = await downloadPart();
        }

        // If download was successful, add to collection
        if (result.success && result.videoData) {
          downloadedCount++;
          if (!firstVideo) {
            firstVideo = result.videoData;
          }
          if (retryCollectionMetadata) {
            retryCollectionMetadata.completedVideoBvids = Array.from(
              new Set([
                ...(retryCollectionMetadata.completedVideoBvids ?? []),
                video.bvid,
              ]),
            );
          }
          storageService.linkVideoToCollection(
            mytubeCollectionId,
            result.videoData.id,
            {
              moveFiles: false,
              order: videoNumber,
            },
          );

          logger.info(
            `Added video ${videoNumber}/${videos.length} to collection`
          );
        } else {
          failedPartNumbers.push(videoNumber);
          if (isLikelyBilibiliAuthFailure(result.error)) {
            sawRiskControlFailure = true;
          }
          if (retryCollectionMetadata) {
            retryCollectionMetadata.failedVideoBvids = Array.from(
              new Set([
                ...(retryCollectionMetadata.failedVideoBvids ?? []),
                video.bvid,
              ]),
            );
          }
          logger.error(
            `Failed to download video ${videoNumber}/${videos.length}: ${video.title}${result.error ? ` (${result.error})` : ""}`
          );
        }
      } catch (videoError) {
        if (isCancellationError(videoError)) {
          throw videoError;
        }
        failedPartNumbers.push(videoNumber);
        if (retryCollectionMetadata) {
          retryCollectionMetadata.failedVideoBvids = Array.from(
            new Set([
              ...(retryCollectionMetadata.failedVideoBvids ?? []),
              video.bvid,
            ]),
          );
        }
        logger.error(
          `Error downloading video ${videoNumber}/${videos.length}:`,
          videoError
        );
        // Continue with next video even if one fails
      }

      // Small delay between downloads to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    logger.info(`Finished downloading ${type}: ${title}`);

    // Under author_folder_only, collection members live in the author folder.
    // Remove any now-empty collection-named folder left from initial placement so
    // it does not linger in the storage root (issue #295 2-2). This only removes
    // empty directories, so legitimate files are never touched.
    try {
      const organizationMode = resolveAuthorOrganizationMode(
        storageService.getSettings(),
      );
      if (organizationMode === "author_folder_only" && resolvedCollectionName) {
        storageService.cleanupCollectionDirectories(resolvedCollectionName);
      }
    } catch (cleanupError) {
      logger.warn(
        "Failed to clean up residual collection directories:",
        cleanupError,
      );
    }

    const skippedCount = videos.length - downloadedCount - failedPartNumbers.length;
    const partial =
      failedPartNumbers.length > 0 && downloadedCount + skippedCount > 0;
    const success = failedPartNumbers.length === 0;
    let error = buildAggregateErrorMessage(
      "collection",
      videos.length,
      downloadedCount,
      skippedCount,
      failedPartNumbers,
    );
    if (error && sawRiskControlFailure) {
      error = `${error}. ${BILIBILI_COOKIE_REFRESH_HINT}`;
    }

    return {
      success,
      partial,
      expectedCount: videos.length,
      downloadedCount,
      skippedCount,
      failedPartNumbers,
      firstVideo,
      collectionId: mytubeCollectionId,
      videosDownloaded: downloadedCount,
      isCollection: true,
      error: error || undefined,
    };
  } catch (error: any) {
    if (isCancellationError(error)) {
      throw error;
    }
    logger.error(`Error downloading ${collectionInfo.type}:`, error);
    return {
      success: false,
      partial: false,
      expectedCount: collectionInfo.count ?? 0,
      downloadedCount: 0,
      skippedCount: 0,
      failedPartNumbers: [],
      isCollection: true,
      error: error.message,
    };
  }
}

/**
 * Download remaining Bilibili parts in sequence
 */
export async function downloadRemainingParts(
  baseUrl: string,
  startPart: number,
  totalParts: number,
  seriesTitle: string,
  collectionId: string | null,
  downloadId: string,
  onStart?: (cancel: () => void) => void,
  retryMetadata?: DownloadRetryMetadata,
): Promise<BilibiliAggregateDownloadResult> {
  try {
    logger.info(
      `Starting download of remaining parts: ${startPart} to ${totalParts} of "${seriesTitle}"`
    );
    
    if (downloadId) {
      storageService.updateActiveDownloadTitle(
        downloadId,
        `Downloading ${seriesTitle}`
      );
    }
    const retryPartsMetadata =
      retryMetadata?.shape === "bilibili_all_parts" ? retryMetadata : undefined;
    if (retryPartsMetadata) {
      retryPartsMetadata.expectedCount = totalParts;
      retryPartsMetadata.lastAttemptedAt = Date.now();
    }

    let successCount = 0;
    let skippedCount = 0;
    const failedParts: number[] = [];
    const skippedParts: number[] = [];
    let firstVideo: BilibiliAggregateDownloadResult["firstVideo"];

    for (let part = startPart; part <= totalParts; part++) {
      // Construct URL for this part
      const partUrl = `${baseUrl}?p=${part}`;

      // Check if this part already exists
      const existingVideo = storageService.getVideoBySourceUrl(partUrl);
      if (existingVideo) {
        skippedCount++;
        skippedParts.push(part);
        if (retryPartsMetadata) {
          retryPartsMetadata.completedPartNumbers = Array.from(
            new Set([...(retryPartsMetadata.completedPartNumbers ?? []), part]),
          ).sort((left, right) => left - right);
        }
        logger.info(
          `Part ${part}/${totalParts} already exists, skipping. Video ID: ${existingVideo.id}`
        );

        // If we have a collection ID, make sure the existing video is in the collection
        if (collectionId && existingVideo.id) {
          try {
            storageService.linkVideoToCollection(collectionId, existingVideo.id, {
              moveFiles: false,
              order: part,
            });
            logger.info(
              `Linked existing part ${part}/${totalParts} to collection ${collectionId}`
            );
          } catch (collectionError) {
            logger.error(
              `Error adding existing part ${part}/${totalParts} to collection:`,
              collectionError
            );
          }
        }
        continue;
      }

      logger.info(`Starting download of part ${part}/${totalParts}`);
      // Update status to show which part is being downloaded
      if (downloadId) {
        storageService.updateActiveDownloadTitle(
          downloadId,
          `Downloading part ${part}/${totalParts}: ${seriesTitle}`
        );
      }

      // Get collection name if collectionId is provided
      let collectionName: string | undefined;
      if (collectionId) {
        const collection = storageService.getCollectionById(collectionId);
        if (collection) {
          collectionName = collection.name || collection.title;
        }
      }

      // Download this part
      const result = await downloadSinglePart(
        partUrl,
        part,
        totalParts,
        seriesTitle,
        downloadId,
        onStart,
        collectionName,
        {
          sourceCollectionName: collectionName || seriesTitle,
          sourceCollectionType: "playlist",
          mediaPlaylistIndex: part,
        } // filenameTemplateSourceOptions
      );

      if (result.success && result.videoData) {
        successCount++;
        if (retryPartsMetadata) {
          retryPartsMetadata.completedPartNumbers = Array.from(
            new Set([...(retryPartsMetadata.completedPartNumbers ?? []), part]),
          ).sort((left, right) => left - right);
        }
        if (!firstVideo) {
          firstVideo = result.videoData;
        }
        // If download was successful and we have a collection ID, add to collection
        if (collectionId) {
          try {
            storageService.linkVideoToCollection(collectionId, result.videoData.id, {
              moveFiles: false,
              order: part,
            });

            logger.info(
              `Added part ${part}/${totalParts} to collection ${collectionId}`
            );
          } catch (collectionError) {
            logger.error(
              `Error adding part ${part}/${totalParts} to collection:`,
              collectionError
            );
          }
        }
        logger.info(`Successfully downloaded part ${part}/${totalParts}`);
      } else {
        failedParts.push(part);
        if (retryPartsMetadata) {
          retryPartsMetadata.failedPartNumbers = Array.from(
            new Set([...(retryPartsMetadata.failedPartNumbers ?? []), part]),
          ).sort((left, right) => left - right);
        }
        logger.error(
          `Failed to download part ${part}/${totalParts}: ${result.error || "Unknown error"}`
        );
      }

      // Small delay between downloads to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Log appropriate message based on results
    const remainingPartsCount = totalParts - startPart + 1;
    const totalProcessed = successCount + skippedCount;
    
    if (failedParts.length === 0 && skippedParts.length === 0) {
      logger.info(
        `All remaining parts (${startPart}-${totalParts}) of "${seriesTitle}" downloaded successfully`
      );
    } else if (failedParts.length === 0) {
      logger.info(
        `Processed ${totalProcessed}/${remainingPartsCount} remaining parts (${startPart}-${totalParts}) of "${seriesTitle}". Downloaded: ${successCount}, Skipped (already exist): ${skippedCount} (parts: ${skippedParts.join(", ")})`
      );
    } else {
      logger.warn(
        `Processed ${totalProcessed}/${remainingPartsCount} remaining parts (${startPart}-${totalParts}) of "${seriesTitle}". Downloaded: ${successCount}, Skipped: ${skippedCount} (parts: ${skippedParts.join(", ")}), Failed: ${failedParts.length} (parts: ${failedParts.join(", ")})`
      );
    }
    const partial = failedParts.length > 0 && totalProcessed > 0;
    const success = failedParts.length === 0;
    const error = buildAggregateErrorMessage(
      "multipart download",
      remainingPartsCount,
      successCount,
      skippedCount,
      failedParts,
    );

    return {
      success,
      partial,
      expectedCount: remainingPartsCount,
      downloadedCount: successCount,
      skippedCount,
      failedPartNumbers: failedParts,
      firstVideo,
      collectionId: collectionId ?? undefined,
      isMultiPart: true,
      totalParts,
      error: error || undefined,
    };
  } catch (error) {
    logger.error("Error downloading remaining Bilibili parts:", error);
    const remainingPartsCount = totalParts - startPart + 1;
    return {
      success: false,
      partial: false,
      expectedCount: remainingPartsCount,
      downloadedCount: 0,
      skippedCount: 0,
      failedPartNumbers: [],
      collectionId: collectionId ?? undefined,
      isMultiPart: true,
      totalParts,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
