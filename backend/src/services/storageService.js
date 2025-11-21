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
      JSON.stringify({ activeDownloads: [] }, null, 2)
    );
  }
}

// Add an active download
function addActiveDownload(id, title) {
  try {
    const status = getDownloadStatus();
    const existingIndex = status.activeDownloads.findIndex(d => d.id === id);
    
    const downloadInfo = { 
      id, 
      title, 
      timestamp: Date.now() 
    };

    if (existingIndex >= 0) {
      status.activeDownloads[existingIndex] = downloadInfo;
    } else {
      status.activeDownloads.push(downloadInfo);
    }

    fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
    console.log(`Added/Updated active download: ${title} (${id})`);
  } catch (error) {
    console.error("Error adding active download:", error);
  }
}

// Remove an active download
function removeActiveDownload(id) {
  try {
    const status = getDownloadStatus();
    const initialLength = status.activeDownloads.length;
    status.activeDownloads = status.activeDownloads.filter(d => d.id !== id);

    if (status.activeDownloads.length !== initialLength) {
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
      console.log(`Removed active download: ${id}`);
    }
  } catch (error) {
    console.error("Error removing active download:", error);
  }
}

// Get download status
function getDownloadStatus() {
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    const initialStatus = { activeDownloads: [] };
    fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(initialStatus, null, 2));
    return initialStatus;
  }

  try {
    const status = JSON.parse(fs.readFileSync(STATUS_DATA_PATH, "utf8"));
    
    // Ensure activeDownloads exists
    if (!status.activeDownloads) {
      status.activeDownloads = [];
    }

    // Check for stale downloads (older than 30 minutes)
    const now = Date.now();
    const validDownloads = status.activeDownloads.filter(d => {
      return d.timestamp && (now - d.timestamp < 30 * 60 * 1000);
    });

    if (validDownloads.length !== status.activeDownloads.length) {
      console.log("Removed stale downloads");
      status.activeDownloads = validDownloads;
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
    }

    return status;
  } catch (error) {
    console.error("Error reading download status:", error);
    return { activeDownloads: [] };
  }
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

// Atomic update for a collection
function atomicUpdateCollection(id, updateFn) {
  let collections = getCollections();
  const index = collections.findIndex((c) => c.id === id);

  if (index === -1) {
    return null;
  }

  // Create a deep copy of the collection to avoid reference issues
  const originalCollection = collections[index];
  const collectionCopy = JSON.parse(JSON.stringify(originalCollection));

  // Apply the update function
  const updatedCollection = updateFn(collectionCopy);

  // If the update function returned null or undefined, abort the update
  if (!updatedCollection) {
    return null;
  }

  updatedCollection.updatedAt = new Date().toISOString();

  // Update the collection in the array
  collections[index] = updatedCollection;

  // Write back to file synchronously
  fs.writeFileSync(COLLECTIONS_DATA_PATH, JSON.stringify(collections, null, 2));

  return updatedCollection;
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
  addActiveDownload,
  removeActiveDownload,
  getDownloadStatus,
  getVideos,
  getVideoById,
  saveVideo,
  deleteVideo,
  getCollections,
  getCollectionById,
  saveCollection,
  atomicUpdateCollection,
  deleteCollection,
};
