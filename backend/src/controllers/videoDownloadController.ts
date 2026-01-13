import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { DownloadResult } from "../services/downloaders/bilibili/types";
import downloadManager from "../services/downloadManager";
import * as downloadService from "../services/downloadService";
import * as storageService from "../services/storageService";
import {
    extractBilibiliVideoId,
    isBilibiliUrl,
    isValidUrl,
    processVideoUrl,
    resolveShortUrl,
    trimBilibiliUrl
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { sendBadRequest, sendData, sendInternalError } from "../utils/response";

/**
 * Search for videos
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns { results } format for backward compatibility with frontend
 */
export const searchVideos = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { query } = req.query;

  if (!query) {
    throw new ValidationError("Search query is required", "query");
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : 1;

  const results = await downloadService.searchYouTube(
    query as string,
    limit,
    offset
  );
  // Return { results } format for backward compatibility (frontend expects response.data.results)
  sendData(res, { results });
};

/**
 * Check video download status
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkVideoDownloadStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    throw new ValidationError("URL is required", "url");
  }

  // Process URL: extract from text, resolve shortened URLs, extract source video ID
  const { sourceVideoId } = await processVideoUrl(url);

  if (!sourceVideoId) {
    // Return object directly for backward compatibility (frontend expects response.data.found)
    sendData(res, { found: false });
    return;
  }

  // Check if video was previously downloaded
  const downloadCheck =
    storageService.checkVideoDownloadBySourceId(sourceVideoId);

  if (downloadCheck.found) {
    // Verify video exists if status is "exists"
    const verification = storageService.verifyVideoExists(
      downloadCheck,
      storageService.getVideoById
    );

    if (verification.updatedCheck) {
      // Video was deleted but not marked, return deleted status
      sendData(res, {
        found: true,
        status: "deleted",
        title: verification.updatedCheck.title,
        author: verification.updatedCheck.author,
        downloadedAt: verification.updatedCheck.downloadedAt,
      });
      return;
    }

    if (verification.exists && verification.video) {
      // Video exists, return exists status
      sendData(res, {
        found: true,
        status: "exists",
        videoId: downloadCheck.videoId,
        title: downloadCheck.title || verification.video.title,
        author: downloadCheck.author || verification.video.author,
        downloadedAt: downloadCheck.downloadedAt,
        videoPath: verification.video.videoPath,
        thumbnailPath: verification.video.thumbnailPath,
      });
      return;
    }

    // Return object directly for backward compatibility
    sendData(res, {
      found: true,
      status: downloadCheck.status,
      title: downloadCheck.title,
      author: downloadCheck.author,
      downloadedAt: downloadCheck.downloadedAt,
      deletedAt: downloadCheck.deletedAt,
    });
    return;
  }

  // Return object directly for backward compatibility
  sendData(res, { found: false });
};

/**
 * Download video
 * Errors are automatically handled by asyncHandler middleware
 */
export const downloadVideo = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
      youtubeUrl,
      downloadAllParts,
      collectionName,
      downloadCollection,
      collectionInfo,
      forceDownload, // Allow re-download of deleted videos
    } = req.body;
    let videoUrl = youtubeUrl;

    if (!videoUrl) {
      return sendBadRequest(res, "Video URL is required");
    }

    logger.info("Processing download request for input:", videoUrl);

    // Process URL: extract from text, resolve shortened URLs, extract source video ID
    const { videoUrl: processedUrl, sourceVideoId, platform } = await processVideoUrl(videoUrl);
    logger.info("Processed URL:", processedUrl);

    // Check if the input is a valid URL
    if (!isValidUrl(processedUrl)) {
      // If not a valid URL, treat it as a search term
      return sendBadRequest(res, "Not a valid URL");
    }

    // Use processed URL as resolved URL
    const resolvedUrl = processedUrl;
    logger.info("Resolved URL to:", resolvedUrl);

    // Check if video was previously downloaded (skip for collections/multi-part)
    if (sourceVideoId && !downloadAllParts && !downloadCollection) {
      const downloadCheck =
        storageService.checkVideoDownloadBySourceId(sourceVideoId);

      // Use the consolidated handler to check download status
      const checkResult = storageService.handleVideoDownloadCheck(
        downloadCheck,
        resolvedUrl,
        storageService.getVideoById,
        (item) => storageService.addDownloadHistoryItem(item),
        forceDownload
      );

      if (checkResult.shouldSkip && checkResult.response) {
        // Video should be skipped, return response
        return sendData(res, checkResult.response);
      }

      // If status is "deleted" and not forcing download, handle separately
      if (downloadCheck.found && downloadCheck.status === "deleted" && !forceDownload) {
        // Video was previously downloaded but deleted - add to history and skip
        storageService.addDownloadHistoryItem({
          id: Date.now().toString(),
          title: downloadCheck.title || "Unknown Title",
          author: downloadCheck.author,
          sourceUrl: resolvedUrl,
          finishedAt: Date.now(),
          status: "deleted",
          downloadedAt: downloadCheck.downloadedAt,
          deletedAt: downloadCheck.deletedAt,
        });

        return sendData(res, {
          success: true,
          skipped: true,
          previouslyDeleted: true,
          title: downloadCheck.title,
          author: downloadCheck.author,
          downloadedAt: downloadCheck.downloadedAt,
          deletedAt: downloadCheck.deletedAt,
          message: "Video was previously downloaded but deleted, skipped download",
        });
      }
    }

    // Determine initial title for the download task
    let initialTitle = "Video";
    try {
      // Try to fetch video info for all URLs (using already processed URL)
      logger.info("Fetching video info for title...");
      const info = await downloadService.getVideoInfo(resolvedUrl);
      if (info && info.title) {
        initialTitle = info.title;
        logger.info("Fetched initial title:", initialTitle);
      }
    } catch (err) {
      logger.warn("Failed to fetch video info for title, using default:", err);
      if (resolvedUrl.includes("youtube.com") || resolvedUrl.includes("youtu.be")) {
        initialTitle = "YouTube Video";
      } else if (isBilibiliUrl(resolvedUrl)) {
        initialTitle = "Bilibili Video";
      }
    }

    // Generate a unique ID for this download task
    const downloadId = Date.now().toString();

    // Define the download task function
    const downloadTask = async (
      registerCancel: (cancel: () => void) => void
    ) => {
      // Use resolved URL for download (already processed)
      let downloadUrl = resolvedUrl;
      
      // Trim Bilibili URL if needed
      if (isBilibiliUrl(downloadUrl)) {
        downloadUrl = trimBilibiliUrl(downloadUrl);
        logger.info("Using trimmed Bilibili URL:", downloadUrl);

        // If downloadCollection is true, handle collection/series download
        if (downloadCollection && collectionInfo) {
          logger.info("Downloading Bilibili collection/series");

          const result = await downloadService.downloadBilibiliCollection(
            collectionInfo,
            collectionName,
            downloadId
          );

          if (result.success) {
            return {
              success: true,
              collectionId: result.collectionId,
              videosDownloaded: result.videosDownloaded,
              isCollection: true,
            };
          } else {
            throw new Error(
              result.error || "Failed to download collection/series"
            );
          }
        }

        // If downloadAllParts is true, handle multi-part download
        if (downloadAllParts) {
          const videoId = extractBilibiliVideoId(downloadUrl);
          if (!videoId) {
            throw new Error("Could not extract Bilibili video ID");
          }

          // Get video info to determine number of parts
          const partsInfo = await downloadService.checkBilibiliVideoParts(
            videoId
          );

          if (!partsInfo.success) {
            throw new Error("Failed to get video parts information");
          }

          const { videosNumber, title } = partsInfo;

          // Update title in storage
          storageService.addActiveDownload(
            downloadId,
            title || "Bilibili Video"
          );

          // Start downloading the first part
          const baseUrl = downloadUrl.split("?")[0];
          const firstPartUrl = `${baseUrl}?p=1`;

          // Check if part 1 already exists
          const existingPart1 = storageService.getVideoBySourceUrl(firstPartUrl);
          let firstPartResult: DownloadResult;
          let collectionId: string | null = null;

          // Find or create collection
          if (collectionName) {
            // First, try to find if an existing part belongs to a collection
            if (existingPart1?.id) {
              const existingCollection = storageService.getCollectionByVideoId(existingPart1.id);
              if (existingCollection) {
                collectionId = existingCollection.id;
                logger.info(
                  `Found existing collection "${existingCollection.name || existingCollection.title}" for this series`
                );
              }
            }

            // If no collection found from existing part, try to find by name
            if (!collectionId) {
              const collectionByName = storageService.getCollectionByName(collectionName);
              if (collectionByName) {
                collectionId = collectionByName.id;
                logger.info(
                  `Found existing collection "${collectionName}" by name`
                );
              }
            }

            // If still no collection found, create a new one
            if (!collectionId) {
              const newCollection = {
                id: Date.now().toString(),
                name: collectionName,
                videos: [],
                createdAt: new Date().toISOString(),
                title: collectionName,
              };
              storageService.saveCollection(newCollection);
              collectionId = newCollection.id;
              logger.info(`Created new collection "${collectionName}"`);
            }
          }

          if (existingPart1) {
            logger.info(
              `Part 1/${videosNumber} already exists, skipping. Video ID: ${existingPart1.id}`
            );
            firstPartResult = {
              success: true,
              videoData: existingPart1,
            };

            // Make sure the existing video is in the collection
            if (collectionId && existingPart1.id) {
              const collection = storageService.getCollectionById(collectionId);
              if (collection && !collection.videos.includes(existingPart1.id)) {
                storageService.atomicUpdateCollection(
                  collectionId,
                  (collection) => {
                    if (!collection.videos.includes(existingPart1.id)) {
                      collection.videos.push(existingPart1.id);
                    }
                    return collection;
                  }
                );
              }
            }
          } else {
            // Get collection name if collectionId is provided
            let collectionName: string | undefined;
            if (collectionId) {
              const collection = storageService.getCollectionById(collectionId);
              if (collection) {
                collectionName = collection.name || collection.title;
              }
            }

            // Download the first part
            firstPartResult =
              await downloadService.downloadSingleBilibiliPart(
                firstPartUrl,
                1,
                videosNumber,
                title || "Bilibili Video",
                downloadId,
                registerCancel,
                collectionName
              );

            // Add to collection if needed
            if (collectionId && firstPartResult.videoData) {
              storageService.atomicUpdateCollection(
                collectionId,
                (collection) => {
                  collection.videos.push(firstPartResult.videoData!.id);
                  return collection;
                }
              );
            }
          }

          // Set up background download for remaining parts
          // Note: We don't await this, it runs in background
          if (videosNumber > 1) {
            downloadService.downloadRemainingBilibiliParts(
              baseUrl,
              2,
              videosNumber,
              title || "Bilibili Video",
              collectionId,
              downloadId // Pass downloadId to track progress
            ).catch((error) => {
              logger.error("Error in background download of remaining parts:", error);
            });
          }

          return {
            success: true,
            video: firstPartResult.videoData,
            isMultiPart: true,
            totalParts: videosNumber,
            collectionId,
          };
        } else {
          // Regular single video download for Bilibili
          logger.info("Downloading single Bilibili video part");

          const result = await downloadService.downloadSingleBilibiliPart(
            downloadUrl,
            1,
            1,
            "", // seriesTitle not used when totalParts is 1
            downloadId,
            registerCancel
          );

          if (result.success) {
            return { success: true, video: result.videoData };
          } else {
            throw new Error(
              result.error || "Failed to download Bilibili video"
            );
          }
        }
      } else if (downloadUrl.includes("missav") || downloadUrl.includes("123av")) {
        // MissAV/123av download
        const videoData = await downloadService.downloadMissAVVideo(
          downloadUrl,
          downloadId,
          registerCancel
        );
        return { success: true, video: videoData };
      } else {
        // YouTube download
        const videoData = await downloadService.downloadYouTubeVideo(
          downloadUrl,
          downloadId,
          registerCancel
        );
        return { success: true, video: videoData };
      }
    };

    // Determine type
    let type = "youtube";
    if (resolvedUrl.includes("missav") || resolvedUrl.includes("123av")) {
      type = "missav";
    } else if (isBilibiliUrl(resolvedUrl)) {
      type = "bilibili";
    }

    // Add to download manager
    downloadManager
      .addDownload(downloadTask, downloadId, initialTitle, resolvedUrl, type)
      .then((result: any) => {
        logger.info("Download completed successfully:", result);
      })
      .catch((error: any) => {
        logger.error("Download failed:", error);
      });

    // Return success immediately indicating the download is queued/started
    sendData(res, {
      success: true,
      message: "Download queued",
      downloadId,
    });
  } catch (error: any) {
    logger.error("Error queuing download:", error);
    sendInternalError(res, "Failed to queue download");
  }
};

