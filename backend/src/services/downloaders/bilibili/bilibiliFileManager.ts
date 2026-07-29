import crypto from "crypto";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import {
  deleteSmallThumbnailMirrorSync,
  moveSmallThumbnailMirrorSync,
} from "../../thumbnailMirrorService";
import { extractSourceVideoId, formatVideoFilename } from "../../../utils/helpers";
import {
  allocateOutputFamilySync,
  promoteFileNoOverwriteSync,
  replaceOwnedFileWithBackupSync,
  type MediaIdentity,
} from "../../filenameTemplate/outputPathAllocator";
import { applyPhysicalOrganization } from "../../filenameTemplate/organizationPath";
import { safeRemove } from "../../../utils/downloadUtils";
import { logger } from "../../../utils/logger";
import {
  ensureDirSafeSync,
  pathExistsSafeSync,
  readdirSafeSync,
  resolveSafePathInDirectories,
  resolveSafeChildPath,
  sanitizePathSegment,
} from "../../../utils/security";
import { planVideoOutputPaths } from "../../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../../filenameTemplate/sourceOptions";
import { FilenameTemplateContext, FilenameTemplateSourceOptions } from "../../filenameTemplate/types";

function parseDownloadedAtMs(
  value: number | string | null | undefined
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function buildMediaIdentity(options?: RenameFilesOptions): MediaIdentity {
  const sourceUrl = options?.sourceUrl || "";
  const sourceVideoId =
    options?.sourceVideoId ||
    (sourceUrl ? extractSourceVideoId(sourceUrl).id : null) ||
    null;
  return {
    platform: "bilibili",
    sourceVideoId,
    mediaType: options?.mediaType || "video",
    partNumber: options?.partNumber ?? null,
  };
}

function subtitleBaseRelativeFromPlan(
  planned: ReturnType<typeof planVideoOutputPaths>
): string {
  return planned.subtitle.relativeDirectory
    ? `${planned.subtitle.relativeDirectory}/${planned.subtitle.baseNameWithoutLanguageOrExt}`
    : planned.subtitle.baseNameWithoutLanguageOrExt;
}

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
    downloadFilenameMode?: string;
    downloadFilenameTemplate?: string;
    authorOrganizationMode?: string;
    moveThumbnailsToVideoFolder?: boolean;
    moveSubtitlesToVideoFolder?: boolean;
  };
  filenameTemplateSourceOptions?: FilenameTemplateSourceOptions;
  legacyTitleOverride?: string;
  sourceUrl?: string;
  sourceVideoId?: string | null;
  partNumber?: number | null;
  mediaType?: "video" | "audio";
  downloadedAtMs?: number | string | null;
  existingLocalVideoId?: string;
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

const AUDIO_TEMP_EXTENSIONS = [".m4a", ".mp3", ".opus"];
const VIDEO_TEMP_EXTENSIONS = [".mp4", ".mkv", ".webm", ".flv"];

/**
 * Find the downloaded file in the temp directory.
 *
 * Extension preference depends on the download mode. Audio-only jobs prefer the
 * extracted audio track (falling back to a video container that still carries
 * audio). Normal video downloads only accept a video container: a failed/absent
 * ffmpeg merge can leave a split `*.m4a` audio stream behind, and returning it
 * would save an audio-only file as a `mediaType: "video"` item with no frames.
 * Returning null there instead lets the caller fail the download.
 */
