import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import {
  calculateDownloadedSize,
  cleanupPartialVideoFiles,
  cleanupSubtitleFiles,
  isCancellationError,
  isDownloadActive,
  parseSize,
} from "../../utils/downloadUtils";
import { formatVideoFilename } from "../../utils/helpers";
import { executeYtDlpJson, executeYtDlpSpawn } from "../../utils/ytDlpUtils";
import * as storageService from "../storageService";
import { Video } from "../storageService";

const PROVIDER_SCRIPT =
  process.env.BGUTIL_SCRIPT_PATH ||
  path.join(
    process.cwd(),
    "bgutil-ytdlp-pot-provider/server/build/generate_once.js"
  );

/**
 * Parse yt-dlp configuration text into flags object
 * Supports standard yt-dlp config file format (one option per line, # for comments)
 */
function parseYtDlpConfig(configText: string): Record<string, any> {
  const flags: Record<string, any> = {};

  if (!configText || typeof configText !== "string") {
    return flags;
  }

  const lines = configText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Parse the option
    // Options can be:
    // -f value
    // --format value
    // --some-flag (boolean)
    // -x (short boolean)

    let optionName: string | null = null;
    let optionValue: string | boolean = true;

    if (line.startsWith("--")) {
      // Long option
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) {
        // Boolean flag (no value)
        optionName = line.substring(2);
      } else {
        optionName = line.substring(2, spaceIndex);
        optionValue = line.substring(spaceIndex + 1).trim();
        // Remove surrounding quotes if present
        if (
          (optionValue.startsWith('"') && optionValue.endsWith('"')) ||
          (optionValue.startsWith("'") && optionValue.endsWith("'"))
        ) {
          optionValue = optionValue.slice(1, -1);
        }
      }
    } else if (line.startsWith("-") && !line.startsWith("--")) {
      // Short option
      const parts = line.split(/\s+/);
      optionName = parts[0].substring(1);
      if (parts.length > 1) {
        optionValue = parts.slice(1).join(" ");
        // Remove surrounding quotes if present
        if (
          typeof optionValue === "string" &&
          ((optionValue.startsWith('"') && optionValue.endsWith('"')) ||
            (optionValue.startsWith("'") && optionValue.endsWith("'")))
        ) {
          optionValue = optionValue.slice(1, -1);
        }
      }
    }

    if (optionName) {
      // Convert kebab-case to camelCase for flags object
      const camelCaseName = optionName.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      flags[camelCaseName] = optionValue;
    }
  }

  return flags;
}

/**
 * Get user's yt-dlp configuration from settings
 */
function getUserYtDlpConfig(): Record<string, any> {
  try {
    const settings = storageService.getSettings();
    if (settings.ytDlpConfig) {
      const parsedConfig = parseYtDlpConfig(settings.ytDlpConfig);
      console.log("Parsed user yt-dlp config:", parsedConfig);
      return parsedConfig;
    }
  } catch (error) {
    console.error("Error reading user yt-dlp config:", error);
  }
  return {};
}

// Helper function to extract author from XiaoHongShu page when yt-dlp doesn't provide it
async function extractXiaoHongShuAuthor(url: string): Promise<string | null> {
  try {
    console.log("Attempting to extract XiaoHongShu author from webpage...");
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
      console.log("Found XiaoHongShu author:", match[1]);
      return match[1];
    }

    // Alternative: try to find in user info
    const userMatch = html.match(/"user":\{[^}]*"nickname":"([^"]+)"/);
    if (userMatch && userMatch[1]) {
      console.log("Found XiaoHongShu author (user):", userMatch[1]);
      return userMatch[1];
    }

    console.log("Could not extract XiaoHongShu author from webpage");
    return null;
  } catch (error) {
    console.error("Error extracting XiaoHongShu author:", error);
    return null;
  }
}

/**
 * Extract network-related options from user config
 * These are safe to apply to all operations (search, info, download)
 */
