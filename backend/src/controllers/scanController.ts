import { execFile } from "child_process";
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
  resolveSafePath,
  validateImagePath,
} from "../utils/security";

// Recursive function to get all files in a directory (restricted to VIDEOS_DIR)
const getFilesRecursively = (dir: string): string[] => {
  // Validate directory path to prevent path traversal
  const safeDir = resolveSafePath(dir, VIDEOS_DIR);
  let results: string[] = [];
  const list = fs.readdirSync(safeDir);

  list.forEach((file) => {
    // Validate file path to prevent path traversal
    const filePath = path.join(safeDir, file);
    // Ensure the file path is still within the allowed directory
    if (!filePath.startsWith(safeDir + path.sep) && filePath !== safeDir) {
      logger.warn(`Skipping file outside allowed directory: ${filePath}`);
      return;
    }
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else {
      results.push(filePath);
    }
  });

  return results;
};

// Recursive function to get all files from a mount directory (no VIDEOS_DIR restriction)
// Still validates that path is absolute and doesn't contain traversal sequences
const getFilesRecursivelyFromMount = (dir: string): string[] => {
  // Validate that directory is absolute and doesn't contain path traversal
  if (!path.isAbsolute(dir)) {
    throw new Error(`Mount directory must be an absolute path: ${dir}`);
  }

  // Check for path traversal sequences
  if (dir.includes("..")) {
    throw new Error(`Path traversal detected in mount directory: ${dir}`);
  }

  // Resolve and normalize the path
  const resolvedDir = path.resolve(path.normalize(dir));

  // Ensure it's still absolute after resolution
  if (!path.isAbsolute(resolvedDir)) {
    throw new Error(`Invalid mount directory path: ${resolvedDir}`);
  }

  // Check if directory exists
  if (!fs.existsSync(resolvedDir)) {
    logger.warn(`Mount directory does not exist: ${resolvedDir}`);
    return [];
  }

  let results: string[] = [];
  try {
    const list = fs.readdirSync(resolvedDir);

    list.forEach((file) => {
      const filePath = path.join(resolvedDir, file);

      // Ensure the file path is still within the mount directory (prevent symlink attacks)
      if (
        !filePath.startsWith(resolvedDir + path.sep) &&
        filePath !== resolvedDir
      ) {
        logger.warn(`Skipping file outside mount directory: ${filePath}`);
        return;
      }

      try {
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
          results = results.concat(getFilesRecursivelyFromMount(filePath));
        } else {
          results.push(filePath);
        }
      } catch (err) {
        logger.warn(`Error accessing file ${filePath}: ${err}`);
      }
    });
  } catch (err) {
    logger.error(`Error reading mount directory ${resolvedDir}: ${err}`);
    throw err;
  }

  return results;
};

/**
 * Scan files in videos directory and sync with database
 * Errors are automatically handled by asyncHandler middleware
 */
