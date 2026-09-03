import crypto from "crypto";
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import {
  createAdminTrustLevelError,
  isAdminTrustLevelAtLeast,
} from "../config/adminTrust";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import * as storageService from "../services/storageService";
import { parseFilename, scrapeMetadataFromTMDB } from "../services/tmdbService";
import { formatVideoFilename } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AUDIO_CONTAINER_EXTENSIONS, MEDIA_FILE_EXTENSIONS } from "../utils/videoExtensions";
import {
  errorResponse,
  sendBadRequest,
  sendData,
  successResponse,
} from "../utils/response";
import {
  execFileSafe,
  hasPathTraversalSegment,
  isPathWithinDirectory,
  imagePathExists,
  normalizeSafeAbsolutePath,
  pathExistsSafe,
  pathExistsTrusted,
  removeImagePath,
  readdirDirentsSafe,
  resolveSafeChildPath,
  resolveSafePath,
  statSafe,
} from "../utils/security";

const MEDIA_EXTENSIONS: string[] = [...MEDIA_FILE_EXTENSIONS];
const AUDIO_EXTENSIONS = new Set<string>(AUDIO_CONTAINER_EXTENSIONS);
const DEFAULT_SCAN_FILE_CONCURRENCY = 3;
const DEFAULT_SCAN_FFPROBE_TIMEOUT_MS = 15000;
const DEFAULT_SCAN_FFMPEG_TIMEOUT_MS = 30000;

