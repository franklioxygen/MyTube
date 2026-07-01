import path from "path";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { cleanupSubtitleFiles } from "../../../utils/downloadUtils";
import { logger } from "../../../utils/logger";
import {
  copyFileSafeSync,
  ensureDirSafeSync,
  readFileSafeSync,
  readdirSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../../../utils/security";
import { YtDlpDownloaderHelper } from "./ytdlpDownloaderHelper";

/**
 * Process subtitle files downloaded by yt-dlp.
 *
 * @param baseFilename - Stem used to identify subtitle files (without extension)
 * @param downloadId - Active download ID for cancellation checks
 * @param moveSubtitlesToVideoFolder - Whether to keep subtitles alongside the video
 * @param videoSourceDir - Directory where yt-dlp wrote the subtitle files (default: VIDEOS_DIR).
 *   For template-based downloads the video lives in a sub-directory; pass that dir so we scan
 *   the right place.
 * @param subtitleDestDir - Absolute destination directory for subtitle files (default: derived
 *   from moveSubtitlesToVideoFolder).
 * @param subtitleWebDir - Web path prefix for subtitle files (default: derived from flags).
 */
export async function processSubtitles(
  baseFilename: string,
  downloadId?: string,
  moveSubtitlesToVideoFolder: boolean = false,
  videoSourceDir?: string,
  subtitleDestDir?: string,
  subtitleWebDir?: string,
): Promise<Array<{ language: string; filename: string; path: string }>> {
  const subtitles: Array<{ language: string; filename: string; path: string }> =
    [];

  logger.info(
    `Processing subtitles for ${baseFilename}, move to video folder: ${moveSubtitlesToVideoFolder}`,
  );

  const downloader = new YtDlpDownloaderHelper();

  // Resolve search and destination directories
  const primarySearchDir = videoSourceDir || VIDEOS_DIR;
  const resolvedDestDir = subtitleDestDir || (moveSubtitlesToVideoFolder ? VIDEOS_DIR : SUBTITLES_DIR);
  const resolvedWebDir = subtitleWebDir || (moveSubtitlesToVideoFolder ? "/videos" : "/subtitles");

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
    // Search in primary dir (video dir) and also the legacy SUBTITLES_DIR fallback
    const searchDirs = primarySearchDir === VIDEOS_DIR
      ? [VIDEOS_DIR, SUBTITLES_DIR]
      : [primarySearchDir, VIDEOS_DIR, SUBTITLES_DIR];
    const subtitleFiles: Array<{ dir: string; file: string }> = [];
    const seenFiles = new Set<string>();

    for (const dir of searchDirs) {
      const files = readdirSafeSync(dir, [VIDEOS_DIR, SUBTITLES_DIR]).filter((file: string) => {
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

      // Parse language from filename: only the segment immediately before the extension
      // (e.g. video_123.en.vtt -> en; Title.With.Dots-2026.ko.vtt -> ko, not "is" from "is")
      const ext = path.extname(subtitleFile);
      const withoutExt = subtitleFile.slice(0, -ext.length);
      const lastSegment = withoutExt.split(".").pop() ?? "";
      const langMatch = lastSegment.match(/^([a-z]{2}(?:-[A-Z]{2})?)$/);
      const language = langMatch ? langMatch[1] : "unknown";
      const extension = ext;

      // Move subtitle to destination directory
      const sourceSubPath = resolveSafeChildPath(dir, subtitleFile);
      const destSubFilename = `${baseFilename}.${language}${extension}`;
      const destinationDir = resolvedDestDir;
      const destSubPath = resolveSafeChildPath(destinationDir, destSubFilename);
      const webPath = `${resolvedWebDir}/${destSubFilename}`;

      try {
        ensureDirSafeSync(destinationDir, [VIDEOS_DIR, SUBTITLES_DIR]);

        if (extension.toLowerCase() === ".vtt") {
          // Read VTT file and fix alignment for centering
          let vttContent = readFileSafeSync(sourceSubPath, [VIDEOS_DIR, SUBTITLES_DIR], "utf-8");
          // Replace align:start with align:middle for centered subtitles
          // Also remove position:0% which forces left positioning
          vttContent = vttContent.replace(/ align:start/g, " align:middle");
          vttContent = vttContent.replace(/ position:0%/g, "");

          // Write cleaned VTT to destination
          writeFileSafeSync(destSubPath, [VIDEOS_DIR, SUBTITLES_DIR], vttContent, "utf-8");
        } else if (sourceSubPath !== destSubPath) {
          copyFileSafeSync(sourceSubPath, [VIDEOS_DIR, SUBTITLES_DIR], destSubPath, [VIDEOS_DIR, SUBTITLES_DIR]);
        }

        // Remove original file if we moved it (if dest is different from source)
        if (sourceSubPath !== destSubPath) {
          unlinkSafeSync(sourceSubPath, [VIDEOS_DIR, SUBTITLES_DIR]);
        }

        logger.info(
          `Processed and moved subtitle ${subtitleFile} to ${destSubPath}`,
        );

        subtitles.push({
          language,
          filename: destSubFilename,
          path: webPath,
        });
      } catch (subtitleFileError) {
        await downloader.handleCancellationErrorPublic(subtitleFileError);
        logger.warn(`Skipping subtitle file ${subtitleFile}:`, subtitleFileError);
      }
    }
  } catch (subtitleError) {
    // If it's a cancellation error, re-throw it
    await downloader.handleCancellationErrorPublic(subtitleError);
    logger.error("Error processing subtitle files:", subtitleError);
  }

  return subtitles;
}
