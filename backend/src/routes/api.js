const express = require("express");
const router = express.Router();
const videoController = require("../controllers/videoController");
const collectionController = require("../controllers/collectionController");

// Video routes
router.get("/search", videoController.searchVideos);
router.post("/download", videoController.downloadVideo);
router.get("/videos", videoController.getVideos);
router.get("/videos/:id", videoController.getVideoById);
router.delete("/videos/:id", videoController.deleteVideo);
router.get("/download-status", videoController.getDownloadStatus);
router.get("/check-bilibili-parts", videoController.checkBilibiliParts);

// Collection routes
router.get("/collections", collectionController.getCollections);
router.post("/collections", collectionController.createCollection);
router.put("/collections/:id", collectionController.updateCollection);
router.delete("/collections/:id", collectionController.deleteCollection);

module.exports = router;
