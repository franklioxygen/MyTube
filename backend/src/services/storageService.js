const fs = require("fs-extra");
const path = require("path");
const {
  UPLOADS_DIR,
  VIDEOS_DIR,
  IMAGES_DIR,
  DATA_DIR,
  VIDEOS_DATA_PATH,
  STATUS_DATA_PATH,
  COLLECTIONS_DATA_PATH,
} = require("../config/paths");

// Initialize storage directories and files
function initializeStorage() {
  fs.ensureDirSync(UPLOADS_DIR);
  fs.ensureDirSync(VIDEOS_DIR);
  fs.ensureDirSync(IMAGES_DIR);
  fs.ensureDirSync(DATA_DIR);

  // Initialize status.json if it doesn't exist
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    fs.writeFileSync(
      STATUS_DATA_PATH,
      JSON.stringify({ isDownloading: false, title: "" }, null, 2)
    );
  }
}

// Update download status
function updateDownloadStatus(isDownloading, title = "") {
  try {
    fs.writeFileSync(
      STATUS_DATA_PATH,
      JSON.stringify({ isDownloading, title, timestamp: Date.now() }, null, 2)
    );
    console.log(
      `Download status updated: isDownloading=${isDownloading}, title=${title}`
    );
  } catch (error) {
    console.error("Error updating download status:", error);
  }
}

// Get download status
function getDownloadStatus() {
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    updateDownloadStatus(false);
    return { isDownloading: false, title: "" };
  }

  const status = JSON.parse(fs.readFileSync(STATUS_DATA_PATH, "utf8"));

  // Check if the status is stale (older than 5 minutes)
  const now = Date.now();
  if (status.timestamp && now - status.timestamp > 5 * 60 * 1000) {
    console.log("Download status is stale, resetting to false");
    updateDownloadStatus(false);
    return { isDownloading: false, title: "" };
  }

  return status;
}

// Get all videos
function getVideos() {
  if (!fs.existsSync(VIDEOS_DATA_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(VIDEOS_DATA_PATH, "utf8"));
}

// Get video by ID
function getVideoById(id) {
  const videos = getVideos();
  return videos.find((v) => v.id === id);
}

// Save a new video
function saveVideo(videoData) {
  let videos = getVideos();
  videos.unshift(videoData);
  fs.writeFileSync(VIDEOS_DATA_PATH, JSON.stringify(videos, null, 2));
  return videoData;
}

// Delete a video
function deleteVideo(id) {
  let videos = getVideos();
  const videoToDelete = videos.find((v) => v.id === id);

  if (!videoToDelete) {
    return false;
  }

  // Remove the video file from the videos directory
  if (videoToDelete.videoFilename) {
    const videoFilePath = path.join(VIDEOS_DIR, videoToDelete.videoFilename);
    if (fs.existsSync(videoFilePath)) {
      fs.unlinkSync(videoFilePath);
    }
  }

  // Remove the thumbnail file from the images directory
  if (videoToDelete.thumbnailFilename) {
    const thumbnailFilePath = path.join(
      IMAGES_DIR,
      videoToDelete.thumbnailFilename
    );
    if (fs.existsSync(thumbnailFilePath)) {
      fs.unlinkSync(thumbnailFilePath);
    }
  }

  // Filter out the deleted video from the videos array
  videos = videos.filter((v) => v.id !== id);

  // Save the updated videos array
  fs.writeFileSync(VIDEOS_DATA_PATH, JSON.stringify(videos, null, 2));

  return true;
}

// Get all collections
function getCollections() {
  if (!fs.existsSync(COLLECTIONS_DATA_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(COLLECTIONS_DATA_PATH, "utf8"));
}

// Get collection by ID
function getCollectionById(id) {
  const collections = getCollections();
  return collections.find((c) => c.id === id);
}

// Save a new collection
function saveCollection(collection) {
  let collections = getCollections();
  collections.push(collection);
  fs.writeFileSync(COLLECTIONS_DATA_PATH, JSON.stringify(collections, null, 2));
  return collection;
}

// Update a collection
function updateCollection(updatedCollection) {
  let collections = getCollections();
  const index = collections.findIndex((c) => c.id === updatedCollection.id);

  if (index === -1) {
    return false;
  }

  collections[index] = updatedCollection;
  fs.writeFileSync(COLLECTIONS_DATA_PATH, JSON.stringify(collections, null, 2));
  return true;
}

// Delete a collection
function deleteCollection(id) {
  let collections = getCollections();
  const updatedCollections = collections.filter((c) => c.id !== id);

  if (updatedCollections.length === collections.length) {
    return false;
  }

  fs.writeFileSync(
    COLLECTIONS_DATA_PATH,
    JSON.stringify(updatedCollections, null, 2)
  );
  return true;
}

module.exports = {
  initializeStorage,
  updateDownloadStatus,
  getDownloadStatus,
  getVideos,
  getVideoById,
  saveVideo,
  deleteVideo,
  getCollections,
  getCollectionById,
  saveCollection,
  updateCollection,
  deleteCollection,
};