export const scanFiles = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  logger.info("Starting file scan...");

  // 1. Get all existing videos from DB
  const existingVideos = storageService.getVideos();
  const existingPaths = new Set<string>();
  const existingFilenames = new Set<string>();

  // Track deleted videos
  let deletedCount = 0;
  const videosToDelete: string[] = [];

  // Check for missing files
  for (const v of existingVideos) {
    if (v.videoPath) existingPaths.add(v.videoPath);
    if (v.videoFilename) {
      existingFilenames.add(v.videoFilename);
    }
  }

  // 2. Recursively scan VIDEOS_DIR
  if (!fs.existsSync(VIDEOS_DIR)) {
    res
      .status(200)
      .json(
        successResponse(
          { addedCount: 0, deletedCount: 0 },
          "Videos directory does not exist",
        ),
      );
    return;
  }

  const allFiles = getFilesRecursively(VIDEOS_DIR);
  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov"];
  const actualFilesOnDisk = new Set<string>(); // Stores filenames (basename)
  const actualFullPathsOnDisk = new Set<string>(); // Stores full absolute paths

  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (videoExtensions.includes(ext)) {
      actualFilesOnDisk.add(path.basename(filePath));
      actualFullPathsOnDisk.add(filePath);
    }
  }

  // Now check for missing videos
  for (const v of existingVideos) {
    if (v.videoFilename) {
      // If the filename is not found in ANY of the scanned files, it is missing.
      if (!actualFilesOnDisk.has(v.videoFilename)) {
        logger.info(`Video missing: ${v.title} (${v.videoFilename})`);
        videosToDelete.push(v.id);
      }
    } else {
      // No filename? That's a bad record.
      logger.warn(`Video record corrupted (no filename): ${v.title}`);
      videosToDelete.push(v.id);
    }
  }

  // Delete missing videos
  for (const id of videosToDelete) {
    if (storageService.deleteVideo(id)) {
      deletedCount++;
    }
  }
  logger.info(`Deleted ${deletedCount} missing videos.`);

  let addedCount = 0;

  // 3. Process each file (Add new ones)
  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (!videoExtensions.includes(ext)) continue;

    const filename = path.basename(filePath);
    const relativePath = path.relative(VIDEOS_DIR, filePath);
    const webPath = `/videos/${relativePath.split(path.sep).join("/")}`;

    // Check if exists in DB by original filename
    if (existingFilenames.has(filename)) {
      continue;
    }

    const stats = fs.statSync(filePath);

    // Skip 0-byte files to prevent importing empty/incomplete videos
    if (stats.size === 0) {
      logger.warn(`Skipping 0-byte video file: ${filePath}`);
      continue;
    }

    const createdDate = stats.birthtime;
    const fileSize = stats.size.toString();

    // Extract title from filename
    const originalTitle = path.parse(filename).name;
    const dateString = createdDate
      .toISOString()
      .split("T")[0]
      .replace(/-/g, "");

    // Try to scrape metadata and poster from TMDB first to get director/author
    let tmdbMetadata = null;
    let tempThumbnailFilename = `${formatVideoFilename(originalTitle, "Admin", dateString)}.jpg`;
    try {
      tmdbMetadata = await scrapeMetadataFromTMDB(
        filename,
        tempThumbnailFilename,
      );
    } catch (error) {
      logger.error(`Error scraping TMDB metadata for "${filename}":`, error);
    }

    // Use director from TMDB metadata as author, fallback to "Admin"
    const author = tmdbMetadata?.director || "Admin";

    // Use original title for database (for display purposes)
    // The title should be readable, not sanitized like filenames
    const displayTitle = originalTitle || "Untitled Video";

    // Check if the original filename already exists in DB (to avoid duplicates)
    if (existingFilenames.has(filename)) {
      logger.info(`Skipping file "${filename}" - already exists in database`);
      continue;
    }

    logger.info(`Found new video file: ${relativePath}`);
    const videoId = (Date.now() + Math.floor(Math.random() * 10000)).toString();

    // Generate thumbnail filename based on original filename (without extension)
    const thumbnailBaseName = path.parse(filename).name;
    const newThumbnailFilename = `${thumbnailBaseName}.jpg`;

    // Use scraped title if available, otherwise use original title
    const finalDisplayTitle = tmdbMetadata?.title || displayTitle;
    const finalDescription = tmdbMetadata?.description;

    // Generate thumbnail with temporary name first (only if TMDB didn't provide one)
    const tempThumbnailPath = path.join(
      IMAGES_DIR,
      `${path.parse(filename).name}.jpg`,
    );

    // Only generate thumbnail with ffmpeg if TMDB didn't provide a poster
    if (!tmdbMetadata?.thumbnailPath && !tmdbMetadata?.thumbnailUrl) {
      try {
        // Validate paths before using them
        const validatedFilePath = resolveSafePath(filePath, VIDEOS_DIR);
        const validatedThumbnailPath = validateImagePath(tempThumbnailPath);

        // Use execFileSafe to prevent command injection
        await execFileSafe("ffmpeg", [
          "-i",
          validatedFilePath,
          "-ss",
          "00:00:00",
          "-vframes",
          "1",
          validatedThumbnailPath,
        ]);
      } catch (error) {
        logger.error("Error generating thumbnail:", error);
        // Continue without thumbnail - don't block the scan
      }
    }

    // Get duration
    let duration = undefined;
    try {
      // Validate path before using it
      const validatedFilePath = resolveSafePath(filePath, VIDEOS_DIR);

      // Use execFileSafe to prevent command injection
      const { stdout } = await execFileSafe("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        validatedFilePath,
      ]);

      const durationOutput = stdout.trim();
      if (durationOutput) {
        const durationSec = parseFloat(durationOutput);
        if (!isNaN(durationSec)) {
          duration = Math.round(durationSec).toString();
        }
      }
    } catch (err) {
      logger.error("Error getting duration:", err);
    }

    // Keep original video filename - don't rename
    const finalVideoFilename = filename;
    const finalVideoPath = filePath;
    const finalWebPath = webPath;

    // Handle thumbnail file - prioritize TMDB poster if available
    // Use TMDB-generated filename if available, otherwise use pre-generated one
    const tmdbThumbnailFilename = (tmdbMetadata as any)?.thumbnailFilename;
    let finalThumbnailFilename = newThumbnailFilename;
    let finalThumbnailPathValue: string | undefined;
    let finalThumbnailUrl: string | undefined;

    // If TMDB provided a poster, use it
    if (
      tmdbMetadata?.thumbnailPath &&
      tmdbMetadata.thumbnailPath.startsWith("/images/")
    ) {
      // Use the filename/path from TMDB metadata (it already includes the correct path)
      if (tmdbThumbnailFilename) {
        // tmdbThumbnailFilename is the relative path from IMAGES_DIR (may include subdirectory)
        const tmdbFilePath = path.join(
          IMAGES_DIR,
          tmdbThumbnailFilename.replace(/\//g, path.sep),
        );
        if (fs.existsSync(tmdbFilePath)) {
          finalThumbnailFilename = path.basename(tmdbThumbnailFilename);
          finalThumbnailPathValue = tmdbMetadata.thumbnailPath;
          finalThumbnailUrl =
            tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath;
          logger.info(
            `Using TMDB poster for "${filename}" (saved as: ${tmdbThumbnailFilename})`,
          );
        } else {
          // File doesn't exist at expected location, but use metadata path anyway
          finalThumbnailFilename = path.basename(tmdbMetadata.thumbnailPath);
          finalThumbnailPathValue = tmdbMetadata.thumbnailPath;
          finalThumbnailUrl =
            tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath;
          logger.warn(
            `TMDB poster path doesn't exist, using metadata path: ${tmdbMetadata.thumbnailPath}`,
          );
        }
      } else {
        // No filename in metadata, extract from thumbnailPath
        const pathFromMetadata = tmdbMetadata.thumbnailPath.replace(
          "/images/",
          "",
        );
        finalThumbnailFilename = path.basename(pathFromMetadata);
        finalThumbnailPathValue = tmdbMetadata.thumbnailPath;
        finalThumbnailUrl =
          tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath;
        logger.info(
          `Using TMDB poster path from metadata: ${tmdbMetadata.thumbnailPath}`,
        );
      }
    } else {
      // Otherwise, handle the ffmpeg-generated thumbnail
      const targetThumbnailPath = path.join(IMAGES_DIR, finalThumbnailFilename);
      try {
        if (fs.existsSync(tempThumbnailPath)) {
          if (
            fs.existsSync(targetThumbnailPath) &&
            tempThumbnailPath !== targetThumbnailPath
          ) {
            // If target exists, remove the temp one
            fs.removeSync(tempThumbnailPath);
            logger.warn(
              `Thumbnail filename already exists: ${finalThumbnailFilename}, using existing`,
            );
          } else if (tempThumbnailPath !== targetThumbnailPath) {
            // Rename the thumbnail file
            fs.moveSync(tempThumbnailPath, targetThumbnailPath);
            logger.info(
              `Renamed thumbnail file to "${finalThumbnailFilename}"`,
            );
          }
          finalThumbnailPathValue = `/images/${finalThumbnailFilename}`;
          finalThumbnailUrl = `/images/${finalThumbnailFilename}`;
        }
      } catch (renameError) {
        logger.error(`Error renaming thumbnail file: ${renameError}`);
        // Use temp filename if rename fails
        if (fs.existsSync(tempThumbnailPath)) {
          finalThumbnailFilename = path.basename(tempThumbnailPath);
          finalThumbnailPathValue = `/images/${finalThumbnailFilename}`;
          finalThumbnailUrl = `/images/${finalThumbnailFilename}`;
        }
      }
    }

    // Use production year January 1st for scraped videos, otherwise use created date
    let finalDateString: string;
    if (tmdbMetadata?.year) {
      // Use production year January 1st (YYYY0101 format)
      finalDateString = `${tmdbMetadata.year}0101`;
    } else {
      // Use created date year January 1st if no TMDB year, or fallback to actual created date
      const createdYear = createdDate.getFullYear();
      finalDateString = `${createdYear}0101`;
    }

    // For createdAt, use production year January 1st if TMDB year is available, otherwise use file created date
    let finalCreatedAt: Date;
    if (tmdbMetadata?.year) {
      // Create date object for production year January 1st
      const productionYear = parseInt(tmdbMetadata.year, 10);
      if (!isNaN(productionYear)) {
        finalCreatedAt = new Date(productionYear, 0, 1); // January 1st (month 0)
      } else {
        finalCreatedAt = createdDate;
      }
    } else {
      finalCreatedAt = createdDate;
    }

    const newVideo = {
      id: videoId,
      title: finalDisplayTitle,
      author: author,
      description: finalDescription,
      source: "local",
      sourceUrl: "",
      videoFilename: finalVideoFilename,
      videoPath: finalWebPath,
      thumbnailFilename: finalThumbnailPathValue
        ? finalThumbnailFilename
        : undefined,
      thumbnailPath: finalThumbnailPathValue,
      thumbnailUrl: finalThumbnailUrl,
      rating: tmdbMetadata?.rating,
      createdAt: finalCreatedAt.toISOString(),
      addedAt: new Date().toISOString(),
      date: finalDateString,
      duration: duration,
      fileSize: fileSize,
    };

    storageService.saveVideo(newVideo);
    addedCount++;

    // Check if video is in a subfolder
    const dirName = path.dirname(relativePath);
    if (dirName !== ".") {
      const collectionName = dirName.split(path.sep)[0];

      let collectionId: string | undefined;
      const allCollections = storageService.getCollections();
      const existingCollection = allCollections.find(
        (c) => c.title === collectionName || c.name === collectionName,
      );

      if (existingCollection) {
        collectionId = existingCollection.id;
      } else {
        collectionId = (
          Date.now() + Math.floor(Math.random() * 10000)
        ).toString();
        const newCollection = {
          id: collectionId,
          title: collectionName,
          name: collectionName,
          videos: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        storageService.saveCollection(newCollection);
        logger.info(`Created new collection from folder: ${collectionName}`);
      }

      if (collectionId) {
        storageService.addVideoToCollection(collectionId, newVideo.id);
        logger.info(
          `Added video ${newVideo.title} to collection ${collectionName}`,
        );
      }
    }
  }

  const message = `Scan complete. Added ${addedCount} new videos. Deleted ${deletedCount} missing videos.`;
  logger.info(message);

  // Return format expected by frontend: { addedCount, deletedCount }
  res.status(200).json({ addedCount, deletedCount });
};

