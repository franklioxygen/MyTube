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
  downloadId?: string
): Promise<Array<{ language: string; filename: string; path: string }>> {
  const subtitles: Array<{ language: string; filename: string; path: string }> =
    [];

  const downloader = new YtDlpDownloaderHelper();

  try {
    const subtitleFiles = fs
      .readdirSync(VIDEOS_DIR)
      .filter(
        (file: string) =>
          file.startsWith(baseFilename) && file.endsWith(".vtt")
      );

    logger.info(`Found ${subtitleFiles.length} subtitle files`);

    for (const subtitleFile of subtitleFiles) {
      // Check if download was cancelled during subtitle processing
      try {
        downloader.throwIfCancelledPublic(downloadId);
      } catch (error) {
        await cleanupSubtitleFiles(baseFilename);
        throw error;
      }

      // Parse language from filename (e.g., video_123.en.vtt -> en)
      const match = subtitleFile.match(
        /\.([a-z]{2}(?:-[A-Z]{2})?)(?:\..*?)?\.vtt$/
      );
      const language = match ? match[1] : "unknown";

      // Move subtitle to subtitles directory
      const sourceSubPath = path.join(VIDEOS_DIR, subtitleFile);
      const destSubFilename = `${baseFilename}.${language}.vtt`;
      const destSubPath = path.join(SUBTITLES_DIR, destSubFilename);

      // Read VTT file and fix alignment for centering
      let vttContent = fs.readFileSync(sourceSubPath, "utf-8");
      // Replace align:start with align:middle for centered subtitles
      // Also remove position:0% which forces left positioning
      vttContent = vttContent.replace(/ align:start/g, " align:middle");
      vttContent = vttContent.replace(/ position:0%/g, "");

      // Write cleaned VTT to destination
      fs.writeFileSync(destSubPath, vttContent, "utf-8");

      // Remove original file
      fs.unlinkSync(sourceSubPath);

      logger.info(
        `Processed and moved subtitle ${subtitleFile} to ${destSubPath}`
      );

      subtitles.push({
        language,
        filename: destSubFilename,
        path: `/subtitles/${destSubFilename}`,
      });
    }
  } catch (subtitleError) {
    // If it's a cancellation error, re-throw it
    await downloader.handleCancellationErrorPublic(subtitleError);
    logger.error("Error processing subtitle files:", subtitleError);
  }

  return subtitles;
}