export function findVideoFileInTemp(
  tempDir: string,
  audioOnly = false
): string | null {
  if (!pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
    return null;
  }

  const files = readdirSafeSync(tempDir, VIDEOS_DIR);
  const orderedExtensions = audioOnly
    ? [...AUDIO_TEMP_EXTENSIONS, ...VIDEO_TEMP_EXTENSIONS]
    : VIDEO_TEMP_EXTENSIONS;

  for (const ext of orderedExtensions) {
    const match = files.find((file: string) => file.endsWith(ext));
    if (match) {
      return match;
    }
  }

  return null;
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
  promoteFileNoOverwriteSync(tempVideoPath, safeTempDir, safeVideoPath, VIDEOS_DIR);
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
    const sourceUrl = options?.sourceUrl || "";
    const sourceVideoId =
      options?.sourceVideoId ||
      (sourceUrl ? extractSourceVideoId(sourceUrl).id : null) ||
      "";
    const ctx: FilenameTemplateContext = {
      title: videoTitle,
      sourceVideoId,
      localVideoId: "",
      downloadedAtMs: parseDownloadedAtMs(options?.downloadedAtMs),
      id: sourceVideoId,
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
      sourceCustomName: srcOpts.sourceCustomName || videoAuthor,
      sourceCollectionName: srcOpts.sourceCollectionName || videoAuthor,
      sourceCollectionId: srcOpts.sourceCollectionId || "",
      sourceCollectionType: srcOpts.sourceCollectionType || "single",
      mediaPlaylistIndex: srcOpts.mediaPlaylistIndex,
      mediaPlaylistIndexWithinDate: srcOpts.mediaPlaylistIndexWithinDate,
      platform: "bilibili",
      sourceUrl,
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

    const thumbnailBaseDir = moveThumbnails ? VIDEOS_DIR : IMAGES_DIR;
    const reservation = allocateOutputFamilySync({
      videoRelativePath: planned.video.relativePath,
      thumbnailRelativePath: planned.thumbnail.relativePath,
      subtitleBaseRelativePath: subtitleBaseRelativeFromPlan(planned),
      thumbnailBaseDir,
      identity: buildMediaIdentity(options),
      existingLocalVideoId: options?.existingLocalVideoId,
      thumbnailRequired: thumbnailSaved,
    });

    const dedupedVideoPath = resolveSafeChildPath(
      VIDEOS_DIR,
      reservation.videoRelativePath
    );
    const dedupedThumbnailPath = resolveSafeChildPath(
      thumbnailBaseDir,
      reservation.thumbnailRelativePath
    );
    const finalVideoFilename = path.basename(reservation.videoRelativePath);
    let finalThumbnailFilename = path.basename(reservation.thumbnailRelativePath);
    const subtitleBaseRelative = reservation.subtitleBaseRelativePath;
    const subtitleDirectory = path.dirname(subtitleBaseRelative);
    const subtitleStem = path.basename(subtitleBaseRelative);
    const subtitleBaseDir = planned.subtitle.absoluteDirectory;
    const subtitleWebBaseDir =
      subtitleDirectory && subtitleDirectory !== "."
        ? `${moveSubtitles ? "/videos" : "/subtitles"}/${subtitleDirectory}`
        : planned.subtitle.webDirectory;

    try {
      if (pathExistsSafeSync(safeVideoPath, VIDEOS_DIR)) {
        replaceOwnedFileWithBackupSync(
          safeVideoPath,
          VIDEOS_DIR,
          dedupedVideoPath,
          VIDEOS_DIR,
          options?.existingLocalVideoId
        );
        logger.info("Renamed video file to:", finalVideoFilename);
      } else {
        logger.info("Video file not found at:", safeVideoPath);
        throw new Error("Video file not found after download");
      }

      if (thumbnailSaved && pathExistsSafeSync(safeThumbnailPath, [IMAGES_DIR, VIDEOS_DIR])) {
        replaceOwnedFileWithBackupSync(
          safeThumbnailPath,
          [IMAGES_DIR, VIDEOS_DIR],
          dedupedThumbnailPath,
          [IMAGES_DIR, VIDEOS_DIR],
          options?.existingLocalVideoId
        );
        moveSmallThumbnailMirrorSync(safeThumbnailPath, dedupedThumbnailPath);
        logger.info("Renamed thumbnail file to:", finalThumbnailFilename);
      } else {
        finalThumbnailFilename = path.basename(safeThumbnailPath);
      }
    } finally {
      reservation.release();
    }

    return {
      newVideoPath: dedupedVideoPath,
      newThumbnailPath: dedupedThumbnailPath,
      finalVideoFilename,
      finalThumbnailFilename,
      videoWebPath: `/videos/${reservation.videoRelativePath}`,
      thumbnailWebPath: thumbnailSaved
        ? `${moveThumbnails ? "/videos" : "/images"}/${reservation.thumbnailRelativePath}`
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
  const safeVideoRelativeDir = path.relative(VIDEOS_DIR, safeVideoDir);
  const relativeVideoWithCollection =
    safeVideoRelativeDir && safeVideoRelativeDir !== "."
      ? `${safeVideoRelativeDir}/${newVideoFilename}`
      : newVideoFilename;
  const shouldIgnoreCollectionDir =
    options?.settings?.authorOrganizationMode === "author_folder_only";
  const preferredVideoRelativePath = applyPhysicalOrganization(
    shouldIgnoreCollectionDir ? newVideoFilename : relativeVideoWithCollection,
    {
      mode: options?.settings?.authorOrganizationMode,
      author: videoAuthor,
    }
  ).relativePath;
  const preferredVideoDir = path.dirname(preferredVideoRelativePath);
  const preferredThumbnailRelativePath =
    preferredVideoDir && preferredVideoDir !== "."
      ? `${preferredVideoDir}/${newThumbnailFilename}`
      : newThumbnailFilename;
  const preferredSubtitleBaseRelativePath =
    preferredVideoDir && preferredVideoDir !== "."
      ? `${preferredVideoDir}/${newSafeBaseFilename}`
      : newSafeBaseFilename;
  const moveThumbnails = options?.settings?.moveThumbnailsToVideoFolder || false;
  const moveSubtitles = options?.settings?.moveSubtitlesToVideoFolder || false;
  const thumbnailBaseDir = moveThumbnails ? VIDEOS_DIR : IMAGES_DIR;
  const reservation = allocateOutputFamilySync({
    videoRelativePath: preferredVideoRelativePath,
    thumbnailRelativePath: preferredThumbnailRelativePath,
    subtitleBaseRelativePath: preferredSubtitleBaseRelativePath,
    thumbnailBaseDir,
    identity: buildMediaIdentity(options),
    existingLocalVideoId: options?.existingLocalVideoId,
    thumbnailRequired: thumbnailSaved,
  });

  const newVideoPath = resolveSafeChildPath(
    VIDEOS_DIR,
    reservation.videoRelativePath
  );
  const newThumbnailPath = resolveSafeChildPath(
    thumbnailBaseDir,
    reservation.thumbnailRelativePath
  );
  const finalVideoFilename = path.basename(reservation.videoRelativePath);
  let finalThumbnailFilename = path.basename(reservation.thumbnailRelativePath);

  try {
    if (pathExistsSafeSync(safeVideoPath, VIDEOS_DIR)) {
      replaceOwnedFileWithBackupSync(
        safeVideoPath,
        VIDEOS_DIR,
        newVideoPath,
        VIDEOS_DIR,
        options?.existingLocalVideoId
      );
      logger.info("Renamed video file to:", finalVideoFilename);
    } else {
      logger.info("Video file not found at:", safeVideoPath);
      throw new Error("Video file not found after download");
    }

    if (thumbnailSaved && pathExistsSafeSync(safeThumbnailPath, [IMAGES_DIR, VIDEOS_DIR])) {
      replaceOwnedFileWithBackupSync(
        safeThumbnailPath,
        [IMAGES_DIR, VIDEOS_DIR],
        newThumbnailPath,
        [IMAGES_DIR, VIDEOS_DIR],
        options?.existingLocalVideoId
      );
      moveSmallThumbnailMirrorSync(safeThumbnailPath, newThumbnailPath);
      logger.info("Renamed thumbnail file to:", finalThumbnailFilename);
    } else {
      finalThumbnailFilename = path.basename(safeThumbnailPath);
    }
  } finally {
    reservation.release();
  }

  const subtitleDirectory = path.dirname(reservation.subtitleBaseRelativePath);
  const subtitleStem = path.basename(reservation.subtitleBaseRelativePath);
  const subtitleBaseDir =
    subtitleDirectory && subtitleDirectory !== "."
      ? resolveSafeChildPath(moveSubtitles ? VIDEOS_DIR : SUBTITLES_DIR, subtitleDirectory)
      : moveSubtitles
        ? VIDEOS_DIR
        : SUBTITLES_DIR;
  const subtitleWebBaseDir =
    subtitleDirectory && subtitleDirectory !== "."
      ? `${moveSubtitles ? "/videos" : "/subtitles"}/${subtitleDirectory}`
      : moveSubtitles
        ? "/videos"
        : "/subtitles";

  return {
    newVideoPath,
    newThumbnailPath,
    finalVideoFilename,
    finalThumbnailFilename,
    videoWebPath: `/videos/${reservation.videoRelativePath}`,
    thumbnailWebPath: thumbnailSaved
      ? `${moveThumbnails ? "/videos" : "/images"}/${reservation.thumbnailRelativePath}`
      : undefined,
    subtitleBaseDir,
    subtitleStem,
    subtitleWebBaseDir,
  };
}

/**
 * Clean up files on cancellation
 */
export async function cleanupFilesOnCancellation(
  videoPath?: string,
  thumbnailPath?: string,
  tempDir?: string
): Promise<void> {
  try {
    if (tempDir && pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
      await safeRemove(tempDir);
      logger.info("Deleted temp directory:", tempDir);
    }
    if (videoPath && pathExistsSafeSync(videoPath, VIDEOS_DIR)) {
      await safeRemove(videoPath);
      logger.info("Deleted partial video file:", videoPath);
    }
    if (
      thumbnailPath &&
      pathExistsSafeSync(thumbnailPath, [IMAGES_DIR, VIDEOS_DIR])
    ) {
      await safeRemove(thumbnailPath);
      deleteSmallThumbnailMirrorSync(thumbnailPath);
      logger.info("Deleted partial thumbnail file:", thumbnailPath);
    }
  } catch (error) {
    logger.error("Error cleaning up files:", error);
  }
}
