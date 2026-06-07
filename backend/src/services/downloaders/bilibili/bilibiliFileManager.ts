import crypto from "crypto";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import {
  deleteSmallThumbnailMirrorSync,
  moveSmallThumbnailMirrorSync,
} from "../../thumbnailMirrorService";
import {
  applyDedupeToRelatedPaths,
  dedupeRelativePath,
} from "../../filenameTemplate/dedupe";
import { safeRemove } from "../../../utils/downloadUtils";
import { formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  ensureDirSafeSync,
  moveSafeSync,
  pathExistsSafeSync,
  readdirSafeSync,
  renameSafeSync,
  resolveSafePathInDirectories,
  resolveSafeChildPath,
  sanitizePathSegment,
} from "../../../utils/security";
import { planVideoOutputPaths } from "../../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../../filenameTemplate/sourceOptions";
import { FilenameTemplateContext, FilenameTemplateSourceOptions } from "../../filenameTemplate/types";

export interface FilePaths {
  videoPath: string;
  thumbnailPath: string;
  videoDir: string;
  imageDir: string;
}

export interface RenamedPaths {
  newVideoPath: string;
  newThumbnailPath: string;
  finalVideoFilename: string;
  finalThumbnailFilename: string;
  videoWebPath?: string;
  thumbnailWebPath?: string;
  subtitleBaseDir?: string;
  subtitleStem?: string;
  subtitleWebBaseDir?: string;
}

export interface RenameFilesOptions {
  settings?: {
    downloadFilenamePresetId?: string;
    downloadFilenameTemplate?: string;
    moveThumbnailsToVideoFolder?: boolean;
    moveSubtitlesToVideoFolder?: boolean;
  };
  filenameTemplateSourceOptions?: FilenameTemplateSourceOptions;
  legacyTitleOverride?: string;
}

/**
 * Create a temporary directory for download
 */
export function createTempDir(): string {
  const tempDir = resolveSafeChildPath(
    VIDEOS_DIR,
    `temp_${Date.now()}_${crypto.randomUUID()}`
  );
  ensureDirSafeSync(tempDir, VIDEOS_DIR);
  logger.info("Created temp directory:", tempDir);
  return tempDir;
}

/**
 * Clean up temporary directory
 */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  if (pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
    await safeRemove(tempDir);
    logger.info("Deleted temp directory:", tempDir);
  }
}

/**
 * Prepare file paths for video and thumbnail
 */
export function prepareFilePaths(
  mergeOutputFormat: string,
  collectionName?: string,
  moveThumbnailsToVideoFolder: boolean = false
): FilePaths {
  // Create a safe base filename (without extension)
  const timestamp = Date.now();
  const safeBaseFilename = `video_${timestamp}`;

  // Add extensions for video and thumbnail (use user's format preference)
  const videoFilename = `${safeBaseFilename}.${mergeOutputFormat}`;
  const thumbnailFilename = `${safeBaseFilename}.jpg`;

  const safeCollectionName = collectionName
    ? sanitizePathSegment(collectionName)
    : "";

  // Determine directories based on collection name
  const videoDir = safeCollectionName
    ? resolveSafeChildPath(VIDEOS_DIR, safeCollectionName)
    : VIDEOS_DIR;
  const imageDir = moveThumbnailsToVideoFolder
    ? safeCollectionName
      ? resolveSafeChildPath(VIDEOS_DIR, safeCollectionName)
      : VIDEOS_DIR
    : safeCollectionName
      ? resolveSafeChildPath(IMAGES_DIR, safeCollectionName)
      : IMAGES_DIR;

  // Ensure directories exist
  ensureDirSafeSync(videoDir, VIDEOS_DIR);
  ensureDirSafeSync(imageDir, [IMAGES_DIR, VIDEOS_DIR]);

  // Set full paths for video and thumbnail
  const videoPath = resolveSafeChildPath(videoDir, videoFilename);
  const thumbnailPath = resolveSafeChildPath(imageDir, thumbnailFilename);

  return {
    videoPath,
    thumbnailPath,
    videoDir,
    imageDir,
  };
}

/**
 * Find video file in temp directory
 */
export function findVideoFileInTemp(tempDir: string): string | null {
  if (!pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
    return null;
  }

  const files = readdirSafeSync(tempDir, VIDEOS_DIR);
  const videoFile =
    files.find((file: string) => file.endsWith(".mp4")) ||
    files.find((file: string) => file.endsWith(".mkv")) ||
    files.find((file: string) => file.endsWith(".webm")) ||
    files.find((file: string) => file.endsWith(".flv"));

  return videoFile || null;
}

/**
 * Move video file from temp directory to final location
 */
export function moveVideoFile(
  tempDir: string,
  videoFile: string,
  videoPath: string
): void {
  const safeTempDir = resolveSafePathInDirectories(tempDir, [VIDEOS_DIR]);
  const safeVideoFilename = path.basename(videoFile);
  const tempVideoPath = resolveSafeChildPath(safeTempDir, safeVideoFilename);
  const safeVideoPath = resolveSafePathInDirectories(videoPath, [VIDEOS_DIR]);
  moveSafeSync(tempVideoPath, safeTempDir, safeVideoPath, VIDEOS_DIR, {
    overwrite: true,
  });
  logger.info("Moved video file to:", safeVideoPath);
}

