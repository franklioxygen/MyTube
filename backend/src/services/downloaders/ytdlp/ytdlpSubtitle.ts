import fs from "fs-extra";
import path from "path";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { cleanupSubtitleFiles } from "../../../utils/downloadUtils";
import { logger } from "../../../utils/logger";
import { BaseDownloader } from "../BaseDownloader";

// Helper class to access BaseDownloader methods without circular dependency
class YtDlpDownloaderHelper extends BaseDownloader {
  async getVideoInfo(): Promise<any> {
    throw new Error("Not implemented");
  }
  async downloadVideo(): Promise<any> {
    throw new Error("Not implemented");
  }

  // Expose protected methods as public for use in module functions
  public handleCancellationErrorPublic(
    error: unknown,
    cleanupFn?: () => void | Promise<void>
  ): Promise<void> {
    return this.handleCancellationError(error, cleanupFn);
  }

  public throwIfCancelledPublic(downloadId?: string): void {
    return this.throwIfCancelled(downloadId);
  }
}

/**
 * Process subtitle files downloaded by yt-dlp
 */
export async function processSubtitles(
  baseFilename: string,
  downloadId?: string,
  moveSubtitlesToVideoFolder: boolean = false
): Promise<Array<{ language: string; filename: string; path: string }>> {
  const subtitles: Array<{ language: string; filename: string; path: string }> =
    [];

  logger.info(
    `Processing subtitles for ${baseFilename}, move to video folder: ${moveSubtitlesToVideoFolder}`
  );

  const downloader = new YtDlpDownloaderHelper();

  try {
    const subtitleExtensions = new Set([
      ".vtt",
      ".srt",
      ".ass",
      ".ssa",
      ".sub",
      ".ttml",
      ".dfxp",
      ".sbv",
    ]);
    const searchDirs = [VIDEOS_DIR, SUBTITLES_DIR];
    const subtitleFiles: Array<{ dir: string; file: string }> = [];
    const seenFiles = new Set<string>();

    for (const dir of searchDirs) {
      const files = fs.readdirSync(dir).filter((file: string) => {
        const ext = path.extname(file).toLowerCase();
        return file.startsWith(baseFilename) && subtitleExtensions.has(ext);
      });

      for (const file of files) {
        if (seenFiles.has(file)) {
          continue;
        }
        seenFiles.add(file);
        subtitleFiles.push({ dir, file });
      }
    }

    logger.info(`Found ${subtitleFiles.length} subtitle files`);

    for (const { dir, file: subtitleFile } of subtitleFiles) {
      // Check if download was cancelled during subtitle processing
      try {
        downloader.throwIfCancelledPublic(downloadId);
      } catch (error) {
        await cleanupSubtitleFiles(baseFilename);
        throw error;
      }

      // Parse language from filename (e.g., video_123.en.vtt -> en)
      const match = subtitleFile.match(
        /\.([a-z]{2}(?:-[A-Z]{2})?)(?:\..*?)?\.[^.]+$/
      );
      const language = match ? match[1] : "unknown";
      const extension = path.extname(subtitleFile);

      // Move subtitle to subtitles directory or keep in video directory if requested
      const sourceSubPath = path.join(dir, subtitleFile);
      const destSubFilename = `${baseFilename}.${language}${extension}`;
      let destSubPath: string;
      let webPath: string;

      if (moveSubtitlesToVideoFolder) {
        destSubPath = path.join(VIDEOS_DIR, destSubFilename);
        webPath = `/videos/${destSubFilename}`;
      } else {
        destSubPath = path.join(SUBTITLES_DIR, destSubFilename);
        webPath = `/subtitles/${destSubFilename}`;
      }

      if (extension.toLowerCase() === ".vtt") {
        // Read VTT file and fix alignment for centering
        let vttContent = fs.readFileSync(sourceSubPath, "utf-8");
        // Replace align:start with align:middle for centered subtitles
        // Also remove position:0% which forces left positioning
        vttContent = vttContent.replace(/ align:start/g, " align:middle");
        vttContent = vttContent.replace(/ position:0%/g, "");

        // Write cleaned VTT to destination
        fs.writeFileSync(destSubPath, vttContent, "utf-8");
      } else if (sourceSubPath !== destSubPath) {
        fs.copyFileSync(sourceSubPath, destSubPath);
      }

      // Remove original file if we moved it (if dest is different from source)
      // If moveSubtitlesToVideoFolder is true, destSubPath might be same as sourceSubPath
      // but with different name (e.g. video_uuid.en.vtt vs video_uuid.vtt)
      // Actually source is usually video_uuid.en.vtt (from yt-dlp) and dest is video_uuid.en.vtt
      // So if names are same and dir is same, we're just overwriting in place, which is fine
      if (sourceSubPath !== destSubPath) {
        fs.unlinkSync(sourceSubPath);
      }

      logger.info(
        `Processed and moved subtitle ${subtitleFile} to ${destSubPath}`
      );

      subtitles.push({
        language,
        filename: destSubFilename,
        path: webPath,
      });
    }
  } catch (subtitleError) {
    // If it's a cancellation error, re-throw it
    await downloader.handleCancellationErrorPublic(subtitleError);
    logger.error("Error processing subtitle files:", subtitleError);
  }

  return subtitles;
}
