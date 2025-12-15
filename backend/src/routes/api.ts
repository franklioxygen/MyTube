import express from "express";
import * as cleanupController from "../controllers/cleanupController";
import * as collectionController from "../controllers/collectionController";
import * as downloadController from "../controllers/downloadController";
import * as scanController from "../controllers/scanController";
import * as subscriptionController from "../controllers/subscriptionController";
import * as videoController from "../controllers/videoController";
import { asyncHandler } from "../middleware/errorHandler";

const router = express.Router();

// Video routes
router.get("/search", asyncHandler(videoController.searchVideos));
router.post("/download", asyncHandler(videoController.downloadVideo));
router.post(
  "/upload",
  videoController.upload.single("video"),
  asyncHandler(videoController.uploadVideo)
);
router.get("/videos", asyncHandler(videoController.getVideos));
router.get("/videos/:id", asyncHandler(videoController.getVideoById));
router.put("/videos/:id", asyncHandler(videoController.updateVideoDetails));
router.delete("/videos/:id", asyncHandler(videoController.deleteVideo));
router.get(
  "/videos/:id/comments",
  asyncHandler(videoController.getVideoComments)
);
router.post("/videos/:id/rate", asyncHandler(videoController.rateVideo));
router.post(
  "/videos/:id/refresh-thumbnail",
  asyncHandler(videoController.refreshThumbnail)
);
router.post(
  "/videos/:id/view",
  asyncHandler(videoController.incrementViewCount)
);
router.put(
  "/videos/:id/progress",
  asyncHandler(videoController.updateProgress)
);

router.post("/scan-files", asyncHandler(scanController.scanFiles));
router.post(
  "/cleanup-temp-files",
  asyncHandler(cleanupController.cleanupTempFiles)
);

router.get("/download-status", asyncHandler(videoController.getDownloadStatus));
router.get(
  "/check-video-download",
  asyncHandler(videoController.checkVideoDownloadStatus)
);
router.get(
  "/check-bilibili-parts",
  asyncHandler(videoController.checkBilibiliParts)
);
router.get(
  "/check-bilibili-collection",
  asyncHandler(videoController.checkBilibiliCollection)
);

// Download management
router.post(
  "/downloads/cancel/:id",
  asyncHandler(downloadController.cancelDownload)
);
router.delete(
  "/downloads/queue/:id",
  asyncHandler(downloadController.removeFromQueue)
);
router.delete("/downloads/queue", asyncHandler(downloadController.clearQueue));
router.get(
  "/downloads/history",
  asyncHandler(downloadController.getDownloadHistory)
);
router.delete(
  "/downloads/history/:id",
  asyncHandler(downloadController.removeDownloadHistory)
);
router.delete(
  "/downloads/history",
  asyncHandler(downloadController.clearDownloadHistory)
);

// Collection routes
router.get("/collections", asyncHandler(collectionController.getCollections));
router.post(
  "/collections",
  asyncHandler(collectionController.createCollection)
);
router.put(
  "/collections/:id",
  asyncHandler(collectionController.updateCollection)
);
router.delete(
  "/collections/:id",
  asyncHandler(collectionController.deleteCollection)
);

// Subscription routes
router.post(
  "/subscriptions",
  asyncHandler(subscriptionController.createSubscription)
);
router.get(
  "/subscriptions",
  asyncHandler(subscriptionController.getSubscriptions)
);
router.delete(
  "/subscriptions/:id",
  asyncHandler(subscriptionController.deleteSubscription)
);

export default router;