/**
 * Rename files based on video metadata
 */
export function renameFilesWithMetadata(
  videoTitle: string,
  videoAuthor: string,
  videoDate: string,
  mergeOutputFormat: string,
  videoPath: string,
  thumbnailPath: string,
  thumbnailSaved: boolean,
  videoDir: string,
  imageDir: string,
  options?: RenameFilesOptions
): RenamedPaths {
  const safeVideoPath = resolveSafePathInDirectories(videoPath, [VIDEOS_DIR]);
  const safeThumbnailPath = resolveSafePathInDirectories(thumbnailPath, [
    IMAGES_DIR,
    VIDEOS_DIR,
  ]);

  const presetId = options?.settings?.downloadFilenamePresetId || "legacy";

  if (presetId !== "legacy") {
    // Non-legacy mode: use path planner
    const uploadDateClean = videoDate.replace(/[^0-9]/g, "").slice(0, 8);
    const year = uploadDateClean.length >= 4 ? uploadDateClean.slice(0, 4) : String(new Date().getFullYear());
    const month = uploadDateClean.length >= 6 ? uploadDateClean.slice(4, 6) : String(new Date().getMonth() + 1).padStart(2, "0");
    const day = uploadDateClean.length >= 8 ? uploadDateClean.slice(6, 8) : String(new Date().getDate()).padStart(2, "0");

    const srcOpts = enrichSourceOptionsForDownload(
      options?.filenameTemplateSourceOptions || {},
      {
        author: videoAuthor,
        uploadDate: videoDate,
      }
    );
    const ctx: FilenameTemplateContext = {
      title: videoTitle,
      id: "",
      ext: "",
      uploader: videoAuthor,
      channel: videoAuthor,
      uploadDate: uploadDateClean,
      uploadYear: year,
      uploadMonth: month,
      uploadDay: day,
      durationSeconds: undefined,
      durationString: "00-00",
      artistName: videoAuthor,
      sourceCustomName: srcOpts.sourceCustomName || "",
      sourceCollectionName: srcOpts.sourceCollectionName || videoAuthor,
      sourceCollectionId: srcOpts.sourceCollectionId || "",
      sourceCollectionType: srcOpts.sourceCollectionType || "single",
      mediaPlaylistIndex: srcOpts.mediaPlaylistIndex,
      mediaPlaylistIndexWithinDate: srcOpts.mediaPlaylistIndexWithinDate,
      platform: "bilibili",
      sourceUrl: "",
    };

    const moveThumbnails = options?.settings?.moveThumbnailsToVideoFolder || false;
    const moveSubtitles = options?.settings?.moveSubtitlesToVideoFolder || false;

    const planned = planVideoOutputPaths({
      settings: options?.settings || {},
      context: ctx,
      videoExtension: mergeOutputFormat,
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: moveThumbnails,
      moveSubtitlesToVideoFolder: moveSubtitles,
    });

    const reservedPaths = new Set<string>();
    let dedupedVideoRelativePath = dedupeRelativePath(
      planned.video.relativePath,
      VIDEOS_DIR,
      reservedPaths
    );
    let dedupedRelated = applyDedupeToRelatedPaths(
      planned.video.relativePath,
      dedupedVideoRelativePath,
      planned.thumbnail.relativePath,
      planned.subtitle.baseNameWithoutLanguageOrExt
    );
    const thumbnailBaseDir = moveThumbnails ? VIDEOS_DIR : IMAGES_DIR;

    while (
      thumbnailSaved &&
      pathExistsSafeSync(
        resolveSafeChildPath(thumbnailBaseDir, dedupedRelated.thumbnail),
        [IMAGES_DIR, VIDEOS_DIR]
      )
    ) {
      reservedPaths.add(dedupedVideoRelativePath);
      dedupedVideoRelativePath = dedupeRelativePath(
        planned.video.relativePath,
        VIDEOS_DIR,
        reservedPaths
      );
      dedupedRelated = applyDedupeToRelatedPaths(
        planned.video.relativePath,
        dedupedVideoRelativePath,
        planned.thumbnail.relativePath,
        planned.subtitle.baseNameWithoutLanguageOrExt
      );
    }

    const dedupedVideoPath = resolveSafeChildPath(
      VIDEOS_DIR,
      dedupedVideoRelativePath
    );
    const dedupedThumbnailPath = resolveSafeChildPath(
      thumbnailBaseDir,
      dedupedRelated.thumbnail
    );
    const finalVideoFilename = path.basename(dedupedVideoRelativePath);
    let finalThumbnailFilename = path.basename(dedupedRelated.thumbnail);
    const subtitleBaseRelative = dedupedRelated.subtitleBase;
    const subtitleDirectory = path.dirname(subtitleBaseRelative);
    const subtitleStem = path.basename(subtitleBaseRelative);
    const subtitleBaseDir = planned.subtitle.absoluteDirectory;
    const subtitleWebBaseDir =
      subtitleDirectory && subtitleDirectory !== "."
        ? `${moveSubtitles ? "/videos" : "/subtitles"}/${subtitleDirectory}`
        : planned.subtitle.webDirectory;

    // Ensure target directories exist
    ensureDirSafeSync(path.dirname(dedupedVideoPath), VIDEOS_DIR);
    ensureDirSafeSync(path.dirname(dedupedThumbnailPath), [IMAGES_DIR, VIDEOS_DIR]);

    if (pathExistsSafeSync(safeVideoPath, VIDEOS_DIR)) {
      renameSafeSync(
        safeVideoPath,
        VIDEOS_DIR,
        dedupedVideoPath,
        VIDEOS_DIR,
      );
      logger.info("Renamed video file to:", finalVideoFilename);
    } else {
      logger.info("Video file not found at:", safeVideoPath);
      throw new Error("Video file not found after download");
    }

    if (thumbnailSaved && pathExistsSafeSync(safeThumbnailPath, [IMAGES_DIR, VIDEOS_DIR])) {
      renameSafeSync(
        safeThumbnailPath,
        [IMAGES_DIR, VIDEOS_DIR],
        dedupedThumbnailPath,
        [IMAGES_DIR, VIDEOS_DIR],
      );
      moveSmallThumbnailMirrorSync(safeThumbnailPath, dedupedThumbnailPath);
      logger.info("Renamed thumbnail file to:", finalThumbnailFilename);
    } else {
      finalThumbnailFilename = path.basename(safeThumbnailPath);
    }

    return {
      newVideoPath: dedupedVideoPath,
      newThumbnailPath: dedupedThumbnailPath,
      finalVideoFilename,
      finalThumbnailFilename,
      videoWebPath: `/videos/${dedupedVideoRelativePath}`,
      thumbnailWebPath: thumbnailSaved
        ? `${moveThumbnails ? "/videos" : "/images"}/${dedupedRelated.thumbnail}`
        : undefined,
      subtitleBaseDir,
      subtitleStem,
      subtitleWebBaseDir,
    };
  }

  // Legacy mode: use formatVideoFilename in same directories as before
  const newSafeBaseFilename = formatVideoFilename(
    options?.legacyTitleOverride || videoTitle,
    videoAuthor,
    videoDate
  );
  const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
  const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

  const safeVideoDir = resolveSafePathInDirectories(videoDir, [VIDEOS_DIR]);
  const safeImageDir = resolveSafePathInDirectories(imageDir, [
    IMAGES_DIR,
    VIDEOS_DIR,
  ]);

  const newVideoPath = resolveSafeChildPath(safeVideoDir, newVideoFilename);
  const newThumbnailPath = resolveSafeChildPath(
    safeImageDir,
    newThumbnailFilename
  );

  if (pathExistsSafeSync(safeVideoPath, VIDEOS_DIR)) {
    renameSafeSync(safeVideoPath, VIDEOS_DIR, newVideoPath, safeVideoDir);
    logger.info("Renamed video file to:", newVideoFilename);
  } else {
    logger.info("Video file not found at:", safeVideoPath);
    throw new Error("Video file not found after download");
  }

  let finalThumbnailFilename = newThumbnailFilename;
  if (thumbnailSaved && pathExistsSafeSync(safeThumbnailPath, [IMAGES_DIR, VIDEOS_DIR])) {
    renameSafeSync(
      safeThumbnailPath,
      [IMAGES_DIR, VIDEOS_DIR],
      newThumbnailPath,
      safeImageDir,
    );
    moveSmallThumbnailMirrorSync(safeThumbnailPath, newThumbnailPath);
    logger.info("Renamed thumbnail file to:", newThumbnailFilename);
  } else {
    finalThumbnailFilename = path.basename(safeThumbnailPath);
  }

  return {
    newVideoPath,
    newThumbnailPath,
    finalVideoFilename: newVideoFilename,
    finalThumbnailFilename,
  };
}

/**
 * Clean up files on cancellation
 */
export async function cleanupFilesOnCancellation(
  videoPath: string,
  thumbnailPath: string,
  tempDir?: string
): Promise<void> {
  try {
    if (tempDir && pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
      await safeRemove(tempDir);
      logger.info("Deleted temp directory:", tempDir);
    }
    if (pathExistsSafeSync(videoPath, VIDEOS_DIR)) {
      await safeRemove(videoPath);
      logger.info("Deleted partial video file:", videoPath);
    }
    if (pathExistsSafeSync(thumbnailPath, [IMAGES_DIR, VIDEOS_DIR])) {
      await safeRemove(thumbnailPath);
      deleteSmallThumbnailMirrorSync(thumbnailPath);
      logger.info("Deleted partial thumbnail file:", thumbnailPath);
    }
  } catch (error) {
    logger.error("Error cleaning up files:", error);
  }
}
