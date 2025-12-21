// Main index file that re-exports all storage service functionality
// This maintains backward compatibility while allowing modular organization

// Types
export * from "./types";

// Initialization
export { initializeStorage } from "./initialization";

// Download Status
export {
  addActiveDownload,
  updateActiveDownload,
  removeActiveDownload,
  setQueuedDownloads,
  getDownloadStatus,
} from "./downloadStatus";

// Download History
export {
  addDownloadHistoryItem,
  getDownloadHistory,
  removeDownloadHistoryItem,
  clearDownloadHistory,
} from "./downloadHistory";

// Video Download Tracking
export {
  checkVideoDownloadBySourceId,
  checkVideoDownloadByUrl,
  recordVideoDownload,
  markVideoDownloadDeleted,
  updateVideoDownloadRecord,
} from "./videoDownloadTracking";

// Settings
export { getSettings, saveSettings } from "./settings";

// Videos
export {
  getVideos,
  getVideoBySourceUrl,
  getVideoById,
  formatLegacyFilenames,
  saveVideo,
  updateVideo,
  deleteVideo,
} from "./videos";

// Collections
export {
  getCollections,
  getCollectionById,
  getCollectionByVideoId,
  getCollectionByName,
  saveCollection,
  atomicUpdateCollection,
  deleteCollection,
  addVideoToCollection,
  removeVideoFromCollection,
  deleteCollectionWithFiles,
  deleteCollectionAndVideos,
} from "./collections";

// File Helpers
export { findVideoFile, findImageFile, moveFile } from "./fileHelpers";

