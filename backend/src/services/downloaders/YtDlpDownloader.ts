import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import {
  cleanupPartialVideoFiles,
  cleanupSubtitleFiles,
} from "../../utils/downloadUtils";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { ProgressTracker } from "../../utils/progressTracker";
import {
  executeYtDlpJson,
  executeYtDlpSpawn,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";

// Note: PO Token provider script path - only used if user has the bgutil plugin installed
// Modern yt-dlp (2025.11+) has built-in JS challenge solvers that work without PO tokens
const PROVIDER_SCRIPT = process.env.BGUTIL_SCRIPT_PATH || "";

// Helper function to extract author from XiaoHongShu page when yt-dlp doesn't provide it
async function extractXiaoHongShuAuthor(url: string): Promise<string | null> {
  try {
    logger.info("Attempting to extract XiaoHongShu author from webpage...");
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const html = response.data;

    // Try to find author name in the JSON data embedded in the page
    // XiaoHongShu embeds data in window.__INITIAL_STATE__
    const match = html.match(/"nickname":"([^"]+)"/);
    if (match && match[1]) {
      logger.info("Found XiaoHongShu author:", match[1]);
      return match[1];
    }

    // Alternative: try to find in user info
    const userMatch = html.match(/"user":\{[^}]*"nickname":"([^"]+)"/);
    if (userMatch && userMatch[1]) {
      logger.info("Found XiaoHongShu author (user):", userMatch[1]);
      return userMatch[1];
    }

    logger.info("Could not extract XiaoHongShu author from webpage");
    return null;
  } catch (error) {
    logger.error("Error extracting XiaoHongShu author:", error);
    return null;
  }
}

export class YtDlpDownloader extends BaseDownloader {
  // Search for videos (primarily for YouTube, but could be adapted)
  static async search(
    query: string,
    limit: number = 8,
    offset: number = 1
  ): Promise<any[]> {
    logger.info(
      `Processing search request for query: "${query}", limit: ${limit}, offset: ${offset}`
    );

    // Get user config for network options
    const userConfig = getUserYtDlpConfig();
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Calculate the total number of items to fetch from search
    // We need to request enough items to cover the offset + limit
    const searchLimit = offset + limit - 1;

    // Use ytsearch for searching
    const searchResults = await executeYtDlpJson(
      `ytsearch${searchLimit}:${query}`,
      {
        ...networkConfig,
        noWarnings: true,
        skipDownload: true,
        flatPlaylist: true, // Use flat playlist for faster search results
        playlistStart: offset,
        playlistEnd: searchLimit,
        ...(PROVIDER_SCRIPT
          ? {
              extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
            }
          : {}),
      }
    );

    if (!searchResults || !searchResults.entries) {
      return [];
    }

    // Format the search results
    const formattedResults = searchResults.entries.map((entry: any) => ({
      id: entry.id,
      title: entry.title,
      author: entry.uploader,
      thumbnailUrl:
        entry.thumbnail ||
        (entry.thumbnails && entry.thumbnails.length > 0
          ? entry.thumbnails[0].url
          : ""),
      duration: entry.duration,
      viewCount: entry.view_count,
      sourceUrl: `https://www.youtube.com/watch?v=${entry.id}`, // Default to YT for search results
      source: "youtube",
    }));

    logger.info(
      `Found ${formattedResults.length} search results for "${query}" (requested ${limit})`
    );

    return formattedResults;
  }

  // Implementation of IDownloader.getVideoInfo
  async getVideoInfo(url: string): Promise<VideoInfo> {
    return YtDlpDownloader.getVideoInfo(url);
  }

  // Get video info without downloading (Static wrapper)
  static async getVideoInfo(url: string): Promise<VideoInfo> {
    try {
      // Get user config for network options
      const userConfig = getUserYtDlpConfig(url);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      const info = await executeYtDlpJson(url, {
        ...networkConfig,
        noWarnings: true,
        preferFreeFormats: true,
        ...(PROVIDER_SCRIPT
          ? {
              extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
            }
          : {}),
      });

      return {
        title: info.title || "Video",
        author: info.uploader || "Unknown",
        date:
          info.upload_date ||
          new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: info.thumbnail,
        description: info.description, // Added description
      };
    } catch (error) {
      logger.error("Error fetching video info:", error);
      return {
        title: "Video",
        author: "Unknown",
        date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: "",
      };
    }
  }

