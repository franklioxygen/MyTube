import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { continuousDownloadService } from "../services/continuousDownloadService";
import { subscriptionService } from "../services/subscriptionService";
import { logger } from "../utils/logger";
import { successMessage } from "../utils/response";

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
  const { playlistUrl, interval, collectionName, downloadAll } = req.body;
  logger.info("Creating playlist subscription:", {
    playlistUrl,
    interval,
    collectionName,
    downloadAll,
  });

  if (!playlistUrl || !interval || !collectionName) {
    throw new ValidationError(
      "Playlist URL, interval, and collection name are required",
      "body"
    );
  }

  // Check if it's a valid playlist URL
  const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
  const playlistMatch = playlistUrl.match(playlistRegex);
  if (!playlistMatch) {
    throw new ValidationError(
      "URL does not contain a playlist parameter",
      "playlistUrl"
    );
  }
  const playlistId = playlistMatch[1];

  // Get playlist info
  const { checkPlaylist } = await import("../services/downloadService");
  const playlistInfo = await checkPlaylist(playlistUrl);

  if (!playlistInfo.success) {
    throw new ValidationError(
      playlistInfo.error || "Failed to get playlist information",
      "playlistUrl"
    );
  }

  // Create or find collection
  const storageService = await import("../services/storageService");
  
  // First, try to find existing collection by name
  let collection = storageService.getCollectionByName(collectionName);
  
  if (!collection) {
    // Create new collection
    const uniqueCollectionName = storageService.generateUniqueCollectionName(collectionName);
    collection = {
      id: Date.now().toString(),
      name: uniqueCollectionName,
      videos: [],
      createdAt: new Date().toISOString(),
      title: uniqueCollectionName,
    };
    storageService.saveCollection(collection);
    logger.info(`Created collection "${uniqueCollectionName}" with ID ${collection.id}`);
  } else {
    logger.info(`Using existing collection "${collection.name}" with ID ${collection.id}`);
  }

  // Extract author from playlist
  let author = "Playlist Author";
  let platform = "YouTube";

  if (playlistUrl.includes("bilibili.com")) {
    platform = "Bilibili";
  }

  try {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../utils/ytDlpUtils");

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
    logger.warn("Could not extract author from playlist, using default:", error);
  }

  // Create subscription
  const subscription = await subscriptionService.subscribePlaylist(
    playlistUrl,
    parseInt(interval),
    playlistInfo.title || collectionName,
    playlistId,
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
    throw new ValidationError("Playlist URL and collection name are required", "body");
  }

  // Check if it's a valid playlist URL
  const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
  if (!playlistRegex.test(playlistUrl)) {
    throw new ValidationError("URL does not contain a playlist parameter", "playlistUrl");
  }

  // Get playlist info to determine author and platform
  const { checkPlaylist } = await import("../services/downloadService");
  const playlistInfo = await checkPlaylist(playlistUrl);

  if (!playlistInfo.success) {
    throw new ValidationError(
      playlistInfo.error || "Failed to get playlist information",
      "playlistUrl"
    );
  }

  // Create collection first - ensure unique name
  const storageService = await import("../services/storageService");
  const uniqueCollectionName = storageService.generateUniqueCollectionName(collectionName);
  const newCollection = {
    id: Date.now().toString(),
    name: uniqueCollectionName,
    videos: [],
    createdAt: new Date().toISOString(),
    title: uniqueCollectionName,
  };
  storageService.saveCollection(newCollection);
  logger.info(`Created collection "${uniqueCollectionName}" with ID ${newCollection.id}`);

  // Extract author from playlist (try to get from first video or use default)
  let author = "Playlist Author";
  let platform = "YouTube";

  try {
    const {
      executeYtDlpJson,
      getNetworkConfigFromUserConfig,
      getUserYtDlpConfig,
    } = await import("../utils/ytDlpUtils");
    const { getProviderScript } = await import("../services/downloaders/ytdlp/ytdlpHelpers");
    
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
    logger.warn("Could not extract author from playlist, using default:", error);
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
