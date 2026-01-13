import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { continuousDownloadService } from "../services/continuousDownloadService";
import { checkPlaylist } from "../services/downloadService";
import * as storageService from "../services/storageService";
import { subscriptionService } from "../services/subscriptionService";
import { isBilibiliUrl } from "../utils/helpers";
import { logger } from "../utils/logger";
import { successMessage } from "../utils/response";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../utils/ytDlpUtils";

/**
 * Create a new subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const createSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url, interval, authorName, downloadAllPrevious } = req.body;
  logger.info("Creating subscription:", {
    url,
    interval,
    authorName,
    downloadAllPrevious,
  });

  if (!url || !interval) {
    throw new ValidationError("URL and interval are required", "body");
  }

  const subscription = await subscriptionService.subscribe(
    url,
    parseInt(interval),
    authorName
  );

  // If user wants to download all previous videos, create a continuous download task
  if (downloadAllPrevious) {
    try {
      await continuousDownloadService.createTask(
        url,
        subscription.author,
        subscription.platform,
        subscription.id
      );
      logger.info(
        `Created continuous download task for subscription ${subscription.id}`
      );
    } catch (error) {
      logger.error(
        "Error creating continuous download task:",
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the subscription creation if task creation fails
    }
  }

  // Return subscription object directly for backward compatibility
  res.status(201).json(subscription);
};

/**
 * Get all subscriptions
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getSubscriptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  const subscriptions = await subscriptionService.listSubscriptions();
  // Return array directly for backward compatibility (frontend expects response.data to be Subscription[])
  res.json(subscriptions);
};

/**
 * Delete a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await subscriptionService.unsubscribe(id);
  res.status(200).json(successMessage("Subscription deleted"));
};

/**
 * Pause a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const pauseSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await subscriptionService.pauseSubscription(id);
  res.status(200).json(successMessage("Subscription paused"));
};

/**
 * Resume a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const resumeSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await subscriptionService.resumeSubscription(id);
  res.status(200).json(successMessage("Subscription resumed"));
};

/**
 * Get all continuous download tasks
 * Errors are automatically handled by asyncHandler middleware
 */
export const getContinuousDownloadTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tasks = await continuousDownloadService.getAllTasks();
  res.json(tasks);
};

/**
 * Cancel a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const cancelContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await continuousDownloadService.cancelTask(id);
  res.status(200).json(successMessage("Task cancelled"));
};

/**
 * Delete a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await continuousDownloadService.deleteTask(id);
  res.status(200).json(successMessage("Task deleted"));
};

/**
 * Pause a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const pauseContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await continuousDownloadService.pauseTask(id);
  res.status(200).json(successMessage("Task paused"));
};

/**
 * Resume a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const resumeContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  await continuousDownloadService.resumeTask(id);
  res.status(200).json(successMessage("Task resumed"));
};

/**
 * Clear all finished continuous download tasks
 * Errors are automatically handled by asyncHandler middleware
 */
export const clearFinishedTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  await continuousDownloadService.clearFinishedTasks();
  res.status(200).json(successMessage("Finished tasks cleared"));
};

/**
 * Create a playlist subscription (and optionally download all videos)
 * Errors are automatically handled by asyncHandler middleware
 */
