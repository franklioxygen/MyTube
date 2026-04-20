import express, { NextFunction, RequestHandler, Router } from "express";
import * as cleanupController from "../controllers/cleanupController";
import * as cloudStorageController from "../controllers/cloudStorageController";
import * as collectionController from "../controllers/collectionController";
import * as downloadController from "../controllers/downloadController";
import * as scanController from "../controllers/scanController";
import * as subscriptionController from "../controllers/subscriptionController";
import * as systemController from "../controllers/systemController";
import * as videoController from "../controllers/videoController";
import * as videoDownloadController from "../controllers/videoDownloadController";
import * as videoMetadataController from "../controllers/videoMetadataController";
import { asyncHandler } from "../middleware/errorHandler";

type ApiRouteMethod = "delete" | "get" | "post" | "put";

export type ApiRouteDefinition = {
  allowApiKey?: boolean;
  handlers: RequestHandler[];
  method: ApiRouteMethod;
  path: string;
};

const apiRouteDefinitions: ApiRouteDefinition[] = [
  // Video routes
  {
    method: "get",
    path: "/search",
    handlers: [asyncHandler(videoDownloadController.searchVideos)],
  },
  {
    method: "post",
    path: "/download",
    allowApiKey: true,
    handlers: [asyncHandler(videoDownloadController.downloadVideo)],
  },
  {
    method: "post",
    path: "/upload",
    handlers: [
      videoController.upload.single("video"),
      asyncHandler(videoController.uploadVideo),
    ],
  },
  {
    method: "post",
    path: "/upload/batch",
    handlers: [
      videoController.uploadBatch.array("videos"),
      asyncHandler(videoController.uploadVideosBatch),
    ],
  },
  {
    method: "get",
    path: "/videos",
    allowApiKey: true,
    handlers: [asyncHandler(videoController.getVideos)],
  },
  {
    method: "get",
    path: "/videos/author-channel-url",
    handlers: [asyncHandler(videoController.getAuthorChannelUrl)],
  },
  {
    method: "get",
    path: "/videos/:id",
    allowApiKey: true,
    handlers: [asyncHandler(videoController.getVideoById)],
  },
  {
    method: "get",
    path: "/mount-video/:id",
    allowApiKey: true,
    handlers: [asyncHandler(videoController.serveMountVideo)],
  },
  {
    method: "put",
    path: "/videos/:id",
    handlers: [asyncHandler(videoController.updateVideoDetails)],
  },
  {
    method: "post",
    path: "/videos/:id/subtitles",
    handlers: [
      videoController.uploadSubtitleMiddleware.single("subtitle"),
      asyncHandler(videoController.uploadSubtitle),
    ],
  },
  {
    method: "delete",
    path: "/videos/:id",
    handlers: [asyncHandler(videoController.deleteVideo)],
  },
  {
    method: "get",
    path: "/videos/:id/comments",
    handlers: [asyncHandler(videoController.getVideoComments)],
  },
  {
    method: "post",
    path: "/videos/:id/rate",
    handlers: [asyncHandler(videoMetadataController.rateVideo)],
  },
  {
    method: "post",
    path: "/videos/:id/refresh-thumbnail",
    handlers: [asyncHandler(videoMetadataController.refreshThumbnail)],
  },
  {
    method: "post",
    path: "/videos/:id/upload-thumbnail",
    handlers: [
      videoMetadataController.thumbnailUpload.single("thumbnail"),
      asyncHandler(videoMetadataController.uploadThumbnail),
    ],
  },
  {
    method: "post",
    path: "/videos/refresh-file-sizes",
    handlers: [asyncHandler(videoMetadataController.refreshAllFileSizes)],
  },
  {
    method: "post",
    path: "/videos/:id/view",
    handlers: [asyncHandler(videoMetadataController.incrementViewCount)],
  },
  {
    method: "put",
    path: "/videos/:id/progress",
    handlers: [asyncHandler(videoMetadataController.updateProgress)],
  },
  {
    method: "post",
    path: "/scan-files",
    handlers: [asyncHandler(scanController.scanFiles)],
  },
  {
    method: "post",
    path: "/scan-mount-directories",
    handlers: [asyncHandler(scanController.scanMountDirectories)],
  },
  {
    method: "post",
    path: "/cleanup-temp-files",
    handlers: [asyncHandler(cleanupController.cleanupTempFiles)],
  },
  {
    method: "get",
    path: "/download-status",
    handlers: [asyncHandler(videoDownloadController.getDownloadStatus)],
  },
  {
    method: "get",
    path: "/check-video-download",
    handlers: [asyncHandler(videoDownloadController.checkVideoDownloadStatus)],
  },
  {
    method: "get",
    path: "/check-bilibili-parts",
    handlers: [asyncHandler(videoDownloadController.checkBilibiliParts)],
  },
  {
    method: "get",
    path: "/check-bilibili-collection",
    handlers: [asyncHandler(videoDownloadController.checkBilibiliCollection)],
  },
  {
    method: "get",
    path: "/check-playlist",
    handlers: [asyncHandler(videoDownloadController.checkPlaylist)],
  },
  {
    method: "post",
    path: "/downloads/channel-playlists",
    handlers: [asyncHandler(downloadController.processChannelPlaylists)],
  },

  // Download management
  {
    method: "post",
    path: "/downloads/cancel/:id",
    handlers: [asyncHandler(downloadController.cancelDownload)],
  },
  {
    method: "delete",
    path: "/downloads/queue/:id",
    handlers: [asyncHandler(downloadController.removeFromQueue)],
  },
  {
    method: "delete",
    path: "/downloads/queue",
    handlers: [asyncHandler(downloadController.clearQueue)],
  },
  {
    method: "get",
    path: "/downloads/history",
    handlers: [asyncHandler(downloadController.getDownloadHistory)],
  },
  {
    method: "delete",
    path: "/downloads/history/:id",
    handlers: [asyncHandler(downloadController.removeDownloadHistory)],
  },
  {
    method: "delete",
    path: "/downloads/history",
    handlers: [asyncHandler(downloadController.clearDownloadHistory)],
  },

  // Collection routes
  {
    method: "get",
    path: "/collections",
    allowApiKey: true,
    handlers: [asyncHandler(collectionController.getCollections)],
  },
  {
    method: "post",
    path: "/collections",
    handlers: [asyncHandler(collectionController.createCollection)],
  },
  {
    method: "put",
    path: "/collections/:id",
    handlers: [asyncHandler(collectionController.updateCollection)],
  },
  {
    method: "delete",
    path: "/collections/:id",
    handlers: [asyncHandler(collectionController.deleteCollection)],
  },

  // Subscription routes
  {
    method: "post",
    path: "/subscriptions",
    handlers: [asyncHandler(subscriptionController.createSubscription)],
  },
  {
    method: "get",
    path: "/subscriptions",
    handlers: [asyncHandler(subscriptionController.getSubscriptions)],
  },
  {
    method: "put",
    path: "/subscriptions/:id",
    handlers: [asyncHandler(subscriptionController.updateSubscription)],
  },
  {
    method: "delete",
    path: "/subscriptions/:id",
    handlers: [asyncHandler(subscriptionController.deleteSubscription)],
  },
  {
    method: "put",
    path: "/subscriptions/:id/pause",
    handlers: [asyncHandler(subscriptionController.pauseSubscription)],
  },
  {
    method: "put",
    path: "/subscriptions/:id/resume",
    handlers: [asyncHandler(subscriptionController.resumeSubscription)],
  },
  {
    method: "post",
    path: "/subscriptions/playlist",
    handlers: [asyncHandler(subscriptionController.createPlaylistSubscription)],
  },
  {
    method: "post",
    path: "/subscriptions/channel-playlists",
    handlers: [asyncHandler(subscriptionController.subscribeChannelPlaylists)],
  },

  // Continuous download task routes
  {
    method: "get",
    path: "/subscriptions/tasks",
    handlers: [asyncHandler(subscriptionController.getContinuousDownloadTasks)],
  },
  // Specific routes must come before parameterized routes (:id)
  {
    method: "delete",
    path: "/subscriptions/tasks/clear-finished",
    handlers: [asyncHandler(subscriptionController.clearFinishedTasks)],
  },
  {
    method: "put",
    path: "/subscriptions/tasks/:id/pause",
    handlers: [asyncHandler(subscriptionController.pauseContinuousDownloadTask)],
  },
  {
    method: "put",
    path: "/subscriptions/tasks/:id/resume",
    handlers: [asyncHandler(subscriptionController.resumeContinuousDownloadTask)],
  },
  {
    method: "delete",
    path: "/subscriptions/tasks/:id",
    handlers: [asyncHandler(subscriptionController.cancelContinuousDownloadTask)],
  },
  {
    method: "delete",
    path: "/subscriptions/tasks/:id/delete",
    handlers: [asyncHandler(subscriptionController.deleteContinuousDownloadTask)],
  },
  {
    method: "post",
    path: "/subscriptions/tasks/playlist",
    handlers: [asyncHandler(subscriptionController.createPlaylistTask)],
  },

  // Cloud storage routes
  {
    method: "get",
    path: "/cloud/signed-url",
    handlers: [asyncHandler(cloudStorageController.getSignedUrl)],
  },
  {
    method: "post",
    path: "/cloud/sync",
    handlers: [asyncHandler(cloudStorageController.syncToCloud)],
  },
  {
    method: "delete",
    path: "/cloud/thumbnail-cache",
    handlers: [asyncHandler(cloudStorageController.clearThumbnailCacheEndpoint)],
  },

  // System routes
  {
    method: "get",
    path: "/system/version",
    handlers: [asyncHandler(systemController.getLatestVersion)],
  },
];