/**
 * Get download status
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns status object directly for backward compatibility with frontend
 */
export const getDownloadStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const status = storageService.getDownloadStatus();
  // Debug log to verify progress data is included
  if (status.activeDownloads.length > 0) {
    status.activeDownloads.forEach((d) => {
      if (d.progress !== undefined || d.speed) {
        logger.debug(
          `[API] Download ${d.id}: progress=${d.progress}%, speed=${d.speed}, totalSize=${d.totalSize}`
        );
      }
    });
  }
  // Return status object directly for backward compatibility (frontend expects response.data to be DownloadStatus)
  sendData(res, status);
};

/**
 * Check Bilibili parts
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkBilibiliParts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  if (!isBilibiliUrl(url as string)) {
    throw new ValidationError("Not a valid Bilibili URL", "url");
  }

  // Resolve shortened URLs (like b23.tv)
  let videoUrl = url as string;
  if (videoUrl.includes("b23.tv")) {
    videoUrl = await resolveShortUrl(videoUrl);
    logger.info("Resolved shortened URL to:", videoUrl);
  }

  // Trim Bilibili URL if needed
  videoUrl = trimBilibiliUrl(videoUrl);

  // Extract video ID
  const videoId = extractBilibiliVideoId(videoUrl);

  if (!videoId) {
    throw new ValidationError("Could not extract Bilibili video ID", "url");
  }

  const result = await downloadService.checkBilibiliVideoParts(videoId);

  // Return result object directly for backward compatibility (frontend expects response.data.success, response.data.videosNumber)
  sendData(res, result);
};

/**
 * Check if Bilibili URL is a collection or series
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkBilibiliCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  if (!isBilibiliUrl(url as string)) {
    throw new ValidationError("Not a valid Bilibili URL", "url");
  }

  // Resolve shortened URLs (like b23.tv)
  let videoUrl = url as string;
  if (videoUrl.includes("b23.tv")) {
    videoUrl = await resolveShortUrl(videoUrl);
    logger.info("Resolved shortened URL to:", videoUrl);
  }

  // Trim Bilibili URL if needed
  videoUrl = trimBilibiliUrl(videoUrl);

  // Extract video ID
  const videoId = extractBilibiliVideoId(videoUrl);

  if (!videoId) {
    throw new ValidationError("Could not extract Bilibili video ID", "url");
  }

  // Check if it's a collection or series
  const result = await downloadService.checkBilibiliCollectionOrSeries(videoId);

  // Return result object directly for backward compatibility (frontend expects response.data.success, response.data.type)
  sendData(res, result);
};

/**
 * Check if URL is a playlist (supports YouTube and Bilibili)
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkPlaylist = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url } = req.query;

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  const playlistUrl = url as string;

  // For YouTube, validate that it has a playlist parameter
  if (playlistUrl.includes("youtube.com") || playlistUrl.includes("youtu.be")) {
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    if (!playlistRegex.test(playlistUrl)) {
      throw new ValidationError("YouTube URL must contain a playlist parameter (list=)", "url");
    }
  }
  // For Bilibili and other platforms, let checkPlaylist service function validate
  // (it uses yt-dlp which can handle various playlist formats)

  try {
    const result = await downloadService.checkPlaylist(playlistUrl);
    sendData(res, result);
  } catch (error) {
    logger.error("Error checking playlist:", error);
    sendData(res, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to check playlist"
    });
  }
};
