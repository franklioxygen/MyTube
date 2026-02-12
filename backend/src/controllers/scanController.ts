import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import * as storageService from "../services/storageService";
import { scrapeMetadataFromTMDB } from "../services/tmdbService";
import { formatVideoFilename } from "../utils/helpers";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import {
  execFileSafe,
  isPathWithinDirectory,
  resolveSafePath,
  validateImagePath,
} from "../utils/security";

const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".webm", ".avi", ".mov"];
const DEFAULT_SCAN_FILE_CONCURRENCY = 3;

const SCAN_FILE_CONCURRENCY = (() => {
  const configured = Number(
    process.env.SCAN_FILE_CONCURRENCY || DEFAULT_SCAN_FILE_CONCURRENCY
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_SCAN_FILE_CONCURRENCY;
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

type ThumbnailResolution = {
  filename?: string;
  path?: string;
  url?: string;
};

const runWithConcurrencyLimit = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  if (items.length === 0) {
    return;
  }

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
};

// Recursive function to get all files in a directory (restricted to VIDEOS_DIR)
const getFilesRecursively = async (dir: string): Promise<string[]> => {
  const safeDir = resolveSafePath(dir, VIDEOS_DIR);
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  const entries = await fs.readdir(safeDir, { withFileTypes: true });

  const nestedResults = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(safeDir, entry.name);

      if (!isPathWithinDirectory(filePath, safeDir)) {
        logger.warn(`Skipping file outside allowed directory: ${filePath}`);
        return [] as string[];
      }

      if (entry.isSymbolicLink()) {
        logger.warn(`Skipping symlink during scan: ${filePath}`);
        return [] as string[];
      }

      if (entry.isDirectory()) {
        return getFilesRecursively(filePath);
      }

      return [filePath];
    })
  );

  return nestedResults.flat();
};

const validateMountDirectory = (dir: string): string => {
  if (!path.isAbsolute(dir)) {
    throw new Error(`Mount directory must be an absolute path: ${dir}`);
  }

  if (dir.includes("..") || dir.includes("\0")) {
    throw new Error(`Path traversal detected in mount directory: ${dir}`);
  }

  const resolvedDir = path.resolve(path.normalize(dir));
  if (!path.isAbsolute(resolvedDir)) {
    throw new Error(`Invalid mount directory path: ${resolvedDir}`);
  }

  return resolvedDir;
};

// Recursive function to get all files from a mount directory (no VIDEOS_DIR restriction)
const getFilesRecursivelyFromMount = async (
  dir: string,
  rootDir?: string
): Promise<string[]> => {
  const resolvedDir = validateMountDirectory(dir);
  const safeRoot = rootDir ? validateMountDirectory(rootDir) : resolvedDir;

  if (!isPathWithinDirectory(resolvedDir, safeRoot)) {
    logger.warn(`Skipping directory outside mount root: ${resolvedDir}`);
    return [];
  }

  if (!(await fs.pathExists(resolvedDir))) {
    logger.warn(`Mount directory does not exist: ${resolvedDir}`);
    return [];
  }

  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

  const nestedResults = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(resolvedDir, entry.name);

      if (!isPathWithinDirectory(filePath, resolvedDir)) {
        logger.warn(`Skipping file outside mount directory: ${filePath}`);
        return [] as string[];
      }

      if (entry.isSymbolicLink()) {
        logger.warn(`Skipping symlink during mount scan: ${filePath}`);
        return [] as string[];
      }

      if (entry.isDirectory()) {
        return getFilesRecursivelyFromMount(filePath, safeRoot);
      }

      return [filePath];
    })
  );

  return nestedResults.flat();
};

const buildVideoWebPath = (
  filePath: string,
  normalizedDirectory: string,
  isMountDirectory: boolean
): string => {
  if (isMountDirectory) {
    return `mount:${path.resolve(path.normalize(filePath))}`;
  }

  const relativePath = path.relative(normalizedDirectory, filePath);
  return `/videos/${relativePath.split(path.sep).join("/")}`;
};

const getSafeFilePathForProcessing = (
  filePath: string,
  isMountDirectory: boolean
): string | null => {
  if (isMountDirectory) {
    if (
      !path.isAbsolute(filePath) ||
      filePath.includes("..") ||
      filePath.includes("\0")
    ) {
      logger.warn(`Skipping unsafe mount path: ${filePath}`);
      return null;
    }

    return path.resolve(path.normalize(filePath));
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
    ]);

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

const maybeGenerateThumbnail = async (
  safeFilePath: string,
  tempThumbnailPath: string
): Promise<void> => {
  try {
    const validatedThumbnailPath = validateImagePath(tempThumbnailPath);
    await execFileSafe("ffmpeg", [
      "-i",
      safeFilePath,
      "-ss",
      "00:00:00",
      "-vframes",
      "1",
      validatedThumbnailPath,
    ]);
  } catch (error) {
    logger.error("Error generating thumbnail:", error);
  }
};

