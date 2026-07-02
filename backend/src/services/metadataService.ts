import { eq } from "drizzle-orm";
import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { db } from "../db";
import { videos } from "../db/schema";
import { ExecutionError, FileError } from "../errors/DownloadErrors";
import { bumpVideosListRevision } from "./storageService/videoListRevision";
import {
  execFileSafe,
  pathExistsSafeSync,
  resolveSafeChildPath,
  validateVideoPath,
} from "../utils/security";
import { logger } from "../utils/logger";

const TEMPORARY_VIDEO_ARTIFACT_PATTERN = /(\.temp\.)|(\.part$)|(\.ytdl$)|(\.f\d+\.)/i;

const isTemporaryVideoArtifact = (filePath: string): boolean => {
  return TEMPORARY_VIDEO_ARTIFACT_PATTERN.test(path.basename(filePath));
};

export const getVideoDuration = async (
  filePath: string,
): Promise<number | null> => {
  try {
    const validatedPath = validateVideoPath(filePath);

    // Check if file exists first
    if (!pathExistsSafeSync(validatedPath, VIDEOS_DIR)) {
      throw FileError.notFound(validatedPath);
    }

    // Use execFileSafe to prevent command injection
    const { stdout } = await execFileSafe("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      validatedPath,
    ]);

    const duration = stdout.trim();
    if (duration) {
      const durationSec = parseFloat(duration);
      if (!isNaN(durationSec)) {
        return Math.round(durationSec);
      }
    }
    return null;
  } catch (error) {
    // Re-throw our custom errors
    if (error instanceof FileError || error instanceof ExecutionError) {
      throw error;
    }
    // Wrap unknown errors
    logger.error(`Error getting duration for ${filePath}:`, error);
    return null;
  }
};

export const getVideoHeight = async (
  filePath: string,
): Promise<number | null> => {
  try {
    const validatedPath = validateVideoPath(filePath);

    // Check if file exists first
    if (!pathExistsSafeSync(validatedPath, VIDEOS_DIR)) {
      throw FileError.notFound(validatedPath);
    }

    // Read the height of the first video stream.
    const { stdout } = await execFileSafe("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=height",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      validatedPath,
    ]);

    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) {
      const height = parseInt(firstLine, 10);
      if (!isNaN(height) && height > 0) {
        return height;
      }
    }
    return null;
  } catch (error) {
    // Re-throw our custom errors
    if (error instanceof FileError || error instanceof ExecutionError) {
      throw error;
    }
    // Wrap unknown errors
    logger.error(`Error getting height for ${filePath}:`, error);
    return null;
  }
};

export const backfillDurations = async () => {
  logger.info("Starting duration backfill...");

  try {
    const allVideos = await db.select().from(videos).all();
    logger.info(`Found ${allVideos.length} videos to check for duration.`);

    let updatedCount = 0;

    for (const video of allVideos) {
      if (video.duration) {
        continue;
      }

      let videoPath = video.videoPath;
      if (!videoPath) continue;

      let fsPath = "";
      if (videoPath.startsWith("/videos/")) {
        const relativePath = videoPath.replace("/videos/", "");
        fsPath = resolveSafeChildPath(VIDEOS_DIR, relativePath);
      } else {
        continue;
      }

      if (!pathExistsSafeSync(fsPath, VIDEOS_DIR)) {
        // logger.warn(`File not found: ${fsPath}`); // Reduce noise
        continue;
      }

      if (isTemporaryVideoArtifact(fsPath)) {
        continue;
      }

      const duration = await getVideoDuration(fsPath);

      if (duration !== null) {
        db.update(videos)
          .set({ duration: duration.toString() })
          .where(eq(videos.id, video.id))
          .run();
        logger.info(`Updated duration for ${video.title}: ${duration}s`);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      // The backfill runs async after startup and can finish after the first
      // list requests were served, so the list ETag must move.
      bumpVideosListRevision();
      logger.info(
        `Duration backfill finished. Updated ${updatedCount} videos.`,
      );
    } else {
      logger.info("Duration backfill finished. No videos needed update.");
    }
  } catch (error) {
    logger.error("Error during duration backfill:", error);
  }
};
