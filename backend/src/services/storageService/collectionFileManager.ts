import path from "path";
import {
  IMAGES_DIR,
  IMAGES_SMALL_DIR,
  SUBTITLES_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import {
  moveSmallThumbnailMirrorSync,
  resolveManagedThumbnailWebPathFromAbsolutePath,
} from "../thumbnailMirrorService";
import { logger } from "../../utils/logger";
import {
  buildStoragePath,
  findImageFile,
  findVideoFile,
  listDirectory,
  moveFile,
  pathExists,
  removeDirectoryTreeIfEmpty,
  removeDirectoryRecursive,
  renamePath,
} from "./fileHelpers";
import { getSettings } from "./settings";
import { Collection, Video } from "./types";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import {
  allocateOutputFamilySync,
  moveOutputFamilyWithJournalSync,
} from "../filenameTemplate/outputPathAllocator";

/**
 * Sanitizes a collection name to prevent path traversal attacks
 * Removes path separators and dangerous sequences
 */
function sanitizeCollectionName(collectionName: string): string {
  // Remove path traversal sequences and path separators
  return collectionName
    .replace(/\.\./g, "") // Remove parent directory references
    .replace(/[\/\\]/g, "") // Remove path separators
    .trim();
}

/**
 * File manager layer for collection-related file operations
 * This module handles all file system operations when videos are added/removed from collections
 */

export interface FileMoveResult {
  updated: boolean;
  updates: Partial<Video>;
}

/**
 * Move video files to a collection directory
 */
export function moveVideoToCollection(
  video: Video,
  collectionName: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return { updated: false, updates: {} };
  }

  if (video.videoFilename) {
    const currentVideoPath = resolveCurrentVideoPath(video, allCollections);
    const targetVideoPath = buildStoragePath(
      VIDEOS_DIR,
      sanitizedCollectionName,
      video.videoFilename
    );

    if (currentVideoPath && currentVideoPath !== targetVideoPath) {
      moveFile(currentVideoPath, targetVideoPath);
      updates.videoPath = `/videos/${sanitizedCollectionName}/${video.videoFilename}`;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move video files from a collection directory (to root or another collection)
 */
export function moveVideoFromCollection(
  video: Video,
  targetVideoDir: string,
  videoPathPrefix: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  if (video.videoFilename) {
    const currentVideoPath = resolveCurrentVideoPath(video, allCollections);
    const targetVideoPath = buildStoragePath(targetVideoDir, video.videoFilename);

    if (currentVideoPath && currentVideoPath !== targetVideoPath) {
      moveFile(currentVideoPath, targetVideoPath);
      updates.videoPath = `${videoPathPrefix}/${video.videoFilename}`;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move thumbnail files to a collection directory
 */
export function moveThumbnailToCollection(
  video: Video,
  collectionName: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return { updated: false, updates: {} };
  }

  if (video.thumbnailFilename) {
    // Find existing file using path from DB if possible, or fallback to search
    let currentImagePath = "";
    let currentWebPath = video.thumbnailPath || null;
    if (video.thumbnailPath) {
      if (video.thumbnailPath.startsWith("/videos/")) {
        currentImagePath = buildStoragePath(
          VIDEOS_DIR,
          video.thumbnailPath.replace(/^\/videos\//, "")
        );
      } else if (video.thumbnailPath.startsWith("/images/")) {
        currentImagePath = buildStoragePath(
          IMAGES_DIR,
          video.thumbnailPath.replace(/^\/images\//, "")
        );
      }
    }

    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (!currentImagePath || !pathExists(currentImagePath)) {
      currentImagePath =
        findImageFile(video.thumbnailFilename, allCollections) || "";
      if (currentImagePath) {
        currentWebPath = resolveManagedThumbnailWebPathFromAbsolutePath(
          currentImagePath,
        );
      }
    }

    // Determine target
    const settings = getSettings();
    const moveWithVideo = settings.moveThumbnailsToVideoFolder;

    let targetImagePath = "";
    let newWebPath = "";

    if (moveWithVideo) {
      targetImagePath = buildStoragePath(
        VIDEOS_DIR,
        sanitizedCollectionName,
        video.thumbnailFilename
      );
      newWebPath = `/videos/${sanitizedCollectionName}/${video.thumbnailFilename}`;
    } else {
      targetImagePath = buildStoragePath(
        IMAGES_DIR,
        sanitizedCollectionName,
        video.thumbnailFilename
      );
      newWebPath = `/images/${sanitizedCollectionName}/${video.thumbnailFilename}`;
    }

    if (currentImagePath && currentImagePath !== targetImagePath) {
      moveFile(currentImagePath, targetImagePath);
      moveSmallThumbnailMirrorSync(currentWebPath, newWebPath);
      updates.thumbnailPath = newWebPath;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move thumbnail files from a collection directory (to root or another collection)
 */
export function moveThumbnailFromCollection(
  video: Video,
  targetVideoDir: string,
  targetImageDir: string,
  videoPathPrefix: string,
  imagePathPrefix: string,
  allCollections: Collection[]
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  if (video.thumbnailFilename) {
    // Find existing file using path from DB if possible
    let currentImagePath = "";
    let currentWebPath = video.thumbnailPath || null;
    if (video.thumbnailPath) {
      if (video.thumbnailPath.startsWith("/videos/")) {
        currentImagePath = buildStoragePath(
          VIDEOS_DIR,
          video.thumbnailPath.replace(/^\/videos\//, "")
        );
      } else if (video.thumbnailPath.startsWith("/images/")) {
        currentImagePath = buildStoragePath(
          IMAGES_DIR,
          video.thumbnailPath.replace(/^\/images\//, "")
        );
      }
    }

    if (!currentImagePath || !pathExists(currentImagePath)) {
      currentImagePath =
        findImageFile(video.thumbnailFilename, allCollections) || "";
      if (currentImagePath) {
        currentWebPath = resolveManagedThumbnailWebPathFromAbsolutePath(
          currentImagePath,
        );
      }
    }

    // Determine target
    const settings = getSettings();
    const moveWithVideo = settings.moveThumbnailsToVideoFolder;

    let targetImagePath = "";
    let newWebPath = "";

    if (moveWithVideo) {
      // Target is same as video target
      targetImagePath = buildStoragePath(targetVideoDir, video.thumbnailFilename);
      newWebPath = `${videoPathPrefix}/${video.thumbnailFilename}`;
    } else {
      // Target is image dir (root or other collection)
      targetImagePath = buildStoragePath(targetImageDir, video.thumbnailFilename);
      newWebPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
    }

    if (currentImagePath && currentImagePath !== targetImagePath) {
      moveFile(currentImagePath, targetImagePath);
      moveSmallThumbnailMirrorSync(currentWebPath, newWebPath);
      updates.thumbnailPath = newWebPath;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move subtitle files to a collection directory
 */
export function moveSubtitlesToCollection(
  video: Video,
  collectionName: string
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return { updated: false, updates: {} };
  }

  if (video.subtitles && video.subtitles.length > 0) {
    const newSubtitles = [...video.subtitles];
    let subtitlesUpdated = false;

    // Get settings to respect moveSubtitlesToVideoFolder
    const settings = getSettings();
    const moveWithVideo = settings.moveSubtitlesToVideoFolder;

    const updatedSubtitles = newSubtitles.map((sub) => {
      const result = processSubtitleFileMove(sub, sanitizedCollectionName, moveWithVideo);
      if (result && result.updated) {
        subtitlesUpdated = true;
        return result.newSub;
      }
      return sub;
    });

    if (subtitlesUpdated) {
      updates.subtitles = updatedSubtitles;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move subtitle files from a collection directory (to root or another collection)
 */
export function moveSubtitlesFromCollection(
  video: Video,
  targetVideoDir: string,
  targetSubDir: string,
  videoPathPrefix: string,
  subtitlePathPrefix?: string
): FileMoveResult {
  const updates: Partial<Video> = {};
  let updated = false;

  if (video.subtitles && video.subtitles.length > 0) {
    const newSubtitles = [...video.subtitles];
    let subtitlesUpdated = false;

    for (let index = 0; index < newSubtitles.length; index++) {
      const sub = newSubtitles[index];
      const result = processSubtitleMoveFromCollection(
        sub,
        targetVideoDir,
        targetSubDir,
        videoPathPrefix,
        subtitlePathPrefix
      );

      if (result && result.updated) {
        newSubtitles[index] = result.newSub;
        subtitlesUpdated = true;
      }
    }

    if (subtitlesUpdated) {
      updates.subtitles = newSubtitles;
      updated = true;
    }
  }

  return { updated, updates };
}

/**
 * Move all video files (video, thumbnail, subtitles) to a collection
 */
export function moveAllFilesToCollection(
  video: Video,
  collectionName: string,
  allCollections: Collection[]
): Partial<Video> {
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return {};
  }

  const settings = getSettings();
  return moveManagedFamilyToRelativeDirs(video, allCollections, {
    videoRelativeDir: sanitizedCollectionName,
    thumbnailRelativeDir: sanitizedCollectionName,
    subtitleRelativeDir: sanitizedCollectionName,
    thumbnailBaseDir: settings.moveThumbnailsToVideoFolder
      ? VIDEOS_DIR
      : IMAGES_DIR,
    subtitleBaseDir: settings.moveSubtitlesToVideoFolder
      ? VIDEOS_DIR
      : SUBTITLES_DIR,
  });
}

/**
 * Move all video files (video, thumbnail, subtitles) from a collection
 */
export function moveAllFilesFromCollection(
  video: Video,
  targetVideoDir: string,
  targetImageDir: string,
  targetSubDir: string,
  videoPathPrefix: string,
  imagePathPrefix: string,
  subtitlePathPrefix: string | undefined,
  allCollections: Collection[]
): Partial<Video> {
  void videoPathPrefix;
  void imagePathPrefix;
  // The caller leaves this undefined when unlinking to the storage root. That
  // absence says nothing about where subtitles belong, so it must not select
  // video storage: the subtitle root is decided by moveSubtitlesToVideoFolder
  // alone, exactly as moveAllFilesToCollection does.
  void subtitlePathPrefix;

  const videoRelativeDir = getRelativeDirWithinRoot(targetVideoDir, VIDEOS_DIR);
  const imageRelativeDir = getRelativeDirWithinRoot(targetImageDir, IMAGES_DIR);
  const subtitleRelativeDir = getRelativeDirWithinRoot(targetSubDir, SUBTITLES_DIR);
  const settings = getSettings();
  const subtitlesInVideoFolder = Boolean(settings.moveSubtitlesToVideoFolder);
  // Same reasoning as subtitles: the active storage configuration decides the
  // thumbnail root, so unlinking must not pull a thumbnail out of the video
  // folder while moveThumbnailsToVideoFolder is enabled.
  const thumbnailsInVideoFolder = Boolean(settings.moveThumbnailsToVideoFolder);

  return moveManagedFamilyToRelativeDirs(video, allCollections, {
    videoRelativeDir,
    thumbnailRelativeDir: thumbnailsInVideoFolder
      ? videoRelativeDir
      : imageRelativeDir,
    subtitleRelativeDir: subtitlesInVideoFolder
      ? videoRelativeDir
      : subtitleRelativeDir,
    thumbnailBaseDir: thumbnailsInVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
    subtitleBaseDir: subtitlesInVideoFolder ? VIDEOS_DIR : SUBTITLES_DIR,
  });
}

/**
 * Clean up empty collection directories
 */
export function cleanupCollectionDirectories(collectionName: string): void {
  // Sanitize collection name to prevent path traversal
  const sanitizedCollectionName = sanitizeCollectionName(collectionName);
  if (!sanitizedCollectionName) {
    logger.warn(`Invalid collection name provided: ${collectionName}`);
    return;
  }
  
  const collectionVideoDir = buildStoragePath(VIDEOS_DIR, sanitizedCollectionName);
  const collectionImageDir = buildStoragePath(IMAGES_DIR, sanitizedCollectionName);
  const collectionSmallImageDir = buildStoragePath(
    IMAGES_SMALL_DIR,
    sanitizedCollectionName,
  );
  const collectionSubtitleDir = buildStoragePath(
    SUBTITLES_DIR,
    sanitizedCollectionName,
  );

  try {
    removeDirectoryTreeIfEmpty(collectionVideoDir);
    removeDirectoryTreeIfEmpty(collectionImageDir);
    removeDirectoryTreeIfEmpty(collectionSmallImageDir);
    removeDirectoryTreeIfEmpty(collectionSubtitleDir);
  } catch (e) {
    logger.error(
      "Error removing collection directories",
      e instanceof Error ? e : new Error(String(e))
    );
  }
}

function resolveCurrentVideoPath(
  video: Video,
  allCollections: Collection[],
): string | null {
  const resolvedManagedPath = video.videoPath
    ? resolveManagedWebPath(video.videoPath)
    : null;

  if (resolvedManagedPath && pathExists(resolvedManagedPath.absolutePath)) {
    return resolvedManagedPath.absolutePath;
  }

  if (!video.videoFilename) {
    return null;
  }

  return findVideoFile(video.videoFilename, allCollections);
}

type ManagedFileSource = {
  absolutePath: string;
  rootDir: string;
  webPath: string | null;
  filename: string;
};

type RelativeFamilyTarget = {
  videoRelativeDir: string;
  thumbnailRelativeDir: string;
  subtitleRelativeDir: string;
  thumbnailBaseDir: string;
  subtitleBaseDir: string;
};

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function joinRelativePath(relativeDir: string, filename: string): string {
  const normalizedDir = toPosixPath(relativeDir).replace(/^\/+|\/+$/g, "");
  return normalizedDir ? `${normalizedDir}/${filename}` : filename;
}

function getRelativeDirWithinRoot(targetDir: string, rootDir: string): string {
  const relative = toPosixPath(path.relative(rootDir, targetDir));
  if (!relative || relative === ".") {
    return "";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  return relative;
}

function sourcePlatformForVideo(video: Video): string {
  const explicitSource = typeof video.source === "string" ? video.source.trim() : "";
  if (explicitSource) {
    return explicitSource.toLowerCase();
  }
  if (typeof video.sourceUrl === "string" && video.sourceUrl.length > 0) {
    try {
      const hostname = new URL(video.sourceUrl).hostname.toLowerCase();
      if (hostname.includes("bilibili")) return "bilibili";
      if (hostname.includes("youtube") || hostname === "youtu.be") return "youtube";
      if (hostname.includes("twitch")) return "twitch";
      if (hostname.includes("missav")) return "missav";
    } catch {
      // Fall through to unknown for legacy malformed source URLs.
    }
  }
  return "unknown";
}

function resolveThumbnailSource(
  video: Video,
  allCollections: Collection[]
): ManagedFileSource | null {
  if (!video.thumbnailFilename && !video.thumbnailPath) {
    return null;
  }

  if (video.thumbnailPath) {
    const resolved = resolveManagedWebPath(video.thumbnailPath);
    if (resolved && pathExists(resolved.absolutePath)) {
      return {
        absolutePath: resolved.absolutePath,
        rootDir: resolved.rootDir,
        webPath: video.thumbnailPath,
        filename: video.thumbnailFilename || path.basename(resolved.relativePath),
      };
    }
  }

  if (!video.thumbnailFilename) {
    return null;
  }

  const fallbackPath = findImageFile(video.thumbnailFilename, allCollections);
  if (!fallbackPath) {
    return null;
  }

  return {
    absolutePath: fallbackPath,
    rootDir: IMAGES_DIR,
    webPath: resolveManagedThumbnailWebPathFromAbsolutePath(fallbackPath),
    filename: video.thumbnailFilename,
  };
}

function resolveSubtitleSources(
  video: Video
): Array<ManagedFileSource & { language: string; extension: string; original: NonNullable<Video["subtitles"]>[number] }> {
  const sources: Array<ManagedFileSource & { language: string; extension: string; original: NonNullable<Video["subtitles"]>[number] }> = [];
  for (const subtitle of video.subtitles || []) {
    const resolved = resolveManagedWebPath(subtitle.path);
    if (!resolved || !pathExists(resolved.absolutePath)) {
      continue;
    }
    sources.push({
      absolutePath: resolved.absolutePath,
      rootDir: resolved.rootDir,
      webPath: subtitle.path,
      filename: subtitle.filename || path.basename(resolved.relativePath),
      language: subtitle.language || "und",
      extension: path.extname(subtitle.filename || resolved.relativePath) || ".vtt",
      original: subtitle,
    });
  }
  return sources;
}

function webPrefixForManagedRoot(rootDir: string): "/videos" | "/images" | "/subtitles" {
  if (rootDir === VIDEOS_DIR) return "/videos";
  if (rootDir === IMAGES_DIR) return "/images";
  return "/subtitles";
}

function moveManagedFamilyToRelativeDirs(
  video: Video,
  allCollections: Collection[],
  target: RelativeFamilyTarget
): Partial<Video> {
  if (!video.videoFilename) {
    return {};
  }

  const currentVideoPath = resolveCurrentVideoPath(video, allCollections);
  if (!currentVideoPath) {
    return {};
  }

  const videoExt = path.extname(video.videoFilename) || path.extname(currentVideoPath) || ".mp4";
  const videoStem = path.basename(video.videoFilename, path.extname(video.videoFilename) || videoExt);
  const preferredVideoRelative = joinRelativePath(
    target.videoRelativeDir,
    `${videoStem}${videoExt}`
  );
  const thumbnailSource = resolveThumbnailSource(video, allCollections);
  const thumbnailExt =
    thumbnailSource
      ? path.extname(thumbnailSource.filename) || ".jpg"
      : ".jpg";
  const preferredThumbnailRelative = joinRelativePath(
    target.thumbnailRelativeDir,
    `${videoStem}${thumbnailExt}`
  );
  const preferredSubtitleBase = joinRelativePath(
    target.subtitleRelativeDir,
    videoStem
  );
  const subtitleSources = resolveSubtitleSources(video);

  const reservation = allocateOutputFamilySync({
    videoRelativePath: preferredVideoRelative,
    thumbnailRelativePath: preferredThumbnailRelative,
    subtitleBaseRelativePath: preferredSubtitleBase,
    subtitleBaseDir: target.subtitleBaseDir,
    subtitleFiles: subtitleSources.map((subtitle) => ({
      language: subtitle.language,
      extension: subtitle.extension,
    })),
    thumbnailBaseDir: target.thumbnailBaseDir,
    identity: {
      platform: sourcePlatformForVideo(video),
      sourceVideoId: video.sourceVideoId || null,
      mediaType: video.mediaType === "audio" ? "audio" : "video",
      localVideoId: video.id,
    },
    existingLocalVideoId: video.id,
    ownedManagedPaths: [
      currentVideoPath,
      ...(thumbnailSource ? [thumbnailSource.absolutePath] : []),
      ...subtitleSources.map((subtitle) => subtitle.absolutePath),
    ],
    thumbnailRequired: Boolean(thumbnailSource),
    subtitleRequired: subtitleSources.length > 0,
  });

  try {
    const updates: Partial<Video> = {};
    const moves: Array<{
      from: string;
      fromBase: string;
      to: string;
      toBase: string;
      kind?: "video" | "thumbnail" | "subtitle" | "sidecar";
    }> = [];

    const videoTargetPath = buildStoragePath(
      VIDEOS_DIR,
      reservation.videoRelativePath
    );
    const newVideoWebPath = `/videos/${reservation.videoRelativePath}`;
    if (currentVideoPath !== videoTargetPath) {
      moves.push({
        from: currentVideoPath,
        fromBase: VIDEOS_DIR,
        to: videoTargetPath,
        toBase: VIDEOS_DIR,
        kind: "video",
      });
      updates.videoPath = newVideoWebPath;
      updates.videoFilename = path.basename(reservation.videoRelativePath);
    }

    let oldThumbnailWebPath: string | null = null;
    let newThumbnailWebPath: string | null = null;
    if (thumbnailSource) {
      const thumbTargetPath = buildStoragePath(
        target.thumbnailBaseDir,
        reservation.thumbnailRelativePath
      );
      newThumbnailWebPath = `${webPrefixForManagedRoot(target.thumbnailBaseDir)}/${reservation.thumbnailRelativePath}`;
      if (thumbnailSource.absolutePath !== thumbTargetPath) {
        moves.push({
          from: thumbnailSource.absolutePath,
          fromBase: thumbnailSource.rootDir,
          to: thumbTargetPath,
          toBase: target.thumbnailBaseDir,
          kind: "thumbnail",
        });
        oldThumbnailWebPath = thumbnailSource.webPath;
        updates.thumbnailPath = newThumbnailWebPath;
        updates.thumbnailFilename = path.basename(reservation.thumbnailRelativePath);
      }
    }

    const newSubtitles: NonNullable<Video["subtitles"]> = [];
    let subtitlesChanged = false;
    for (const originalSubtitle of video.subtitles || []) {
      const subtitleSource = subtitleSources.find(
        (candidate) => candidate.original === originalSubtitle
      );
      if (!subtitleSource) {
        newSubtitles.push(originalSubtitle);
        continue;
      }

      const filename = `${path.basename(reservation.subtitleBaseRelativePath)}.${subtitleSource.language}${subtitleSource.extension}`;
      const relativeDir = path.dirname(reservation.subtitleBaseRelativePath);
      const subtitleRelative = joinRelativePath(
        relativeDir === "." ? "" : relativeDir,
        filename
      );
      const subtitleTargetPath = buildStoragePath(
        target.subtitleBaseDir,
        subtitleRelative
      );
      const subtitleWebPath = `${webPrefixForManagedRoot(target.subtitleBaseDir)}/${subtitleRelative}`;

      if (subtitleSource.absolutePath !== subtitleTargetPath) {
        moves.push({
          from: subtitleSource.absolutePath,
          fromBase: subtitleSource.rootDir,
          to: subtitleTargetPath,
          toBase: target.subtitleBaseDir,
          kind: "subtitle",
        });
        subtitlesChanged = true;
        newSubtitles.push({
          language: subtitleSource.language,
          filename,
          path: subtitleWebPath,
        });
      } else {
        newSubtitles.push(originalSubtitle);
      }
    }

    if (subtitlesChanged) {
      updates.subtitles = newSubtitles;
    }

    if (moves.length === 0) {
      return {};
    }

    moveOutputFamilyWithJournalSync(moves);

    if (
      oldThumbnailWebPath &&
      newThumbnailWebPath &&
      oldThumbnailWebPath !== newThumbnailWebPath
    ) {
      moveSmallThumbnailMirrorSync(oldThumbnailWebPath, newThumbnailWebPath);
    }

    return updates;
  } finally {
    reservation.release();
  }
}

/**
 * Rename collection directories (video, image, subtitle)
 */
export function renameCollectionDirectories(
  oldName: string,
  newName: string
): boolean {
  // Sanitize both names
  const sanitizedOldName = sanitizeCollectionName(oldName);
  const sanitizedNewName = sanitizeCollectionName(newName);

  if (!sanitizedOldName || !sanitizedNewName || sanitizedOldName === sanitizedNewName) {
    return false;
  }

  const resultVideo = processDirectoryRename(VIDEOS_DIR, sanitizedOldName, sanitizedNewName);
  const resultImage = processDirectoryRename(IMAGES_DIR, sanitizedOldName, sanitizedNewName);
  const resultSmallImage = processDirectoryRename(
    IMAGES_SMALL_DIR,
    sanitizedOldName,
    sanitizedNewName,
  );
  const resultSubtitle = processDirectoryRename(SUBTITLES_DIR, sanitizedOldName, sanitizedNewName);

  return resultVideo && resultImage && resultSmallImage && resultSubtitle;
}

/**
 * Update video paths in memory after a collection rename
 */
export function updateVideoPathsForCollectionRename(
  video: Video,
  oldName: string,
  newName: string
): Partial<Video> {
  const updates: Partial<Video> = {};
  const sanitizedOldName = sanitizeCollectionName(oldName);
  const sanitizedNewName = sanitizeCollectionName(newName);

  if (!sanitizedOldName || !sanitizedNewName) return updates;

  // Helper to replace path part
  const replacePath = (currentPath: string, prefix: string): string => {
    // path is web access path, usually /videos/CollectionName/file.mp4
    const oldPrefix = `${prefix}/${sanitizedOldName}/`;
    const newPrefix = `${prefix}/${sanitizedNewName}/`;
    
    if (currentPath.startsWith(oldPrefix)) {
      return currentPath.replace(oldPrefix, newPrefix);
    }
    return currentPath;
  };

  if (video.videoPath) {
    // Assume paths start with /videos for collection items
    const newPath = replacePath(video.videoPath, '/videos');
    if (newPath !== video.videoPath) updates.videoPath = newPath;
  }

  if (video.thumbnailPath) {
    let newPath = video.thumbnailPath;
    if (video.thumbnailPath.startsWith('/videos/')) {
       newPath = replacePath(video.thumbnailPath, '/videos');
    } else if (video.thumbnailPath.startsWith('/images/')) {
       newPath = replacePath(video.thumbnailPath, '/images');
    }
    
    if (newPath !== video.thumbnailPath) updates.thumbnailPath = newPath;
  }

  if (video.subtitles) {
    const originalSubtitles = video.subtitles;
    const newSubtitles: typeof originalSubtitles = [];
    let hasUpdatedSubtitlePaths = false;

    for (const subtitle of originalSubtitles) {
      let newPath = subtitle.path;
      if (subtitle.path.startsWith('/videos/')) {
         newPath = replacePath(subtitle.path, '/videos');
      } else if (subtitle.path.startsWith('/subtitles/')) {
         newPath = replacePath(subtitle.path, '/subtitles');
      }

      if (newPath !== subtitle.path) {
        hasUpdatedSubtitlePaths = true;
        newSubtitles.push({ ...subtitle, path: newPath });
      } else {
        newSubtitles.push(subtitle);
      }
    }

    if (hasUpdatedSubtitlePaths) updates.subtitles = newSubtitles;
  }

  return updates;
}

/**
 * Process a single subtitle file move for collection
 */
function processSubtitleFileMove(
  sub: { path: string; language: string; filename: string },
  sanitizedCollectionName: string,
  moveWithVideo: boolean
): { updated: boolean; newSub: typeof sub } | null {
  const paths = calculateSubtitlePaths(sub, sanitizedCollectionName, moveWithVideo);

  if (paths) {
    const { absoluteSourcePath, targetSubPath, newWebPath } = paths;
    
    if (
      pathExists(absoluteSourcePath) &&
      absoluteSourcePath !== targetSubPath
    ) {
      try {
        moveFile(absoluteSourcePath, targetSubPath);
        return {
          updated: true,
          newSub: {
            ...sub,
            path: newWebPath,
          },
        };
      } catch (e) {
        logger.error(
          `Error moving subtitle file ${absoluteSourcePath} to ${targetSubPath}: ${e}`
        );
        throw e;
      }
    }
  }

  return null;
}

function calculateSubtitlePaths(
  sub: { path: string; language: string; filename: string },
  sanitizedCollectionName: string,
  moveWithVideo: boolean
): { absoluteSourcePath: string; targetSubPath: string; newWebPath: string } | null {
  // Determine existing absolute path
  let absoluteSourcePath = "";
  if (sub.path.startsWith("/videos/")) {
    absoluteSourcePath = buildStoragePath(
      VIDEOS_DIR,
      sub.path.replace("/videos/", "")
    );
  } else if (sub.path.startsWith("/subtitles/")) {
    absoluteSourcePath = buildStoragePath(
      UPLOADS_DIR,
      sub.path.replace(/^\//, ""),
    );
  }

  let targetSubDir = "";
  let newWebPath = "";

  // Determine target based on moveSubtitlesToVideoFolder setting
  if (moveWithVideo) {
    // Always move to video folder
    targetSubDir = buildStoragePath(VIDEOS_DIR, sanitizedCollectionName);
    newWebPath = `/videos/${sanitizedCollectionName}/${path.basename(sub.path)}`;
  } else {
    // Move to central subtitles folder (mirror collection structure)
    targetSubDir = buildStoragePath(SUBTITLES_DIR, sanitizedCollectionName);
    newWebPath = `/subtitles/${sanitizedCollectionName}/${path.basename(sub.path)}`;
  }

  if (absoluteSourcePath && targetSubDir && newWebPath) {
    return {
      absoluteSourcePath,
      targetSubPath: buildStoragePath(targetSubDir, path.basename(sub.path)),
      newWebPath
    };
  }
  return null;
}

/**
 * Helper to rename a specific type of directory
 * Extracted to reduce complexity of renameCollectionDirectories
 */
function processDirectoryRename(
  baseDir: string,
  sanitizedOldName: string,
  sanitizedNewName: string
): boolean {
  let success = true;
  const oldDir = buildStoragePath(baseDir, sanitizedOldName);
  const newDir = buildStoragePath(baseDir, sanitizedNewName);

  try {
    if (pathExists(oldDir)) {
      if (pathExists(newDir)) {
        // If target directory already exists, we fail for now or merge.
        // Let's assume name collision check is done before.
        // But if it exists, merging is safer than overwriting.
        logger.warn(
          `Target directory ${newDir} already exists. Merging content.`
        );

        // Move all files from old to new
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        const files = listDirectory(oldDir);
        files.forEach((file) => {
          const oldFile = buildStoragePath(oldDir, file);
          const newFile = buildStoragePath(newDir, file);
          try {
            moveFile(oldFile, newFile);
          } catch (e) {
            logger.error(`Error moving file ${oldFile} to ${newFile}: ${e}`);
            success = false;
          }
        });
        // Remove old directory (use recursive to handle non-empty dirs)
        try {
          removeDirectoryRecursive(oldDir);
        } catch (e) {
          logger.error(`Error removing old directory ${oldDir}: ${e}`);
          success = false;
        }
      } else {
        // Simple rename
        renamePath(oldDir, newDir);
      }
    }
  } catch (e) {
    logger.error(
      `Error renaming directory from ${oldDir} to ${newDir}`,
      e instanceof Error ? e : new Error(String(e))
    );
    success = false;
  }

  return success;
}

function processSubtitleMoveFromCollection(
  sub: { path: string; language: string; filename: string },
  targetVideoDir: string,
  targetSubDir: string,
  videoPathPrefix: string,
  subtitlePathPrefix?: string
): { updated: boolean; newSub: typeof sub } | null {
  let absoluteSourcePath = "";
  // Construct absolute source path based on DB path
  if (sub.path.startsWith("/videos/")) {
    absoluteSourcePath = buildStoragePath(
      VIDEOS_DIR,
      sub.path.replace("/videos/", ""),
    );
  } else if (sub.path.startsWith("/subtitles/")) {
    // sub.path is like /subtitles/Collection/file.vtt
    // SUBTITLES_DIR is uploads/subtitles
    absoluteSourcePath = buildStoragePath(
      UPLOADS_DIR,
      sub.path.replace(/^\//, ""),
    );
  }

  let targetSubDirPath = "";
  let newWebPath = "";

  if (sub.path.startsWith("/videos/")) {
    targetSubDirPath = targetVideoDir; // Calculated above (root or other collection)
    newWebPath = `${videoPathPrefix}/${path.basename(sub.path)}`;
  } else if (sub.path.startsWith("/subtitles/")) {
    // Should move to root subtitles or other collection subtitles
    targetSubDirPath = targetSubDir;
    newWebPath = subtitlePathPrefix
      ? `${subtitlePathPrefix}/${path.basename(sub.path)}`
      : `/subtitles/${path.basename(sub.path)}`;
  }

  if (absoluteSourcePath && targetSubDirPath && newWebPath) {
    const targetSubPath = buildStoragePath(
      targetSubDirPath,
      path.basename(sub.path),
    );

    // Ensure correct paths for move
    if (
      pathExists(absoluteSourcePath) &&
      absoluteSourcePath !== targetSubPath
    ) {
      try {
        moveFile(absoluteSourcePath, targetSubPath);
        return {
          updated: true,
          newSub: {
            ...sub,
            path: newWebPath,
          },
        };
      } catch (e) {
        logger.error(
          `Error moving subtitle file ${absoluteSourcePath} to ${targetSubPath}: ${e}`
        );
        throw e;
      }
    }
  }

  return null;
}