export const createPlaylistSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { playlistUrl, interval, collectionName, downloadAll, collectionInfo } =
    req.body;
  logger.info("Creating playlist subscription:", {
    playlistUrl,
    interval,
    collectionName,
    downloadAll,
    collectionInfo,
  });

  if (!playlistUrl || !interval || !collectionName) {
    throw new ValidationError(
      "Playlist URL, interval, and collection name are required",
      "body"
    );
  }

  // Detect platform
  const isBilibili = isBilibiliUrl(playlistUrl);
  const platform = isBilibili ? "Bilibili" : "YouTube";

  // Validate playlist URL format based on platform
  let playlistId: string | null = null;
  let playlistTitle: string = collectionName;
  let videoCount: number = 0;

  // For Bilibili collection/series, use collectionInfo if provided
  if (
    isBilibili &&
    collectionInfo &&
    (collectionInfo.type === "collection" || collectionInfo.type === "series")
  ) {
    // Skip checkPlaylist validation for Bilibili collections/series
    // Use the collectionInfo directly
    playlistId = collectionInfo.id?.toString() || null;
    playlistTitle = collectionInfo.title || collectionName;
    videoCount = collectionInfo.count || 0;
    logger.info(
      `Using Bilibili ${collectionInfo.type} info: ${playlistTitle} (${videoCount} videos)`
    );
  } else if (isBilibili) {
    // For Bilibili playlists (not collections), try to validate with checkPlaylist
    // For Bilibili, yt-dlp handles playlist URLs differently
    playlistId = null; // Will be extracted from playlist info if available
  } else {
    // For YouTube, check for list parameter
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const playlistMatch = playlistUrl.match(playlistRegex);
    if (!playlistMatch) {
      throw new ValidationError(
        "YouTube URL must contain a playlist parameter (list=)",
        "playlistUrl"
      );
    }
    playlistId = playlistMatch[1];
  }

  // Get playlist info (skip if we already have collectionInfo for Bilibili)
  let playlistInfo: {
    success: boolean;
    title?: string;
    videoCount?: number;
    error?: string;
  };

  if (
    isBilibili &&
    collectionInfo &&
    (collectionInfo.type === "collection" || collectionInfo.type === "series")
  ) {
    // Use collectionInfo instead of calling checkPlaylist
    playlistInfo = {
      success: true,
      title: playlistTitle,
      videoCount: videoCount,
    };
  } else {
    // Get playlist info (this validates the playlist for both platforms)
    playlistInfo = await checkPlaylist(playlistUrl);

    if (!playlistInfo.success) {
      throw new ValidationError(
        playlistInfo.error || "Failed to get playlist information",
        "playlistUrl"
      );
    }

    playlistTitle = playlistInfo.title || collectionName;
    videoCount = playlistInfo.videoCount || 0;
  }

  // Extract playlist ID from yt-dlp info if not already extracted (for Bilibili)
  if (!playlistId && isBilibili) {
    try {
      const userConfig = getUserYtDlpConfig(playlistUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      const info = await executeYtDlpJson(playlistUrl, {
        ...networkConfig,
        noWarnings: true,
        flatPlaylist: true,
        playlistEnd: 1,
      });

      // Try to extract playlist ID from Bilibili playlist info
      if (info.id) {
        playlistId = info.id;
      } else if (info.extractor_key === "bilibili:playlist") {
        // For Bilibili playlists, the ID might be in the URL or extractor info
        playlistId = info.playlist_id || info.id || null;
      }
    } catch (error) {
      logger.warn(
        "Could not extract playlist ID, continuing without it:",
        error
      );
    }
  }

  // Create or find collection
  // First, try to find existing collection by name
  let collection = storageService.getCollectionByName(collectionName);

  if (!collection) {
    // Create new collection
    const uniqueCollectionName =
      storageService.generateUniqueCollectionName(collectionName);
    collection = {
      id: Date.now().toString(),
      name: uniqueCollectionName,
      videos: [],
      createdAt: new Date().toISOString(),
      title: uniqueCollectionName,
    };
    storageService.saveCollection(collection);
    logger.info(
      `Created collection "${uniqueCollectionName}" with ID ${collection.id}`
    );
  } else {
    logger.info(
      `Using existing collection "${collection.name}" with ID ${collection.id}`
    );
  }

  // Extract author from playlist
  let author = "Playlist Author";

  try {
    const userConfig = getUserYtDlpConfig(playlistUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    const info = await executeYtDlpJson(playlistUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      playlistEnd: 1,
    });

    if (info.entries && info.entries.length > 0) {
      const firstEntry = info.entries[0];
      if (firstEntry.uploader) {
        author = firstEntry.uploader;
      } else if (firstEntry.channel) {
        author = firstEntry.channel;
      }
    } else if (info.uploader) {
      author = info.uploader;
    } else if (info.channel) {
      author = info.channel;
    }
  } catch (error) {
    logger.warn(
      "Could not extract author from playlist, using default:",
      error
    );
  }

  // Create subscription
  const subscription = await subscriptionService.subscribePlaylist(
    playlistUrl,
    parseInt(interval),
    playlistTitle,
    playlistId || "",
    author,
    platform,
    collection.id
  );

  // If user wants to download all videos, create a continuous download task
  let task = null;
  if (downloadAll) {
    try {
      task = await continuousDownloadService.createPlaylistTask(
        playlistUrl,
        author,
        platform,
        collection.id
      );
      logger.info(
        `Created continuous download task ${task.id} for playlist subscription ${subscription.id}`
      );
    } catch (error) {
      logger.error(
        "Error creating continuous download task for playlist:",
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the subscription creation if task creation fails
    }
  }

  res.status(201).json({
    subscription,
    collectionId: collection.id,
    taskId: task?.id,
  });
};

/**
 * Create a continuous download task for a playlist
 * Errors are automatically handled by asyncHandler middleware
 */
export const createPlaylistTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { playlistUrl, collectionName } = req.body;
  logger.info("Creating playlist task:", {
    playlistUrl,
    collectionName,
  });

  if (!playlistUrl || !collectionName) {
    throw new ValidationError(
      "Playlist URL and collection name are required",
      "body"
    );
  }

  // Detect platform
  const isBilibili = isBilibiliUrl(playlistUrl);
  const platform = isBilibili ? "Bilibili" : "YouTube";

  // Validate playlist URL format based on platform
  if (!isBilibili) {
    // For YouTube, check for list parameter
    const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    if (!playlistRegex.test(playlistUrl)) {
      throw new ValidationError(
        "YouTube URL must contain a playlist parameter (list=)",
        "playlistUrl"
      );
    }
  }
  // For Bilibili, we'll rely on checkPlaylist to validate

  // Get playlist info to determine author and platform
  const playlistInfo = await checkPlaylist(playlistUrl);

  if (!playlistInfo.success) {
    throw new ValidationError(
      playlistInfo.error || "Failed to get playlist information",
      "playlistUrl"
    );
  }

  // Create collection first - ensure unique name
  const uniqueCollectionName =
    storageService.generateUniqueCollectionName(collectionName);
  const newCollection = {
    id: Date.now().toString(),
    name: uniqueCollectionName,
    videos: [],
    createdAt: new Date().toISOString(),
    title: uniqueCollectionName,
  };
  storageService.saveCollection(newCollection);
  logger.info(
    `Created collection "${uniqueCollectionName}" with ID ${newCollection.id}`
  );

  // Extract author from playlist (try to get from first video or use default)
  let author = "Playlist Author";

  try {
    const { getProviderScript } = await import(
      "../services/downloaders/ytdlp/ytdlpHelpers"
    );

    const userConfig = getUserYtDlpConfig(playlistUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Get first video info to extract author
    const info = await executeYtDlpJson(playlistUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      playlistEnd: 1,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    if (info.entries && info.entries.length > 0) {
      const firstEntry = info.entries[0];
      if (firstEntry.uploader) {
        author = firstEntry.uploader;
      }
    } else if (info.uploader) {
      author = info.uploader;
    }
  } catch (error) {
    logger.warn(
      "Could not extract author from playlist, using default:",
      error
    );
  }

  // Create continuous download task with collection ID
  const task = await continuousDownloadService.createPlaylistTask(
    playlistUrl,
    author,
    platform,
    newCollection.id
  );

  logger.info(
    `Created playlist download task ${task.id} for collection ${newCollection.id}`
  );

  res.status(201).json({
    taskId: task.id,
    collectionId: newCollection.id,
    task,
  });
};