const SCAN_FILE_CONCURRENCY = (() => {
  const configured = Number(
    process.env.SCAN_FILE_CONCURRENCY || DEFAULT_SCAN_FILE_CONCURRENCY
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_SCAN_FILE_CONCURRENCY;
})();

const SCAN_FFPROBE_TIMEOUT_MS = (() => {
  const configured = Number(
    process.env.SCAN_FFPROBE_TIMEOUT_MS || DEFAULT_SCAN_FFPROBE_TIMEOUT_MS
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_SCAN_FFPROBE_TIMEOUT_MS;
})();

const SCAN_FFMPEG_TIMEOUT_MS = (() => {
  const configured = Number(
    process.env.SCAN_FFMPEG_TIMEOUT_MS || DEFAULT_SCAN_FFMPEG_TIMEOUT_MS
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_SCAN_FFMPEG_TIMEOUT_MS;
})();

type ProcessDirectoryOptions = {
  isMountDirectory?: boolean;
  scannedFiles?: string[];
};

type ExistingVideoSnapshot = {
  id: string;
  fileSize?: string;
};

type ProcessFileResult = "added" | "updated" | "skipped";

type TmdbMetadata = Awaited<ReturnType<typeof scrapeMetadataFromTMDB>>;

import { resolveThumbnail } from "./scanHelpers";
import { runWithConcurrencyLimit } from "../utils/concurrency";

type RecursiveCollectionMode = "local" | "mount";

const resolveDirectoryForCollection = (
  dir: string,
  mode: RecursiveCollectionMode
): string => {
  return mode === "mount" ? validateMountDirectory(dir) : resolveSafePath(dir, VIDEOS_DIR);
};

// NAS appliances drop generated files next to the media: QNAP writes preview
// clips into ".@__thumb" and trashes into "@Recycle", Synology uses "@eaDir".
// Those scan as real videos, so skip them along with any other dot-entry.
const SYSTEM_ENTRY_NAMES = new Set(["@Recycle", "@eaDir", "#recycle"]);

const isSkippableEntryName = (name: string): boolean =>
  name.startsWith(".") || SYSTEM_ENTRY_NAMES.has(name);

const collectFilesRecursively = async (
  dir: string,
  mode: RecursiveCollectionMode,
  rootDir: string
): Promise<string[]> => {
  const resolvedDir = resolveDirectoryForCollection(dir, mode);
  const safeRoot = resolveDirectoryForCollection(rootDir, mode);

  if (mode === "mount") {
    if (!isPathWithinDirectory(resolvedDir, safeRoot)) {
      logger.warn(`Skipping directory outside mount root: ${resolvedDir}`);
      return [];
    }
  }

  if (!(await pathExistsSafe(resolvedDir, safeRoot))) {
    logger.warn(
      mode === "mount"
        ? `Mount directory does not exist: ${resolvedDir}`
        : `Directory does not exist: ${resolvedDir}`
    );
    return [];
  }

  const entries = await readdirDirentsSafe(resolvedDir, safeRoot);

  const nestedResults = await Promise.all(
    entries.map(async (entry) => {
      if (isSkippableEntryName(entry.name)) {
        return [] as string[];
      }

      let filePath: string;
      try {
        filePath = resolveSafeChildPath(resolvedDir, entry.name);
      } catch {
        logger.warn(`Skipping invalid path during scan: ${entry.name}`);
        return [] as string[];
      }

      if (!isPathWithinDirectory(filePath, resolvedDir)) {
        logger.warn(
          mode === "mount"
            ? `Skipping file outside mount directory: ${filePath}`
            : `Skipping file outside allowed directory: ${filePath}`
        );
        return [] as string[];
      }

      if (entry.isSymbolicLink()) {
        logger.warn(
          mode === "mount"
            ? `Skipping symlink during mount scan: ${filePath}`
            : `Skipping symlink during scan: ${filePath}`
        );
        return [] as string[];
      }

      if (entry.isDirectory()) {
        return collectFilesRecursively(filePath, mode, safeRoot);
      }

      return [filePath];
    })
  );

  return nestedResults.flat();
};

// Recursive function to get all files in a directory (restricted to VIDEOS_DIR)
const getFilesRecursively = async (dir: string): Promise<string[]> => {
  return collectFilesRecursively(dir, "local", VIDEOS_DIR);
};

const validateMountDirectory = (dir: string): string => {
  if (!path.isAbsolute(dir)) {
    throw new Error(`Mount directory must be an absolute path: ${dir}`);
  }

  if (hasPathTraversalSegment(dir) || dir.includes("\0")) {
    throw new Error(`Path traversal detected in mount directory: ${dir}`);
  }

  const resolvedDir = normalizeSafeAbsolutePath(dir);
  if (!path.isAbsolute(resolvedDir)) {
    throw new Error(`Invalid mount directory path: ${resolvedDir}`);
  }

  return resolvedDir;
};

const isSameOrNestedDirectory = (targetDir: string, baseDir: string): boolean => {
  const relative = path.relative(baseDir, targetDir);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const overlapsLocalVideosDirectory = (dir: string): boolean => {
  const normalizedDir = normalizeSafeAbsolutePath(dir);
  const normalizedVideosDir = normalizeSafeAbsolutePath(VIDEOS_DIR);
  return (
    isSameOrNestedDirectory(normalizedDir, normalizedVideosDir) ||
    isSameOrNestedDirectory(normalizedVideosDir, normalizedDir)
  );
};

const getFilesRecursivelyFromMount = async (
  dir: string,
  rootDir?: string
): Promise<string[]> => {
  return collectFilesRecursively(dir, "mount", rootDir ?? dir);
};

const buildVideoWebPath = (
  filePath: string,
  normalizedDirectory: string,
  isMountDirectory: boolean
): string => {
  if (isMountDirectory) {
    return `mount:${normalizeSafeAbsolutePath(filePath)}`;
  }

  const relativePath = path.relative(normalizedDirectory, filePath);
  return `/videos/${relativePath.split(path.sep).join("/")}`;
};

// A media-server layout carries the work's identity on the folder, not the file:
// "Heat (1995) [2160p]/Heat.1995.2160p.x265-YTS.mkv". Season and extras folders
// carry none, so walk past them to reach the folder that names the work.
const NON_IDENTIFYING_FOLDER =
  /^(?:season\s*\d+|s\d{1,3}|specials?|extras?|featurettes?|bonus|\d*\s*第[\d一二三四五六七八九十]+季)$/i;

const IDENTITY_FOLDER_MAX_DEPTH = 3;

const resolveIdentityFolderName = (
  filePath: string,
  rootDir: string
): string | null => {
  let dir = path.dirname(filePath);

  for (let depth = 0; depth < IDENTITY_FOLDER_MAX_DEPTH; depth += 1) {
    // Stop at the scan root: its name is the library ("TV Shows"), not a work.
    if (dir === rootDir || !isPathWithinDirectory(dir, rootDir)) {
      return null;
    }

    const name = path.basename(dir).trim();
    if (name && !NON_IDENTIFYING_FOLDER.test(name)) {
      return name;
    }

    dir = path.dirname(dir);
  }

  return null;
};

// TMDB matches a series, never a single episode, so every file in a season
// folder comes back carrying the same show title. Keep the episode designator
// from the filename so the episodes stay tellable apart in the library.
// Read straight off the filename rather than through the title parser, whose
// patterns require title text before the token - episodes named plainly
// "S01E01.mkv" would otherwise carry no designator at all, leaving every file
// in the folder sharing the show's title.
const EPISODE_DESIGNATOR_PATTERN = /(?:^|[^A-Za-z0-9])[Ss](\d{1,3})[Ee](\d{1,3})(?![0-9])/;

const buildEpisodeLabel = (filename: string): string | null => {
  const designator = EPISODE_DESIGNATOR_PATTERN.exec(path.parse(filename).name);
  if (designator) {
    const season = designator[1].padStart(2, "0");
    const episode = designator[2].padStart(2, "0");
    return `S${season}E${episode}`;
  }

  const parsed = parseFilename(filename);
  if (!parsed.isTVShow || typeof parsed.episode !== "number") {
    return null;
  }

  const episode = `E${String(parsed.episode).padStart(2, "0")}`;
  return typeof parsed.season === "number"
    ? `S${String(parsed.season).padStart(2, "0")}${episode}`
    : episode;
};

// Media servers keep bonus material in a fixed set of sibling folders, and
// release groups drop a short "sample" beside the film. Counting either makes a
// lone film look like a set and earns it a collection it should not have.
const EXTRAS_FOLDER_NAMES = new Set([
  "behind the scenes",
  "behindthescenes",
  "bonus",
  "deleted scenes",
  "extras",
  "featurettes",
  "interviews",
  "other",
  "sample",
  "samples",
  "scenes",
  "shorts",
  "trailers",
]);

// Media servers mark an extra with a hyphen suffix: "Film-trailer.mkv". The
// hyphen is required, not any separator: several of these words end ordinary
// titles - "The.Interview", "The.Other", "One.Short" - and treating those as
// bonus material would skip the film and delete the record it already had.
const EXTRA_FILENAME_SUFFIX_PATTERN =
  /-(?:sample|trailer|teaser|featurette|behindthescenes|bloopers?|deleted|interview|scene|short|other)$/i;
const EXTRA_FILENAME_WHOLE_PATTERN = /^(?:sample|trailer)$/i;
const RELEASE_SAMPLE_PATTERN = /\.sample\./i;

const isExtraVideoPath = (filePath: string, rootDir: string): boolean => {
  const filename = path.basename(filePath);
  const stem = path.parse(filename).name;

  if (
    EXTRA_FILENAME_WHOLE_PATTERN.test(stem) ||
    EXTRA_FILENAME_SUFFIX_PATTERN.test(stem) ||
    RELEASE_SAMPLE_PATTERN.test(filename)
  ) {
    return true;
  }

  // Bonus folders sit *under* a work, so stop before the scan root's own
  // children: a library named "Shorts" or "Trailers" is a category of content,
  // not bonus material, and treating it as such would skip everything in it -
  // and drop the records of anything already imported from it.
  let dir = path.dirname(filePath);
  while (isPathWithinDirectory(dir, rootDir) && path.dirname(dir) !== rootDir) {
    if (dir === rootDir) {
      break;
    }

    if (EXTRAS_FOLDER_NAMES.has(path.basename(dir).toLowerCase())) {
      return true;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return false;
};

const getSafeFilePathForProcessing = (
  filePath: string,
  isMountDirectory: boolean
): string | null => {
  if (isMountDirectory) {
    if (
      !path.isAbsolute(filePath) ||
      hasPathTraversalSegment(filePath) ||
      filePath.includes("\0")
    ) {
      logger.warn(`Skipping unsafe mount path: ${filePath}`);
      return null;
    }

    return normalizeSafeAbsolutePath(filePath);
  }

  try {
    return resolveSafePath(filePath, VIDEOS_DIR);
  } catch {
    logger.warn(`Skipping unsafe local path: ${filePath}`);
    return null;
  }
};

const extractDuration = async (
  safeFilePath: string
): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileSafe("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      safeFilePath,
    ], { timeout: SCAN_FFPROBE_TIMEOUT_MS });

    const durationOutput = stdout.trim();
    if (!durationOutput) {
      return undefined;
    }

    const durationSec = parseFloat(durationOutput);
    if (Number.isNaN(durationSec)) {
      return undefined;
    }

    return Math.round(durationSec).toString();
  } catch (error) {
    logger.error("Error getting duration:", error);
    return undefined;
  }
};

type VideoDimensions = {
  width: number;
  height: number;
};

const extractDimensions = async (
  safeFilePath: string
): Promise<VideoDimensions | undefined> => {
  try {
    const { stdout } = await execFileSafe("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      safeFilePath,
    ], { timeout: SCAN_FFPROBE_TIMEOUT_MS });

    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) {
      return undefined;
    }

    const [rawWidth, rawHeight] = firstLine
      .split(/[x,]/)
      .map((part) => part.trim());
    const width = Number.parseInt(rawWidth ?? "", 10);
    const height = Number.parseInt(rawHeight ?? "", 10);

    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height };
    }

    return undefined;
  } catch (error) {
    logger.error("Error getting video dimensions:", error);
    return undefined;
  }
};

