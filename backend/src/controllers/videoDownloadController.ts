import { Request, Response } from "express";
import { isCancelledError, ValidationError } from "../errors/DownloadErrors";
import downloadManager from "../services/downloadManager";
import { buildBilibiliDownloadTask } from "../services/bilibiliDownloadTask";
import {
  createBilibiliRetryMetadata,
  createDownloadModeRetryMetadata,
  mergeBilibiliRetryMetadata,
  parseRetryMetadata,
} from "../services/downloadRetryMetadata";
import { normalizeAudioFormat } from "../types/settings";
import * as downloadService from "../services/downloadService";
import {
  recordEvent,
  normalizeSourceKind,
  normalizeSurface,
  platformFromUrl,
} from "../services/statistics";
import { isLoginRequired } from "../services/passwordService";
import * as storageService from "../services/storageService";
import {
  extractBilibiliVideoId,
  getMissAVPlaceholderTitle,
  isBilibiliShortUrl,
  isBilibiliUrl,
  isMissAVUrl,
  isTwitchVideoUrl,
  isYouTubeUrl,
  isValidUrl,
  processVideoUrl,
  resolveShortUrl,
  trimBilibiliUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { getLimitParam, getPositiveIntegerParam, getStringParam } from "../utils/paramUtils";
import { sendBadRequest, sendData, sendInternalError } from "../utils/response";
import { validateUrl } from "../utils/security";

function isDownloadStillQueued(downloadId: string): boolean {
  try {
    const status = storageService.getDownloadStatus();
    return status.queuedDownloads.some((download) => download.id === downloadId);
  } catch (error) {
    logger.debug("Unable to inspect queued downloads for title update:", error);
    return false;
  }
}

const getVisibilityScopedRole = (
  req: Request
): storageService.VideoCallerRole | undefined => {
  if (!isLoginRequired()) {
    return undefined;
  }
  return req.user?.role as storageService.VideoCallerRole | undefined;
};

/**
 * Search for videos
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns { results } format for backward compatibility with frontend
 */
export const searchVideos = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const query = getStringParam(req.query.query);

  if (!query) {
    throw new ValidationError("Search query is required", "query");
  }

  const limit = getLimitParam(req.query.limit, 8, 50);
  const offset = getPositiveIntegerParam(req.query.offset, 1);

  const results = await downloadService.searchYouTube(query, limit, offset);
  // Return { results } format for backward compatibility (frontend expects response.data.results)
  sendData(res, { results });
};

