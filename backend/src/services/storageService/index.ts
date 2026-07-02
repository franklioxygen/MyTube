// Main index file that re-exports all storage service functionality
// This maintains backward compatibility while allowing modular organization

// Types
export * from "./types";

// Initialization
export { initializeStorage } from "./initialization";

// Download Status
export {
    addActiveDownload,
    getActiveDownload,
    getDownloadStatus,
    removeActiveDownload,
    setQueuedDownloads,
    updateActiveDownload,
    updateActiveDownloadTitle
} from "./downloadStatus";

// Download History
export {
    addDownloadHistoryItem,
    clearDownloadHistory,
    getDownloadHistory,
    getDownloadHistoryItem,
    getLatestRetryHistoryItemBySourceUrl,
    pruneDownloadHistory,
    getPendingRetryHistoryItems,
    finalizePendingRetryHistoryItem,
    markDownloadHistoryDeletedByVideoId,
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
export {
    deleteSettingsKeys,
    getSettings,
    invalidateSettingsCache,
    saveSettings,
    WHITELISTED_SETTINGS
} from "./settings";

// Videos
export {
    bumpVideosListRevision,
    classifyMediaVisibility,
    deleteVideo,
    formatLegacyFilenames,
    getVideoById,
    getVideoBySourceUrl,
    getVideos,
    getVideoSummaries,
    getVideosListETag,
    isCloudFileVisibleToVisitor,
    isThumbnailReferencedByOtherVideo,
    isVideoPublic,
    saveVideo,
    saveVideoIfAbsent,
    saveVideoWithInsertFlag,
    updateVideo
} from "./videos";
export type { MediaVisibility, VideoCallerRole } from "./videos";

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
    getCollectionBySourceKey,
    getCollectionByVideoId,
    getCollectionsByVideoId,
    getCollections,
    linkVideoToCollection,
    moveVideoToExclusiveCollection,
    removeVideoFromCollection,
    renameCollection,
    saveCollection
} from "./collections";

// Author Collection Utils
export {
    addVideoToAuthorCollection,
    backfillLegacyCollectionOrigins,
    cleanupRedundantAuthorCollectionLinks,
    findOrCreateAuthorCollection,
    organizeVideoByAuthor,
    validateCollectionName
} from "./authorCollectionUtils";

// File Helpers
export { findImageFile, findVideoFile, moveFile } from "./fileHelpers";
export { cleanupCollectionDirectories } from "./collectionFileManager";

// Filename Template path helpers (re-exported for convenience)
export { getManagedRelativePath, resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