  // Get the latest video URL from a channel
  static async getLatestVideoUrl(channelUrl: string): Promise<string | null> {
    try {
      logger.info("Fetching latest video for channel:", channelUrl);

      // Get user config for network options
      const userConfig = getUserYtDlpConfig(channelUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      // Append /videos to channel URL to ensure we get videos and not the channel tab
      let targetUrl = channelUrl;
      if (
        channelUrl.includes("youtube.com/") &&
        !channelUrl.includes("/videos") &&
        !channelUrl.includes("/shorts") &&
        !channelUrl.includes("/streams")
      ) {
        // Check if it looks like a channel URL
        if (
          channelUrl.includes("/@") ||
          channelUrl.includes("/channel/") ||
          channelUrl.includes("/c/") ||
          channelUrl.includes("/user/")
        ) {
          targetUrl = `${channelUrl}/videos`;
          logger.info("Modified channel URL to:", targetUrl);
        }
      }

      // Use yt-dlp to get the first video in the channel (playlist)
      const result = await executeYtDlpJson(targetUrl, {
        ...networkConfig,
        playlistEnd: 5,
        noWarnings: true,
        flatPlaylist: true, // We only need the ID/URL, not full info
        ...(PROVIDER_SCRIPT
          ? {
              extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
            }
          : {}),
      });

      // If it's a playlist/channel, 'entries' will contain the videos
      if (result.entries && result.entries.length > 0) {
        // Iterate through entries to find a valid video
        // Sometimes the first entry is the channel/tab itself (e.g. id starts with UC)
        for (const entry of result.entries) {
          // Skip entries that look like channel IDs (start with UC and are 24 chars)
          // or entries without a title/url that look like metadata
          if (entry.id && entry.id.startsWith("UC") && entry.id.length === 24) {
            continue;
          }

          const videoId = entry.id;
          if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
          }
          if (entry.url) {
            return entry.url;
          }
        }
      }
      return null;
    } catch (error) {
      logger.error("Error fetching latest video URL:", error);
      return null;
    }
  }

  // Implementation of IDownloader.downloadVideo
  async downloadVideo(url: string, options?: DownloadOptions): Promise<Video> {
    return YtDlpDownloader.downloadVideo(
      url,
      options?.downloadId,
      options?.onStart
    );
  }

