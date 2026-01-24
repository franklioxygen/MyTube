import { eq } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { db } from "../db";
import { videos } from "../db/schema";
import { ExecutionError, FileError } from "../errors/DownloadErrors";
import { execFileSafe, validateVideoPath } from "../utils/security";

export const getVideoDuration = async (
  filePath: string,
): Promise<number | null> => {
  try {
    // Check if file exists first
    if (!fs.existsSync(filePath)) {
      throw FileError.notFound(filePath);
    }

    // Validate path to prevent path traversal
    const validatedPath = validateVideoPath(filePath);

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
    console.error(`Error getting duration for ${filePath}:`, error);
    return null;
  }
};

export const backfillDurations = async () => {
  console.log("Starting duration backfill...");

  try {
    const allVideos = await db.select().from(videos).all();
    console.log(`Found ${allVideos.length} videos to check for duration.`);

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
        fsPath = path.join(VIDEOS_DIR, relativePath);
      } else {
        continue;
      }

      if (!fs.existsSync(fsPath)) {
        // console.warn(`File not found: ${fsPath}`); // Reduce noise
        continue;
      }

      const duration = await getVideoDuration(fsPath);

      if (duration !== null) {
        db.update(videos)
          .set({ duration: duration.toString() })
          .where(eq(videos.id, video.id))
          .run();
        console.log(`Updated duration for ${video.title}: ${duration}s`);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(
        `Duration backfill finished. Updated ${updatedCount} videos.`,
      );
    } else {
      console.log("Duration backfill finished. No videos needed update.");
    }
  } catch (error) {
    console.error("Error during duration backfill:", error);
  }
};