const maybeGenerateThumbnail = async (
  safeFilePath: string
): Promise<string | null> => {
  const baseThumbnailDir = path.resolve(IMAGES_DIR);
  const normalizedThumbnailPath = resolveSafeChildPath(
    baseThumbnailDir,
    `.scan-${crypto.randomUUID()}.jpg`
  );

  try {
    await execFileSafe("ffmpeg", [
      "-nostdin",
      "-y",
      "-i",
      safeFilePath,
      "-ss",
      "00:00:00",
      "-vframes",
      "1",
      "-update",
      "1",
      normalizedThumbnailPath,
    ], { timeout: SCAN_FFMPEG_TIMEOUT_MS });

    const thumbnailExists = await imagePathExists(normalizedThumbnailPath);
    if (!thumbnailExists) {
      throw new Error("Generated thumbnail file does not exist");
    }

    return normalizedThumbnailPath;
  } catch (error) {
    try {
      if (await imagePathExists(normalizedThumbnailPath)) {
        await removeImagePath(normalizedThumbnailPath);
      }
    } catch (cleanupError) {
      logger.warn("Failed to clean up invalid generated thumbnail", {
        thumbnailPath: normalizedThumbnailPath,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }

    logger.error("Error generating thumbnail:", error);
    return null;
  }
};
const processSingleVideoFile = async (
  filePath: string,
  normalizedDirectory: string,
  existingVideosByPath: Map<string, ExistingVideoSnapshot>,
  isMountDirectory: boolean,
  resolveCollectionId: (
    collectionName: string,
    displayTitle?: string
  ) => Promise<string | undefined>,
  noteExistingVideo: (videoId: string, collectionName: string) => void
): Promise<ProcessFileResult> => {
  const filename = path.basename(filePath);
  const relativePath = path.relative(normalizedDirectory, filePath);
  const webPath = buildVideoWebPath(filePath, normalizedDirectory, isMountDirectory);

  const stats = await statSafe(filePath, normalizedDirectory);
  if (stats.size === 0) {
    logger.warn(`Skipping 0-byte video file: ${filePath}`);
    return "skipped";
  }

  const createdDate = stats.birthtime;
  const fileSize = stats.size.toString();
  const existingVideo = existingVideosByPath.get(webPath);
  if (existingVideo && existingVideo.fileSize === fileSize) {
    // Nothing to re-read, but the folder may have crossed the grouping
    // threshold since this file was imported - a second episode arriving beside
    // a lone one. Collections are only assigned on insert, so without this the
    // new collection would permanently omit the file that did not change.
    const unchangedDirName = path.dirname(relativePath);
    if (unchangedDirName !== ".") {
      noteExistingVideo(existingVideo.id, unchangedDirName.split(path.sep)[0]);
    }

    return "skipped";
  }

  const replacingVideoId = existingVideo?.id;
  if (replacingVideoId) {
    // Refreshed, not inserted - so the collection guard below skips it. Hand it
    // to the same reconciliation the unchanged files use, or a folder that
    // crosses the grouping threshold while its original file also changed ends
    // up with a collection missing that original.
    const replacingDirName = path.dirname(relativePath);
    if (replacingDirName !== ".") {
      noteExistingVideo(replacingVideoId, replacingDirName.split(path.sep)[0]);
    }

    logger.info(`Detected file change at ${webPath}, refreshing metadata`);
  }

  const originalTitle = path.parse(filename).name;
  const dateString = createdDate.toISOString().split("T")[0].replace(/-/g, "");

  let tmdbMetadata: TmdbMetadata = null;
  const tempThumbnailFilename = `${formatVideoFilename(
    originalTitle,
    "Admin",
    dateString
  )}.jpg`;

  try {
    tmdbMetadata = await scrapeMetadataFromTMDB(filename, tempThumbnailFilename);
  } catch (error) {
    logger.error(`Error scraping TMDB metadata for "${filename}":`, error);
  }

  // Release names ("Heat.1995.2160p.4K.WEB.x265.10bit.AAC5.1-[YTS.MX].mkv")
  // rarely match, while the folder they sit in usually does. Only mount scans
  // retry: under the managed videos folder the parent is an author/collection
  // folder, which would invite a wrong match.
  if (!tmdbMetadata && isMountDirectory) {
    const identityFolder = resolveIdentityFolderName(filePath, normalizedDirectory);

    if (identityFolder) {
      try {
        tmdbMetadata = await scrapeMetadataFromTMDB(
          `${identityFolder}${path.extname(filename)}`,
          tempThumbnailFilename
        );
      } catch (error) {
        logger.error(
          `Error scraping TMDB metadata for folder "${identityFolder}":`,
          error
        );
      }
    }
  }

  logger.info(`Found new video file: ${relativePath}`);

  const displayTitle = originalTitle || "Untitled Video";
  const episodeLabel = tmdbMetadata?.title ? buildEpisodeLabel(filename) : null;
  const finalDisplayTitle = tmdbMetadata?.title
    ? episodeLabel
      ? `${tmdbMetadata.title} - ${episodeLabel}`
      : tmdbMetadata.title
    : displayTitle;
  const finalDescription = tmdbMetadata?.description;
  const author = tmdbMetadata?.director || "Admin";

  const thumbnailBaseName = path.parse(filename).name;
  const newThumbnailFilename = `${thumbnailBaseName}.jpg`;

  const safeFilePath = getSafeFilePathForProcessing(filePath, isMountDirectory);
  const tempThumbnailPath =
    !tmdbMetadata?.thumbnailPath && !tmdbMetadata?.thumbnailUrl && safeFilePath
      ? await maybeGenerateThumbnail(safeFilePath)
      : null;

  const duration = safeFilePath
    ? await extractDuration(safeFilePath)
    : undefined;
  const dimensions = safeFilePath
    ? await extractDimensions(safeFilePath)
    : undefined;

  const thumbnail = await resolveThumbnail(
    filename,
    tmdbMetadata,
    tempThumbnailPath,
    newThumbnailFilename
  );

  let finalDateString: string;
  if (tmdbMetadata?.year) {
    finalDateString = `${tmdbMetadata.year}0101`;
  } else {
    finalDateString = `${createdDate.getFullYear()}0101`;
  }

  let finalCreatedAt = createdDate;
  if (tmdbMetadata?.year) {
    const productionYear = Number.parseInt(tmdbMetadata.year, 10);
    if (!Number.isNaN(productionYear)) {
      finalCreatedAt = new Date(productionYear, 0, 1);
    }
  }

  const videoId = replacingVideoId || crypto.randomUUID();

  const newVideo = {
    id: videoId,
    title: finalDisplayTitle,
    author,
    description: finalDescription,
    source: "local",
    sourceUrl: "",
    videoFilename: filename,
    videoPath: webPath,
    mediaType: (AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase())
      ? "audio"
      : "video") as "audio" | "video",
    thumbnailFilename: thumbnail.path ? thumbnail.filename : undefined,
    thumbnailPath: thumbnail.path,
    thumbnailUrl: thumbnail.url,
    rating: tmdbMetadata?.rating,
    createdAt: finalCreatedAt.toISOString(),
    addedAt: new Date().toISOString(),
    date: finalDateString,
    duration,
    width: dimensions?.width,
    height: dimensions?.height,
    fileSize,
  };

  storageService.saveVideo(newVideo, {
    statisticsReason: "scan",
  });
  existingVideosByPath.set(webPath, {
    id: videoId,
    fileSize,
  });

  const dirName = path.dirname(relativePath);
  if (!replacingVideoId && dirName !== ".") {
    const collectionName = dirName.split(path.sep)[0];
    // Name the collection after the work TMDB recognized rather than the raw
    // release folder - but only when that folder *is* the collection folder.
    // With a library root as the scan root the first segment is the library
    // name ("TV Shows"), which one show's title must not overwrite.
    const collectionDisplayTitle =
      isMountDirectory &&
      tmdbMetadata?.title &&
      resolveIdentityFolderName(filePath, normalizedDirectory) === collectionName
        ? tmdbMetadata.title
        : undefined;
    const collectionId = await resolveCollectionId(
      collectionName,
      collectionDisplayTitle
    );

    if (collectionId) {
      // Mount media belongs to the media server, so it must never be relocated
      // into a collection folder. Saying so up front also skips the legacy
      // move path, which reloads every collection and its members per video -
      // synchronous SQLite work that stalls the whole server mid-scan.
      storageService.addVideoToCollection(
        collectionId,
        newVideo.id,
        isMountDirectory ? { moveFiles: false } : undefined
      );
      logger.info(`Added video ${newVideo.title} to collection ${collectionName}`);
    }
  }

  return replacingVideoId ? "updated" : "added";
};

/**
 * Helper function to process video files from a directory
 * Reusable logic for scanning directories
 */
const processDirectoryFiles = async (
  directory: string,
  existingVideosByPath: Map<string, ExistingVideoSnapshot>,
  videoExtensions: string[],
  options: ProcessDirectoryOptions = {}
): Promise<{ addedCount: number; updatedCount: number; allFiles: string[] }> => {
  const isMountDirectory = options.isMountDirectory || false;
  const normalizedDirectory = isMountDirectory
    ? validateMountDirectory(directory)
    : resolveSafePath(directory, VIDEOS_DIR);

  if (!(await pathExistsTrusted(normalizedDirectory))) {
    logger.warn(`Directory does not exist: ${normalizedDirectory}`);
    return { addedCount: 0, updatedCount: 0, allFiles: [] };
  }

  const collectedFiles =
    options.scannedFiles ||
    (isMountDirectory
      ? await getFilesRecursivelyFromMount(normalizedDirectory)
      : await getFilesRecursively(normalizedDirectory));

  // Bonus material is not library content: a media server keeps it beside the
  // film precisely so a player can ignore it. Dropping it here also keeps it
  // out of the caller's on-disk set, so extras imported by an earlier scan are
  // cleaned up on the next one.
  const allFiles = isMountDirectory
    ? collectedFiles.filter(
        (filePath) => !isExtraVideoPath(filePath, normalizedDirectory)
      )
    : collectedFiles;

  const videoFiles = allFiles.filter((filePath) =>
    videoExtensions.includes(path.extname(filePath).toLowerCase())
  );

  const collectionIdCache = new Map<string, string>();
  const collectionCreationLocks = new Map<string, Promise<string | undefined>>();

  // A folder holding one video is a single film, not a series, and turning it
  // into a one-video collection just clutters the library. Count the whole
  // batch up front so the decision does not depend on scan order. An existing
  // collection of that name is still joined - only creating a new one is
  // withheld.
  const videoCountByCollectionName = new Map<string, number>();
  for (const filePath of videoFiles) {
    const dirName = path.dirname(path.relative(normalizedDirectory, filePath));
    if (dirName === ".") {
      continue;
    }

    const name = dirName.split(path.sep)[0];
    videoCountByCollectionName.set(
      name,
      (videoCountByCollectionName.get(name) ?? 0) + 1
    );
  }

  const shouldGroupIntoCollection = (collectionName: string): boolean =>
    !isMountDirectory || (videoCountByCollectionName.get(collectionName) ?? 0) > 1;

  const resolveCollectionId = async (
    collectionName: string,
    displayTitle?: string
  ): Promise<string | undefined> => {
    // Decided before any lookup: a lone film must not join a same-named
    // collection either, or one left behind by an earlier scan quietly takes
    // it back in.
    if (!shouldGroupIntoCollection(collectionName)) {
      return undefined;
    }

    const cached = collectionIdCache.get(collectionName);
    if (cached) {
      return cached;
    }

    const inFlight = collectionCreationLocks.get(collectionName);
    if (inFlight) {
      return inFlight;
    }

    const createPromise = Promise.resolve().then(() => {
      const allCollections = storageService.getCollections();
      const existingCollection = allCollections.find(
        (collection) =>
          collection.title === collectionName || collection.name === collectionName
      );

      if (existingCollection) {
        collectionIdCache.set(collectionName, existingCollection.id);
        return existingCollection.id;
      }

      const collectionId = crypto.randomUUID();

      storageService.saveCollection({
        id: collectionId,
        // `name` stays the folder, so lookups by folder name keep matching.
        title: displayTitle || collectionName,
        name: collectionName,
        videos: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      logger.info(`Created new collection from folder: ${collectionName}`);
      collectionIdCache.set(collectionName, collectionId);
      return collectionId;
    });

    collectionCreationLocks.set(collectionName, createPromise);
    try {
      return await createPromise;
    } finally {
      collectionCreationLocks.delete(collectionName);
    }
  };

  let addedCount = 0;
  let updatedCount = 0;
  const existingVideosByCollectionName = new Map<string, string[]>();

  await runWithConcurrencyLimit(
    videoFiles,
    SCAN_FILE_CONCURRENCY,
    async (filePath) => {
      try {
        const result = await processSingleVideoFile(
          filePath,
          normalizedDirectory,
          existingVideosByPath,
          isMountDirectory,
          resolveCollectionId,
          (videoId, collectionName) => {
            existingVideosByCollectionName.set(
              collectionName,
              [...(existingVideosByCollectionName.get(collectionName) ?? []), videoId]
            );
          }
        );

        if (result === "added") {
          addedCount += 1;
        } else if (result === "updated") {
          updatedCount += 1;
        }
      } catch (error) {
        logger.error(`Error processing video file ${filePath}:`, error);
      }
    }
  );

  // Reconcile after the pass, so a collection created from a newly added file
  // already carries the title TMDB recognised before the existing files join.
  for (const [collectionName, videoIds] of existingVideosByCollectionName) {
    if (!shouldGroupIntoCollection(collectionName)) {
      continue;
    }

    const collectionId = await resolveCollectionId(collectionName);
    if (!collectionId) {
      continue;
    }

    for (const videoId of videoIds) {
      storageService.addVideoToCollection(
        collectionId,
        videoId,
        isMountDirectory ? { moveFiles: false } : undefined
      );
    }
  }

  return { addedCount, updatedCount, allFiles };
};

/**
 * Scan files in videos directory and sync with database
 * This endpoint intentionally remains available across trust levels because it
 * only operates on the app-managed local /videos tree, not arbitrary host paths.
 * Errors are automatically handled by asyncHandler middleware
 */
type ScanType = "files" | "mount";

type ActiveScan = {
  scanType: ScanType;
  startedAt: string;
};

// A scan rewrites library records, so only one may run at a time. The state is
// held here rather than in the client so a scan still reports as running after
// the page that started it navigated away and remounted.
let activeScan: ActiveScan | null = null;

const beginScan = (scanType: ScanType, res: Response): boolean => {
  if (activeScan) {
    res.status(409).json(
      errorResponse("A scan is already running.", {
        errorKey: "scanAlreadyRunning",
      })
    );
    return false;
  }

  activeScan = { scanType, startedAt: new Date().toISOString() };
  return true;
};

const endScan = (): void => {
  activeScan = null;
};

/**
 * Report whether a scan is currently running
 */
export const getScanStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  sendData(res, {
    scanning: activeScan !== null,
    scanType: activeScan?.scanType ?? null,
    startedAt: activeScan?.startedAt ?? null,
  });
};

const runFileScan = async (res: Response): Promise<void> => {
  logger.info("Starting file scan...");

  const existingVideos = storageService.getVideos();
  const existingVideosByPath = new Map<string, ExistingVideoSnapshot>();
  const videosToDelete: string[] = [];

  for (const video of existingVideos) {
    if (video.videoPath?.startsWith("/videos/")) {
      existingVideosByPath.set(video.videoPath, {
        id: video.id,
        fileSize: video.fileSize,
      });
    }
  }

  if (!(await pathExistsTrusted(VIDEOS_DIR))) {
    res
      .status(200)
      .json(
        successResponse(
          { addedCount: 0, deletedCount: 0 },
          "Videos directory does not exist"
        )
      );
    return;
  }

  const allFiles = await getFilesRecursively(VIDEOS_DIR);
  const actualVideoWebPathsOnDisk = new Set<string>();

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!MEDIA_EXTENSIONS.includes(ext)) {
      continue;
    }

    const relativePath = path.relative(VIDEOS_DIR, filePath);
    const webPath = `/videos/${relativePath.split(path.sep).join("/")}`;
    actualVideoWebPathsOnDisk.add(webPath);
  }

  for (const video of existingVideos) {
    if (video.videoPath?.startsWith("/videos/")) {
      if (!actualVideoWebPathsOnDisk.has(video.videoPath)) {
        logger.info(`Video missing: ${video.title} (${video.videoPath})`);
        videosToDelete.push(video.id);
      }
    } else if (video.videoFilename && !video.videoPath) {
      const inferredPath = `/videos/${video.videoFilename}`;
      if (!actualVideoWebPathsOnDisk.has(inferredPath)) {
        logger.info(
          `Video missing (legacy path): ${video.title} (${video.videoFilename})`
        );
        videosToDelete.push(video.id);
      }
    }
  }

  let deletedCount = 0;
  for (const id of videosToDelete) {
    if (storageService.deleteVideo(id)) {
      deletedCount += 1;
    }
  }
  logger.info(`Deleted ${deletedCount} missing videos.`);

  const { addedCount, updatedCount } = await processDirectoryFiles(
    VIDEOS_DIR,
    existingVideosByPath,
    MEDIA_EXTENSIONS,
    { scannedFiles: allFiles }
  );

  const message = `Scan complete. Added ${addedCount} new videos. Updated ${updatedCount} existing videos. Deleted ${deletedCount} missing videos.`;
  logger.info(message);

  res.status(200).json({ addedCount, deletedCount });
};