function getNetworkConfigFromUserConfig(
  userConfig: Record<string, any>
): Record<string, any> {
  const networkOptions: Record<string, any> = {};

  // Proxy settings
  if (userConfig.proxy) {
    networkOptions.proxy = userConfig.proxy;
  }

  // Rate limiting
  if (userConfig.r || userConfig.limitRate) {
    networkOptions.limitRate = userConfig.r || userConfig.limitRate;
  }

  // Socket timeout
  if (userConfig.socketTimeout) {
    networkOptions.socketTimeout = userConfig.socketTimeout;
  }

  // Force IPv4/IPv6
  if (userConfig.forceIpv4 || userConfig["4"]) {
    networkOptions.forceIpv4 = true;
  }
  if (userConfig.forceIpv6 || userConfig["6"]) {
    networkOptions.forceIpv6 = true;
  }

  // Geo bypass
  if (userConfig.xff) {
    networkOptions.xff = userConfig.xff;
  }

  // Sleep/rate limiting
  if (userConfig.sleepRequests) {
    networkOptions.sleepRequests = userConfig.sleepRequests;
  }
  if (userConfig.sleepInterval || userConfig.minSleepInterval) {
    networkOptions.sleepInterval =
      userConfig.sleepInterval || userConfig.minSleepInterval;
  }
  if (userConfig.maxSleepInterval) {
    networkOptions.maxSleepInterval = userConfig.maxSleepInterval;
  }

  // Retries
  if (userConfig.retries || userConfig.R) {
    networkOptions.retries = userConfig.retries || userConfig.R;
  }

  return networkOptions;
}

export class YtDlpDownloader {
  // Search for videos (primarily for YouTube, but could be adapted)
  static async search(query: string): Promise<any[]> {
    console.log("Processing search request for query:", query);

    // Get user config for network options
    const userConfig = getUserYtDlpConfig();
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Use ytsearch for searching
    const searchResults = await executeYtDlpJson(`ytsearch5:${query}`, {
      ...networkConfig,
      noWarnings: true,
      skipDownload: true,
      playlistEnd: 5, // Limit to 5 results
      extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
    });

    if (!searchResults || !searchResults.entries) {
      return [];
    }

    // Format the search results
    const formattedResults = searchResults.entries.map((entry: any) => ({
      id: entry.id,
      title: entry.title,
      author: entry.uploader,
      thumbnailUrl: entry.thumbnail,
      duration: entry.duration,
      viewCount: entry.view_count,
      sourceUrl: `https://www.youtube.com/watch?v=${entry.id}`, // Default to YT for search results
      source: "youtube",
    }));

    console.log(
      `Found ${formattedResults.length} search results for "${query}"`
    );

    return formattedResults;
  }

  // Get video info without downloading
  static async getVideoInfo(url: string): Promise<{
    title: string;
    author: string;
    date: string;
    thumbnailUrl: string;
  }> {
    try {
      // Get user config for network options
      const userConfig = getUserYtDlpConfig();
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      const info = await executeYtDlpJson(url, {
        ...networkConfig,
        noWarnings: true,
        preferFreeFormats: true,
        extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
      });

      return {
        title: info.title || "Video",
        author: info.uploader || "Unknown",
        date:
          info.upload_date ||
          new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: info.thumbnail,
      };
    } catch (error) {
      console.error("Error fetching video info:", error);
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
      console.log("Fetching latest video for channel:", channelUrl);

      // Get user config for network options
      const userConfig = getUserYtDlpConfig();
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
          console.log("Modified channel URL to:", targetUrl);
        }
      }

      // Use yt-dlp to get the first video in the channel (playlist)
      const result = await executeYtDlpJson(targetUrl, {
        ...networkConfig,
        playlistEnd: 5,
        noWarnings: true,
        flatPlaylist: true, // We only need the ID/URL, not full info
        extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
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
      console.error("Error fetching latest video URL:", error);
      return null;
    }
  }

