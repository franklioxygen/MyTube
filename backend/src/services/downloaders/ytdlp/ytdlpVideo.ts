import fs from "fs-extra";
import path from "path";
import { AVATARS_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { downloadAndProcessAvatar } from "../../../utils/avatarUtils";
import {
  cleanupSubtitleFiles,
  cleanupVideoArtifacts,
} from "../../../utils/downloadUtils";
import { formatVideoFilename, isYouTubeUrl } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { ProgressTracker } from "../../../utils/progressTracker";
import {
  downloadChannelAvatar,
  executeYtDlpJson,
  executeYtDlpSpawn,
  getAxiosProxyConfig,
  getChannelUrlFromVideo,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
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
    channelUrl: string | null = null,
    authorAvatarUrl: string | null = null,
    authorAvatarSaved: boolean = false;
  let finalVideoFilename = videoFilename;
  let finalThumbnailFilename = thumbnailFilename;
  let finalAuthorAvatarFilename: string | undefined = undefined;
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

    // Try to get channel URL using yt-dlp if not available in info
    if (!channelUrl && isYouTubeUrl(videoUrl)) {
      logger.info("Channel URL not in info, fetching using yt-dlp...");
      channelUrl = await getChannelUrlFromVideo(videoUrl, networkConfig);
      logger.info("Channel URL fetched:", channelUrl);
    }

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
      imageDir: IMAGES_DIR,
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
        try {
          axiosConfig = getAxiosProxyConfig(downloadUserConfig.proxy);
        } catch (error) {
          if (error instanceof InvalidProxyError) {
            // Log the error but continue without proxy for thumbnail
            // Video download already succeeded, don't fail for thumbnail proxy issues
            logger.warn(
              "Invalid proxy configuration for thumbnail download, proceeding without proxy:",
              error.message
            );
          } else {
            throw error;
          }
        }
      }

      thumbnailSaved = await downloader.downloadThumbnailPublic(
        thumbnailUrl,
        newThumbnailPath,
        axiosConfig
      );
    }

    // Download and process author avatar
    let authorAvatarPath: string | null = null;
    const platform = source === "youtube" ? "youtube" : "generic";

    if (channelUrl && isYouTubeUrl(videoUrl)) {
      logger.info("Downloading author avatar from channel:", {
        channelUrl: channelUrl,
        author: videoAuthor,
        platform: platform,
      });

      // Download channel avatar using yt-dlp to a temp file first
      const tempAvatarPath = path.join(AVATARS_DIR, `temp_${Date.now()}.jpg`);
      fs.ensureDirSync(AVATARS_DIR);

      const downloaded = await downloadChannelAvatar(
        channelUrl,
        tempAvatarPath,
        networkConfig
      );

      if (downloaded && fs.existsSync(tempAvatarPath)) {
        // Process the downloaded avatar (check if exists, resize)
        authorAvatarPath = await downloadAndProcessAvatar(
          tempAvatarPath, // Use temp file path as "URL" for processing
          platform,
          videoAuthor,
          async (url: string, savePath: string) => {
            // This function just moves the temp file
            if (fs.existsSync(url)) {
              fs.moveSync(url, savePath, { overwrite: true });
              return true;
            }
            return false;
          }
        );
        authorAvatarSaved = authorAvatarPath !== null;

        // Clean up temp file if it still exists (in case processing failed or file wasn't moved)
        if (fs.existsSync(tempAvatarPath)) {
          try {
            fs.unlinkSync(tempAvatarPath);
            logger.info(`Cleaned up temp avatar file: ${tempAvatarPath}`);
          } catch (cleanupError) {
            logger.warn(
              `Failed to clean up temp avatar file: ${tempAvatarPath}`,
              cleanupError
            );
          }
        }
      } else if (fs.existsSync(tempAvatarPath)) {
        // Clean up temp file if download failed
        try {
          fs.unlinkSync(tempAvatarPath);
          logger.info(
            `Cleaned up temp avatar file after failed download: ${tempAvatarPath}`
          );
        } catch (cleanupError) {
          logger.warn(
            `Failed to clean up temp avatar file: ${tempAvatarPath}`,
            cleanupError
          );
        }
      }
    } else {
      // Fallback: try to get avatar URL from info if available
      authorAvatarUrl = info.channel_avatar || info.uploader_avatar || null;
      if (authorAvatarUrl) {
        logger.info("Downloading author avatar from URL:", {
          url: authorAvatarUrl,
          author: videoAuthor,
          platform: platform,
        });

        // Prepare axios config with proxy if available
        let avatarAxiosConfig = {};
        if (downloadUserConfig.proxy) {
          try {
            avatarAxiosConfig = getAxiosProxyConfig(downloadUserConfig.proxy);
          } catch (error) {
            if (error instanceof InvalidProxyError) {
              logger.warn(
                "Invalid proxy configuration for avatar download, proceeding without proxy:",
                error.message
              );
            } else {
              throw error;
            }
          }
        }

        // Use the utility function to download and process avatar
        authorAvatarPath = await downloadAndProcessAvatar(
          authorAvatarUrl,
          platform,
          videoAuthor,
          downloader.downloadThumbnailPublic.bind(downloader),
          avatarAxiosConfig
        );
        authorAvatarSaved = authorAvatarPath !== null;
      } else {
        logger.info(
          "No channel URL or avatar URL available, skipping avatar download"
        );
      }
    }

    // Get the final avatar filename from the path if avatar was saved
    if (authorAvatarPath) {
      finalAuthorAvatarFilename = path.basename(authorAvatarPath);
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
    authorAvatarFilename:
      authorAvatarSaved && finalAuthorAvatarFilename
        ? finalAuthorAvatarFilename
        : undefined,
    authorAvatarPath:
      authorAvatarSaved && finalAuthorAvatarFilename
        ? `/avatars/${finalAuthorAvatarFilename}`
        : undefined,
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
      authorAvatarFilename: authorAvatarSaved
        ? finalAuthorAvatarFilename
        : existingVideo.authorAvatarFilename,
      authorAvatarPath: authorAvatarSaved
        ? `/avatars/${finalAuthorAvatarFilename}`
        : existingVideo.authorAvatarPath,
    });

    if (updatedVideo) {
      logger.info("Video updated in database with new subtitles");

      // Add video to author collection if enabled (for existing videos too)
      storageService.addVideoToAuthorCollection(
        updatedVideo.id,
        videoAuthor,
        settings.saveAuthorFilesToCollection || false
      );

      return updatedVideo;
    }
  }

  // Save the video (new video)
  storageService.saveVideo(videoData);

  logger.info("Video added to database");

  // Add video to author collection if enabled
  const authorCollection = storageService.addVideoToAuthorCollection(
    videoData.id,
    videoAuthor,
    settings.saveAuthorFilesToCollection || false
  );

  if (authorCollection) {
    // If video was added to a collection, the file paths might have changed
    // Fetch the updated video from storage
    const updatedVideo = storageService.getVideoById(videoData.id);
    if (updatedVideo) {
      return updatedVideo;
    }
  }

  return videoData;
}