export const scanFiles = async (
  _req: Request,
  res: Response
): Promise<void> => {
  if (!beginScan("files", res)) {
    return;
  }

  try {
    await runFileScan(res);
  } finally {
    endScan();
  }
};

/**
 * Scan mount directories for video files
 * Accepts array of directory paths in request body: { directories: string[] }
 */
const runMountScan = async (req: Request, res: Response): Promise<void> => {
  logger.info("Starting mount directories scan...");

  const { directories } = req.body;

  if (!directories || !Array.isArray(directories) || directories.length === 0) {
    sendBadRequest(res, "Directories array is required and must not be empty");
    return;
  }

  const trimmedDirectories = directories
    .map((dir: string) => dir.trim())
    .filter((dir: string) => dir.length > 0);

  if (trimmedDirectories.length === 0) {
    sendBadRequest(res, "No valid directories provided");
    return;
  }

  const validDirectories: string[] = [];
  const invalidDirectories: string[] = [];
  for (const directory of trimmedDirectories) {
    try {
      const validatedDirectory = validateMountDirectory(directory);
      if (overlapsLocalVideosDirectory(validatedDirectory)) {
        invalidDirectories.push(directory);
        continue;
      }

      validDirectories.push(validatedDirectory);
    } catch {
      invalidDirectories.push(directory);
    }
  }

  if (invalidDirectories.length > 0) {
    res.status(400).json(
      errorResponse("Invalid mount directories detected (must be absolute safe paths)", {
        invalidDirectories,
      })
    );
    return;
  }

  logger.info(
    `Scanning ${validDirectories.length} mount directory/directories: ${validDirectories.join(
      ", "
    )}`
  );

  const existingVideos = storageService.getVideos();
  const existingVideosByPath = new Map<string, ExistingVideoSnapshot>();

  for (const video of existingVideos) {
    if (video.videoPath) {
      existingVideosByPath.set(video.videoPath, {
        id: video.id,
        fileSize: video.fileSize,
      });
    }
  }

  let totalAddedCount = 0;
  let totalUpdatedCount = 0;
  const actualMountPathsOnDisk = new Set<string>();

  for (const directory of validDirectories) {
    const { addedCount, updatedCount, allFiles } = await processDirectoryFiles(
      directory,
      existingVideosByPath,
      MEDIA_EXTENSIONS,
      { isMountDirectory: true }
    );

    totalAddedCount += addedCount;
    totalUpdatedCount += updatedCount;

    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (MEDIA_EXTENSIONS.includes(ext)) {
        actualMountPathsOnDisk.add(normalizeSafeAbsolutePath(filePath));
      }
    }
  }

  let deletedCount = 0;
  const videosToDelete: string[] = [];

  // Every mount record that the scan did not find on disk is dropped, including
  // records under a directory the operator has since removed from the setting.
  // Only the database row goes: deleteVideo() never touches a "mount:" file,
  // so the media itself stays where the media server expects it.
  for (const video of existingVideos) {
    if (!video.videoPath?.startsWith("mount:")) {
      continue;
    }

    const actualVideoPath = video.videoPath.substring(6);

    let normalizedVideoPath: string;
    try {
      normalizedVideoPath = normalizeSafeAbsolutePath(actualVideoPath);
    } catch {
      continue;
    }

    if (!actualMountPathsOnDisk.has(normalizedVideoPath)) {
      logger.info(`Mount video no longer scanned: ${video.title} (${video.videoPath})`);
      videosToDelete.push(video.id);
    }
  }

  for (const id of videosToDelete) {
    if (storageService.deleteVideo(id)) {
      deletedCount += 1;
    }
  }

  logger.info(
    `Mount scan complete. Added ${totalAddedCount} new videos. Updated ${totalUpdatedCount} existing videos. Deleted ${deletedCount} missing videos.`
  );

  res.status(200).json({
    addedCount: totalAddedCount,
    deletedCount,
    scannedDirectories: validDirectories.length,
  });
};

export const scanMountDirectories = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!isAdminTrustLevelAtLeast("host")) {
    res.status(403).json(createAdminTrustLevelError("host"));
    return;
  }

  if (!beginScan("mount", res)) {
    return;
  }

  try {
    await runMountScan(req, res);
  } finally {
    endScan();
  }
};