  // Download video
  static async downloadVideo(
    videoUrl: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void
  ): Promise<Video> {
    console.log("Detected URL:", videoUrl);

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
        extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
      });

      console.log("Video info:", {
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

      // Download the video
      console.log("Downloading video to:", newVideoPath);

      if (downloadId) {
        storageService.updateActiveDownload(downloadId, {
          filename: videoTitle,
          progress: 0,
        });
      }

      // Get user's yt-dlp configuration
      const userConfig = getUserYtDlpConfig();

      // Default format based on user config or fallback
      let defaultFormat =
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
      let youtubeFormat =
        "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec=aac]/bestvideo[ext=mp4][vcodec=h264]+bestaudio[ext=m4a]/best[ext=mp4]/best";

      // If user specified a format, use it (but still apply MP4 container preference)
      if (userConfig.f || userConfig.format) {
        const userFormat = userConfig.f || userConfig.format;
        defaultFormat = userFormat;
        youtubeFormat = userFormat;
        console.log("Using user-specified format:", userFormat);
      }

      // Prepare base flags from user config (excluding certain overridden options)
      const {
        output: _output, // Ignore user output template (we manage this)
        o: _o,
        writeSubs: _writeSubs, // We always enable subtitles
        writeAutoSubs: _writeAutoSubs,
        convertSubs: _convertSubs,
        f: _f, // Format is handled specially above
        format: _format,
        S: userFormatSort, // Format sort is handled specially
        formatSort: userFormatSort2,
        ...safeUserConfig
      } = userConfig;

      // Get format sort option if user specified it
      const formatSortValue = userFormatSort || userFormatSort2;

      // Prepare flags - user config first, then our required overrides
      const flags: Record<string, any> = {
        ...safeUserConfig, // Apply user config first
        output: newVideoPath, // Always use our output path
        format: defaultFormat,
        mergeOutputFormat: "mp4",
        writeSubs: true,
        writeAutoSubs: true,
        convertSubs: "vtt",
        extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
      };

      // Apply format sort if user specified it (e.g., -S res:480)
      if (formatSortValue) {
        flags.formatSort = formatSortValue;
        console.log("Using user-specified format sort:", formatSortValue);
      }

      // Add YouTube specific flags if it's a YouTube URL
      if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
        flags.format = youtubeFormat;

        // Check if user specified format filters that might need better format metadata
        const userHasFormatFilter =
          (userConfig.f || userConfig.format) &&
          (youtubeFormat.includes("[") || youtubeFormat.includes("height"));

        // Combine YouTube extractor args with PO token provider
        // Don't force player_client=android if user has format filters (web client has better format metadata)
        let ytExtractorArgs = "";

        if (
          userConfig.extractorArgs &&
          userConfig.extractorArgs.includes("youtube:")
        ) {
          // User has YouTube-specific args, use them
          ytExtractorArgs = userConfig.extractorArgs;
        } else if (!userHasFormatFilter) {
          // Only use Android client by default if no format filters (for PO token bypass)
          ytExtractorArgs = "youtube:player_client=android";
        }

        // Ensure PO token provider is included
        if (ytExtractorArgs) {
          if (!ytExtractorArgs.includes("youtubepot-bgutilscript")) {
            ytExtractorArgs += `;youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`;
          }
          flags.extractorArgs = ytExtractorArgs;
        } else {
          // Just use PO token provider without player_client override
          flags.extractorArgs = `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`;
        }

        // Only set Android-specific headers if using Android client
        if (ytExtractorArgs.includes("player_client=android")) {
          flags.addHeader = [
            "Referer:https://www.youtube.com/",
            "User-Agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          ];
        }
      }

      console.log("Final yt-dlp flags:", flags);

      // Use spawn to capture stdout for progress
      const subprocess = executeYtDlpSpawn(videoUrl, flags);

      if (onStart) {
        onStart(() => {
          console.log("Killing subprocess for download:", downloadId);
          subprocess.kill();

          // Clean up partial files
          console.log("Cleaning up partial files...");
          cleanupPartialVideoFiles(newVideoPath);
          cleanupPartialVideoFiles(newThumbnailPath);
          cleanupSubtitleFiles(newSafeBaseFilename);
        });
      }

      subprocess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        // Parse progress: [download]  23.5% of 10.00MiB at  2.00MiB/s ETA 00:05
        // Also try to match: [download] 55.8MiB of 123.45MiB at 5.67MiB/s ETA 00:12
        const progressMatch = output.match(
          /(\d+\.?\d*)%\s+of\s+([~\d\w.]+)\s+at\s+([~\d\w.\/]+)/
        );

        // Try to match format with downloaded size explicitly shown
        const progressWithSizeMatch = output.match(
          /([~\d\w.]+)\s+of\s+([~\d\w.]+)\s+at\s+([~\d\w.\/]+)/
        );

        if (progressMatch && downloadId) {
          const percentage = parseFloat(progressMatch[1]);
          const totalSize = progressMatch[2];
          const speed = progressMatch[3];

          // Calculate downloadedSize from percentage and totalSize
          const downloadedSize = calculateDownloadedSize(percentage, totalSize);

          storageService.updateActiveDownload(downloadId, {
            progress: percentage,
            totalSize: totalSize,
            downloadedSize: downloadedSize,
            speed: speed,
          });
        } else if (progressWithSizeMatch && downloadId) {
          // If we have explicit downloaded size in the output
          const downloadedSize = progressWithSizeMatch[1];
          const totalSize = progressWithSizeMatch[2];
          const speed = progressWithSizeMatch[3];

          // Calculate percentage from downloaded and total sizes
          const downloadedBytes = parseSize(downloadedSize);
          const totalBytes = parseSize(totalSize);
          const percentage =
            totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

          storageService.updateActiveDownload(downloadId, {
            progress: percentage,
            totalSize: totalSize,
            downloadedSize: downloadedSize,
            speed: speed,
          });
        }
      });

      // Wait for download to complete
      try {
        await subprocess;
      } catch (error: any) {
        if (isCancellationError(error)) {
          console.log("Download was cancelled");
          cleanupPartialVideoFiles(newVideoPath);
          cleanupSubtitleFiles(newSafeBaseFilename);
          throw new Error("Download cancelled by user");
        }
        // Re-throw other errors
        throw error;
      }

      // Check if download was cancelled (it might have been removed from active downloads)
      if (!isDownloadActive(downloadId)) {
        console.log("Download was cancelled (no longer in active downloads)");
        cleanupPartialVideoFiles(newVideoPath);
        cleanupSubtitleFiles(newSafeBaseFilename);
        throw new Error("Download cancelled by user");
      }

      console.log("Video downloaded successfully");

      // Check if download was cancelled before processing thumbnails and subtitles
      if (!isDownloadActive(downloadId)) {
        console.log(
          "Download was cancelled, skipping thumbnail and subtitle processing"
        );
        cleanupSubtitleFiles(newSafeBaseFilename);
        throw new Error("Download cancelled by user");
      }

      // Download and save the thumbnail
      thumbnailSaved = false;

      if (thumbnailUrl) {
        try {
          console.log("Downloading thumbnail from:", thumbnailUrl);

          const thumbnailResponse = await axios({
            method: "GET",
            url: thumbnailUrl,
            responseType: "stream",
          });

          const thumbnailWriter = fs.createWriteStream(newThumbnailPath);
          thumbnailResponse.data.pipe(thumbnailWriter);

          await new Promise<void>((resolve, reject) => {
            thumbnailWriter.on("finish", () => {
              thumbnailSaved = true;
              resolve();
            });
            thumbnailWriter.on("error", reject);
          });

          console.log("Thumbnail saved to:", newThumbnailPath);
        } catch (thumbnailError) {
          console.error("Error downloading thumbnail:", thumbnailError);
          // Continue even if thumbnail download fails
        }
      }

      // Check again if download was cancelled before processing subtitles
      if (!isDownloadActive(downloadId)) {
        console.log("Download was cancelled, skipping subtitle processing");
        cleanupSubtitleFiles(newSafeBaseFilename);
        throw new Error("Download cancelled by user");
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

        console.log(`Found ${subtitleFiles.length} subtitle files`);

        for (const subtitleFile of subtitleFiles) {
          // Check if download was cancelled during subtitle processing
          if (!isDownloadActive(downloadId)) {
            console.log("Download was cancelled during subtitle processing");
            cleanupSubtitleFiles(baseFilename);
            throw new Error("Download cancelled by user");
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

          console.log(
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
        if (isCancellationError(subtitleError)) {
          throw subtitleError;
        }
        console.error("Error processing subtitle files:", subtitleError);
      }
    } catch (error) {
      console.error("Error in download process:", error);
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
      console.error("Failed to extract duration from downloaded file:", e);
    }

    // Get file size
    try {
      if (fs.existsSync(finalVideoPath)) {
        const stats = fs.statSync(finalVideoPath);
        videoData.fileSize = stats.size.toString();
      }
    } catch (e) {
      console.error("Failed to get file size:", e);
    }

    // Check if video with same sourceUrl already exists
    const existingVideo = storageService.getVideoBySourceUrl(videoUrl);

    if (existingVideo) {
      // Update existing video with new subtitle information and file paths
      console.log(
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
        console.log("Video updated in database with new subtitles");
        return updatedVideo;
      }
    }

    // Save the video (new video)
    storageService.saveVideo(videoData);

    console.log("Video added to database");

    return videoData;
  }
}
