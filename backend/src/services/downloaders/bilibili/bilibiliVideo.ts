import fs from "fs-extra";
import path from "path";
import { DownloadCancelledError } from "../../../errors/DownloadErrors";
import { formatBytes } from "../../../utils/downloadUtils";
import { formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { ProgressTracker } from "../../../utils/progressTracker";
import {
  executeYtDlpJson,
  executeYtDlpSpawn,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import * as storageService from "../../storageService";
import { Video } from "../../storageService";
import { BaseDownloader } from "../BaseDownloader";
import { prepareBilibiliDownloadFlags } from "./bilibiliConfig";
import {
  cleanupFilesOnCancellation,
  cleanupTempDir,
  createTempDir,
  findVideoFileInTemp,
  moveVideoFile,
  prepareFilePaths,
  renameFilesWithMetadata,
} from "./bilibiliFileManager";
import {
  extractPartMetadata,
  getFileSize,
  getVideoDuration,
} from "./bilibiliMetadata";
import { downloadSubtitles } from "./bilibiliSubtitle";
import { BilibiliVideoInfo, DownloadResult } from "./types";

// Helper class to access BaseDownloader methods without circular dependency
class BilibiliDownloaderHelper extends BaseDownloader {
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

  public async downloadThumbnailPublic(
    thumbnailUrl: string,
    savePath: string
  ): Promise<boolean> {
    return this.downloadThumbnail(thumbnailUrl, savePath);
  }
}

/**
 * Core video download function using yt-dlp
 */
export async function downloadVideo(
  url: string,
  videoPath: string,
  thumbnailPath: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void
): Promise<BilibiliVideoInfo> {
  const tempDir = createTempDir();

  try {
    logger.info("Downloading Bilibili video using yt-dlp to:", tempDir);

    // Get video info first
    const userConfig = getUserYtDlpConfig(url);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    const info = await executeYtDlpJson(url, {
      ...networkConfig,
      noWarnings: true,
    });

    const videoTitle = info.title || "Bilibili Video";
    const videoAuthor = info.uploader || info.channel || "Bilibili User";
    const videoDate =
      info.upload_date ||
      info.release_date ||
      new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const thumbnailUrl = info.thumbnail || null;
    const description = info.description || "";

    // Prepare output path with a safe filename to avoid issues with special characters
    // Use a simple template that yt-dlp will fill in
    const outputTemplate = path.join(tempDir, "video.%(ext)s");

    // Prepare download flags using the config module
    const { flags } = prepareBilibiliDownloadFlags(url, outputTemplate);

    // Use spawn to capture stdout for progress
    const subprocess = executeYtDlpSpawn(url, flags);

    if (onStart) {
      onStart(async () => {
        logger.info("Killing subprocess for download:", downloadId);
        subprocess.kill();

        // Clean up partial files
        logger.info("Cleaning up partial files...");
        await cleanupFilesOnCancellation(videoPath, thumbnailPath, tempDir);
      });
    }

    // Track progress from stdout using ProgressTracker
    const progressTracker = new ProgressTracker(downloadId);
    subprocess.stdout?.on("data", (data: Buffer) => {
      progressTracker.parseAndUpdate(data.toString());
    });

    // Capture stderr for better error reporting
    let stderrOutput = "";
    subprocess.stderr?.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
      // Log stderr in real-time for debugging (filter out expected warnings)
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());
      for (const line of lines) {
        // Skip expected/informational messages
        if (
          line.includes("[download]") ||
          line.includes("[info]") ||
          line.includes("[ExtractAudio]") ||
          line.includes("[Merger]") ||
          line.includes("[BiliBili]") ||
          line.includes("Subtitles are only available when logged in") ||
          line.includes("Invalid data found when processing input")
        ) {
          continue;
        }
        logger.warn("yt-dlp stderr:", line);
      }
    });

    // Wait for download to complete
    let downloadError: any = null;
    try {
      await subprocess;
    } catch (error: any) {
      downloadError = error;
      // Only log as warning if it's an expected subtitle-related issue
      // "Invalid data found when processing input" is a real error, not expected
      const stderrMsg = error.stderr || "";
      const isExpectedSubtitleError = stderrMsg.includes(
        "Subtitles are only available when logged in"
      );
      if (isExpectedSubtitleError) {
        logger.warn("yt-dlp subtitle warning (continuing):", error.message);
      } else {
        logger.error("yt-dlp download failed:", error.message);
        if (error.stderr) {
          logger.error("yt-dlp error output:", error.stderr);
        }
      }
    }

    logger.info("Download completed, checking for video file");

    // Check if download was cancelled (it might have been removed from active downloads)
    // But only check this if we don't have a real yt-dlp error
    const downloader = new BilibiliDownloaderHelper();
    let wasCancelled = false;
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      wasCancelled = true;
      // If we have a download error, prefer showing that over cancellation
      if (!downloadError) {
        if (fs.existsSync(tempDir)) {
          fs.removeSync(tempDir);
        }
        throw error;
      }
    }

    // Check if file exists first
    const videoFile = findVideoFileInTemp(tempDir);

    // If there was a download error and no file was found, throw the error
    if (downloadError && !videoFile) {
      // Clean up temp directory
      await cleanupTempDir(tempDir);
      // If it was cancelled, throw cancellation error, otherwise throw the yt-dlp error
      if (wasCancelled) {
        throw DownloadCancelledError.create();
      }
      throw new Error(
        `yt-dlp download failed: ${
          downloadError.message || downloadError.stderr || "Unknown error"
        }`
      );
    }

    // If no file found and no error was caught, something went wrong
    if (!videoFile) {
      await cleanupTempDir(tempDir);
      const errorMsg = downloadError
        ? `Downloaded video file not found. yt-dlp error: ${
            downloadError.message
          }. stderr: ${(downloadError.stderr || "").substring(0, 500)}`
        : `Downloaded video file not found.`;
      throw new Error(errorMsg);
    }

    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      logger.info("Files in temp directory:", files);
    }

    // If there was an error but we found the file, log a warning but continue
    if (downloadError) {
      logger.warn(
        "yt-dlp reported an error but file was downloaded successfully:",
        videoFile
      );
    }

    logger.info("Found video file:", videoFile);

    // Get final file size for progress update
    const tempVideoPath = path.join(tempDir, videoFile);
    if (downloadId && fs.existsSync(tempVideoPath)) {
      const stats = fs.statSync(tempVideoPath);
      const finalSize = formatBytes(stats.size);
      storageService.updateActiveDownload(downloadId, {
        downloadedSize: finalSize,
        totalSize: finalSize,
        progress: 100,
        speed: "0 B/s",
      });
    }

    // Move the file to the desired location
    moveVideoFile(tempDir, videoFile, videoPath);

    // Clean up temp directory
    await cleanupTempDir(tempDir);

    // Download thumbnail if available
    let thumbnailSaved = false;
    if (thumbnailUrl) {
      // Use base class method via temporary instance
      const downloader = new BilibiliDownloaderHelper();
      thumbnailSaved = await downloader.downloadThumbnailPublic(
        thumbnailUrl,
        thumbnailPath
      );
    }

    return {
      title: videoTitle,
      author: videoAuthor,
      date: videoDate,
      thumbnailUrl: thumbnailUrl,
      thumbnailSaved,
      description,
    };
  } catch (error: any) {
    logger.error("Error in downloadBilibiliVideo:", error);

    // Make sure we clean up the temp directory if it exists
    await cleanupTempDir(tempDir);

    // Return a default object to prevent undefined errors
    return {
      title: "Bilibili Video",
      author: "Bilibili User",
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: null,
      thumbnailSaved: false,
      error: error.message,
    };
  }
}

