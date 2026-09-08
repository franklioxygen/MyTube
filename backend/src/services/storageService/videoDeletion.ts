import { eq } from "drizzle-orm";
import path from "path";
import {
  AVATARS_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import { removeMediaServerArtifactsForVideo } from "../mediaServerExport";
import { logger } from "../../utils/logger";
import { getCollections } from "./collections";
import {
  buildStoragePath,
  findImageFile,
  findVideoFile,
  pathExists,
  removeEmptyDirectoryChain,
  removeFileIfExists,
} from "./fileHelpers";
import { markDownloadHistoryDeletedByVideoId } from "./downloadHistory";
import { markVideoDownloadDeleted } from "./videoDownloadTracking";
import {
  deleteSmallThumbnailMirrorSync,
  resolveManagedThumbnailWebPathFromAbsolutePath,
} from "../thumbnailMirrorService";
import { bumpVideosListRevision } from "./videoListRevision";
import { getVideoById, getArtifactOwners } from "./videoQueries";
import { createArtifactReferenceGuard } from "./artifactReferences";

type ReferenceGuard = (absolutePath: string) => boolean;

export function deleteVideo(
  id: string,
  reason: "manual" | "retention" | "maintenance" | "auto_delete" = "manual"
): boolean {
  try {
    const videoToDelete = getVideoById(id);
    if (!videoToDelete) return false;

    const allCollections = getCollections();
    // Read all owners before touching disk. Never treat a database/JSON read
    // failure as an empty library and delete potentially shared artifacts.
    const remainingVideos = getArtifactOwners().filter((video) => video.id !== id);
    const isReferenced = createArtifactReferenceGuard(remainingVideos);

    // Remove video file
    deleteVideoFile(videoToDelete, allCollections, isReferenced);

    // Remove thumbnail file
    deleteThumbnailFile(videoToDelete, allCollections, isReferenced);

    // Remove author avatar file only if this is the last video from this author
    deleteAuthorAvatarIfNeeded(videoToDelete, remainingVideos, isReferenced);

    // Remove subtitle files
    deleteSubtitleFiles(videoToDelete, allCollections, isReferenced);

    const deletedAt = Date.now();

    // Mark download tracking and history as deleted
    markVideoDownloadDeleted(id);
    markDownloadHistoryDeletedByVideoId(id, deletedAt);

    // Delete from DB
    db.delete(videos).where(eq(videos.id, id)).run();
    bumpVideosListRevision();
    try {
      const { invalidateRecommendationSignalsCache } = require("../recommendationSignalsService") as {
        invalidateRecommendationSignalsCache: () => void;
      };
      invalidateRecommendationSignalsCache();
    } catch {
      // recommendation signals are best-effort
    }
    removeMediaServerArtifactsForVideo(videoToDelete, {
      libraryVideos: remainingVideos,
      preserveSharedArtifacts: true,
    });

    // Statistics: emit library_video_deleted with the reason bucket and a size
    // snapshot if known. Best-effort; never blocks the delete.
    try {
      // Lazy require to avoid import cycles between storageService and statistics.
      const { recordEvent } = require("../statistics") as {
        recordEvent: (input: any) => string | null;
      };
      const fileSizeBytes =
        videoToDelete.fileSize !== undefined && videoToDelete.fileSize !== null
          ? Number(videoToDelete.fileSize) || 0
          : 0;
      recordEvent({
        eventType: "library_video_deleted",
        actorRole: reason === "retention" ? "system" : "system",
        surface: "background",
        videoId: id,
        platform:
          typeof videoToDelete.source === "string"
            ? videoToDelete.source.toLowerCase()
            : null,
        payload: {
          reason,
          videoTitle: videoToDelete.title,
          fileSizeBytes,
        },
      });
    } catch {
      // statistics is best-effort
    }
    return true;
  } catch (error) {
    logger.error(
      "Error deleting video",
      error instanceof Error ? error : new Error(String(error))
    );
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(
      `Failed to delete video: ${id}`,
      error instanceof Error ? error : new Error(String(error)),
      "deleteVideo"
    );
  }
}

function isLocalManagedVideo(
  video: import("./types").Video
): boolean {
  return !video.videoPath || video.videoPath.startsWith("/videos/");
}

export function isThumbnailReferencedByOtherVideo(
  video: import("./types").Video,
  exceptionId: string,
  candidatePath?: string
): boolean {
  if (!candidatePath && !video.thumbnailFilename && !video.thumbnailPath) return false;
  const owners = getArtifactOwners().filter((candidate) => candidate.id !== exceptionId);
  const absolutePath = candidatePath ?? (video.thumbnailPath
    ? resolveManagedWebPath(video.thumbnailPath)?.absolutePath
    : video.thumbnailFilename ? buildStoragePath(IMAGES_DIR, video.thumbnailFilename) : undefined);
  // An unresolved explicit path cannot establish which file is safe to delete.
  return !absolutePath || createArtifactReferenceGuard(owners)(absolutePath);
}

export function isVideoFileReferencedByOtherVideo(
  video: import("./types").Video,
  exceptionId: string,
  candidatePath?: string
): boolean {
  if (!candidatePath && !video.videoFilename && !video.videoPath) return false;
  const owners = getArtifactOwners().filter((candidate) => candidate.id !== exceptionId);
  const absolutePath = candidatePath ?? (video.videoPath
    ? resolveManagedWebPath(video.videoPath)?.absolutePath
    : video.videoFilename ? buildStoragePath(VIDEOS_DIR, video.videoFilename) : undefined);
  return !absolutePath || createArtifactReferenceGuard(owners)(absolutePath);
}

function deleteVideoFile(
  video: import("./types").Video,
  allCollections: import("./types").Collection[],
  isReferenced: ReferenceGuard
): void {
  if (!isLocalManagedVideo(video)) {
    return;
  }

  // Prefer videoPath so a templated nested path (e.g.
  // /videos/Channel/Season 2026/file.mp4) resolves to its real on-disk
  // location. Once template subdirectories are enabled identical basenames
  // can exist in different folders, and findVideoFile() (basename-only
  // lookup) could match the wrong file or miss the intended one entirely.
  if (video.videoPath) {
    const resolved = resolveManagedWebPath(video.videoPath);
    if (resolved?.prefix === "/videos") {
      deleteLocalVideoPath(resolved.absolutePath, resolved.rootDir, isReferenced);
    }
    // A missing or invalid explicit path must never select someone else's
    // file by basename. Scanning uses this path to reconcile missing records.
    return;
  }

  // Legacy fallback: only basename available (older rows pre-feature).
  if (video.videoFilename) {
    const actualPath = findVideoFile(video.videoFilename, allCollections);
    if (actualPath) {
      deleteLocalVideoPath(actualPath, VIDEOS_DIR, isReferenced);
    }
  }
}

function deleteLocalVideoPath(absolutePath: string, rootDir: string, isReferenced: ReferenceGuard): boolean {
  if (!pathExists(absolutePath) || isReferenced(absolutePath)) {
    return false;
  }

  removeFileIfExists(absolutePath);
  removeEmptyDirectoryChain(path.dirname(absolutePath), rootDir);
  return true;
}

function deleteThumbnailFile(
  video: import("./types").Video,
  allCollections: import("./types").Collection[],
  isReferenced: ReferenceGuard
): void {
  if (video.thumbnailFilename) {
    const canUseLocalFallbacks = !video.thumbnailPath && isLocalManagedVideo(video);
    let thumbnailPath: string | null = null;

    // Determine the actual file path based on thumbnailPath
    if (video.thumbnailPath) {
      if (video.thumbnailPath.startsWith("/videos/")) {
        // Thumbnail is stored alongside video file
        thumbnailPath = buildStoragePath(
          VIDEOS_DIR,
          video.thumbnailPath.replace(/^\/videos\//, "")
        );
      } else if (video.thumbnailPath.startsWith("/images/")) {
        // Thumbnail is in images directory (may be in collection subdirectory)
        thumbnailPath = buildStoragePath(
          UPLOADS_DIR,
          video.thumbnailPath.replace(/^\//, "")
        );
      }
    }

    // Fallback: try to find by filename if path-based lookup fails
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (
      canUseLocalFallbacks &&
      (!thumbnailPath || !pathExists(thumbnailPath))
    ) {
      // Try alongside video file (when moveThumbnailsToVideoFolder is enabled)
      if (video.videoFilename) {
        const videoPath = video.videoPath
          ? resolveManagedWebPath(video.videoPath)?.absolutePath
          : findVideoFile(video.videoFilename, allCollections);
        if (videoPath) {
          const videoDir = path.dirname(videoPath);
          thumbnailPath = buildStoragePath(videoDir, video.thumbnailFilename);
          if (!pathExists(thumbnailPath)) {
            thumbnailPath = null;
          }
        }
      }
    }

    // Final fallback: try standard image locations
    if (
      canUseLocalFallbacks &&
      (!thumbnailPath || !pathExists(thumbnailPath))
    ) {
      thumbnailPath = findImageFile(video.thumbnailFilename, allCollections);
    }

    // Delete the thumbnail file if it exists
    if (thumbnailPath && pathExists(thumbnailPath)) {
      if (isReferenced(thumbnailPath)) {
        logger.info(
          `Skipping thumbnail deletion - another video still references it: ${thumbnailPath}`
        );
        return;
      }

      try {
        const thumbnailWebPath =
          resolveManagedThumbnailWebPathFromAbsolutePath(thumbnailPath) ||
          video.thumbnailPath ||
          null;
        removeFileIfExists(thumbnailPath);
        deleteSmallThumbnailMirrorSync(thumbnailWebPath);
        pruneManagedArtifactParentDirectories(thumbnailPath);
        logger.info(`Deleted thumbnail file: ${thumbnailPath}`);
      } catch (error) {
        logger.error(
          `Error deleting thumbnail file ${thumbnailPath}`,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }
}

function deleteAuthorAvatarIfNeeded(
  video: import("./types").Video,
  remainingVideos: import("./types").Video[],
  isReferenced: ReferenceGuard
): void {
  if (video.authorAvatarFilename && video.author) {
    // Check if there are other videos from the same author
    const otherVideosFromAuthor = remainingVideos.filter(
      (v) => v.author === video.author
    );

    // Only delete avatar if this is the last video from this author
    if (otherVideosFromAuthor.length === 0) {
      let avatarPath: string | null = null;

      // Determine the actual file path based on authorAvatarPath
      if (video.authorAvatarPath) {
        if (video.authorAvatarPath.startsWith("/avatars/")) {
          // Avatar is in avatars directory
          avatarPath = buildStoragePath(
            UPLOADS_DIR,
            video.authorAvatarPath.replace(/^\//, "")
          );
        } else if (video.authorAvatarPath.startsWith("/images/")) {
          // Legacy: Avatar might be in images directory (for backward compatibility)
          avatarPath = buildStoragePath(
            UPLOADS_DIR,
            video.authorAvatarPath.replace(/^\//, "")
          );
        }
      }

      // Fallback: try to find by filename in avatars directory
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (!video.authorAvatarPath) {
        const fallbackPath = buildStoragePath(
          AVATARS_DIR,
          video.authorAvatarFilename
        );
        if (pathExists(fallbackPath)) {
          avatarPath = fallbackPath;
        }
      }

      // Delete the avatar file if it exists
      if (avatarPath && pathExists(avatarPath) && !isReferenced(avatarPath)) {
        try {
          removeFileIfExists(avatarPath);
          removeEmptyDirectoryChain(path.dirname(avatarPath), AVATARS_DIR);
          logger.info(`Deleted author avatar file: ${avatarPath}`);
        } catch (error) {
          logger.error(
            `Error deleting author avatar file ${avatarPath}`,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    } else {
      logger.info(
        `Skipping avatar deletion - ${otherVideosFromAuthor.length} other video(s) from author "${video.author}" still exist`
      );
    }
  }
}

function deleteSubtitleFiles(
  video: import("./types").Video,
  allCollections: import("./types").Collection[],
  isReferenced: ReferenceGuard
): void {
  if (video.subtitles && video.subtitles.length > 0) {
    const canUseLocalFallbacks = isLocalManagedVideo(video);
    for (const subtitle of video.subtitles) {
      let subtitlePath =
        subtitle.path && typeof subtitle.path === "string"
          ? resolveManagedWebPath(subtitle.path)?.absolutePath ?? null
          : null;

      // Fallback: try to find by filename if path-based lookup fails
      // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
      if (
        canUseLocalFallbacks && !subtitle.path
      ) {
        // Try root subtitles directory
        subtitlePath = buildStoragePath(SUBTITLES_DIR, subtitle.filename);
        if (!pathExists(subtitlePath)) {
          // Try alongside video file
          if (video.videoFilename) {
            const videoPath = video.videoPath
              ? resolveManagedWebPath(video.videoPath)?.absolutePath
              : findVideoFile(video.videoFilename, allCollections);
            if (videoPath) {
              const videoDir = path.dirname(videoPath);
              subtitlePath = buildStoragePath(videoDir, subtitle.filename);
            }
          }
        }
      }

      // Delete the subtitle file if it exists
      if (subtitlePath && pathExists(subtitlePath) && !isReferenced(subtitlePath)) {
        try {
          removeFileIfExists(subtitlePath);
          pruneManagedArtifactParentDirectories(subtitlePath);
          logger.info(`Deleted subtitle file: ${subtitlePath}`);
        } catch (error) {
          logger.error(
            `Error deleting subtitle file ${subtitlePath}`,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }
  }
}

function pruneManagedArtifactParentDirectories(absolutePath: string): void {
  if (absolutePath.startsWith(VIDEOS_DIR + path.sep)) {
    removeEmptyDirectoryChain(path.dirname(absolutePath), VIDEOS_DIR);
    return;
  }

  if (absolutePath.startsWith(IMAGES_DIR + path.sep)) {
    removeEmptyDirectoryChain(path.dirname(absolutePath), IMAGES_DIR);
    return;
  }

  if (absolutePath.startsWith(SUBTITLES_DIR + path.sep)) {
    removeEmptyDirectoryChain(path.dirname(absolutePath), SUBTITLES_DIR);
    return;
  }
}
