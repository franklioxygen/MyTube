import express from "express";
import * as cleanupController from "../controllers/cleanupController";
import * as collectionController from "../controllers/collectionController";
import * as downloadController from "../controllers/downloadController";
import * as scanController from "../controllers/scanController";
import * as videoController from "../controllers/videoController";

const router = express.Router();

// Video routes
router.get("/search", videoController.searchVideos);
router.post("/download", videoController.downloadVideo);
router.post("/upload", videoController.upload.single("video"), videoController.uploadVideo);
router.get("/videos", videoController.getVideos);
router.get("/videos/:id", videoController.getVideoById);
router.put("/videos/:id", videoController.updateVideoDetails);
router.delete("/videos/:id", videoController.deleteVideo);
router.get("/videos/:id/comments", videoController.getVideoComments);
router.post("/videos/:id/rate", videoController.rateVideo);
router.post("/videos/:id/refresh-thumbnail", videoController.refreshThumbnail);
router.post("/videos/:id/view", videoController.incrementViewCount);
router.put("/videos/:id/progress", videoController.updateProgress);

router.post("/scan-files", scanController.scanFiles);
router.post("/cleanup-temp-files", cleanupController.cleanupTempFiles);

router.get("/download-status", videoController.getDownloadStatus);
router.get("/check-bilibili-parts", videoController.checkBilibiliParts);
router.get("/check-bilibili-collection", videoController.checkBilibiliCollection);

// Download management
router.post("/downloads/cancel/:id", downloadController.cancelDownload);
router.delete("/downloads/queue/:id", downloadController.removeFromQueue);
router.delete("/downloads/queue", downloadController.clearQueue);
router.get("/downloads/history", downloadController.getDownloadHistory);
router.delete("/downloads/history/:id", downloadController.removeDownloadHistory);
router.delete("/downloads/history", downloadController.clearDownloadHistory);

// Collection routes
router.get("/collections", collectionController.getCollections);
router.post("/collections", collectionController.createCollection);
router.put("/collections/:id", collectionController.updateCollection);
router.delete("/collections/:id", collectionController.deleteCollection);

// Subscription routes
import * as subscriptionController from "../controllers/subscriptionController";
router.post("/subscriptions", subscriptionController.createSubscription);
router.get("/subscriptions", subscriptionController.getSubscriptions);
router.delete("/subscriptions/:id", subscriptionController.deleteSubscription);

export default router;