/**
 * Download a single Bilibili part (video + metadata + subtitles)
 */
export async function downloadSinglePart(
  url: string,
  partNumber: number,
  totalParts: number,
  seriesTitle: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
  collectionName?: string
): Promise<DownloadResult> {
  try {
    logger.info(
      `Downloading Bilibili part ${partNumber}/${totalParts}: ${url}`
    );

    // Get user's yt-dlp configuration for merge output format
    const userConfig = getUserYtDlpConfig(url);
    const mergeOutputFormat = userConfig.mergeOutputFormat || "mp4";

    // Create a safe base filename (without extension)
    const timestamp = Date.now();

    // Prepare file paths using the file manager
    const { videoPath, thumbnailPath, videoDir, imageDir } = prepareFilePaths(
      mergeOutputFormat,
      collectionName
    );

    let videoTitle,
      videoAuthor,
      videoDate,
      videoDescription,
      thumbnailUrl,
      thumbnailSaved;

    // Download Bilibili video
    let bilibiliInfo: BilibiliVideoInfo;
    try {
      bilibiliInfo = await downloadVideo(
        url,
        videoPath,
        thumbnailPath,
        downloadId,
        onStart
      );
    } catch (error: any) {
      // If download was cancelled, re-throw immediately without downloading subtitles or creating video data
      const downloader = new BilibiliDownloaderHelper();
      downloader.handleCancellationErrorPublic(error);
      throw error;
    }

    if (!bilibiliInfo) {
      throw new Error("Failed to get Bilibili video info");
    }

    logger.info("Bilibili download info:", bilibiliInfo);

    // Extract channel URL and part-specific title from Bilibili API using metadata module
    const { channelUrl, partTitle } = await extractPartMetadata(
      url,
      partNumber,
      totalParts,
      seriesTitle,
      bilibiliInfo
    );

    // For multi-part videos, include the part number in the title
    videoTitle = totalParts > 1 ? `${partNumber} ${partTitle}` : partTitle;

    videoAuthor = bilibiliInfo.author || "Bilibili User";
    videoDate =
      bilibiliInfo.date ||
      new Date().toISOString().slice(0, 10).replace(/-/g, "");
    videoDescription = bilibiliInfo.description || "";
    thumbnailUrl = bilibiliInfo.thumbnailUrl;
    thumbnailSaved = bilibiliInfo.thumbnailSaved;

    // Check if download was cancelled before processing files
    const downloader = new BilibiliDownloaderHelper();
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      throw error;
    }

    // Rename files based on metadata using file manager
    const {
      newVideoPath,
      newThumbnailPath,
      finalVideoFilename,
      finalThumbnailFilename,
    } = renameFilesWithMetadata(
      videoTitle,
      videoAuthor,
      videoDate,
      mergeOutputFormat,
      videoPath,
      thumbnailPath,
      thumbnailSaved,
      videoDir,
      imageDir
    );

    // Get video duration and file size using metadata module
    const duration = await getVideoDuration(newVideoPath);
    const fileSize = getFileSize(newVideoPath);

    // Check if download was cancelled before downloading subtitles
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      throw error;
    }

    // Download subtitles
    // Get the base filename for subtitles (without extension)
    const newSafeBaseFilename = formatVideoFilename(
      videoTitle,
      videoAuthor,
      videoDate
    );

    let subtitles: Array<{
      language: string;
      filename: string;
      path: string;
    }> = [];
    try {
      logger.info("Attempting to download subtitles...");
      subtitles = await downloadSubtitles(
        url,
        newSafeBaseFilename,
        collectionName
      );
      logger.info(`Downloaded ${subtitles.length} subtitles`);
    } catch (e) {
      // If it's a cancellation error, re-throw it
      downloader.handleCancellationErrorPublic(e);
      logger.error("Error downloading subtitles:", e);
    }

    // Check if download was cancelled before creating video data
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      // Clean up any files that were created
      await cleanupFilesOnCancellation(newVideoPath, newThumbnailPath);
      throw DownloadCancelledError.create();
    }

    // Create metadata for the video
    // For multi-part videos, ensure each part gets a unique ID by including part number
    const uniqueId =
      totalParts > 1 ? `${timestamp}_part${partNumber}` : timestamp.toString();

    const videoData: Video = {
      id: uniqueId,
      title: videoTitle,
      author: videoAuthor,
      description: videoDescription,
      date: videoDate,
      source: "bilibili",
      sourceUrl: url,
      videoFilename: finalVideoFilename,
      thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      videoPath: collectionName
        ? `/videos/${collectionName}/${finalVideoFilename}`
        : `/videos/${finalVideoFilename}`,
      thumbnailPath: thumbnailSaved
        ? collectionName
          ? `/images/${collectionName}/${finalThumbnailFilename}`
          : `/images/${finalThumbnailFilename}`
        : null,
      duration: duration,
      fileSize: fileSize,
      channelUrl: channelUrl || undefined,
      addedAt: new Date().toISOString(),
      partNumber: partNumber,
      totalParts: totalParts,
      seriesTitle: seriesTitle,
      createdAt: new Date().toISOString(),
    };

    // For multi-part videos, always create a new video entry (each part is separate)
    // For single videos, check if video with same sourceUrl already exists
    if (totalParts === 1) {
      const existingVideo = storageService.getVideoBySourceUrl(url);

      if (existingVideo) {
        // Update existing video with new subtitle information and file paths
        logger.info(
          "Video with same sourceUrl exists, updating subtitle information"
        );

        // Use existing video's ID and preserve other fields
        videoData.id = existingVideo.id;
        videoData.addedAt = existingVideo.addedAt;
        videoData.createdAt = existingVideo.createdAt;

        const updatedVideo = storageService.updateVideo(existingVideo.id, {
          subtitles: subtitles.length > 0 ? subtitles : undefined,
          videoFilename: finalVideoFilename,
          videoPath: collectionName
            ? `/videos/${collectionName}/${finalVideoFilename}`
            : `/videos/${finalVideoFilename}`,
          thumbnailFilename: thumbnailSaved
            ? finalThumbnailFilename
            : existingVideo.thumbnailFilename,
          thumbnailPath: thumbnailSaved
            ? collectionName
              ? `/images/${collectionName}/${finalThumbnailFilename}`
              : `/images/${finalThumbnailFilename}`
            : existingVideo.thumbnailPath,
          duration: duration,
          fileSize: fileSize,
          title: videoData.title, // Update title in case it changed
          description: videoData.description, // Update description in case it changed
        });

        if (updatedVideo) {
          logger.info(`Video updated in database with new subtitles`);
          return { success: true, videoData: updatedVideo };
        }
      }
    }

    // Save the video (new video)
    storageService.saveVideo(videoData);

    logger.info(`Part ${partNumber}/${totalParts} added to database`);

    return { success: true, videoData };
  } catch (error: any) {
    logger.error(
      `Error downloading Bilibili part ${partNumber}/${totalParts}:`,
      error
    );
    return { success: false, error: error.message };
  }
}