const resolveThumbnail = async (
  filename: string,
  tmdbMetadata: TmdbMetadata,
  tempThumbnailPath: string,
  fallbackThumbnailFilename: string
): Promise<ThumbnailResolution> => {
  const tmdbThumbnailFilename = (tmdbMetadata as any)?.thumbnailFilename as
    | string
    | undefined;

  if (
    tmdbMetadata?.thumbnailPath &&
    tmdbMetadata.thumbnailPath.startsWith("/images/")
  ) {
    if (tmdbThumbnailFilename) {
      const tmdbFilePath = validateImagePath(
        path.join(IMAGES_DIR, tmdbThumbnailFilename.replace(/\//g, path.sep))
      );

      if (await fs.pathExists(tmdbFilePath)) {
        logger.info(
          `Using TMDB poster for "${filename}" (saved as: ${tmdbThumbnailFilename})`
        );
      } else {
        logger.warn(
          `TMDB poster path doesn't exist, using metadata path: ${tmdbMetadata.thumbnailPath}`
        );
      }

      return {
        filename: path.basename(tmdbThumbnailFilename),
        path: tmdbMetadata.thumbnailPath,
        url: tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath,
      };
    }

    const pathFromMetadata = tmdbMetadata.thumbnailPath.replace("/images/", "");
    return {
      filename: path.basename(pathFromMetadata),
      path: tmdbMetadata.thumbnailPath,
      url: tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath,
    };
  }

  let finalThumbnailFilename = fallbackThumbnailFilename;

  try {
    const safeTargetThumbnailPath = validateImagePath(
      path.join(IMAGES_DIR, finalThumbnailFilename)
    );
    const safeTempThumbnailPath = validateImagePath(tempThumbnailPath);

    if (await fs.pathExists(safeTempThumbnailPath)) {
      if (
        (await fs.pathExists(safeTargetThumbnailPath)) &&
        safeTempThumbnailPath !== safeTargetThumbnailPath
      ) {
        await fs.remove(safeTempThumbnailPath);
        logger.warn(
          `Thumbnail filename already exists: ${finalThumbnailFilename}, using existing`
        );
      } else if (safeTempThumbnailPath !== safeTargetThumbnailPath) {
        await fs.move(safeTempThumbnailPath, safeTargetThumbnailPath);
        logger.info(`Renamed thumbnail file to "${finalThumbnailFilename}"`);
      }

      return {
        filename: finalThumbnailFilename,
        path: `/images/${finalThumbnailFilename}`,
        url: `/images/${finalThumbnailFilename}`,
      };
    }
  } catch (error) {
    logger.error(`Error resolving thumbnail file: ${error}`);
  }

  if (await fs.pathExists(tempThumbnailPath)) {
    finalThumbnailFilename = path.basename(tempThumbnailPath);
    return {
      filename: finalThumbnailFilename,
      path: `/images/${finalThumbnailFilename}`,
      url: `/images/${finalThumbnailFilename}`,
    };
  }

  return {};
};

const processSingleVideoFile = async (
  filePath: string,
  normalizedDirectory: string,
  existingVideosByPath: Map<string, ExistingVideoSnapshot>,
  isMountDirectory: boolean,
  resolveCollectionId: (collectionName: string) => Promise<string | undefined>
): Promise<ProcessFileResult> => {
  const filename = path.basename(filePath);
  const relativePath = path.relative(normalizedDirectory, filePath);
  const webPath = buildVideoWebPath(filePath, normalizedDirectory, isMountDirectory);

  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  const stats = await fs.stat(filePath);
  if (stats.size === 0) {
    logger.warn(`Skipping 0-byte video file: ${filePath}`);
    return "skipped";
  }

  const createdDate = stats.birthtime;
  const fileSize = stats.size.toString();
  const existingVideo = existingVideosByPath.get(webPath);
  if (existingVideo && existingVideo.fileSize === fileSize) {
    return "skipped";
  }

  const replacingVideoId = existingVideo?.id;
  if (replacingVideoId) {
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

  logger.info(`Found new video file: ${relativePath}`);

  const displayTitle = originalTitle || "Untitled Video";
  const finalDisplayTitle = tmdbMetadata?.title || displayTitle;
  const finalDescription = tmdbMetadata?.description;
  const author = tmdbMetadata?.director || "Admin";

  const thumbnailBaseName = path.parse(filename).name;
  const newThumbnailFilename = `${thumbnailBaseName}.jpg`;
  const tempThumbnailPath = path.join(IMAGES_DIR, newThumbnailFilename);

  const safeFilePath = getSafeFilePathForProcessing(filePath, isMountDirectory);

  if (!tmdbMetadata?.thumbnailPath && !tmdbMetadata?.thumbnailUrl && safeFilePath) {
    await maybeGenerateThumbnail(safeFilePath, tempThumbnailPath);
  }

  const duration = safeFilePath
    ? await extractDuration(safeFilePath)
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

  const videoId =
    replacingVideoId ||
    (Date.now() + Math.floor(Math.random() * 10000)).toString();

  const newVideo = {
    id: videoId,
    title: finalDisplayTitle,
    author,
    description: finalDescription,
    source: "local",
    sourceUrl: "",
    videoFilename: filename,
    videoPath: webPath,
    thumbnailFilename: thumbnail.path ? thumbnail.filename : undefined,
    thumbnailPath: thumbnail.path,
    thumbnailUrl: thumbnail.url,
    rating: tmdbMetadata?.rating,
    createdAt: finalCreatedAt.toISOString(),
    addedAt: new Date().toISOString(),
    date: finalDateString,
    duration,
    fileSize,
  };

  storageService.saveVideo(newVideo);
  existingVideosByPath.set(webPath, {
    id: videoId,
    fileSize,
  });

  const dirName = path.dirname(relativePath);
  if (!replacingVideoId && dirName !== ".") {
    const collectionName = dirName.split(path.sep)[0];
    const collectionId = await resolveCollectionId(collectionName);

    if (collectionId) {
      storageService.addVideoToCollection(collectionId, newVideo.id);
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
  const normalizedDirectory = path.resolve(path.normalize(directory));

  if (!(await fs.pathExists(normalizedDirectory))) {
    logger.warn(`Directory does not exist: ${normalizedDirectory}`);
    return { addedCount: 0, updatedCount: 0, allFiles: [] };
  }

  const allFiles =
    options.scannedFiles ||
    (isMountDirectory
      ? await getFilesRecursivelyFromMount(normalizedDirectory)
      : await getFilesRecursively(normalizedDirectory));

  const videoFiles = allFiles.filter((filePath) =>
    videoExtensions.includes(path.extname(filePath).toLowerCase())
  );

  const collectionIdCache = new Map<string, string>();
  const collectionCreationLocks = new Map<string, Promise<string | undefined>>();

  const resolveCollectionId = async (
    collectionName: string
  ): Promise<string | undefined> => {
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

      const collectionId = (
        Date.now() + Math.floor(Math.random() * 10000)
      ).toString();

      storageService.saveCollection({
        id: collectionId,
        title: collectionName,
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
          resolveCollectionId
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

  return { addedCount, updatedCount, allFiles };
};

/**
 * Scan files in videos directory and sync with database
 * Errors are automatically handled by asyncHandler middleware
 */
export const scanFiles = async (
  _req: Request,
  res: Response
): Promise<void> => {
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

  if (!(await fs.pathExists(VIDEOS_DIR))) {
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
    if (!VIDEO_EXTENSIONS.includes(ext)) {
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
    VIDEO_EXTENSIONS,
    { scannedFiles: allFiles }
  );

  const message = `Scan complete. Added ${addedCount} new videos. Updated ${updatedCount} existing videos. Deleted ${deletedCount} missing videos.`;
  logger.info(message);

  res.status(200).json({ addedCount, deletedCount });
};

/**
 * Scan mount directories for video files
 * Accepts array of directory paths in request body: { directories: string[] }
 */
export const scanMountDirectories = async (
  req: Request,
  res: Response
): Promise<void> => {
  logger.info("Starting mount directories scan...");

  const { directories } = req.body;

  if (!directories || !Array.isArray(directories) || directories.length === 0) {
    res
      .status(400)
      .json({ error: "Directories array is required and must not be empty" });
    return;
  }

  const trimmedDirectories = directories
    .map((dir: string) => dir.trim())
    .filter((dir: string) => dir.length > 0);

  if (trimmedDirectories.length === 0) {
    res.status(400).json({ error: "No valid directories provided" });
    return;
  }

  const validDirectories: string[] = [];
  const invalidDirectories: string[] = [];
  for (const directory of trimmedDirectories) {
    try {
      validDirectories.push(validateMountDirectory(directory));
    } catch {
      invalidDirectories.push(directory);
    }
  }

  if (invalidDirectories.length > 0) {
    res.status(400).json({
      error: "Invalid mount directories detected (must be absolute safe paths)",
      invalidDirectories,
    });
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
      VIDEO_EXTENSIONS,
      { isMountDirectory: true }
    );

    totalAddedCount += addedCount;
    totalUpdatedCount += updatedCount;

    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (VIDEO_EXTENSIONS.includes(ext)) {
        actualMountPathsOnDisk.add(path.resolve(path.normalize(filePath)));
      }
    }
  }

  let deletedCount = 0;
  const videosToDelete: string[] = [];

  const normalizedDirectories = validDirectories;

  for (const video of existingVideos) {
    if (!video.videoPath) {
      continue;
    }

    let actualVideoPath = video.videoPath;
    if (actualVideoPath.startsWith("mount:")) {
      actualVideoPath = actualVideoPath.substring(6);
    }

    let normalizedVideoPath: string;
    try {
      normalizedVideoPath = path.resolve(path.normalize(actualVideoPath));
    } catch {
      continue;
    }

    const isInScannedDirectory = normalizedDirectories.some((dir: string) => {
      return (
        normalizedVideoPath === dir ||
        normalizedVideoPath.startsWith(`${dir}${path.sep}`)
      );
    });

    if (!isInScannedDirectory) {
      continue;
    }

    if (!actualMountPathsOnDisk.has(normalizedVideoPath)) {
      logger.info(`Mount video missing: ${video.title} (${video.videoPath})`);
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
