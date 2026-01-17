// Main index file that re-exports all storage service functionality
// This maintains backward compatibility while allowing modular organization

// Types
export * from "./types";

// Initialization
export { initializeStorage } from "./initialization";

// Download Status
export {
    addActiveDownload,
    getDownloadStatus,
    removeActiveDownload,
    setQueuedDownloads,
    updateActiveDownload
} from "./downloadStatus";

// Download History
export {
    addDownloadHistoryItem,
    clearDownloadHistory,
    getDownloadHistory,
    removeDownloadHistoryItem
} from "./downloadHistory";

// Video Download Tracking
export {
    checkVideoDownloadBySourceId,
    checkVideoDownloadByUrl,
    handleVideoDownloadCheck,
    markVideoDownloadDeleted,
    recordVideoDownload,
    updateVideoDownloadRecord,
    verifyVideoExists
} from "./videoDownloadTracking";

// Settings
export { getSettings, saveSettings } from "./settings";

// Videos
export {
    deleteVideo,
    formatLegacyFilenames,
    getVideoById,
    getVideoBySourceUrl,
    getVideos,
    saveVideo,
    updateVideo
} from "./videos";

// Collections
export {
    addVideoToCollection,
    atomicUpdateCollection,
    deleteCollection,
    deleteCollectionAndVideos,
    deleteCollectionWithFiles,
    generateUniqueCollectionName,
    getCollectionById,
    getCollectionByName,
    getCollectionByVideoId,
    getCollections,
    removeVideoFromCollection,
    renameCollection,
    saveCollection
} from "./collections";

// Author Collection Utils
export {
    addVideoToAuthorCollection,
    findOrCreateAuthorCollection,
    validateCollectionName
} from "./authorCollectionUtils";

// File Helpers
export { findImageFile, findVideoFile, moveFile } from "./fileHelpers";
