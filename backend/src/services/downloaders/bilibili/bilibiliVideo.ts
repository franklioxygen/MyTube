import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { DownloadCancelledError } from "../../../errors/DownloadErrors";
import { formatBytes, safeRemove } from "../../../utils/downloadUtils";
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
  const tempDir = path.join(
    VIDEOS_DIR,
    `temp_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  );

  try {
    // Create a unique temporary directory for the download
    fs.ensureDirSync(tempDir);

    logger.info("Downloading Bilibili video using yt-dlp to:", tempDir);

    // Get user's yt-dlp configuration for network settings
    const userConfig = getUserYtDlpConfig(url);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Get video info first (with network config)
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

    // Default format - explicitly require H.264 (avc1) codec for Safari compatibility
    // Safari doesn't support HEVC/H.265 or other codecs that Bilibili might serve
    let downloadFormat =
      "bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";

    // If user specified a format, use it
    if (userConfig.f || userConfig.format) {
      downloadFormat = userConfig.f || userConfig.format;
      logger.info("Using user-specified format for Bilibili:", downloadFormat);
    }

    // Get format sort option if user specified it
    // Default to preferring H.264 codec for Safari compatibility
    let formatSortValue = userConfig.S || userConfig.formatSort;
    if (!formatSortValue && !(userConfig.f || userConfig.format)) {
      // If user hasn't specified format or format sort, prefer H.264 for compatibility
      formatSortValue = "vcodec:h264";
      logger.info(
        "Using default format sort for Safari compatibility:",
        formatSortValue
      );
    }

    // Prepare base flags from user config (excluding output options we manage)
    const {
      output: _output,
      o: _o,
      f: _f,
      format: _format,
      S: _S,
      formatSort: _formatSort,
      // Extract user subtitle preferences (use them if provided)
      writeSubs: userWriteSubs,
      writeAutoSubs: userWriteAutoSubs,
      convertSubs: userConvertSubs,
      // Extract user merge output format (use it if provided)
      mergeOutputFormat: userMergeOutputFormat,
      ...safeUserConfig
    } = userConfig;

    // Determine merge output format: use user's choice or default to mp4
    const mergeOutputFormat = userMergeOutputFormat || "mp4";
    logger.info(`Using merge output format: ${mergeOutputFormat}`);

    // Prepare flags for yt-dlp - merge user config with required settings
    const flags: Record<string, any> = {
      ...networkConfig, // Apply network settings
      ...safeUserConfig, // Apply other user config
      output: outputTemplate,
      format: downloadFormat,
      // Use user preferences if provided, otherwise use defaults
      mergeOutputFormat: mergeOutputFormat,
      writeSubs: userWriteSubs !== undefined ? userWriteSubs : true,
      writeAutoSubs: userWriteAutoSubs !== undefined ? userWriteAutoSubs : true,
      convertSubs: userConvertSubs !== undefined ? userConvertSubs : "vtt",
      ignoreErrors: true, // Continue even if subtitle download fails
      noWarnings: false, // Show warnings for debugging
    };

    // Apply format sort (either user-specified or default H.264 preference)
    if (formatSortValue) {
      flags.formatSort = formatSortValue;
      logger.info("Using format sort for Bilibili:", formatSortValue);
    }

    logger.info("Final Bilibili yt-dlp flags:", flags);

    // Use spawn to capture stdout for progress
    const subprocess = executeYtDlpSpawn(url, flags);

    if (onStart) {
      onStart(async () => {
        logger.info("Killing subprocess for download:", downloadId);
        subprocess.kill();

        // Clean up partial files
        logger.info("Cleaning up partial files...");

        if (fs.existsSync(tempDir)) {
          await safeRemove(tempDir);
          logger.info("Deleted temp directory:", tempDir);
        }
        if (fs.existsSync(videoPath)) {
          await safeRemove(videoPath);
          logger.info("Deleted partial video file:", videoPath);
        }
        if (fs.existsSync(thumbnailPath)) {
          await safeRemove(thumbnailPath);
          logger.info("Deleted partial thumbnail file:", thumbnailPath);
        }
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
      // Use base class helper for cancellation handling
      const downloader = new BilibiliDownloaderHelper();
      downloader.handleCancellationErrorPublic(error, async () => {
        if (fs.existsSync(tempDir)) {
          await safeRemove(tempDir);
        }
      });
      // Only log as error if it's not an expected subtitle-related issue
      const stderrMsg = error.stderr || "";
      const isExpectedError =
        stderrMsg.includes("Subtitles are only available when logged in") ||
        stderrMsg.includes("Invalid data found when processing input");
      if (!isExpectedError) {
        logger.error("yt-dlp download failed:", error.message);
        if (error.stderr) {
          logger.error("yt-dlp error output:", error.stderr);
        }
      }
    }

    // Check if download was cancelled (it might have been removed from active downloads)
    const downloader = new BilibiliDownloaderHelper();
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      if (fs.existsSync(tempDir)) {
        fs.removeSync(tempDir);
      }
      throw error;
    }

    logger.info("Download completed, checking for video file");

    // Find the downloaded file (try multiple extensions)
    const files = fs.readdirSync(tempDir);
    logger.info("Files in temp directory:", files);

    const videoFile =
      files.find((file: string) => file.endsWith(".mp4")) ||
      files.find((file: string) => file.endsWith(".mkv")) ||
      files.find((file: string) => file.endsWith(".webm")) ||
      files.find((file: string) => file.endsWith(".flv"));

    if (!videoFile) {
      // List all files for debugging
      logger.error("No video file found. All files:", files);
      const errorMsg = downloadError
        ? `Downloaded video file not found. yt-dlp error: ${
            downloadError.message
          }. stderr: ${(downloadError.stderr || stderrOutput).substring(
            0,
            500
          )}`
        : `Downloaded video file not found. yt-dlp stderr: ${stderrOutput.substring(
            0,
            500
          )}`;
      throw new Error(errorMsg);
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
    fs.moveSync(tempVideoPath, videoPath, { overwrite: true });

    logger.info("Moved video file to:", videoPath);

    // Clean up temp directory
    fs.removeSync(tempDir);

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
    if (fs.existsSync(tempDir)) {
      fs.removeSync(tempDir);
    }

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
  onStart?: (cancel: () => void) => void
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
    const safeBaseFilename = `video_${timestamp}`;

    // Add extensions for video and thumbnail (use user's format preference)
    const videoFilename = `${safeBaseFilename}.${mergeOutputFormat}`;
    const thumbnailFilename = `${safeBaseFilename}.jpg`;

    // Set full paths for video and thumbnail
    const videoPath = path.join(VIDEOS_DIR, videoFilename);
    const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

    let videoTitle,
      videoAuthor,
      videoDate,
      videoDescription,
      thumbnailUrl,
      thumbnailSaved;
    let finalVideoFilename = videoFilename;
    let finalThumbnailFilename = thumbnailFilename;

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

    // For multi-part videos, include the part number in the title
    videoTitle =
      totalParts > 1
        ? `${seriesTitle} - Part ${partNumber}/${totalParts}`
        : bilibiliInfo.title || "Bilibili Video";

    videoAuthor = bilibiliInfo.author || "Bilibili User";
    videoDate =
      bilibiliInfo.date ||
      new Date().toISOString().slice(0, 10).replace(/-/g, "");
    videoDescription = bilibiliInfo.description || "";
    thumbnailUrl = bilibiliInfo.thumbnailUrl;
    thumbnailSaved = bilibiliInfo.thumbnailSaved;
    
    // Extract channel URL for Bilibili
    let channelUrl: string | undefined;
    try {
      const { extractBilibiliVideoId } = await import("../../../utils/helpers");
      const videoId = extractBilibiliVideoId(url);
      if (videoId) {
        const axios = (await import("axios")).default;
        const isBvId = videoId.startsWith("BV");
        const apiUrl = isBvId
          ? `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`
          : `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace("av", "")}`;
        
        const response = await axios.get(apiUrl, {
          headers: {
            Referer: "https://www.bilibili.com",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        });
        
        if (response.data?.data?.owner?.mid) {
          const mid = response.data.data.owner.mid;
          channelUrl = `https://space.bilibili.com/${mid}`;
        }
      }
    } catch (error) {
      logger.error("Error extracting Bilibili channel URL:", error);
      // Continue without channel URL
    }

    // Update the safe base filename with the actual title
    // Update the safe base filename with the new format
    const newSafeBaseFilename = formatVideoFilename(
      videoTitle,
      videoAuthor,
      videoDate
    );
    const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
    const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

    // Rename the files
    const newVideoPath = path.join(VIDEOS_DIR, newVideoFilename);
    const newThumbnailPath = path.join(IMAGES_DIR, newThumbnailFilename);

    // Check if download was cancelled before processing files
    const downloader = new BilibiliDownloaderHelper();
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      throw error;
    }

    if (fs.existsSync(videoPath)) {
      fs.renameSync(videoPath, newVideoPath);
      logger.info("Renamed video file to:", newVideoFilename);
      finalVideoFilename = newVideoFilename;
    } else {
      logger.info("Video file not found at:", videoPath);
      // Check again if download was cancelled (might have been cancelled during downloadVideo)
      try {
        downloader.throwIfCancelledPublic(downloadId);
      } catch (error) {
        throw error;
      }
      throw new Error("Video file not found after download");
    }

    if (thumbnailSaved && fs.existsSync(thumbnailPath)) {
      fs.renameSync(thumbnailPath, newThumbnailPath);
      logger.info("Renamed thumbnail file to:", newThumbnailFilename);
      finalThumbnailFilename = newThumbnailFilename;
    }

    // Get video duration
    let duration: string | undefined;
    try {
      const { getVideoDuration } = await import(
        "../../../services/metadataService"
      );
      const durationSec = await getVideoDuration(newVideoPath);
      if (durationSec) {
        duration = durationSec.toString();
      }
    } catch (e) {
      logger.error("Failed to extract duration from Bilibili video:", e);
    }

    // Get file size
    let fileSize: string | undefined;
    try {
      if (fs.existsSync(newVideoPath)) {
        const stats = fs.statSync(newVideoPath);
        fileSize = stats.size.toString();
      }
    } catch (e) {
      logger.error("Failed to get file size:", e);
    }

    // Check if download was cancelled before downloading subtitles
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      throw error;
    }

    // Download subtitles
    let subtitles: Array<{
      language: string;
      filename: string;
      path: string;
    }> = [];
    try {
      logger.info("Attempting to download subtitles...");
      subtitles = await downloadSubtitles(url, newSafeBaseFilename);
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
      try {
        if (fs.existsSync(newVideoPath)) {
          fs.unlinkSync(newVideoPath);
          logger.info("Deleted video file:", newVideoPath);
        }
        if (fs.existsSync(newThumbnailPath)) {
          fs.unlinkSync(newThumbnailPath);
          logger.info("Deleted thumbnail file:", newThumbnailPath);
        }
      } catch (cleanupError) {
        logger.error("Error cleaning up files:", cleanupError);
      }
      throw DownloadCancelledError.create();
    }

    // Create metadata for the video
    const videoData: Video = {
      id: timestamp.toString(),
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
      videoPath: `/videos/${finalVideoFilename}`,
      thumbnailPath: thumbnailSaved
        ? `/images/${finalThumbnailFilename}`
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

    // Check if video with same sourceUrl already exists
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
        videoPath: `/videos/${finalVideoFilename}`,
        thumbnailFilename: thumbnailSaved
          ? finalThumbnailFilename
          : existingVideo.thumbnailFilename,
        thumbnailPath: thumbnailSaved
          ? `/images/${finalThumbnailFilename}`
          : existingVideo.thumbnailPath,
        duration: duration,
        fileSize: fileSize,
        title: videoData.title, // Update title in case it changed
        description: videoData.description, // Update description in case it changed
      });

      if (updatedVideo) {
        logger.info(
          `Part ${partNumber}/${totalParts} updated in database with new subtitles`
        );
        return { success: true, videoData: updatedVideo };
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
