import express from "express";
import * as collectionController from "../controllers/collectionController";
import * as videoController from "../controllers/videoController";

const router = express.Router();

// Video routes
router.get("/search", videoController.searchVideos);
router.post("/download", videoController.downloadVideo);
router.post("/upload", videoController.upload.single("video"), videoController.uploadVideo);
router.get("/videos", videoController.getVideos);
router.get("/videos/:id", videoController.getVideoById);
router.delete("/videos/:id", videoController.deleteVideo);
router.get("/videos/:id/comments", videoController.getVideoComments);

router.get("/download-status", videoController.getDownloadStatus);
router.get("/check-bilibili-parts", videoController.checkBilibiliParts);
router.get("/check-bilibili-collection", videoController.checkBilibiliCollection);

// Collection routes
router.get("/collections", collectionController.getCollections);
router.post("/collections", collectionController.createCollection);
router.put("/collections/:id", collectionController.updateCollection);
router.delete("/collections/:id", collectionController.deleteCollection);

export default router;
