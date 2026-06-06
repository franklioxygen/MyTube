import {
  extractBilibiliVideoId,
  isBilibiliUrl,
  trimBilibiliUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import type { BilibiliCollectionCheckResult } from "./downloaders/BilibiliDownloader";
import * as downloadService from "./downloadService";
import type { DownloadRetryMetadata } from "./downloadRetryMetadata";
import * as storageService from "./storageService";

export interface BilibiliDownloadTaskOptions {
  downloadUrl: string;
  downloadId: string;
  initialTitle?: string;
  downloadAllParts?: boolean;
  downloadCollection?: boolean;
  collectionName?: string;
  collectionInfo?: BilibiliCollectionCheckResult;
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

    if (options.downloadCollection && options.collectionInfo) {
      logger.info("Downloading Bilibili collection/series");

      const currentTitle =
        storageService.getActiveDownload(options.downloadId)?.title ||
        initialTitle;
      const collectionTitle =
        currentTitle !== initialTitle
          ? currentTitle
          : options.collectionName ||
            options.collectionInfo.title ||
            "Bilibili Collection";

      const result = await downloadService.downloadBilibiliCollection(
        options.collectionInfo,
        options.collectionName ?? "",
        options.downloadId,
      );

      if (result.success) {
        return {
          success: true,
          collectionId: result.collectionId,
          videosDownloaded: result.videosDownloaded,
          isCollection: true,
          title: collectionTitle,
        };
      }

      throw new Error(result.error || "Failed to download collection/series");
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
      let collectionId: string | null = null;

      if (options.collectionName) {
        if (existingPart1?.id) {
          const existingCollection = storageService.getCollectionByVideoId(
            existingPart1.id,
          );
          if (existingCollection) {
            collectionId = existingCollection.id;
            logger.info(
              `Found existing collection "${
                existingCollection.name || existingCollection.title
              }" for this series`,
            );
          }
        }

        if (!collectionId) {
          const collectionByName = storageService.getCollectionByName(
            options.collectionName,
          );
          if (collectionByName) {
            collectionId = collectionByName.id;
            logger.info(
              `Found existing collection "${options.collectionName}" by name`,
            );
          }
        }

        if (!collectionId) {
          const newCollection = {
            id: Date.now().toString(),
            name: options.collectionName,
            videos: [],
            createdAt: new Date().toISOString(),
            title: options.collectionName,
          };
          storageService.saveCollection(newCollection);
          collectionId = newCollection.id;
          logger.info(`Created new collection "${options.collectionName}"`);
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
          const collection = storageService.getCollectionById(collectionId);
          if (collection && !collection.videos.includes(existingPart1.id)) {
            storageService.atomicUpdateCollection(collectionId, (collection) => {
              if (!collection.videos.includes(existingPart1.id)) {
                collection.videos.push(existingPart1.id);
              }
              return collection;
            });
          }
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
          storageService.atomicUpdateCollection(collectionId, (collection) => {
            collection.videos.push(firstPartResult.videoData!.id);
            return collection;
          });
        }
      }

      if (videosNumber > 1) {
        const currentTitle =
          storageService.getActiveDownload(options.downloadId)?.title ||
          title ||
          "Bilibili Video";
        downloadService
          .downloadRemainingBilibiliParts(
            baseUrl,
            2,
            videosNumber,
            currentTitle,
            collectionId,
            options.downloadId,
          )
          .catch((error) => {
            logger.error(
              "Error in background download of remaining parts:",
              error,
            );
          });
      }

      return {
        success: true,
        video: firstPartResult.videoData,
        isMultiPart: true,
        totalParts: videosNumber,
        collectionId,
        title: title || initialTitle,
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

    if (result.success) {
      return { success: true, video: result.videoData };
    }

    throw new Error(result.error || "Failed to download Bilibili video");
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
      onTitleUpdate: (id, title) =>
        storageService.updateActiveDownloadTitle(id, title),
    });
  }

  return buildBilibiliDownloadTask({
    downloadUrl: url,
    downloadId,
    downloadAllParts: true,
    collectionName: metadata.collectionName,
    onTitleUpdate: (id, title) =>
      storageService.updateActiveDownloadTitle(id, title),
  });
}
