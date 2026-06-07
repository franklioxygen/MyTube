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
import type { DownloadRetryMetadata } from "./downloadRetryMetadata";
import * as storageService from "./storageService";

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
  retryMetadata?: DownloadRetryMetadata;
  onTitleUpdate?: (downloadId: string, title: string) => void;
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
      const existingPart1 = storageService.getVideoBySourceUrl(firstPartUrl);
      let firstPartResult: downloadService.DownloadResult;
      let firstVideo = existingPart1;
      let collectionId: string | null = null;
      const multipartCollectionName =
        options.collectionName ?? retryMetadata?.collectionName;

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

        if (existingPart1?.id) {
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
          if (existingCollection && !collectionId) {
            collectionId = existingCollection.id;
            logger.info(
              `Found existing collection "${
                existingCollection.name || existingCollection.title
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
          };
          storageService.saveCollection(newCollection);
          collectionId = newCollection.id;
          logger.info(`Created new collection "${multipartCollectionName}"`);
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

        firstPartResult = await downloadService.downloadSingleBilibiliPart(
          firstPartUrl,
          1,
          videosNumber,
          currentTitle,
          options.downloadId,
          registerCancel,
          resolvedCollectionName,
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
    const result = await downloadService.downloadSingleBilibiliPart(
      downloadUrl,
      1,
      1,
      "",
      options.downloadId,
      registerCancel,
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
  metadata: DownloadRetryMetadata,
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
