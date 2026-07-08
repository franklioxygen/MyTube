import { logger } from "../../utils/logger";

// Helper to safely execute files (prevent command injection)
export const execFileSafe = async (
  file: string,
  args: string[],
  options: any = {}
): Promise<void> => {
  const { execFile } = await import("child_process");
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`execFile error: ${error.message}`);
        logger.error(`stderr: ${stderr}`);
        reject(error);
        return;
      }
      resolve();
    });
  });
};

// Helper for video duration
export const getVideoDuration = async (
  videoPath: string
): Promise<number | undefined> => {
  try {
    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          videoPath,
        ],
        (error, stdout) => {
          if (error) {
            logger.error("ffprobe error:", error);
            resolve(undefined);
            return;
          }
          const duration = parseFloat(stdout);
          resolve(isNaN(duration) ? undefined : duration);
        }
      );
    });
  } catch (err) {
    logger.error("Failed to get video duration:", err);
    return undefined;
  }
};

export const getVideoDimensions = async (
  videoPath: string
): Promise<{ width: number; height: number } | undefined> => {
  try {
    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "csv=p=0:s=x",
          videoPath,
        ],
        (error, stdout) => {
          if (error) {
            logger.error("ffprobe dimensions error:", error);
            resolve(undefined);
            return;
          }

          const firstLine = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean);
          if (!firstLine) {
            resolve(undefined);
            return;
          }

          const [rawWidth, rawHeight] = firstLine
            .split(/[x,]/)
            .map((part) => part.trim());
          const width = Number.parseInt(rawWidth ?? "", 10);
          const height = Number.parseInt(rawHeight ?? "", 10);
          resolve(
            Number.isFinite(width) &&
              Number.isFinite(height) &&
              width > 0 &&
              height > 0
              ? { width, height }
              : undefined
          );
        }
      );
    });
  } catch (err) {
    logger.error("Failed to get video dimensions:", err);
    return undefined;
  }
};

export const uploadedFileHasVideoStream = async (
  videoPath: string
): Promise<boolean> => {
  try {
    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      execFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          videoPath,
        ],
        (error, stdout) => {
          if (error) {
            logger.error("ffprobe stream validation error:", error);
            resolve(false);
            return;
          }

          const streamTypes = stdout
            .split(/\r?\n/)
            .map((line) => line.trim().toLowerCase())
            .filter(Boolean);
          resolve(streamTypes.includes("video"));
        }
      );
    });
  } catch (err) {
    logger.error("Failed to validate uploaded video stream:", err);
    return false;
  }
};
