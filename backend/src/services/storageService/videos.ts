// Barrel for the video storage layer, split into focused modules.
// Re-exports the public surface so existing `./videos` imports keep working.

export type { VideoCallerRole } from "./videoQueries";
export {
  getVideos,
  getVideoSummaries,
  getVideoBySourceUrl,
  getVideoById,
  getVideoPartBySourceUrl,
} from "./videoQueries";

export {
  bumpVideosListRevision,
  getVideosListETag,
} from "./videoListRevision";

export type { MediaVisibility } from "./videoVisibility";
export {
  classifyMediaVisibility,
  isCloudFileVisibleToVisitor,
  isVideoPublic,
} from "./videoVisibility";

export type { SaveVideoOptions } from "./videoMutations";
export {
  saveVideo,
  saveVideoIfAbsent,
  saveVideoWithInsertFlag,
  updateVideo,
} from "./videoMutations";

export { deleteVideo, isThumbnailReferencedByOtherVideo } from "./videoDeletion";

export { formatLegacyFilenames } from "./legacyFilenames";
