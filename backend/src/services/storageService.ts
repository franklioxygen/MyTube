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
  name?: string; // Add name property
  [key: string]: any;
}

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp: number;
  filename?: string;
  totalSize?: string;
  downloadedSize?: string;
  progress?: number;
  speed?: string;
}

export interface DownloadStatus {
  activeDownloads: DownloadInfo[];
  queuedDownloads: DownloadInfo[];
}

// Initialize storage directories and files
export function initializeStorage(): void {
  fs.ensureDirSync(UPLOADS_DIR);
  fs.ensureDirSync(VIDEOS_DIR);
  fs.ensureDirSync(IMAGES_DIR);
  fs.ensureDirSync(DATA_DIR);

  // Initialize status.json if it doesn't exist, or reset active downloads if it does
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    fs.writeFileSync(
      STATUS_DATA_PATH,
      JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
    );
  } else {
    // If it exists, we should clear active downloads because the server is just starting up
    // so no downloads can be active yet.
    try {
      const status = JSON.parse(fs.readFileSync(STATUS_DATA_PATH, "utf8"));
      status.activeDownloads = [];
      // We keep queued downloads as they might still be valid to process later
      // (though currently we don't auto-resume them, but we shouldn't delete them)
      if (!status.queuedDownloads) status.queuedDownloads = [];
      
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
      console.log("Cleared active downloads on startup");
    } catch (error) {
      console.error("Error resetting active downloads:", error);
      // Re-create if corrupt
      fs.writeFileSync(
        STATUS_DATA_PATH,
        JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
      );
    }
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
      // Preserve existing progress info if just updating title/timestamp
      downloadInfo.filename = status.activeDownloads[existingIndex].filename;
      downloadInfo.totalSize = status.activeDownloads[existingIndex].totalSize;
      downloadInfo.downloadedSize = status.activeDownloads[existingIndex].downloadedSize;
      downloadInfo.progress = status.activeDownloads[existingIndex].progress;
      downloadInfo.speed = status.activeDownloads[existingIndex].speed;
      
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

// Update an active download with partial info
export function updateActiveDownload(id: string, updates: Partial<DownloadInfo>): void {
  try {
    const status = getDownloadStatus();
    const existingIndex = status.activeDownloads.findIndex((d) => d.id === id);

    if (existingIndex >= 0) {
      status.activeDownloads[existingIndex] = {
        ...status.activeDownloads[existingIndex],
        ...updates,
        timestamp: Date.now() // Update timestamp to prevent stale removal
      };
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
    }
  } catch (error) {
    console.error("Error updating active download:", error);
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

// Set queued downloads
export function setQueuedDownloads(queuedDownloads: DownloadInfo[]): void {
  try {
    const status = getDownloadStatus();
    status.queuedDownloads = queuedDownloads;
    fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
  } catch (error) {
    console.error("Error setting queued downloads:", error);
  }
}

// Get download status
export function getDownloadStatus(): DownloadStatus {
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    const initialStatus: DownloadStatus = { activeDownloads: [], queuedDownloads: [] };
    fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(initialStatus, null, 2));
    return initialStatus;
  }

  try {
    const status: DownloadStatus = JSON.parse(
      fs.readFileSync(STATUS_DATA_PATH, "utf8")
    );

    // Ensure arrays exist
    if (!status.activeDownloads) status.activeDownloads = [];
    if (!status.queuedDownloads) status.queuedDownloads = [];

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
    return { activeDownloads: [], queuedDownloads: [] };
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

  // Remove the video file
  if (videoToDelete.videoFilename) {
    const actualPath = findVideoFile(videoToDelete.videoFilename);
    if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
    }
  }

  // Remove the thumbnail file
  if (videoToDelete.thumbnailFilename) {
      const actualPath = findImageFile(videoToDelete.thumbnailFilename);
      if (actualPath && fs.existsSync(actualPath)) {
          fs.unlinkSync(actualPath);
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

// Helper to find where a video file currently resides
function findVideoFile(filename: string): string | null {
  // Check root
  const rootPath = path.join(VIDEOS_DIR, filename);
  if (fs.existsSync(rootPath)) return rootPath;

  // Check collections
  const collections = getCollections();
  for (const collection of collections) {
    const collectionName = collection.name || collection.title;
    if (collectionName) {
      const collectionPath = path.join(VIDEOS_DIR, collectionName, filename);
      if (fs.existsSync(collectionPath)) return collectionPath;
    }
  }
  return null;
}

// Helper to find where an image file currently resides
function findImageFile(filename: string): string | null {
  // Check root
  const rootPath = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(rootPath)) return rootPath;

  // Check collections
  const collections = getCollections();
  for (const collection of collections) {
    const collectionName = collection.name || collection.title;
    if (collectionName) {
      const collectionPath = path.join(IMAGES_DIR, collectionName, filename);
      if (fs.existsSync(collectionPath)) return collectionPath;
    }
  }
  return null;
}

// Helper to move a file
function moveFile(sourcePath: string, destPath: string): void {
  try {
    if (fs.existsSync(sourcePath)) {
      fs.ensureDirSync(path.dirname(destPath));
      fs.moveSync(sourcePath, destPath, { overwrite: true });
      console.log(`Moved file from ${sourcePath} to ${destPath}`);
    }
  } catch (error) {
    console.error(`Error moving file from ${sourcePath} to ${destPath}:`, error);
  }
}

// Add video to collection and move files
export function addVideoToCollection(collectionId: string, videoId: string): Collection | null {
  const collection = atomicUpdateCollection(collectionId, (c) => {
    if (!c.videos.includes(videoId)) {
      c.videos.push(videoId);
    }
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    const collectionName = collection.name || collection.title;

    if (video && collectionName) {
      const updates: Partial<Video> = {};
      let updated = false;

      // Move video file
      if (video.videoFilename) {
        const currentVideoPath = findVideoFile(video.videoFilename);
        const targetVideoPath = path.join(VIDEOS_DIR, collectionName, video.videoFilename);
        
        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `/videos/${collectionName}/${video.videoFilename}`;
          updated = true;
        }
      }

      // Move image file
      if (video.thumbnailFilename) {
        const currentImagePath = findImageFile(video.thumbnailFilename);
        const targetImagePath = path.join(IMAGES_DIR, collectionName, video.thumbnailFilename);

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = `/images/${collectionName}/${video.thumbnailFilename}`;
          updated = true;
        }
      }

      if (updated) {
        updateVideo(videoId, updates);
      }
    }
  }

  return collection;
}

// Remove video from collection and move files
export function removeVideoFromCollection(collectionId: string, videoId: string): Collection | null {
  const collection = atomicUpdateCollection(collectionId, (c) => {
    c.videos = c.videos.filter((v) => v !== videoId);
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    
    if (video) {
      // Check if video is in any other collection
      const allCollections = getCollections();
      const otherCollection = allCollections.find(c => c.videos.includes(videoId) && c.id !== collectionId);
      
      let targetVideoDir = VIDEOS_DIR;
      let targetImageDir = IMAGES_DIR;
      let videoPathPrefix = '/videos';
      let imagePathPrefix = '/images';

      if (otherCollection) {
        const otherName = otherCollection.name || otherCollection.title;
        if (otherName) {
          targetVideoDir = path.join(VIDEOS_DIR, otherName);
          targetImageDir = path.join(IMAGES_DIR, otherName);
          videoPathPrefix = `/videos/${otherName}`;
          imagePathPrefix = `/images/${otherName}`;
        }
      }

      const updates: Partial<Video> = {};
      let updated = false;

      // Move video file
      if (video.videoFilename) {
        const currentVideoPath = findVideoFile(video.videoFilename);
        const targetVideoPath = path.join(targetVideoDir, video.videoFilename);
        
        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `${videoPathPrefix}/${video.videoFilename}`;
          updated = true;
        }
      }

      // Move image file
      if (video.thumbnailFilename) {
        const currentImagePath = findImageFile(video.thumbnailFilename);
        const targetImagePath = path.join(targetImageDir, video.thumbnailFilename);

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
          updated = true;
        }
      }

      if (updated) {
        updateVideo(videoId, updates);
      }
    }
  }

  return collection;
}

// Delete collection and move files back to root (or other collection)
export function deleteCollectionWithFiles(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;
  
  // Move files for all videos in the collection
  if (collection.videos && collection.videos.length > 0) {
    collection.videos.forEach(videoId => {
      const video = getVideoById(videoId);
      if (video) {
        // Check if video is in any OTHER collection (excluding the one being deleted)
        const allCollections = getCollections();
        const otherCollection = allCollections.find(c => c.videos.includes(videoId) && c.id !== collectionId);

        let targetVideoDir = VIDEOS_DIR;
        let targetImageDir = IMAGES_DIR;
        let videoPathPrefix = '/videos';
        let imagePathPrefix = '/images';

        if (otherCollection) {
          const otherName = otherCollection.name || otherCollection.title;
          if (otherName) {
            targetVideoDir = path.join(VIDEOS_DIR, otherName);
            targetImageDir = path.join(IMAGES_DIR, otherName);
            videoPathPrefix = `/videos/${otherName}`;
            imagePathPrefix = `/images/${otherName}`;
          }
        }

        const updates: Partial<Video> = {};
        let updated = false;

        // Move video file
        if (video.videoFilename) {
          // We know it should be in the collection folder being deleted, but use findVideoFile to be safe
          const currentVideoPath = findVideoFile(video.videoFilename);
          const targetVideoPath = path.join(targetVideoDir, video.videoFilename);
          
          if (currentVideoPath && currentVideoPath !== targetVideoPath) {
            moveFile(currentVideoPath, targetVideoPath);
            updates.videoPath = `${videoPathPrefix}/${video.videoFilename}`;
            updated = true;
          }
        }

        // Move image file
        if (video.thumbnailFilename) {
          const currentImagePath = findImageFile(video.thumbnailFilename);
          const targetImagePath = path.join(targetImageDir, video.thumbnailFilename);

          if (currentImagePath && currentImagePath !== targetImagePath) {
            moveFile(currentImagePath, targetImagePath);
            updates.thumbnailPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
            updated = true;
          }
        }

        if (updated) {
          updateVideo(videoId, updates);
        }
      }
    });
  }

  // Delete the collection from DB
  const success = deleteCollection(collectionId);

  // Remove the collection directories if empty
  if (success && collectionName) {
    try {
      const videoCollectionDir = path.join(VIDEOS_DIR, collectionName);
      const imageCollectionDir = path.join(IMAGES_DIR, collectionName);

      if (fs.existsSync(videoCollectionDir) && fs.readdirSync(videoCollectionDir).length === 0) {
        fs.rmdirSync(videoCollectionDir);
      }
      if (fs.existsSync(imageCollectionDir) && fs.readdirSync(imageCollectionDir).length === 0) {
        fs.rmdirSync(imageCollectionDir);
      }
    } catch (error) {
      console.error("Error removing collection directories:", error);
    }
  }

  return success;
}

// Delete collection and all its videos
export function deleteCollectionAndVideos(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;

  // Delete all videos in the collection
  if (collection.videos && collection.videos.length > 0) {
    // Create a copy of the videos array to iterate over safely
    const videosToDelete = [...collection.videos];
    videosToDelete.forEach(videoId => {
      deleteVideo(videoId);
    });
  }

  // Delete the collection from DB
  const success = deleteCollection(collectionId);

  // Remove the collection directories
  if (success && collectionName) {
    try {
      const videoCollectionDir = path.join(VIDEOS_DIR, collectionName);
      const imageCollectionDir = path.join(IMAGES_DIR, collectionName);

      if (fs.existsSync(videoCollectionDir)) {
        fs.rmdirSync(videoCollectionDir);
      }
      if (fs.existsSync(imageCollectionDir)) {
        fs.rmdirSync(imageCollectionDir);
      }
    } catch (error) {
      console.error("Error removing collection directories:", error);
    }
  }

  return success;
}
