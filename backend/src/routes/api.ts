import express from "express";
import * as collectionController from "../controllers/collectionController";
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

router.get("/download-status", videoController.getDownloadStatus);
router.get("/check-bilibili-parts", videoController.checkBilibiliParts);
router.get("/check-bilibili-collection", videoController.checkBilibiliCollection);

// Collection routes
router.get("/collections", collectionController.getCollections);
router.post("/collections", collectionController.createCollection);
router.put("/collections/:id", collectionController.updateCollection);
router.delete("/collections/:id", collectionController.deleteCollection);

export default router;