  // Download video (Static wrapper/Implementation)
  static async downloadVideo(
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

    let videoTitle,
      videoAuthor,
      videoDate,
      videoDescription,
      thumbnailUrl,
      thumbnailSaved,
      source;
    let finalVideoFilename = videoFilename;
    let finalThumbnailFilename = thumbnailFilename;
    let subtitles: Array<{ language: string; filename: string; path: string }> =
      [];

    try {
      // Get video info first
      const info = await executeYtDlpJson(videoUrl, {
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

      videoTitle = info.title || "Video";
      videoAuthor = info.uploader || "Unknown";

      // If author is unknown and it's a XiaoHongShu video, try custom extraction
      if (
        (!info.uploader || info.uploader === "Unknown") &&
        info.extractor === "XiaoHongShu"
      ) {
        const customAuthor = await extractXiaoHongShuAuthor(videoUrl);
        if (customAuthor) {
          videoAuthor = customAuthor;
        }
      }
      videoDescription = info.description || "";
      videoDate =
        info.upload_date ||
        new Date().toISOString().slice(0, 10).replace(/-/g, "");
      thumbnailUrl = info.thumbnail;
      source = info.extractor || "generic";

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
      const newVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);
      const newThumbnailPath = path.join(IMAGES_DIR, finalThumbnailFilename);

      // Note: newVideoPath will be updated below based on merge output format
      logger.info("Preparing video download path:", newVideoPath);

      if (downloadId) {
        storageService.updateActiveDownload(downloadId, {
          filename: videoTitle,
          progress: 0,
        });
      }

      // Get user's yt-dlp configuration
      const userConfig = getUserYtDlpConfig(videoUrl);

      // Default format based on user config or fallback
      let defaultFormat =
        "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best";
      let youtubeFormat =
        "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4][vcodec^=h264]+bestaudio[ext=m4a]/best[ext=mp4]/best";

      // If user specified a format, use it (but still apply MP4 container preference)
      if (userConfig.f || userConfig.format) {
        const userFormat = userConfig.f || userConfig.format;
        defaultFormat = userFormat;
        youtubeFormat = userFormat;
        logger.info("Using user-specified format:", userFormat);
      }

      // Prepare base flags from user config (excluding output options we manage)
      const {
        output: _output, // Ignore user output template (we manage this)
        o: _o,
        f: _f, // Format is handled specially above
        format: _format,
        S: userFormatSort, // Format sort is handled specially
        formatSort: userFormatSort2,
        // Extract user subtitle preferences (use them if provided)
        writeSubs: userWriteSubs,
        writeAutoSubs: userWriteAutoSubs,
        convertSubs: userConvertSubs,
        // Extract user merge output format (use it if provided)
        mergeOutputFormat: userMergeOutputFormat,
        ...safeUserConfig
      } = userConfig;

      // Get format sort option if user specified it
      const formatSortValue = userFormatSort || userFormatSort2;

      // Determine merge output format: use user's choice or default to mp4
      // However, if user is sorting by resolution (likely demanding 4K/VP9), default to MKV
      // because VP9/AV1 in MP4 (mp4v2) is often problematic for Safari/QuickTime.
      let defaultMergeFormat = "mp4";
      if (formatSortValue && formatSortValue.includes("res")) {
        // Use WebM for high-res (likely VP9/AV1) as it's supported by Safari 14+ and Chrome
        defaultMergeFormat = "webm";
      }
      const mergeOutputFormat = userMergeOutputFormat || defaultMergeFormat;

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

      logger.info(
        `Using merge output format: ${mergeOutputFormat}, downloading to: ${newVideoPathWithFormat}`
      );

      // Prepare flags - defaults first, then user config to allow overrides
      const flags: Record<string, any> = {
        ...safeUserConfig, // Apply user config
        output: newVideoPathWithFormat, // Always use our output path with correct extension
        format: defaultFormat,
        // Use user preferences if provided, otherwise use defaults
        mergeOutputFormat: mergeOutputFormat,
        writeSubs: userWriteSubs !== undefined ? userWriteSubs : true,
        writeAutoSubs:
          userWriteAutoSubs !== undefined ? userWriteAutoSubs : true,
        convertSubs: userConvertSubs !== undefined ? userConvertSubs : "vtt",
        // Only add PO token provider if configured
        ...(PROVIDER_SCRIPT
          ? {
              extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
            }
          : {}),
      };

      // Apply format sort if user specified it (e.g., -S res:480)
      if (formatSortValue) {
        flags.formatSort = formatSortValue;
        logger.info("Using user-specified format sort:", formatSortValue);
      }

      // Add YouTube specific flags if it's a YouTube URL
      // Always apply preferred formats for YouTube to ensure codec compatibility (H.264/AAC for Safari)
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        // If the user hasn't specified a format (-f), but HAS specified a sorting order (-S),
        // we should assume they want to prioritize their sort order (e.g. resolution) over
        // our default strictly-compatible codec constraints.
        // This fixes the issue where -S res:2160 fails because the default format restricts to H.264 (max 1080p).
        if (!userConfig.f && !userConfig.format && formatSortValue) {
          // Allow any video codec (including VP9/AV1 for 4K), but try to keep audio good
          // Prioritize VP9 in WebM for Safari 14+ compatibility (AV1 is less supported)
          flags.format =
            "bestvideo[vcodec^=vp9][ext=webm]+bestaudio/bestvideo[ext=webm]+bestaudio/bestvideo+bestaudio/best";
        } else {
          flags.format = youtubeFormat;
        }

        // Use user's extractor args if provided, otherwise let yt-dlp use its defaults
        // Modern yt-dlp (2025.11+) has built-in JS challenge solvers that work without PO tokens
        if (
          userConfig.extractorArgs &&
          userConfig.extractorArgs.includes("youtube:")
        ) {
          // User has YouTube-specific args, use them
          flags.extractorArgs = userConfig.extractorArgs;

          // If user is using android client, add appropriate headers
          if (userConfig.extractorArgs.includes("player_client=android")) {
            flags.addHeader = [
              "Referer:https://www.youtube.com/",
              "User-Agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            ];
          }
        }
        // Remove the extractorArgs default if not needed - let yt-dlp handle it
        if (!flags.extractorArgs) {
          delete flags.extractorArgs;
        }
      }

      logger.debug("Final yt-dlp flags:", flags);

      // Use spawn to capture stdout for progress
      const subprocess = executeYtDlpSpawn(videoUrl, flags);

      if (onStart) {
        onStart(() => {
          logger.info("Killing subprocess for download:", downloadId);
          subprocess.kill();

          // Clean up partial files
          logger.info("Cleaning up partial files...");
          cleanupPartialVideoFiles(newVideoPathWithFormat);
          cleanupPartialVideoFiles(newThumbnailPath);
          cleanupSubtitleFiles(newSafeBaseFilename);
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
        // Use base class helper for cancellation handling
        const downloader = new YtDlpDownloader();
        downloader.handleCancellationError(error, () => {
          cleanupPartialVideoFiles(newVideoPathWithFormat);
          cleanupSubtitleFiles(newSafeBaseFilename);
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
      const downloader = new YtDlpDownloader();
      try {
        downloader.throwIfCancelled(downloadId);
      } catch (error) {
        cleanupPartialVideoFiles(newVideoPathWithFormat);
        cleanupSubtitleFiles(newSafeBaseFilename);
        throw error;
      }

      logger.info("Video downloaded successfully");

      // Check if download was cancelled before processing thumbnails and subtitles
      try {
        downloader.throwIfCancelled(downloadId);
      } catch (error) {
        cleanupSubtitleFiles(newSafeBaseFilename);
        throw error;
      }

      // Download and save the thumbnail
      thumbnailSaved = false;

      if (thumbnailUrl) {
        thumbnailSaved = await downloader.downloadThumbnail(
          thumbnailUrl,
          newThumbnailPath
        );
      }

      // Check again if download was cancelled before processing subtitles
      try {
        downloader.throwIfCancelled(downloadId);
      } catch (error) {
        cleanupSubtitleFiles(newSafeBaseFilename);
        throw error;
      }

      // Scan for subtitle files
      try {
        const baseFilename = newSafeBaseFilename;
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
            downloader.throwIfCancelled(downloadId);
          } catch (error) {
            cleanupSubtitleFiles(baseFilename);
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
        downloader.handleCancellationError(subtitleError);
        logger.error("Error processing subtitle files:", subtitleError);
      }
    } catch (error) {
      logger.error("Error in download process:", error);
      throw error;
    }

    // Create metadata for the video
    const videoData: Video = {
      id: timestamp.toString(),
      title: videoTitle || "Video",
      author: videoAuthor || "Unknown",
      description: videoDescription,
      date:
        videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      source: source, // Use extracted source
      sourceUrl: videoUrl,
      videoFilename: finalVideoFilename,
      thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      videoPath: `/videos/${finalVideoFilename}`,
      thumbnailPath: thumbnailSaved
        ? `/images/${finalThumbnailFilename}`
        : null,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      duration: undefined, // Will be populated below
      addedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    // If duration is missing from info, try to extract it from file
    const finalVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);

    try {
      const { getVideoDuration } = await import(
        "../../services/metadataService"
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
          ? `/images/${finalThumbnailFilename}`
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
}
