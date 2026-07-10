import {
  extractBilibiliVideoId,
  isBilibiliUrl,
  trimBilibiliUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import type {
  BilibiliAggregateDownloadResult,
  BilibiliCollectionCheckResult,
} from "./downloaders/BilibiliDownloader";
import * as downloadService from "./downloadService";
import type { BilibiliRetryMetadata } from "./downloadRetryMetadata";
import * as storageService from "./storageService";
import { resolveAuthorOrganizationMode } from "../types/settings";
import type { AudioFormat } from "../types/settings";

function buildAggregateError(result: BilibiliAggregateDownloadResult): string {
  if (result.error) {
    return result.error;
  }

  if (result.failedPartNumbers.length > 0) {
    return `Bilibili download incomplete; failed parts/items: ${result.failedPartNumbers.join(", ")}`;
  }

  return "Bilibili download did not complete successfully";
}

export interface BilibiliDownloadTaskOptions {
  downloadUrl: string;
  downloadId: string;
  initialTitle?: string;
  downloadAllParts?: boolean;
  downloadCollection?: boolean;
  collectionName?: string;
  collectionInfo?: BilibiliCollectionCheckResult;
  retryMetadata?: BilibiliRetryMetadata;
  onTitleUpdate?: (downloadId: string, title: string) => void;
  audioOnly?: boolean;
  audioFormat?: AudioFormat;
}

export function buildBilibiliDownloadTask(
  options: BilibiliDownloadTaskOptions,
): (registerCancel: (cancel: () => void) => void) => Promise<any> {
  return async (registerCancel: (cancel: () => void) => void) => {
    let downloadUrl = options.downloadUrl;

    if (!isBilibiliUrl(downloadUrl)) {
      throw new Error("Expected a Bilibili URL");
    }

    downloadUrl = trimBilibiliUrl(downloadUrl);
    logger.info("Using trimmed Bilibili URL:", downloadUrl);

    const initialTitle = options.initialTitle ?? "Bilibili Video";
    const retryMetadata = options.retryMetadata;
    if (retryMetadata) {
      retryMetadata.normalizedSourceUrl = downloadUrl;
      retryMetadata.lastAttemptedAt = Date.now();
    }

    if (options.downloadCollection && options.collectionInfo) {
      logger.info("Downloading Bilibili collection/series");

      const currentTitle =
        storageService.getActiveDownload(options.downloadId)?.title ||
        initialTitle;
      const collectionTitle =
        currentTitle !== initialTitle
          ? currentTitle
          : options.collectionName ||
            retryMetadata?.collectionName ||
            options.collectionInfo.title ||
            "Bilibili Collection";

      const result = await downloadService.downloadBilibiliCollection(
        options.collectionInfo,
        options.collectionName ?? retryMetadata?.collectionName ?? "",
        options.downloadId,
        registerCancel,
        retryMetadata?.shape === "bilibili_collection" ? retryMetadata : undefined,
      );

      return {
        ...result,
        collectionId: result.collectionId,
        videosDownloaded: result.videosDownloaded,
        isCollection: true,
        title: collectionTitle,
      };
    }

    if (options.downloadAllParts) {
      const videoId = extractBilibiliVideoId(downloadUrl);
      if (!videoId) {
        throw new Error("Could not extract Bilibili video ID");
      }

      const partsInfo = await downloadService.checkBilibiliVideoParts(videoId);
      if (!partsInfo.success) {
        throw new Error("Failed to get video parts information");
      }

      const { videosNumber, title } = partsInfo;
      if (retryMetadata?.shape === "bilibili_all_parts") {
        retryMetadata.expectedCount = videosNumber;
        retryMetadata.completedPartNumbers = undefined;
        retryMetadata.failedPartNumbers = undefined;
      }
      if (title) {
        options.onTitleUpdate?.(options.downloadId, title);
      }

      storageService.addActiveDownload(
        options.downloadId,
        title || "Bilibili Video",
      );

      const baseUrl = downloadUrl.split("?")[0];
      const firstPartUrl = `${baseUrl}?p=1`;
      // Scope the part-1 reuse check to the requested media type so an audio
      // request for a multipart video whose part 1 already exists as a video
      // still downloads the audio item instead of skipping to the video row.
      const existingPart1 = storageService.getVideoBySourceUrl(
        firstPartUrl,
        options.audioOnly === true ? "audio" : "video",
      );
      let firstPartResult: downloadService.DownloadResult;
      let firstVideo = existingPart1;
      let collectionId: string | null = null;
      const multipartCollectionName =
        options.collectionName ?? retryMetadata?.collectionName;

      // Stable Bilibili source identity for this multipart video's grouping
      // collection. Used to reuse the same MyTube collection across retries and
      // re-downloads instead of spawning duplicate (often empty) collections when
      // an earlier attempt failed or was cancelled before part 1 was saved
      // (issue #295 follow-on). The bvid is stable per multipart video, so it is
      // used for both mid and id to satisfy the all-fields-present source lookup.
      const multipartSourceKey = videoId
        ? {
            sourcePlatform: "bilibili",
            sourceType: "multipart",
            sourceMid: videoId,
            sourceId: videoId,
          }
        : undefined;

      if (multipartCollectionName) {
        if (retryMetadata?.shape === "bilibili_all_parts") {
          retryMetadata.collectionName = multipartCollectionName;
        }
        if (
          retryMetadata?.shape === "bilibili_all_parts" &&
          retryMetadata.linkedCollectionId
        ) {
          const persistedCollection = storageService.getCollectionById(
            retryMetadata.linkedCollectionId,
          );
          if (persistedCollection) {
            collectionId = persistedCollection.id;
            logger.info(
              `Reusing persisted collection "${
                persistedCollection.name || persistedCollection.title
              }" for multipart retry`,
            );
          }
        }

        // Prefer the stable source key: this reliably re-finds a collection
        // created by a prior attempt even when part 1 was never saved, which is
        // what previously caused duplicate empty collections to accumulate.
        if (!collectionId && multipartSourceKey) {
          const bySourceKey = storageService.getCollectionBySourceKey(
            multipartSourceKey.sourcePlatform,
            multipartSourceKey.sourceType,
            multipartSourceKey.sourceMid,
            multipartSourceKey.sourceId,
          );
          if (bySourceKey) {
            collectionId = bySourceKey.id;
            logger.info(
              `Reusing existing collection by source key "${
                bySourceKey.name || bySourceKey.title
              }" for this series`,
            );
          }
        }

        if (existingPart1?.id && !collectionId) {
          const existingCollections = storageService.getCollectionsByVideoId(
            existingPart1.id,
          );
          const existingCollection =
            existingCollections.find(
              (collection) =>
                multipartCollectionName &&
                (collection.name === multipartCollectionName ||
                  collection.title === multipartCollectionName),
            ) ?? existingCollections[0];
          if (existingCollection) {
            collectionId = existingCollection.id;
            logger.info(
              `Found existing collection "${
                existingCollection.name || existingCollection.title
              }" for this series`,
            );
          }
        }

        // Safety net: reuse a same-named non-author collection before creating a
        // brand-new one, so a missing source-key match never produces a duplicate.
        if (!collectionId) {
          const namedCollection = storageService.getCollectionByName(
            multipartCollectionName,
          );
          if (namedCollection && namedCollection.origin !== "author_auto") {
            collectionId = namedCollection.id;
            logger.info(
              `Reusing existing same-named collection "${
                namedCollection.name || namedCollection.title
              }" for this series`,
            );
          }
        }

        if (!collectionId) {
          const newCollection = {
            id: Date.now().toString(),
            name: multipartCollectionName,
            videos: [],
            createdAt: new Date().toISOString(),
            title: multipartCollectionName,
            ...(multipartSourceKey ?? {}),
          };
          storageService.saveCollection(newCollection);
          collectionId = newCollection.id;
          logger.info(`Created new collection "${multipartCollectionName}"`);
        } else if (multipartSourceKey) {
          // Backfill the stable source key onto a reused legacy collection so
          // future re-downloads match it directly via the source lookup.
          const reused = storageService.getCollectionById(collectionId);
          if (
            reused &&
            (reused.sourcePlatform !== multipartSourceKey.sourcePlatform ||
              reused.sourceType !== multipartSourceKey.sourceType ||
              reused.sourceMid !== multipartSourceKey.sourceMid ||
              reused.sourceId !== multipartSourceKey.sourceId)
          ) {
            storageService.saveCollection({ ...reused, ...multipartSourceKey });
            logger.info(
              `Backfilled source key on collection "${
                reused.name || reused.title
              }"`,
            );
          }
        }
        if (retryMetadata?.shape === "bilibili_all_parts") {
          retryMetadata.linkedCollectionId = collectionId ?? undefined;
        }
      }

      if (existingPart1) {
        logger.info(
          `Part 1/${videosNumber} already exists, skipping. Video ID: ${existingPart1.id}`,
        );
        firstPartResult = {
          success: true,
          videoData: existingPart1,
        };

        if (collectionId && existingPart1.id) {
          storageService.linkVideoToCollection(collectionId, existingPart1.id, {
            moveFiles: false,
            order: 1,
          });
        }
        if (retryMetadata?.shape === "bilibili_all_parts") {
          retryMetadata.completedPartNumbers = Array.from(
            new Set([...(retryMetadata.completedPartNumbers ?? []), 1]),
          ).sort((left, right) => left - right);
        }
      } else {
        let resolvedCollectionName: string | undefined;
        if (collectionId) {
          const collection = storageService.getCollectionById(collectionId);
          if (collection) {
            resolvedCollectionName = collection.name || collection.title;
          }
        }

        const currentTitle =
          storageService.getActiveDownload(options.downloadId)?.title ||
          title ||
          "Bilibili Video";

        const filenameOptions = {
          sourceCollectionName: resolvedCollectionName || currentTitle,
          sourceCollectionType: "playlist" as const,
          mediaPlaylistIndex: 1,
        };
        firstPartResult = options.audioOnly === true
          ? await downloadService.downloadSingleBilibiliPart(
              firstPartUrl, 1, videosNumber, currentTitle, options.downloadId,
              registerCancel, resolvedCollectionName, filenameOptions,
              { audioOnly: true, audioFormat: options.audioFormat },
            )
          : await downloadService.downloadSingleBilibiliPart(
              firstPartUrl, 1, videosNumber, currentTitle, options.downloadId,
              registerCancel, resolvedCollectionName, filenameOptions,
            );

        if (collectionId && firstPartResult.videoData) {
          storageService.linkVideoToCollection(
            collectionId,
            firstPartResult.videoData.id,
            {
              moveFiles: false,
              order: 1,
            },
          );
        }
        if (firstPartResult.videoData) {
          firstVideo = firstPartResult.videoData;
        }
        if (retryMetadata?.shape === "bilibili_all_parts") {
          if (firstPartResult.success && firstPartResult.videoData) {
            retryMetadata.completedPartNumbers = Array.from(
              new Set([...(retryMetadata.completedPartNumbers ?? []), 1]),
            ).sort((left, right) => left - right);
          } else {
            retryMetadata.failedPartNumbers = Array.from(
              new Set([...(retryMetadata.failedPartNumbers ?? []), 1]),
            ).sort((left, right) => left - right);
          }
        }
      }

      let downloadedCount =
        existingPart1 ? 0 : firstPartResult.success && firstPartResult.videoData ? 1 : 0;
      let skippedCount = existingPart1 ? 1 : 0;
      let failedPartNumbers =
        !existingPart1 && !firstPartResult.success ? [1] : [];

      let remainingResult: BilibiliAggregateDownloadResult | null = null;
      if (videosNumber > 1) {
        const currentTitle =
          storageService.getActiveDownload(options.downloadId)?.title ||
          title ||
          "Bilibili Video";
        remainingResult = await downloadService.downloadRemainingBilibiliParts(
          baseUrl,
          2,
          videosNumber,
          currentTitle,
          collectionId,
          options.downloadId,
          registerCancel,
          retryMetadata?.shape === "bilibili_all_parts" ? retryMetadata : undefined,
        );
        downloadedCount += remainingResult.downloadedCount;
        skippedCount += remainingResult.skippedCount;
        failedPartNumbers = failedPartNumbers.concat(
          remainingResult.failedPartNumbers,
        );
        if (!firstVideo && remainingResult.firstVideo) {
          firstVideo = remainingResult.firstVideo;
        }
      }

      // Under author_folder_only the parts live in the author folder; remove any
      // now-empty collection-named folder left from initial placement so it does
      // not linger in the storage root. Mirrors the collection/series download
      // path (issue #295 2-2). Only removes empty directories.
      if (multipartCollectionName) {
        try {
          const organizationMode = resolveAuthorOrganizationMode(
            storageService.getSettings(),
          );
          if (organizationMode === "author_folder_only") {
            const cleanupName = collectionId
              ? storageService.getCollectionById(collectionId)?.name ??
                multipartCollectionName
              : multipartCollectionName;
            storageService.cleanupCollectionDirectories(cleanupName);
          }
        } catch (cleanupError) {
          logger.warn(
            "Failed to clean up residual collection directories:",
            cleanupError,
          );
        }
      }

      const partial =
        failedPartNumbers.length > 0 &&
        downloadedCount + skippedCount > 0;
      const success = failedPartNumbers.length === 0;

      return {
        success,
        partial,
        expectedCount: videosNumber,
        downloadedCount,
        skippedCount,
        failedPartNumbers,
        firstVideo,
        video: firstVideo,
        isMultiPart: true,
        totalParts: videosNumber,
        collectionId: collectionId ?? undefined,
        title: title || initialTitle,
        error:
          success
            ? undefined
            : buildAggregateError({
                success,
                partial,
                expectedCount: videosNumber,
                downloadedCount,
                skippedCount,
                failedPartNumbers,
                firstVideo,
                collectionId: collectionId ?? undefined,
                isMultiPart: true,
                totalParts: videosNumber,
                error: remainingResult?.error,
              }),
      };
    }

    logger.info("Downloading single Bilibili video part");
    const result = options.audioOnly === true
      ? await downloadService.downloadSingleBilibiliPart(
          downloadUrl, 1, 1, "", options.downloadId, registerCancel,
          undefined, undefined,
          { audioOnly: true, audioFormat: options.audioFormat },
        )
      : await downloadService.downloadSingleBilibiliPart(
          downloadUrl, 1, 1, "", options.downloadId, registerCancel,
        );

    return {
      ...result,
      video: result.videoData,
    };
  };
}

export function buildBilibiliDownloadTaskFromRetryMetadata(
  url: string,
  downloadId: string,
  metadata: BilibiliRetryMetadata,
): (registerCancel: (cancel: () => void) => void) => Promise<any> {
  if (metadata.shape === "bilibili_collection") {
    return buildBilibiliDownloadTask({
      downloadUrl: url,
      downloadId,
      downloadCollection: true,
      collectionInfo: metadata.collectionInfo,
      collectionName: metadata.collectionName,
      retryMetadata: metadata,
      onTitleUpdate: (id, title) =>
        storageService.updateActiveDownloadTitle(id, title),
    });
  }

  return buildBilibiliDownloadTask({
    downloadUrl: url,
    downloadId,
    downloadAllParts: true,
    collectionName: metadata.collectionName,
    retryMetadata: metadata,
    onTitleUpdate: (id, title) =>
      storageService.updateActiveDownloadTitle(id, title),
  });
}