/**
 * Check video download status
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkVideoDownloadStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const url = getStringParam(req.query.url);

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  // Process URL: extract from text, resolve shortened URLs, extract source video ID
  const { videoUrl, sourceVideoId, platform } = await processVideoUrl(url);

  // Validate the extracted URL to prevent SSRF attacks while allowing
  // Telegram/share text that includes a title plus the actual URL.
  try {
    validateUrl(videoUrl);
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "Invalid URL format",
      "url",
    );
  }

  if (!sourceVideoId) {
    // Return object directly for backward compatibility (frontend expects response.data.found)
    sendData(res, { found: false });
    return;
  }

  // Check if video was previously downloaded
  const downloadCheck =
    storageService.checkVideoDownloadBySourceId(sourceVideoId, platform);

  if (downloadCheck.found) {
    const visibilityScopedRole = getVisibilityScopedRole(req);
    const getVisibleVideoById = (videoId: string) =>
      storageService.getVideoById(videoId, visibilityScopedRole);

    if (
      visibilityScopedRole === "visitor" &&
      downloadCheck.status === "exists" &&
      downloadCheck.videoId &&
      !getVisibleVideoById(downloadCheck.videoId)
    ) {
      sendData(res, { found: false });
      return;
    }

    // Verify video exists if status is "exists"
    const verification = storageService.verifyVideoExists(
      downloadCheck,
      getVisibleVideoById,
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
  res: Response,
): Promise<any> => {
  try {
    const {
      youtubeUrl,
      downloadAllParts,
      collectionName,
      downloadCollection,
      collectionInfo,
      forceDownload, // Allow re-download of deleted videos
      statisticsContext, // optional attribution metadata for the statistics feature
      audioOnly,
    } = req.body;
    // Audio-only is an explicit per-request intent. Never fall back to a
    // persisted setting so extensions, API callers, and subscriptions remain
    // video downloads unless they opt in themselves.
    const effectiveAudioOnly = audioOnly === true;
    const audioFormat = normalizeAudioFormat(
      storageService.getSettings()?.audioFormat,
    );
    let videoUrl = youtubeUrl;

    if (!videoUrl) {
      return sendBadRequest(res, "Video URL is required");
    }

    logger.info("Processing download request for input:", videoUrl);
    // Resolve attribution surface and source for statistics ingestion.
    const clientHeader = req.headers?.["x-mytube-client"];
    const isExtensionRequest =
      typeof clientHeader === "string" && clientHeader.toLowerCase() === "extension";
    const statisticsSurface = isExtensionRequest
      ? "extension"
      : req.apiKeyAuthenticated === true
        ? "api"
        : "web";
    const statisticsSourceKind = (() => {
      const fromCtx = statisticsContext?.sourceKind;
      if (typeof fromCtx === "string") return normalizeSourceKind(fromCtx);
      if (isExtensionRequest) return "extension";
      if (req.apiKeyAuthenticated === true) return "api";
      return "manual";
    })();
    const statisticsRelatedEventId =
      typeof statisticsContext?.relatedEventId === "string"
        ? statisticsContext.relatedEventId
        : null;

    // Process URL: extract from text, resolve shortened URLs, extract source video ID
    const {
      videoUrl: processedUrl,
      sourceVideoId,
      platform,
    } = await processVideoUrl(videoUrl);
    logger.info("Processed URL:", processedUrl);

    // Validate the extracted URL to prevent SSRF attacks while accepting
    // Telegram/share text that includes surrounding title or commentary.
    let validatedVideoUrl: string;
    try {
      validatedVideoUrl = validateUrl(processedUrl);
    } catch (error) {
      return sendBadRequest(
        res,
        error instanceof Error ? error.message : "Invalid URL format",
      );
    }

    // Check if the input is a valid URL
    if (!isValidUrl(validatedVideoUrl)) {
      // If not a valid URL, treat it as a search term
      return sendBadRequest(res, "Not a valid URL");
    }

    // Use processed URL as resolved URL
    const resolvedUrl = isBilibiliUrl(validatedVideoUrl)
      ? trimBilibiliUrl(validatedVideoUrl)
      : validatedVideoUrl;
    logger.info("Resolved URL to:", resolvedUrl);
    // Check if video was previously downloaded (skip for collections/multi-part)
    if (sourceVideoId && !downloadAllParts && !downloadCollection) {
      const downloadCheck =
        storageService.checkVideoDownloadBySourceId(sourceVideoId, platform);

      // Get settings to check dontSkipDeletedVideo
      const settings = storageService.getSettings();
      const dontSkipDeletedVideo = settings.dontSkipDeletedVideo || false;

      // Use the consolidated handler to check download status
      const checkResult = storageService.handleVideoDownloadCheck(
        downloadCheck,
        resolvedUrl,
        storageService.getVideoById,
        (item) => storageService.addDownloadHistoryItem(item),
        forceDownload,
        dontSkipDeletedVideo,
        {
          platform: platformFromUrl(resolvedUrl),
          sourceKind: statisticsSourceKind,
        }
      );

      if (checkResult.shouldSkip && checkResult.response) {
        // Video should be skipped, return response
        return sendData(res, checkResult.response);
      }
    }

    // Emit download_enqueued only after duplicate/deleted short-circuits so the
    // queue metrics represent accepted work that actually entered the queue.
    const downloadEnqueuedEventId = recordEvent({
      eventType: "download_enqueued",
      actorRole: req.user?.role === "visitor" ? "visitor" : "admin",
      surface: normalizeSurface(statisticsSurface),
      sessionId: null,
      relatedEventId: statisticsRelatedEventId,
      platform: platformFromUrl(resolvedUrl),
      sourceKind: statisticsSourceKind,
      payload: {
        downloadAllParts: !!downloadAllParts,
        downloadCollection: !!downloadCollection,
      },
    });

    // Determine initial title for the download task
    let initialTitle = "Pending...";
    // We purposefully delay title fetching to the background task to make the API response instant
    if (isYouTubeUrl(resolvedUrl)) {
      initialTitle = "YouTube Video";
    } else if (isBilibiliUrl(resolvedUrl)) {
      initialTitle = "Bilibili Video";
    } else if (isTwitchVideoUrl(resolvedUrl)) {
      initialTitle = "Twitch Video";
    } else if (isMissAVUrl(resolvedUrl)) {
      initialTitle = getMissAVPlaceholderTitle(resolvedUrl);
    }

    // Generate a unique ID for this download task
    const downloadId = Date.now().toString();
    const parsedPreviousRetryMetadata = isBilibiliUrl(resolvedUrl)
      ? parseRetryMetadata(
          storageService.getLatestRetryHistoryItemBySourceUrl(
            resolvedUrl,
            "bilibili",
          )?.retryMetadata,
        )
      : undefined;
    const previousBilibiliRetryMetadata =
      parsedPreviousRetryMetadata?.shape !== "download_mode"
        ? parsedPreviousRetryMetadata
        : undefined;
    const currentBilibiliRetryMetadata = isBilibiliUrl(resolvedUrl)
      ? createBilibiliRetryMetadata({
          downloadAllParts: !!downloadAllParts,
          downloadCollection: !!downloadCollection,
          collectionName,
          collectionInfo,
          normalizedSourceUrl: resolvedUrl,
        })
      : undefined;
    const bilibiliRetryMetadata = isBilibiliUrl(resolvedUrl)
      ? currentBilibiliRetryMetadata
        ? mergeBilibiliRetryMetadata(
            currentBilibiliRetryMetadata,
            previousBilibiliRetryMetadata,
          )
        : previousBilibiliRetryMetadata
      : undefined;
    const shouldReuseRetryAggregateMode =
      isBilibiliUrl(resolvedUrl) &&
      !downloadAllParts &&
      !downloadCollection &&
      !!bilibiliRetryMetadata;
    const retryCollectionInfo =
      bilibiliRetryMetadata?.shape === "bilibili_collection"
        ? bilibiliRetryMetadata.collectionInfo
        : undefined;
    const effectiveDownloadAllParts =
      !!downloadAllParts ||
      (shouldReuseRetryAggregateMode &&
        bilibiliRetryMetadata?.shape === "bilibili_all_parts");
    const effectiveDownloadCollection =
      !!downloadCollection ||
      (shouldReuseRetryAggregateMode &&
        bilibiliRetryMetadata?.shape === "bilibili_collection");
    const effectiveCollectionName =
      collectionName ?? bilibiliRetryMetadata?.collectionName;
    const effectiveCollectionInfo = collectionInfo ?? retryCollectionInfo;
    const isAggregateBilibiliDownload =
      effectiveDownloadAllParts || effectiveDownloadCollection;
    const modeRetryMetadata =
      effectiveAudioOnly && !isMissAVUrl(resolvedUrl) && !isAggregateBilibiliDownload
        ? createDownloadModeRetryMetadata({ audioOnly: true, audioFormat })
        : undefined;

    // Define the download task function
    const downloadTask = async (
      registerCancel: (cancel: () => void) => void,
    ) => {
      // Use resolved URL for download (already processed)
      let downloadUrl = resolvedUrl;

      if (isBilibiliUrl(downloadUrl)) {
        return buildBilibiliDownloadTask({
          downloadUrl,
          downloadId,
          initialTitle,
          downloadAllParts: effectiveDownloadAllParts,
          downloadCollection: effectiveDownloadCollection,
          collectionName: effectiveCollectionName,
          collectionInfo: effectiveCollectionInfo,
          retryMetadata: bilibiliRetryMetadata,
          audioOnly: effectiveAudioOnly && !isAggregateBilibiliDownload,
          audioFormat,
          onTitleUpdate: (id, title) => {
            storageService.updateActiveDownloadTitle(id, title);
            downloadManager.updateTaskTitle(id, title);
          },
        })(registerCancel);
      } else if (isMissAVUrl(downloadUrl)) {
        // MissAV/123av/njavtv download
        const videoData = await downloadService.downloadMissAVVideo(
          downloadUrl,
          downloadId,
          registerCancel,
        );
        return { success: true, video: videoData };
      } else {
        // YouTube download
        const videoData = effectiveAudioOnly
          ? await downloadService.downloadYouTubeVideo(downloadUrl, {
              downloadId,
              onStart: registerCancel,
              audioOnly: true,
              audioFormat,
            })
          : await downloadService.downloadYouTubeVideo(
              downloadUrl,
              downloadId,
              registerCancel,
            );
        return { success: true, video: videoData };
      }
    };

    // Determine type
    let type = "youtube";
    if (isMissAVUrl(resolvedUrl)) {
      type = "missav";
    } else if (isBilibiliUrl(resolvedUrl)) {
      type = "bilibili";
    }

    // Add to download manager immediately with initial title to show in queue
    // We don't await the result here because we want to return response immediately
    // and let the download happen in background
    downloadManager
      .addDownload(downloadTask, downloadId, initialTitle, resolvedUrl, type, {
        actorRole: req.user?.role === "visitor" ? "visitor" : "admin",
        surface: statisticsSurface,
        sourceKind: statisticsSourceKind,
        relatedEventId: statisticsRelatedEventId,
        enqueuedEventId: downloadEnqueuedEventId,
      }, bilibiliRetryMetadata ?? modeRetryMetadata)
      .then((result: any) => {
        logger.info("Download completed successfully:", result);
      })
      .catch((error: any) => {
        if (isCancelledError(error)) {
          logger.info("Download cancelled:", {
            downloadId,
            title: initialTitle,
          });
          return;
        }

        logger.error("Download failed:", error);
      });

    // Send success response immediately
    sendData(res, {
      success: true,
      message: "Download queued",
      downloadId,
    });

    // Process metadata update in background
    (async () => {
      let videoTitle = initialTitle;

      try {
        // MissAV metadata extraction uses Puppeteer. Running it while the task is
        // still queued can launch extra Chromium instances on weak hosts; the
        // MissAV downloader fetches and applies the real title when the task starts.
        if (isMissAVUrl(resolvedUrl)) {
          logger.debug(
            "Skipping queued MissAV title lookup; metadata will be fetched when the download starts.",
          );
          return;
        }

        // Active downloads fetch metadata inside the downloader. Only queued tasks
        // need this lightweight background lookup to improve their displayed title.
        if (!isDownloadStillQueued(downloadId)) {
          return;
        }

        // Fetch video info for title
        logger.info("Fetching video info for title update...");
        const info = await downloadService.getVideoInfo(resolvedUrl);
        if (info && info.title) {
          videoTitle = info.title;
          logger.info("Fetched title:", videoTitle);
          // Update the task title in manager (handles both queued and active)
          downloadManager.updateTaskTitle(downloadId, videoTitle);
        }
      } catch (err) {
        logger.warn("Failed to fetch video info for title:", err);
      }
    })();
  } catch (error: unknown) {
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
  res: Response,
): Promise<void> => {
  const status = storageService.getDownloadStatus();
  // Debug log to verify progress data is included
  if (status.activeDownloads.length > 0) {
    status.activeDownloads.forEach((d) => {
      if (d.progress !== undefined || d.speed) {
        logger.debug(
          `[API] Download ${d.id}: progress=${d.progress}%, speed=${d.speed}, totalSize=${d.totalSize}`,
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
  res: Response,
): Promise<void> => {
  const url = getStringParam(req.query.url);

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  if (!isBilibiliUrl(url)) {
    throw new ValidationError("Not a valid Bilibili URL", "url");
  }

  // Resolve shortened URLs (like b23.tv)
  let videoUrl = url;
  if (isBilibiliShortUrl(videoUrl)) {
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
  res: Response,
): Promise<void> => {
  const url = getStringParam(req.query.url);

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  if (!isBilibiliUrl(url)) {
    throw new ValidationError("Not a valid Bilibili URL", "url");
  }

  // Resolve shortened URLs (like b23.tv)
  let videoUrl = url;
  if (isBilibiliShortUrl(videoUrl)) {
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
  res: Response,
): Promise<void> => {
  const url = getStringParam(req.query.url);

  if (!url) {
    throw new ValidationError("URL is required", "url");
  }

  const playlistUrl = url;

  // For YouTube, validate that it has a playlist parameter
  if (isYouTubeUrl(playlistUrl)) {
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    if (!playlistRegex.test(playlistUrl)) {
      throw new ValidationError(
        "YouTube URL must contain a playlist parameter (list=)",
        "url",
      );
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
      error:
        error instanceof Error ? error.message : "Failed to check playlist",
    });
  }
};
