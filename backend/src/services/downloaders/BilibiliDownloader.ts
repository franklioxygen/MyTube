import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { DownloadCancelledError } from "../../errors/DownloadErrors";
import { bccToVtt } from "../../utils/bccToVtt";
import { formatBytes, safeRemove } from "../../utils/downloadUtils";
import {
    extractBilibiliVideoId,
    formatVideoFilename,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { ProgressTracker } from "../../utils/progressTracker";
import {
    executeYtDlpJson,
    executeYtDlpSpawn,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";
import * as storageService from "../storageService";
import { Collection, Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";

export interface BilibiliVideoInfo {
  title: string;
  author: string;
  date: string;
  thumbnailUrl: string | null;
  thumbnailSaved: boolean;
  description?: string;
  error?: string;
}

export interface BilibiliPartsCheckResult {
  success: boolean;
  videosNumber: number;
  title?: string;
}

export interface BilibiliCollectionCheckResult {
  success: boolean;
  type: "collection" | "series" | "none";
  id?: number;
  title?: string;
  count?: number;
  mid?: number;
}

export interface BilibiliVideoItem {
  bvid: string;
  title: string;
  aid: number;
}

export interface BilibiliVideosResult {
  success: boolean;
  videos: BilibiliVideoItem[];
}

export interface DownloadResult {
  success: boolean;
  videoData?: Video;
  error?: string;
}

export interface CollectionDownloadResult {
  success: boolean;
  collectionId?: string;
  videosDownloaded?: number;
  error?: string;
}

export class BilibiliDownloader extends BaseDownloader {
  // Implementation of IDownloader.getVideoInfo
  async getVideoInfo(url: string): Promise<VideoInfo> {
    const videoId = extractBilibiliVideoId(url);
    if (!videoId) {
      throw new Error("Invalid Bilibili URL");
    }
    return BilibiliDownloader.getVideoInfo(videoId);
  }

  // Get video info without downloading (Static wrapper)
  static async getVideoInfo(videoId: string): Promise<VideoInfo> {
    try {
      const videoUrl = `https://www.bilibili.com/video/${videoId}`;

      // Get user config for network options
      const userConfig = getUserYtDlpConfig(videoUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);
      const info = await executeYtDlpJson(videoUrl, {
        ...networkConfig,
        noWarnings: true,
      });

      return {
        title: info.title || "Bilibili Video",
        author: info.uploader || info.channel || "Bilibili User",
        date:
          info.upload_date ||
          info.release_date ||
          new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: info.thumbnail || null,
        description: info.description, // Added description
      };
    } catch (error) {
      logger.error("Error fetching Bilibili video info with yt-dlp:", error);
      // Fallback to API
      try {
        const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
        const response = await axios.get(apiUrl);

        if (response.data && response.data.data) {
          const videoInfo = response.data.data;
          return {
            title: videoInfo.title || "Bilibili Video",
            author: videoInfo.owner?.name || "Bilibili User",
            date: new Date(videoInfo.pubdate * 1000)
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, ""),
            thumbnailUrl: videoInfo.pic || null,
            description: videoInfo.desc,
          };
        }
      } catch (apiError) {
        logger.error("Error fetching Bilibili video info from API:", apiError);
      }
      return {
        title: "Bilibili Video",
        author: "Bilibili User",
        date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: null,
      };
    }
  }

  // Implementation of IDownloader.downloadVideo
  // Note: For Bilibili, this defaults to downloading single part/video.
  async downloadVideo(url: string, options?: DownloadOptions): Promise<Video> {
    // Assuming single part download for simplicity in the general interface
    const result = await BilibiliDownloader.downloadSinglePart(
      url,
      1,
      1,
      "",
      options?.downloadId,
      options?.onStart
    );

    if (result.success && result.videoData) {
      return result.videoData;
    }

    throw new Error(result.error || "Failed to download Bilibili video");
  }

  // Get author info from Bilibili space URL
  static async getAuthorInfo(mid: string): Promise<{
    name: string;
    mid: string;
  }> {
    try {
      // Use the card API which doesn't require WBI signing
      const apiUrl = `https://api.bilibili.com/x/web-interface/card?mid=${mid}`;
      logger.info("Fetching Bilibili author info from:", apiUrl);

      const response = await axios.get(apiUrl, {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (response.data && response.data.data && response.data.data.card) {
        const card = response.data.data.card;
        return {
          name: card.name || "Bilibili User",
          mid: mid,
        };
      }

      return { name: "Bilibili User", mid };
    } catch (error) {
      logger.error("Error fetching Bilibili author info:", error);
      return { name: "Bilibili User", mid };
    }
  }

  // Get the latest video URL from a Bilibili author's space
  static async getLatestVideoUrl(spaceUrl: string): Promise<string | null> {
    try {
      logger.info("Fetching latest video for Bilibili space:", spaceUrl);

      // Extract mid from the space URL
      const { extractBilibiliMid } = await import("../../utils/helpers");
      const mid = extractBilibiliMid(spaceUrl);

      if (!mid) {
        logger.error(
          "Could not extract mid from Bilibili space URL:",
          spaceUrl
        );
        return null;
      }

      logger.info("Extracted mid:", mid);

      // Get user config for network options (cookies, proxy, etc.)
      const userConfig = getUserYtDlpConfig(spaceUrl);
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      // Use yt-dlp to get the latest video from the user's space
      // Bilibili space URL format: https://space.bilibili.com/{mid}/video
      const videosUrl = `https://space.bilibili.com/${mid}/video`;

      try {
        const result = await executeYtDlpJson(videosUrl, {
          ...networkConfig,
          playlistEnd: 1, // Only get the first (latest) video
          flatPlaylist: true, // Don't download, just get info
          noWarnings: true,
        });

        // If it's a playlist/channel, 'entries' will contain the videos
        if (result.entries && result.entries.length > 0) {
          const latestVideo = result.entries[0];
          const bvid = latestVideo.id;

          if (bvid) {
            const videoUrl = `https://www.bilibili.com/video/${bvid}`;
            logger.info("Found latest Bilibili video:", videoUrl);
            return videoUrl;
          }

          // Fallback to url if id is not available
          if (latestVideo.url) {
            logger.info("Found latest Bilibili video:", latestVideo.url);
            return latestVideo.url;
          }
        }
      } catch (ytdlpError) {
        logger.error("yt-dlp failed, trying API fallback:", ytdlpError);

        // Fallback: Try the non-WBI API endpoint
        const apiUrl = `https://api.bilibili.com/x/space/arc/search?mid=${mid}&pn=1&ps=1&order=pubdate`;

        const response = await axios.get(apiUrl, {
          headers: {
            Referer: "https://www.bilibili.com",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });

        if (
          response.data &&
          response.data.data &&
          response.data.data.list &&
          response.data.data.list.vlist
        ) {
          const videos = response.data.data.list.vlist;

          if (videos.length > 0) {
            const latestVideo = videos[0];
            const bvid = latestVideo.bvid;

            if (bvid) {
              const videoUrl = `https://www.bilibili.com/video/${bvid}`;
              logger.info(
                "Found latest Bilibili video (API fallback):",
                videoUrl
              );
              return videoUrl;
            }
          }
        }
      }

      logger.info("No videos found for Bilibili space:", spaceUrl);
      return null;
    } catch (error) {
      logger.error("Error fetching latest Bilibili video:", error);
      return null;
    }
  }

  // Wrapper for internal download logic, matching existing static method
  static async downloadVideo(
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
        logger.info(
          "Using user-specified format for Bilibili:",
          downloadFormat
        );
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
        writeAutoSubs:
          userWriteAutoSubs !== undefined ? userWriteAutoSubs : true,
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
        const downloader = new BilibiliDownloader();
        downloader.handleCancellationError(error, async () => {
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
      const downloader = new BilibiliDownloader();
      try {
        downloader.throwIfCancelled(downloadId);
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
        const downloader = new BilibiliDownloader();
        thumbnailSaved = await downloader.downloadThumbnail(
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

  // Helper function to check if a Bilibili video has multiple parts
  static async checkVideoParts(
    videoId: string
  ): Promise<BilibiliPartsCheckResult> {
    try {
      // Try to get video info from Bilibili API
      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
      logger.info("Fetching video info from API to check parts:", apiUrl);

      const response = await axios.get(apiUrl);

      if (response.data && response.data.data) {
        const videoInfo = response.data.data;
        const videosNumber = videoInfo.videos || 1;

        logger.info(`Bilibili video has ${videosNumber} parts`);

        return {
          success: true,
          videosNumber,
          title: videoInfo.title || "Bilibili Video",
        };
      }

      return { success: false, videosNumber: 1 };
    } catch (error) {
      logger.error("Error checking Bilibili video parts:", error);
      return { success: false, videosNumber: 1 };
    }
  }

  // Helper function to check if a Bilibili video belongs to a collection or series
  static async checkCollectionOrSeries(
    videoId: string
  ): Promise<BilibiliCollectionCheckResult> {
    try {
      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
      logger.info("Checking if video belongs to collection/series:", apiUrl);

      const response = await axios.get(apiUrl, {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (response.data && response.data.data) {
        const videoInfo = response.data.data;
        const mid = videoInfo.owner?.mid;

        // Check for collection (ugc_season)
        if (videoInfo.ugc_season) {
          const season = videoInfo.ugc_season;
          logger.info(`Video belongs to collection: ${season.title}`);
          return {
            success: true,
            type: "collection",
            id: season.id,
            title: season.title,
            count: season.ep_count || 0,
            mid: mid,
          };
        }

        // If no collection found, return none
        return { success: true, type: "none" };
      }

      return { success: false, type: "none" };
    } catch (error) {
      logger.error("Error checking collection/series:", error);
      return { success: false, type: "none" };
    }
  }

  // Helper function to get all videos from a Bilibili collection
  static async getCollectionVideos(
    mid: number,
    seasonId: number
  ): Promise<BilibiliVideosResult> {
    try {
      const allVideos: BilibiliVideoItem[] = [];
      let pageNum = 1;
      const pageSize = 30;
      let hasMore = true;

      logger.info(
        `Fetching collection videos for mid=${mid}, season_id=${seasonId}`
      );

      while (hasMore) {
        const apiUrl = `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list`;
        const params = {
          mid: mid,
          season_id: seasonId,
          page_num: pageNum,
          page_size: pageSize,
          sort_reverse: false,
        };

        logger.info(`Fetching page ${pageNum} of collection...`);

        const response = await axios.get(apiUrl, {
          params,
          headers: {
            Referer: "https://www.bilibili.com",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        });

        if (response.data && response.data.data) {
          const data = response.data.data;
          const archives = data.archives || [];

          logger.info(`Got ${archives.length} videos from page ${pageNum}`);

          archives.forEach((video: any) => {
            allVideos.push({
              bvid: video.bvid,
              title: video.title,
              aid: video.aid,
            });
          });

          // Check if there are more pages
          const total = data.page?.total || 0;
          hasMore = allVideos.length < total;
          pageNum++;
        } else {
          hasMore = false;
        }
      }

      logger.info(`Total videos in collection: ${allVideos.length}`);
      return { success: true, videos: allVideos };
    } catch (error) {
      logger.error("Error fetching collection videos:", error);
      return { success: false, videos: [] };
    }
  }

  // Helper function to get all videos from a Bilibili series
  static async getSeriesVideos(
    mid: number,
    seriesId: number
  ): Promise<BilibiliVideosResult> {
    try {
      const allVideos: BilibiliVideoItem[] = [];
      let pageNum = 1;
      const pageSize = 30;
      let hasMore = true;

      logger.info(
        `Fetching series videos for mid=${mid}, series_id=${seriesId}`
      );

      while (hasMore) {
        const apiUrl = `https://api.bilibili.com/x/series/archives`;
        const params = {
          mid: mid,
          series_id: seriesId,
          pn: pageNum,
          ps: pageSize,
        };

        logger.info(`Fetching page ${pageNum} of series...`);

        const response = await axios.get(apiUrl, {
          params,
          headers: {
            Referer: "https://www.bilibili.com",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        });

        if (response.data && response.data.data) {
          const data = response.data.data;
          const archives = data.archives || [];

          logger.info(`Got ${archives.length} videos from page ${pageNum}`);

          archives.forEach((video: any) => {
            allVideos.push({
              bvid: video.bvid,
              title: video.title,
              aid: video.aid,
            });
          });

          // Check if there are more pages
          const page = data.page || {};
          hasMore =
            archives.length === pageSize &&
            allVideos.length < (page.total || 0);
          pageNum++;
        } else {
          hasMore = false;
        }
      }

      logger.info(`Total videos in series: ${allVideos.length}`);
      return { success: true, videos: allVideos };
    } catch (error) {
      logger.error("Error fetching series videos:", error);
      return { success: false, videos: [] };
    }
  }

  // Helper function to download a single Bilibili part
  static async downloadSinglePart(
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
        bilibiliInfo = await BilibiliDownloader.downloadVideo(
          url,
          videoPath,
          thumbnailPath,
          downloadId,
          onStart
        );
      } catch (error: any) {
        // If download was cancelled, re-throw immediately without downloading subtitles or creating video data
        const downloader = new BilibiliDownloader();
        downloader.handleCancellationError(error);
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
      const downloader = new BilibiliDownloader();
      try {
        downloader.throwIfCancelled(downloadId);
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
          downloader.throwIfCancelled(downloadId);
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
          "../../services/metadataService"
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
        downloader.throwIfCancelled(downloadId);
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
        subtitles = await BilibiliDownloader.downloadSubtitles(
          url,
          newSafeBaseFilename
        );
        logger.info(`Downloaded ${subtitles.length} subtitles`);
      } catch (e) {
        // If it's a cancellation error, re-throw it
        downloader.handleCancellationError(e);
        logger.error("Error downloading subtitles:", e);
      }

      // Check if download was cancelled before creating video data
      try {
        downloader.throwIfCancelled(downloadId);
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

  // Helper function to download all videos from a Bilibili collection or series
  static async downloadCollection(
    collectionInfo: BilibiliCollectionCheckResult,
    collectionName: string,
    downloadId: string
  ): Promise<CollectionDownloadResult> {
    try {
      const { type, id, mid, title, count } = collectionInfo;

      logger.info(`Starting download of ${type}: ${title} (${count} videos)`);

      // Add to active downloads
      if (downloadId) {
        storageService.addActiveDownload(
          downloadId,
          `Downloading ${type}: ${title}`
        );
      }

      // Fetch all videos from the collection/series
      let videosResult: BilibiliVideosResult;
      if (type === "collection" && mid && id) {
        videosResult = await BilibiliDownloader.getCollectionVideos(mid, id);
      } else if (type === "series" && mid && id) {
        videosResult = await BilibiliDownloader.getSeriesVideos(mid, id);
      } else {
        throw new Error(`Unknown type: ${type}`);
      }

      if (!videosResult.success || videosResult.videos.length === 0) {
        throw new Error(`Failed to fetch videos from ${type}`);
      }

      const videos = videosResult.videos;
      logger.info(`Found ${videos.length} videos to download`);

      // Create a MyTube collection for these videos
      const mytubeCollection: Collection = {
        id: Date.now().toString(),
        name: collectionName || title || "Collection",
        videos: [],
        createdAt: new Date().toISOString(),
        title: collectionName || title || "Collection",
      };
      storageService.saveCollection(mytubeCollection);
      const mytubeCollectionId = mytubeCollection.id;

      logger.info(`Created MyTube collection: ${mytubeCollection.name}`);

      // Download each video sequentially
      for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const videoNumber = i + 1;

        // Update status
        if (downloadId) {
          storageService.addActiveDownload(
            downloadId,
            `Downloading ${videoNumber}/${videos.length}: ${video.title}`
          );
        }

        logger.info(
          `Downloading video ${videoNumber}/${videos.length}: ${video.title}`
        );

        // Construct video URL
        const videoUrl = `https://www.bilibili.com/video/${video.bvid}`;

        try {
          // Download this video
          const result = await BilibiliDownloader.downloadSinglePart(
            videoUrl,
            videoNumber,
            videos.length,
            title || "Collection",
            downloadId
          );

          // If download was successful, add to collection
          if (result.success && result.videoData) {
            storageService.atomicUpdateCollection(
              mytubeCollectionId,
              (collection) => {
                collection.videos.push(result.videoData!.id);
                return collection;
              }
            );

            logger.info(
              `Added video ${videoNumber}/${videos.length} to collection`
            );
          } else {
            logger.error(
              `Failed to download video ${videoNumber}/${videos.length}: ${video.title}`
            );
          }
        } catch (videoError) {
          logger.error(
            `Error downloading video ${videoNumber}/${videos.length}:`,
            videoError
          );
          // Continue with next video even if one fails
        }

        // Small delay between downloads to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // All videos downloaded, remove from active downloads
      if (downloadId) {
        storageService.removeActiveDownload(downloadId);
      }

      logger.info(`Finished downloading ${type}: ${title}`);

      return {
        success: true,
        collectionId: mytubeCollectionId,
        videosDownloaded: videos.length,
      };
    } catch (error: any) {
      logger.error(`Error downloading ${collectionInfo.type}:`, error);
      if (downloadId) {
        storageService.removeActiveDownload(downloadId);
      }
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Helper function to download remaining Bilibili parts in sequence
  static async downloadRemainingParts(
    baseUrl: string,
    startPart: number,
    totalParts: number,
    seriesTitle: string,
    collectionId: string,
    downloadId: string
  ): Promise<void> {
    try {
      // Add to active downloads if ID is provided
      if (downloadId) {
        storageService.addActiveDownload(
          downloadId,
          `Downloading ${seriesTitle}`
        );
      }

      for (let part = startPart; part <= totalParts; part++) {
        // Update status to show which part is being downloaded
        if (downloadId) {
          storageService.addActiveDownload(
            downloadId,
            `Downloading part ${part}/${totalParts}: ${seriesTitle}`
          );
        }

        // Construct URL for this part
        const partUrl = `${baseUrl}?p=${part}`;

        // Download this part
        const result = await BilibiliDownloader.downloadSinglePart(
          partUrl,
          part,
          totalParts,
          seriesTitle,
          downloadId
        );

        // If download was successful and we have a collection ID, add to collection
        if (result.success && collectionId && result.videoData) {
          try {
            storageService.atomicUpdateCollection(
              collectionId,
              (collection) => {
                collection.videos.push(result.videoData!.id);
                return collection;
              }
            );

            logger.info(
              `Added part ${part}/${totalParts} to collection ${collectionId}`
            );
          } catch (collectionError) {
            logger.error(
              `Error adding part ${part}/${totalParts} to collection:`,
              collectionError
            );
          }
        }

        // Small delay between downloads to avoid overwhelming the server
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // All parts downloaded, remove from active downloads
      if (downloadId) {
        storageService.removeActiveDownload(downloadId);
      }
      logger.info(
        `All ${totalParts} parts of "${seriesTitle}" downloaded successfully`
      );
    } catch (error) {
      logger.error("Error downloading remaining Bilibili parts:", error);
      if (downloadId) {
        storageService.removeActiveDownload(downloadId);
      }
    }
  }

  // Helper function to get cookies from cookies.txt
  static getCookieHeader(): string {
    try {
      const { DATA_DIR } = require("../../config/paths");
      const cookiesPath = path.join(DATA_DIR, "cookies.txt");
      if (fs.existsSync(cookiesPath)) {
        const content = fs.readFileSync(cookiesPath, "utf8");
        const lines = content.split("\n");
        const cookies = [];
        for (const line of lines) {
          if (line.startsWith("#") || !line.trim()) continue;
          const parts = line.split("\t");
          if (parts.length >= 7) {
            const name = parts[5];
            const value = parts[6].trim();
            cookies.push(`${name}=${value}`);
          }
        }
        return cookies.join("; ");
      }
    } catch (e) {
      logger.error("Error reading cookies.txt:", e);
    }
    return "";
  }

  // Helper function to download subtitles
  static async downloadSubtitles(
    videoUrl: string,
    baseFilename: string
  ): Promise<Array<{ language: string; filename: string; path: string }>> {
    try {
      const videoId = extractBilibiliVideoId(videoUrl);
      if (!videoId) return [];

      const cookieHeader = BilibiliDownloader.getCookieHeader();
      if (!cookieHeader) {
        logger.warn(
          "WARNING: No cookies found in cookies.txt. Bilibili subtitles usually require login."
        );
      }

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.bilibili.com",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      };

      // Get CID first
      const viewApiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
      let viewResponse;
      try {
        viewResponse = await axios.get(viewApiUrl, { headers });
      } catch (viewError: any) {
        logger.error(`Failed to fetch view API: ${viewError.message}`);
        return [];
      }

      const cid = viewResponse.data?.data?.cid;

      if (!cid) {
        logger.info("Could not find CID for video");
        return [];
      }

      // Get subtitles from player API first (player API has actual URLs)
      const playerApiUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${videoId}&cid=${cid}`;
      logger.info(`Fetching subtitles from: ${playerApiUrl}`);
      let playerResponse;
      try {
        playerResponse = await axios.get(playerApiUrl, { headers });
      } catch (playerError: any) {
        logger.warn(`Player API failed: ${playerError.message}`);
        // Continue to check view API fallback
        playerResponse = null;
      }

      if (cookieHeader && !cookieHeader.includes("SESSDATA")) {
        logger.warn(
          "WARNING: SESSDATA cookie not found! This is required for Bilibili authentication."
        );
      }

      let subtitlesData = playerResponse?.data?.data?.subtitle?.subtitles;

      // Fallback: Check if subtitles are in the view response (sometimes they are)
      if (!subtitlesData || subtitlesData.length === 0) {
        logger.info(
          "No subtitles in player API, checking view API response..."
        );
        const viewSubtitles = viewResponse.data?.data?.subtitle?.list;
        if (viewSubtitles && viewSubtitles.length > 0) {
          logger.info(`Found ${viewSubtitles.length} subtitles in view API`);
          subtitlesData = viewSubtitles;
        }
      }

      if (!subtitlesData) {
        logger.info("No subtitle field in response data");
      } else if (!Array.isArray(subtitlesData)) {
        logger.info("Subtitles field is not an array");
      } else {
        logger.info(`Found ${subtitlesData.length} subtitles`);
      }

      if (!subtitlesData || !Array.isArray(subtitlesData)) {
        logger.info("No subtitles found in API response");
        return [];
      }

      const savedSubtitles = [];

      // Ensure subtitles directory exists
      fs.ensureDirSync(SUBTITLES_DIR);

      // Process subtitles (matching v1.5.14 approach - simple and direct)
      for (const sub of subtitlesData) {
        const lang = sub.lan;
        const subUrl = sub.subtitle_url;

        // Skip subtitles without URL
        if (!subUrl) continue;

        // Ensure URL is absolute (sometimes it starts with //)
        const absoluteSubUrl = subUrl.startsWith("//")
          ? `https:${subUrl}`
          : subUrl;

        logger.info(`Downloading subtitle (${lang}): ${absoluteSubUrl}`);

        // Do NOT send cookies to the subtitle CDN (hdslb.com) as it can cause 400 Bad Request (Header too large)
        // and they are not needed for the CDN file itself.
        const cdnHeaders = {
          "User-Agent": headers["User-Agent"],
          Referer: headers["Referer"],
        };

        try {
          const subResponse = await axios.get(absoluteSubUrl, {
            headers: cdnHeaders,
          });
          const vttContent = bccToVtt(subResponse.data);

          if (vttContent) {
            const subFilename = `${baseFilename}.${lang}.vtt`;
            const subPath = path.join(SUBTITLES_DIR, subFilename);

            fs.writeFileSync(subPath, vttContent);
            logger.info(`Saved subtitle file: ${subPath}`);

            savedSubtitles.push({
              language: lang,
              filename: subFilename,
              path: `/subtitles/${subFilename}`,
            });
          } else {
            logger.warn(`Failed to convert subtitle to VTT format for ${lang}`);
          }
        } catch (subError: any) {
          logger.error(
            `Failed to download subtitle (${lang}): ${subError.message}`
          );
          continue;
        }
      }

      return savedSubtitles;
    } catch (error) {
      logger.error("Error in downloadSubtitles:", error);
      return [];
    }
  }
}