const denyApiKeyRoute: RequestHandler = (_req, _res, next: NextFunction) => {
  next("router");
};

const registerRoute = (
  router: Router,
  definition: ApiRouteDefinition,
  handlers: RequestHandler[]
): void => {
  switch (definition.method) {
    case "delete":
      router.delete(definition.path, ...handlers);
      return;
    case "get":
      router.get(definition.path, ...handlers);
      return;
    case "post":
      router.post(definition.path, ...handlers);
      return;
    case "put":
      router.put(definition.path, ...handlers);
      return;
  }
};

export const buildApiRouter = (
  apiKeyOnly = false,
  definitions: readonly ApiRouteDefinition[] = apiRouteDefinitions
): Router => {
  const router = express.Router();

  if (apiKeyOnly) {
    router.use((req, _res, next) => {
      if (req.apiKeyAuthenticated === true) {
        next();
        return;
      }

      next("router");
    });
  }

  for (const definition of definitions) {
    const handlers =
      apiKeyOnly && definition.allowApiKey !== true
        ? [denyApiKeyRoute]
        : definition.handlers;

    registerRoute(router, definition, handlers);
  }

  return router;
};

const apiRoutes = buildApiRouter();

export const apiKeyRoutes = buildApiRouter(true);

export default apiRoutes;