/**
 * Helper function to process video files from a directory
 * Reusable logic for scanning directories
 */
const processDirectoryFiles = async (
  directory: string,
  existingFilenames: Set<string>,
  videoExtensions: string[],
  isMountDirectory: boolean = false,
): Promise<{ addedCount: number; allFiles: string[] }> => {
  let addedCount = 0;
  const allFiles: string[] = [];

  // Normalize directory path
  const normalizedDirectory = path.resolve(path.normalize(directory));

  if (!fs.existsSync(normalizedDirectory)) {
    logger.warn(`Directory does not exist: ${normalizedDirectory}`);
    return { addedCount: 0, allFiles: [] };
  }

  try {
    // Use mount directory function if this is a mount directory scan
    const files = isMountDirectory
      ? getFilesRecursivelyFromMount(normalizedDirectory)
      : getFilesRecursively(normalizedDirectory);
    allFiles.push(...files);

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      if (!videoExtensions.includes(ext)) continue;

      const filename = path.basename(filePath);
      const relativePath = path.relative(normalizedDirectory, filePath);

      // Check if exists in DB by original filename
      if (existingFilenames.has(filename)) {
        continue;
      }

      const stats = fs.statSync(filePath);

      // Skip 0-byte files to prevent importing empty/incomplete videos
      if (stats.size === 0) {
        logger.warn(`Skipping 0-byte video file: ${filePath}`);
        continue;
      }

      const createdDate = stats.birthtime;
      const fileSize = stats.size.toString();

      // Extract title from filename
      const originalTitle = path.parse(filename).name;
      const dateString = createdDate
        .toISOString()
        .split("T")[0]
        .replace(/-/g, "");

      // Try to scrape metadata and poster from TMDB first to get director/author
      let tmdbMetadata = null;
      let tempThumbnailFilename = `${formatVideoFilename(originalTitle, "Admin", dateString)}.jpg`;
      try {
        tmdbMetadata = await scrapeMetadataFromTMDB(
          filename,
          tempThumbnailFilename,
        );
      } catch (error) {
        logger.error(`Error scraping TMDB metadata for "${filename}":`, error);
      }

      // Use director from TMDB metadata as author, fallback to "Admin"
      const author = tmdbMetadata?.director || "Admin";

      // Use original title for database (for display purposes)
      const displayTitle = originalTitle || "Untitled Video";

      logger.info(`Found new video file: ${relativePath}`);
      const videoId = (
        Date.now() + Math.floor(Math.random() * 10000)
      ).toString();

      // Generate thumbnail filename based on original filename (without extension)
      const thumbnailBaseName = path.parse(filename).name;
      const newThumbnailFilename = `${thumbnailBaseName}.jpg`;

      // Use scraped title if available, otherwise use original title
      const finalDisplayTitle = tmdbMetadata?.title || displayTitle;
      const finalDescription = tmdbMetadata?.description;

      // Generate thumbnail with temporary name first (only if TMDB didn't provide one)
      const tempThumbnailPath = path.join(
        IMAGES_DIR,
        `${path.parse(filename).name}.jpg`,
      );

      // Only generate thumbnail with ffmpeg if TMDB didn't provide a poster
      if (!tmdbMetadata?.thumbnailPath && !tmdbMetadata?.thumbnailUrl) {
        // For mount directories, validate path differently (must be absolute, no traversal)
        // For regular directories, use resolveSafePath
        let safeFilePath: string | null = null;
        if (isMountDirectory) {
          // Mount directory: validate it's absolute and doesn't contain traversal
          if (
            path.isAbsolute(filePath) &&
            !filePath.includes("..") &&
            !filePath.includes("\0")
          ) {
            safeFilePath = path.resolve(filePath);
          } else {
            logger.warn(
              `Skipping thumbnail generation for unsafe mount path: ${filePath}`,
            );
          }
        } else {
          // Regular directory: use resolveSafePath
          try {
            safeFilePath = resolveSafePath(filePath, VIDEOS_DIR);
          } catch (err) {
            logger.warn(
              `Skipping thumbnail generation for unsafe path: ${filePath}`,
            );
          }
        }

        if (safeFilePath) {
          const safeThumbnailPath = validateImagePath(tempThumbnailPath);

          await new Promise<void>((resolve) => {
            // Use execFile instead of exec to prevent command injection
            execFile(
              "ffmpeg",
              [
                "-i",
                safeFilePath!,
                "-ss",
                "00:00:00",
                "-vframes",
                "1",
                safeThumbnailPath,
              ],
              (error) => {
                if (error) {
                  logger.error("Error generating thumbnail:", error);
                  resolve();
                } else {
                  resolve();
                }
              },
            );
          });
        }
      }

      // Get duration
      let duration = undefined;
      try {
        // For mount directories, validate path differently (must be absolute, no traversal)
        // For regular directories, use resolveSafePath
        let safeFilePath: string | null = null;
        if (isMountDirectory) {
          // Mount directory: validate it's absolute and doesn't contain traversal
          if (
            path.isAbsolute(filePath) &&
            !filePath.includes("..") &&
            !filePath.includes("\0")
          ) {
            safeFilePath = path.resolve(filePath);
          } else {
            logger.warn(
              `Skipping duration extraction for unsafe mount path: ${filePath}`,
            );
          }
        } else {
          // Regular directory: use resolveSafePath
          try {
            safeFilePath = resolveSafePath(filePath, VIDEOS_DIR);
          } catch (err) {
            logger.warn(
              `Skipping duration extraction for unsafe path: ${filePath}`,
            );
          }
        }

        if (safeFilePath) {
          const durationOutput = await new Promise<string>(
            (resolve, reject) => {
              // Use execFile instead of exec to prevent command injection
              execFile(
                "ffprobe",
                [
                  "-v",
                  "error",
                  "-show_entries",
                  "format=duration",
                  "-of",
                  "default=noprint_wrappers=1:nokey=1",
                  safeFilePath!,
                ],
                (error, stdout, _stderr) => {
                  if (error) {
                    reject(error);
                  } else {
                    resolve(stdout.toString().trim());
                  }
                },
              );
            },
          );
          if (durationOutput) {
            const durationSec = parseFloat(durationOutput);
            if (!isNaN(durationSec)) {
              duration = Math.round(durationSec).toString();
            }
          }
        }
      } catch (err) {
        logger.error("Error getting duration:", err);
      }

      // Construct web path - use mount: prefix only for mount directories
      const webPath = isMountDirectory
        ? `mount:${filePath}`
        : `/videos/${relativePath}`;

      // Handle thumbnail file - prioritize TMDB poster if available
      const tmdbThumbnailFilename = (tmdbMetadata as any)?.thumbnailFilename;
      let finalThumbnailFilename = newThumbnailFilename;
      let finalThumbnailPathValue: string | undefined;
      let finalThumbnailUrl: string | undefined;

      // If TMDB provided a poster, use it
      if (
        tmdbMetadata?.thumbnailPath &&
        tmdbMetadata.thumbnailPath.startsWith("/images/")
      ) {
        if (tmdbThumbnailFilename) {
          // Validate path to prevent path traversal
          const safeTmdbFilePath = validateImagePath(
            path.join(
              IMAGES_DIR,
              tmdbThumbnailFilename.replace(/\//g, path.sep),
            ),
          );
          if (fs.existsSync(safeTmdbFilePath)) {
            finalThumbnailFilename = path.basename(tmdbThumbnailFilename);
            finalThumbnailPathValue = tmdbMetadata.thumbnailPath;
            finalThumbnailUrl =
              tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath;
          } else {
            finalThumbnailFilename = path.basename(tmdbMetadata.thumbnailPath);
            finalThumbnailPathValue = tmdbMetadata.thumbnailPath;
            finalThumbnailUrl =
              tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath;
          }
        } else {
          const pathFromMetadata = tmdbMetadata.thumbnailPath.replace(
            "/images/",
            "",
          );
          finalThumbnailFilename = path.basename(pathFromMetadata);
          finalThumbnailPathValue = tmdbMetadata.thumbnailPath;
          finalThumbnailUrl =
            tmdbMetadata.thumbnailUrl || tmdbMetadata.thumbnailPath;
        }
      } else {
        // Handle ffmpeg-generated thumbnail
        // Validate paths to prevent path traversal
        const safeTargetThumbnailPath = validateImagePath(
          path.join(IMAGES_DIR, finalThumbnailFilename),
        );
        const safeTempThumbnailPath = validateImagePath(tempThumbnailPath);
        try {
          if (fs.existsSync(safeTempThumbnailPath)) {
            if (
              fs.existsSync(safeTargetThumbnailPath) &&
              safeTempThumbnailPath !== safeTargetThumbnailPath
            ) {
              fs.removeSync(safeTempThumbnailPath);
            } else if (safeTempThumbnailPath !== safeTargetThumbnailPath) {
              fs.moveSync(safeTempThumbnailPath, safeTargetThumbnailPath);
            }
            finalThumbnailPathValue = `/images/${finalThumbnailFilename}`;
            finalThumbnailUrl = `/images/${finalThumbnailFilename}`;
          }
        } catch (renameError) {
          logger.error(`Error renaming thumbnail file: ${renameError}`);
          if (fs.existsSync(tempThumbnailPath)) {
            finalThumbnailFilename = path.basename(tempThumbnailPath);
            finalThumbnailPathValue = `/images/${finalThumbnailFilename}`;
            finalThumbnailUrl = `/images/${finalThumbnailFilename}`;
          }
        }
      }

      // Use production year January 1st for scraped videos, otherwise use created date
      let finalDateString: string;
      if (tmdbMetadata?.year) {
        finalDateString = `${tmdbMetadata.year}0101`;
      } else {
        const createdYear = createdDate.getFullYear();
        finalDateString = `${createdYear}0101`;
      }

      // For createdAt, use production year January 1st if TMDB year is available
      let finalCreatedAt: Date;
      if (tmdbMetadata?.year) {
        const productionYear = parseInt(tmdbMetadata.year, 10);
        if (!isNaN(productionYear)) {
          finalCreatedAt = new Date(productionYear, 0, 1);
        } else {
          finalCreatedAt = createdDate;
        }
      } else {
        finalCreatedAt = createdDate;
      }

      const newVideo = {
        id: videoId,
        title: finalDisplayTitle,
        author: author,
        description: finalDescription,
        source: "local",
        sourceUrl: "",
        videoFilename: filename,
        videoPath: webPath,
        thumbnailFilename: finalThumbnailPathValue
          ? finalThumbnailFilename
          : undefined,
        thumbnailPath: finalThumbnailPathValue,
        thumbnailUrl: finalThumbnailUrl,
        rating: tmdbMetadata?.rating,
        createdAt: finalCreatedAt.toISOString(),
        addedAt: new Date().toISOString(),
        date: finalDateString,
        duration: duration,
        fileSize: fileSize,
      };

      storageService.saveVideo(newVideo);
      existingFilenames.add(filename); // Mark as added to avoid duplicates
      addedCount++;

      // Check if video is in a subfolder
      const dirName = path.dirname(relativePath);
      if (dirName !== ".") {
        const collectionName = dirName.split(path.sep)[0];

        let collectionId: string | undefined;
        const allCollections = storageService.getCollections();
        const existingCollection = allCollections.find(
          (c) => c.title === collectionName || c.name === collectionName,
        );

        if (existingCollection) {
          collectionId = existingCollection.id;
        } else {
          collectionId = (
            Date.now() + Math.floor(Math.random() * 10000)
          ).toString();
          const newCollection = {
            id: collectionId,
            title: collectionName,
            name: collectionName,
            videos: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          storageService.saveCollection(newCollection);
          logger.info(`Created new collection from folder: ${collectionName}`);
        }

        if (collectionId) {
          storageService.addVideoToCollection(collectionId, newVideo.id);
          logger.info(
            `Added video ${newVideo.title} to collection ${collectionName}`,
          );
        }
      }
    }
  } catch (error) {
    logger.error(`Error scanning directory ${directory}:`, error);
  }

  return { addedCount, allFiles };
};

/**
 * Scan mount directories for video files
 * Accepts array of directory paths in request body: { directories: string[] }
 */
export const scanMountDirectories = async (
  req: Request,
  res: Response,
): Promise<void> => {
  logger.info("Starting mount directories scan...");

  const { directories } = req.body;

  if (!directories || !Array.isArray(directories) || directories.length === 0) {
    res
      .status(400)
      .json({ error: "Directories array is required and must not be empty" });
    return;
  }

  // Filter out empty strings and trim
  const validDirectories = directories
    .map((dir: string) => dir.trim())
    .filter((dir: string) => dir.length > 0);

  if (validDirectories.length === 0) {
    res.status(400).json({ error: "No valid directories provided" });
    return;
  }

  logger.info(
    `Scanning ${validDirectories.length} mount directory/directories: ${validDirectories.join(", ")}`,
  );

  // 1. Get all existing videos from DB
  const existingVideos = storageService.getVideos();
  const existingFilenames = new Set<string>();

  // Track existing filenames
  for (const v of existingVideos) {
    if (v.videoFilename) {
      existingFilenames.add(v.videoFilename);
    }
  }

  const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov"];
  let totalAddedCount = 0;
  const actualFilesOnDisk = new Set<string>();

  // 2. Scan each directory
  for (const directory of validDirectories) {
    const { addedCount, allFiles } = await processDirectoryFiles(
      directory,
      existingFilenames,
      videoExtensions,
      true, // isMountDirectory = true
    );

    totalAddedCount += addedCount;

    // Track all found files
    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (videoExtensions.includes(ext)) {
        actualFilesOnDisk.add(path.basename(filePath));
      }
    }
  }

  // 3. Check for missing videos (only those that were in the scanned directories)
  // Note: We're not deleting videos from the default VIDEOS_DIR, only checking mount directories
  let deletedCount = 0;
  const videosToDelete: string[] = [];

  // Only check videos that might have come from mount directories
  // We'll check if the videoPath exists in any of the scanned directories
  // Normalize all directory paths for comparison
  const normalizedDirectories = validDirectories.map((dir: string) => {
    try {
      return path.resolve(path.normalize(dir));
    } catch {
      return dir;
    }
  });

  for (const v of existingVideos) {
    if (v.videoFilename && v.videoPath) {
      // Extract actual path from mount: prefix if present
      let actualVideoPath = v.videoPath;
      if (actualVideoPath.startsWith("mount:")) {
        actualVideoPath = actualVideoPath.substring(6); // Remove "mount:" prefix
      }

      // Normalize video path and check if it's within any scanned directory
      let normalizedVideoPath: string;
      try {
        normalizedVideoPath = path.resolve(path.normalize(actualVideoPath));
      } catch {
        continue; // Skip if path can't be normalized
      }

      // Check if this video path is within any of the scanned directories
      const isInScannedDirectory = normalizedDirectories.some(
        (normalizedDir: string) => {
          try {
            // Check if video path starts with the directory path
            // This works because we've normalized both paths
            return (
              normalizedVideoPath.startsWith(normalizedDir + path.sep) ||
              normalizedVideoPath === normalizedDir
            );
          } catch {
            return false;
          }
        },
      );

      if (isInScannedDirectory && !actualFilesOnDisk.has(v.videoFilename)) {
        logger.info(
          `Video missing from mount directory: ${v.title} (${v.videoFilename})`,
        );
        videosToDelete.push(v.id);
      }
    }
  }

  // Delete missing videos
  for (const id of videosToDelete) {
    if (storageService.deleteVideo(id)) {
      deletedCount++;
    }
  }
  logger.info(`Deleted ${deletedCount} missing videos from mount directories.`);

  const message = `Mount directories scan complete. Added ${totalAddedCount} new videos. Deleted ${deletedCount} missing videos.`;
  logger.info(message);

  // Return format expected by frontend: { addedCount, deletedCount }
  res.status(200).json({ addedCount: totalAddedCount, deletedCount });
};
