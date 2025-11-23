import fs from "fs-extra";
import path from "path";
import {
    COLLECTIONS_DATA_PATH,
    DATA_DIR,
    IMAGES_DIR,
    STATUS_DATA_PATH,
    UPLOADS_DIR,
    VIDEOS_DATA_PATH,
    VIDEOS_DIR,
} from "../config/paths";

export interface Video {
  id: string;
  title: string;
  sourceUrl: string;
  videoFilename?: string;
  thumbnailFilename?: string;
  createdAt: string;
  [key: string]: any;
}

export interface Collection {
  id: string;
  title: string;
  videos: string[];
  updatedAt?: string;
  [key: string]: any;
}

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp: number;
}

export interface DownloadStatus {
  activeDownloads: DownloadInfo[];
}

// Initialize storage directories and files
export function initializeStorage(): void {
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
export function addActiveDownload(id: string, title: string): void {
  try {
    const status = getDownloadStatus();
    const existingIndex = status.activeDownloads.findIndex((d) => d.id === id);

    const downloadInfo: DownloadInfo = {
      id,
      title,
      timestamp: Date.now(),
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
export function removeActiveDownload(id: string): void {
  try {
    const status = getDownloadStatus();
    const initialLength = status.activeDownloads.length;
    status.activeDownloads = status.activeDownloads.filter((d) => d.id !== id);

    if (status.activeDownloads.length !== initialLength) {
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
      console.log(`Removed active download: ${id}`);
    }
  } catch (error) {
    console.error("Error removing active download:", error);
  }
}

// Get download status
export function getDownloadStatus(): DownloadStatus {
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    const initialStatus: DownloadStatus = { activeDownloads: [] };
    fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(initialStatus, null, 2));
    return initialStatus;
  }

  try {
    const status: DownloadStatus = JSON.parse(
      fs.readFileSync(STATUS_DATA_PATH, "utf8")
    );

    // Ensure activeDownloads exists
    if (!status.activeDownloads) {
      status.activeDownloads = [];
    }

    // Check for stale downloads (older than 30 minutes)
    const now = Date.now();
    const validDownloads = status.activeDownloads.filter((d) => {
      return d.timestamp && now - d.timestamp < 30 * 60 * 1000;
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
export function getVideos(): Video[] {
  if (!fs.existsSync(VIDEOS_DATA_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(VIDEOS_DATA_PATH, "utf8"));
}

// Get video by ID
export function getVideoById(id: string): Video | undefined {
  const videos = getVideos();
  return videos.find((v) => v.id === id);
}

// Save a new video
export function saveVideo(videoData: Video): Video {
  let videos = getVideos();
  videos.unshift(videoData);
  fs.writeFileSync(VIDEOS_DATA_PATH, JSON.stringify(videos, null, 2));
  return videoData;
}

// Update a video
export function updateVideo(id: string, updates: Partial<Video>): Video | null {
  let videos = getVideos();
  const index = videos.findIndex((v) => v.id === id);

  if (index === -1) {
    return null;
  }

  const updatedVideo = { ...videos[index], ...updates };
  videos[index] = updatedVideo;
  fs.writeFileSync(VIDEOS_DATA_PATH, JSON.stringify(videos, null, 2));
  return updatedVideo;
}

// Delete a video
export function deleteVideo(id: string): boolean {
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
export function getCollections(): Collection[] {
  if (!fs.existsSync(COLLECTIONS_DATA_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(COLLECTIONS_DATA_PATH, "utf8"));
}

// Get collection by ID
export function getCollectionById(id: string): Collection | undefined {
  const collections = getCollections();
  return collections.find((c) => c.id === id);
}

// Save a new collection
export function saveCollection(collection: Collection): Collection {
  let collections = getCollections();
  collections.push(collection);
  fs.writeFileSync(COLLECTIONS_DATA_PATH, JSON.stringify(collections, null, 2));
  return collection;
}

// Atomic update for a collection
export function atomicUpdateCollection(
  id: string,
  updateFn: (collection: Collection) => Collection | null
): Collection | null {
  let collections = getCollections();
  const index = collections.findIndex((c) => c.id === id);

  if (index === -1) {
    return null;
  }

  // Create a deep copy of the collection to avoid reference issues
  const originalCollection = collections[index];
  const collectionCopy: Collection = JSON.parse(
    JSON.stringify(originalCollection)
  );

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
export function deleteCollection(id: string): boolean {
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
