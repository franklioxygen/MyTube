import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import {
  cleanupSubtitleFiles,
  cleanupVideoArtifacts,
} from "../../../utils/downloadUtils";
import { formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { ProgressTracker } from "../../../utils/progressTracker";
import {
  executeYtDlpSpawn,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import * as storageService from "../../storageService";
import { Video } from "../../storageService";
import { BaseDownloader } from "../BaseDownloader";
import { prepareDownloadFlags } from "./ytdlpConfig";
import { getProviderScript } from "./ytdlpHelpers";
import { extractVideoMetadata } from "./ytdlpMetadata";
import { processSubtitles } from "./ytdlpSubtitle";

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

  public async downloadThumbnailPublic(
    thumbnailUrl: string,
    savePath: string,
    axiosConfig: any = {}
  ): Promise<boolean> {
    return this.downloadThumbnail(thumbnailUrl, savePath, axiosConfig);
  }
}

/**
 * Core video download function using yt-dlp
 */
export async function downloadVideo(
  videoUrl: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void
): Promise<Video> {
  logger.info("Detected URL:", videoUrl);

  // Create a safe base filename (without extension)
  const timestamp = Date.now();
  const safeBaseFilename = `video_${timestamp}`;

  // Add extensions for video and thumbnail
  const videoFilename = `${safeBaseFilename}.mp4`;
  const thumbnailFilename = `${safeBaseFilename}.jpg`;

  let videoTitle: string,
    videoAuthor: string,
    videoDate: string,
    videoDescription: string,
    thumbnailUrl: string | null,
    thumbnailSaved: boolean,
    source: string,
    channelUrl: string | null = null;
  let finalVideoFilename = videoFilename;
  let finalThumbnailFilename = thumbnailFilename;
  let subtitles: Array<{ language: string; filename: string; path: string }> =
    [];

  const downloader = new YtDlpDownloaderHelper();

  try {
    const PROVIDER_SCRIPT = getProviderScript();

    // Get user's yt-dlp configuration for network options (including proxy)
    const userConfig = getUserYtDlpConfig(videoUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Get video info first
    const info = await executeYtDlpJson(videoUrl, {
      ...networkConfig,
      noWarnings: true,
      preferFreeFormats: true,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    logger.info("Video info:", {
      title: info.title,
      uploader: info.uploader,
      upload_date: info.upload_date,
      extractor: info.extractor,
    });

    // Extract metadata
    const metadata = await extractVideoMetadata(videoUrl, info);
    videoTitle = metadata.videoTitle;
    videoAuthor = metadata.videoAuthor;
    videoDate = metadata.videoDate;
    videoDescription = metadata.videoDescription;
    thumbnailUrl = metadata.thumbnailUrl;
    source = metadata.source;

    // Extract channel URL from info if available
    channelUrl = info.channel_url || info.uploader_url || null;

    // Update the safe base filename with the actual title
    const newSafeBaseFilename = formatVideoFilename(
      videoTitle,
      videoAuthor,
      videoDate
    );
    const newVideoFilename = `${newSafeBaseFilename}.mp4`;
    const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

    // Update the filenames
    finalVideoFilename = newVideoFilename;
    finalThumbnailFilename = newThumbnailFilename;

    // Update paths
    const settings = storageService.getSettings();
    const moveThumbnailsToVideoFolder =
      settings.moveThumbnailsToVideoFolder || false;
    const moveSubtitlesToVideoFolder =
      settings.moveSubtitlesToVideoFolder || false;

    logger.info("File location settings:", {
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder,
      videoDir: VIDEOS_DIR,
      imageDir: IMAGES_DIR
    });

    const newVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);
    const newThumbnailPath = moveThumbnailsToVideoFolder
      ? path.join(VIDEOS_DIR, finalThumbnailFilename)
      : path.join(IMAGES_DIR, finalThumbnailFilename);

    logger.info("Preparing video download path:", newVideoPath);

    if (downloadId) {
      storageService.updateActiveDownload(downloadId, {
        filename: videoTitle,
        progress: 0,
      });
    }

    // Get user's yt-dlp configuration (reuse from above if available, otherwise fetch again)
    // Note: userConfig was already fetched above, but we need to ensure it's still valid
    const downloadUserConfig = userConfig || getUserYtDlpConfig(videoUrl);

    // Log proxy configuration for debugging
    if (downloadUserConfig.proxy) {
      logger.info("Using proxy for download:", downloadUserConfig.proxy);
    }

    // Prepare download flags
    const { flags, mergeOutputFormat } = prepareDownloadFlags(
      videoUrl,
      newVideoPath,
      downloadUserConfig
    );

    // Log final flags to verify proxy is included
    if (flags.proxy) {
      logger.info("Proxy included in download flags:", flags.proxy);
    } else {
      logger.warn(
        "Proxy not found in download flags. User config proxy:",
        downloadUserConfig.proxy
      );
    }

    // Update the video path to use the correct extension based on merge format
    const videoExtension = mergeOutputFormat;
    const newVideoPathWithFormat = newVideoPath.replace(
      /\.mp4$/,
      `.${videoExtension}`
    );
    finalVideoFilename = finalVideoFilename.replace(
      /\.mp4$/,
      `.${videoExtension}`
    );

    // Update output path in flags
    flags.output = newVideoPathWithFormat;

    logger.info(
      `Using merge output format: ${mergeOutputFormat}, downloading to: ${newVideoPathWithFormat}`
    );

    // Use spawn to capture stdout for progress
    const subprocess = executeYtDlpSpawn(videoUrl, flags);

    if (onStart) {
      onStart(async () => {
        logger.info("Killing subprocess for download:", downloadId);
        subprocess.kill();

        // Clean up partial files
        logger.info("Cleaning up partial files...");
        await cleanupVideoArtifacts(newSafeBaseFilename);
        
        // Use fresh cleanup based on settings
        const currentSettings = storageService.getSettings();
        if (!currentSettings.moveThumbnailsToVideoFolder) {
            await cleanupVideoArtifacts(newSafeBaseFilename, IMAGES_DIR);
        }
        
        if (fs.existsSync(newThumbnailPath)) {
          await fs.remove(newThumbnailPath);
        }
        await cleanupSubtitleFiles(newSafeBaseFilename);
      });
    }

    // Use ProgressTracker for centralized progress parsing
    const progressTracker = new ProgressTracker(downloadId);
    subprocess.stdout?.on("data", (data: Buffer) => {
      progressTracker.parseAndUpdate(data.toString());
    });

    // Wait for download to complete
    try {
      await subprocess;
    } catch (error: any) {
      await downloader.handleCancellationErrorPublic(error, async () => {
        await cleanupVideoArtifacts(newSafeBaseFilename);
        await cleanupSubtitleFiles(newSafeBaseFilename);
      });

      // Check if error is subtitle-related and video file exists
      const stderr = error.stderr || "";
      const isSubtitleError =
        stderr.includes("Unable to download video subtitles") ||
        stderr.includes("Unable to download subtitles") ||
        (stderr.includes("subtitles") && stderr.includes("429"));

      if (isSubtitleError) {
        // Check if video file was successfully downloaded
        if (fs.existsSync(newVideoPathWithFormat)) {
          logger.warn(
            "Subtitle download failed, but video was downloaded successfully. Continuing...",
            error.message
          );
          // Log the subtitle error details
          if (stderr) {
            logger.warn("Subtitle error details:", stderr);
          }
          // Continue processing - don't throw
        } else {
          // Video file doesn't exist, this is a real error
          throw error;
        }
      } else {
        // Re-throw other errors
        throw error;
      }
    }

    // Check if download was cancelled (it might have been removed from active downloads)
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      await cleanupVideoArtifacts(newSafeBaseFilename);
      await cleanupSubtitleFiles(newSafeBaseFilename);
      throw error;
    }

    logger.info("Video downloaded successfully");

    // Check if download was cancelled before processing thumbnails and subtitles
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      await cleanupSubtitleFiles(newSafeBaseFilename);
      throw error;
    }

    // Download and save the thumbnail
    thumbnailSaved = false;

    if (thumbnailUrl) {
      // Prepare axios config with proxy if available
      let axiosConfig = {};
      
      if (downloadUserConfig.proxy) {
        axiosConfig = getAxiosProxyConfig(downloadUserConfig.proxy);
      }

      thumbnailSaved = await downloader.downloadThumbnailPublic(
        thumbnailUrl,
        newThumbnailPath,
        axiosConfig
      );
    }

    // Check again if download was cancelled before processing subtitles
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      await cleanupSubtitleFiles(newSafeBaseFilename);
      throw error;
    }

    // Process subtitle files
    subtitles = await processSubtitles(
      newSafeBaseFilename,
      downloadId,
      moveSubtitlesToVideoFolder
    );
  } catch (error) {
    logger.error("Error in download process:", error);
    throw error;
  }

  // Create metadata for the video
  const settings = storageService.getSettings();
  const moveThumbnailsToVideoFolder =
    settings.moveThumbnailsToVideoFolder || false;

  const videoData: Video = {
    id: timestamp.toString(),
    title: videoTitle || "Video",
    author: videoAuthor || "Unknown",
    description: videoDescription,
    date: videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    source: source, // Use extracted source
    sourceUrl: videoUrl,
    videoFilename: finalVideoFilename,
    thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    videoPath: `/videos/${finalVideoFilename}`,
    thumbnailPath: thumbnailSaved
      ? moveThumbnailsToVideoFolder
        ? `/videos/${finalThumbnailFilename}`
        : `/images/${finalThumbnailFilename}`
      : null,
    subtitles: subtitles.length > 0 ? subtitles : undefined,
    duration: undefined, // Will be populated below
    channelUrl: channelUrl || undefined,
    addedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  // If duration is missing from info, try to extract it from file
  const finalVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);

  try {
    const { getVideoDuration } = await import(
      "../../../services/metadataService"
    );
    const duration = await getVideoDuration(finalVideoPath);
    if (duration) {
      videoData.duration = duration.toString();
    }
  } catch (e) {
    logger.error("Failed to extract duration from downloaded file:", e);
  }

  // Get file size
  try {
    if (fs.existsSync(finalVideoPath)) {
      const stats = fs.statSync(finalVideoPath);
      videoData.fileSize = stats.size.toString();
    }
  } catch (e) {
    logger.error("Failed to get file size:", e);
  }

  // Check if video with same sourceUrl already exists
  const existingVideo = storageService.getVideoBySourceUrl(videoUrl);

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
        ? moveThumbnailsToVideoFolder
          ? `/videos/${finalThumbnailFilename}`
          : `/images/${finalThumbnailFilename}`
        : existingVideo.thumbnailPath,
      duration: videoData.duration,
      fileSize: videoData.fileSize,
      title: videoData.title, // Update title in case it changed
      description: videoData.description, // Update description in case it changed
    });

    if (updatedVideo) {
      logger.info("Video updated in database with new subtitles");
      return updatedVideo;
    }
  }

  // Save the video (new video)
  storageService.saveVideo(videoData);

  logger.info("Video added to database");

  return videoData;
}
