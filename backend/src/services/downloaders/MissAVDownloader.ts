import * as cheerio from "cheerio";
import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";
import { DATA_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { cleanupTemporaryFiles, safeRemove } from "../../utils/downloadUtils";
import { formatVideoFilename } from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { ProgressTracker } from "../../utils/progressTracker";
import { validateUrl } from "../../utils/security";
import {
  flagsToArgs,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
} from "../../utils/ytDlpUtils";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";

const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";

export class MissAVDownloader extends BaseDownloader {
  // Implementation of IDownloader.getVideoInfo
  async getVideoInfo(url: string): Promise<VideoInfo> {
    return MissAVDownloader.getVideoInfo(url);
  }

  // Get video info without downloading (Static wrapper)
  static async getVideoInfo(url: string): Promise<VideoInfo> {
    try {
      // Validate URL to prevent SSRF attacks
      const validatedUrl = validateUrl(url);
      
      logger.info(`Fetching page content for ${validatedUrl} with Puppeteer...`);

      const USER_AGENT =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--user-agent=${USER_AGENT}`,
        ],
      });
      const page = await browser.newPage();

      await page.goto(validatedUrl, { waitUntil: "networkidle2", timeout: 60000 });

      const html = await page.content();
      await browser.close();

      const $ = cheerio.load(html);
      const pageTitle = $('meta[property="og:title"]').attr("content");
      const ogImage = $('meta[property="og:image"]').attr("content");

      const urlObj = new URL(url);
      const author = urlObj.hostname.replace("www.", "");

      return {
        title: pageTitle || "MissAV Video",
        author: author,
        date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: ogImage || null,
      };
    } catch (error) {
      logger.error("Error fetching MissAV video info:", error);
      const urlObj = new URL(url);
      const author = urlObj.hostname.replace("www.", "");

      return {
        title: "MissAV Video",
        author: author,
        date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: null,
      };
    }
  }

  // Implementation of IDownloader.downloadVideo
  async downloadVideo(url: string, options?: DownloadOptions): Promise<Video> {
    return MissAVDownloader.downloadVideo(
      url,
      options?.downloadId,
      options?.onStart
    );
  }

  // Helper function to download MissAV video (Static wrapper/Implementation)
  static async downloadVideo(
    url: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void
  ): Promise<Video> {
    logger.info("Detected MissAV/123av URL:", url);

    const timestamp = Date.now();

    // Ensure directories exist
    fs.ensureDirSync(VIDEOS_DIR);
    fs.ensureDirSync(IMAGES_DIR);

    const urlObj = new URL(url);
    const author = urlObj.hostname.replace("www.", "");

    let videoTitle = "MissAV Video";
    let videoAuthor = author;
    let videoDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    let thumbnailUrl: string | null = null;
    let thumbnailSaved = false;

    try {
      // 1. Extract m3u8 URL and metadata using Puppeteer
      // (yt-dlp doesn't support MissAV natively, so we extract the m3u8 URL first)
      // Set a real user agent
      const USER_AGENT =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

      // Validate URL to prevent SSRF attacks
      const validatedUrl = validateUrl(url);
      
      logger.info("Launching Puppeteer to extract m3u8 URL...");

      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--user-agent=${USER_AGENT}`,
        ],
      });
      const page = await browser.newPage();


      // Setup request listener to find m3u8 URLs
      const m3u8Urls: string[] = [];
      page.on("request", (request) => {
        const reqUrl = request.url();
        if (reqUrl.includes(".m3u8") && !reqUrl.includes("preview")) {
          logger.info("Found m3u8 URL via network interception:", reqUrl);
          if (!m3u8Urls.includes(reqUrl)) {
            m3u8Urls.push(reqUrl);
          }
        }
      });

      logger.info("Navigating to:", validatedUrl);
      await page.goto(validatedUrl, { waitUntil: "networkidle2", timeout: 60000 });

      const html = await page.content();
      await browser.close();

      // 2. Extract metadata using cheerio
      const $ = cheerio.load(html);
      const pageTitle = $('meta[property="og:title"]').attr("content");
      if (pageTitle) {
        videoTitle = pageTitle;
      }

      const ogImage = $('meta[property="og:image"]').attr("content");
      if (ogImage) {
        thumbnailUrl = ogImage;
      }

      logger.info("Extracted metadata:", {
        title: videoTitle,
        thumbnail: thumbnailUrl,
      });

      // 3. Get user's yt-dlp configuration early to check for format sort
      // This helps determine m3u8 URL selection strategy and will be reused later
      const userConfig = getUserYtDlpConfig(url);
      const hasFormatSort = !!(userConfig.S || userConfig.formatSort);

      // 4. Select the best m3u8 URL from collected URLs
      let m3u8Url = MissAVDownloader.selectBestM3u8Url(m3u8Urls, hasFormatSort);

      if (m3u8Url) {
        logger.info(
          `Selected m3u8 URL from ${m3u8Urls.length} candidates (format sort: ${hasFormatSort}):`,
          m3u8Url
        );
        const alternatives = m3u8Urls.filter((u) => u !== m3u8Url);
        if (alternatives.length > 0) {
          logger.info("Alternative URLs:", alternatives);
        }
      }

      // 5. If m3u8 URL was not found via network, try regex extraction as fallback
      if (!m3u8Url) {
        logger.info(
          "m3u8 URL not found via network, trying regex extraction..."
        );

        // Logic ported from: https://github.com/smalltownjj/yt-dlp-plugin-missav/blob/main/yt_dlp_plugins/extractor/missav.py
        const m3u8Match = html.match(/m3u8\|[^"]+\|playlist\|source/);

        if (m3u8Match) {
          const matchString = m3u8Match[0];
          const cleanString = matchString
            .replace("m3u8|", "")
            .replace("|playlist|source", "");
          const urlWords = cleanString.split("|");

          const videoIndex = urlWords.indexOf("video");
          if (videoIndex !== -1) {
            const protocol = urlWords[videoIndex - 1];
            const videoFormat = urlWords[videoIndex + 1];
            const m3u8UrlPath = urlWords.slice(0, 5).reverse().join("-");
            const baseUrlPath = urlWords
              .slice(5, videoIndex - 1)
              .reverse()
              .join(".");
            const regexExtractedUrl = `${protocol}://${baseUrlPath}/${m3u8UrlPath}/${videoFormat}/${urlWords[videoIndex]}.m3u8`;
            logger.info("Reconstructed m3u8 URL via regex:", regexExtractedUrl);

            if (!m3u8Urls.includes(regexExtractedUrl)) {
              m3u8Urls.push(regexExtractedUrl);
            }
            m3u8Url = regexExtractedUrl;
          }
        }
      }

      if (!m3u8Url) {
        const debugFile = path.join(DATA_DIR, `missav_debug_${timestamp}.html`);
        fs.writeFileSync(debugFile, html);
        logger.error(`Could not find m3u8 URL. HTML dumped to ${debugFile}`);
        throw new Error(
          "Could not find m3u8 URL in page source or network requests"
        );
      }

      // 5. Get network configuration from user config (already loaded above)
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      // Get merge output format from user config or default to mp4
      const mergeOutputFormat = userConfig.mergeOutputFormat || "mp4";

      // 6. Update the safe base filename with the actual title
      // Use the correct extension based on merge output format
      const newSafeBaseFilename = formatVideoFilename(
        videoTitle,
        videoAuthor,
        videoDate
      );
      const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
      const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

      const newVideoPath = path.join(VIDEOS_DIR, newVideoFilename);
      const settings = storageService.getSettings();
      const moveThumbnailsToVideoFolder =
        settings.moveThumbnailsToVideoFolder || false;
      const thumbnailDir = moveThumbnailsToVideoFolder
        ? VIDEOS_DIR
        : IMAGES_DIR;
      const newThumbnailPath = path.join(thumbnailDir, newThumbnailFilename);

      // 7. Download the video using yt-dlp with the m3u8 URL
      logger.info("Downloading video from m3u8 URL using yt-dlp:", m3u8Url);
      logger.info("Downloading video to:", newVideoPath);
      logger.info("Download ID:", downloadId);

      if (downloadId) {
        storageService.updateActiveDownload(downloadId, {
          filename: videoTitle,
          progress: 0,
        });
      } else {
        logger.warn(
          "[MissAV] Warning: downloadId is not set, progress updates will not work!"
        );
      }

      // Get format sort option if user specified it
      const formatSortValue = userConfig.S || userConfig.formatSort;

      // Default format - use bestvideo*+bestaudio/best to support highest resolution
      // This allows downloading 1080p or higher if available
      let downloadFormat = "bestvideo*+bestaudio/best";

      // If user specified a format, use it
      if (userConfig.f || userConfig.format) {
        downloadFormat = userConfig.f || userConfig.format;
        logger.info("Using user-specified format for MissAV:", downloadFormat);
      } else if (formatSortValue) {
        // If user specified format sort but not format, use a more permissive format
        // that allows format sort to work properly with m3u8 streams
        // This ensures format sort (e.g., -S res:360) can properly filter resolutions
        downloadFormat = "bestvideo+bestaudio/best";
        logger.info(
          "Using permissive format with format sort for MissAV:",
          downloadFormat,
          "format sort:",
          formatSortValue
        );
      }

      // Prepare flags for yt-dlp to download m3u8 stream
      // Dynamically determine Referer based on the input URL domain
      const urlObjForReferer = new URL(url);
      const referer = `${urlObjForReferer.protocol}//${urlObjForReferer.host}/`;
      logger.info("Using Referer:", referer);

      // Prepare flags object - merge user config with required settings
      const flags: any = {
        ...networkConfig, // Apply network settings (proxy, etc.)
        output: newVideoPath,
        format: downloadFormat,
        mergeOutputFormat: mergeOutputFormat,
        addHeader: [`Referer:${referer}`, `User-Agent:${USER_AGENT}`],
      };

      // Apply format sort if user specified it
      if (formatSortValue) {
        flags.formatSort = formatSortValue;
        logger.info("Using format sort for MissAV:", formatSortValue);
      }

      logger.info("Final MissAV yt-dlp flags:", flags);

      // Use ProgressTracker for centralized progress parsing
      const progressTracker = new ProgressTracker(downloadId);
      const parseProgress = (output: string, source: "stdout" | "stderr") => {
        // Log raw output for debugging (only first few lines or if it contains progress)
        const lines = output.split("\n").filter((line) => line.trim());
        if (lines.length > 0 && lines[0].includes("[download]")) {
          logger.info(
            `[MissAV Progress ${source}]:`,
            lines[0].substring(0, 100)
          );
        }
        progressTracker.parseAndUpdate(output);
      };

      logger.info("Starting yt-dlp process with spawn...");

      // Convert flags object to array of args using the utility function
      const args = [m3u8Url, ...flagsToArgs(flags)];

      // Log the full command for debugging
      logger.info("Executing yt-dlp command:", YT_DLP_PATH, args.join(" "));

      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(YT_DLP_PATH, args);

          child.stdout.on("data", (data) => {
            parseProgress(data.toString(), "stdout");
          });

          child.stderr.on("data", (data) => {
            parseProgress(data.toString(), "stderr");
          });

          child.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`yt-dlp process exited with code ${code}`));
            }
          });

          child.on("error", (err) => {
            reject(err);
          });

          if (onStart) {
            onStart(async () => {
              logger.info("Killing subprocess for download:", downloadId);
              child.kill();

              // Clean up temporary files created by yt-dlp (*.part, *.ytdl, etc.)
              logger.info("Cleaning up temporary files...");
              await cleanupTemporaryFiles(newVideoPath);
            });
          }
        });

        logger.info("Video downloaded successfully");
      } catch (err: any) {
        // Use base class helper for cancellation handling
        const downloader = new MissAVDownloader();
        await downloader.handleCancellationError(err, async () => {
          await cleanupTemporaryFiles(newVideoPath);
        });
        logger.error("yt-dlp execution failed:", err);
        throw err;
      }

      // Check if download was cancelled (it might have been removed from active downloads)
      const downloader = new MissAVDownloader();
      try {
        downloader.throwIfCancelled(downloadId);
      } catch (error) {
        await cleanupTemporaryFiles(newVideoPath);
        throw error;
      }

      // 8. Download and save the thumbnail
      if (thumbnailUrl) {
        // Use base class method via temporary instance
        let axiosConfig = {};
        if (userConfig.proxy) {
          try {
            axiosConfig = getAxiosProxyConfig(userConfig.proxy);
          } catch (error) {
            if (error instanceof InvalidProxyError) {
              logger.warn(
                "Invalid proxy configuration for thumbnail download, proceeding without proxy:",
                error.message
              );
            } else {
              throw error;
            }
          }
        }
        const downloader = new MissAVDownloader();
        thumbnailSaved = await downloader.downloadThumbnail(
          thumbnailUrl,
          newThumbnailPath,
          axiosConfig
        );
      }

      // 9. Get video duration
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
        logger.error("Failed to extract duration from MissAV video:", e);
      }

      // 10. Get file size
      let fileSize: string | undefined;
      try {
        if (fs.existsSync(newVideoPath)) {
          const stats = fs.statSync(newVideoPath);
          fileSize = stats.size.toString();
        }
      } catch (e) {
        logger.error("Failed to get file size:", e);
      }

      // 11. Save metadata
      const videoData: Video = {
        id: timestamp.toString(),
        title: videoTitle,
        author: videoAuthor,
        date: videoDate,
        source: "missav",
        sourceUrl: url,
        videoFilename: newVideoFilename,
        thumbnailFilename: thumbnailSaved ? newThumbnailFilename : undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        videoPath: `/videos/${newVideoFilename}`,
        thumbnailPath: thumbnailSaved
          ? moveThumbnailsToVideoFolder
            ? `/videos/${newThumbnailFilename}`
            : `/images/${newThumbnailFilename}`
          : null,
        duration: duration,
        fileSize: fileSize,
        addedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      storageService.saveVideo(videoData);
      logger.info("MissAV video saved to database");


      // Add video to author collection if enabled
      const authorCollection = storageService.addVideoToAuthorCollection(
        videoData.id,
        videoAuthor,
        settings.saveAuthorFilesToCollection || false
      );

      if (authorCollection) {
        // If video was added to a collection, the file paths might have changed
        // Fetch the updated video from storage (using videoData.id which is timestamp string)
        const updatedVideo = storageService.getVideoById(videoData.id);
        if (updatedVideo) {
          return updatedVideo;
        }
      }

      return videoData;
    } catch (error: any) {
      logger.error("Error in downloadMissAVVideo:", error);
      // Cleanup - try to get the correct extension from config, fallback to mp4
      try {
        const cleanupConfig = getUserYtDlpConfig(url);
        const cleanupFormat = cleanupConfig.mergeOutputFormat || "mp4";
        const cleanupSafeBaseFilename = formatVideoFilename(
          videoTitle,
          videoAuthor,
          videoDate
        );
        const cleanupVideoPath = path.join(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.${cleanupFormat}`
        );
        const cleanupThumbnailPath = path.join(
          IMAGES_DIR,
          `${cleanupSafeBaseFilename}.jpg`
        );
        if (fs.existsSync(cleanupVideoPath)) await safeRemove(cleanupVideoPath);
        if (fs.existsSync(cleanupThumbnailPath))
          await safeRemove(cleanupThumbnailPath);
        // Also try mp4 in case the file was created with default extension
        const cleanupVideoPathMp4 = path.join(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.mp4`
        );
        if (fs.existsSync(cleanupVideoPathMp4))
          await safeRemove(cleanupVideoPathMp4);
      } catch (cleanupError) {
        // If cleanup fails, try with default mp4 extension
        const cleanupSafeBaseFilename = formatVideoFilename(
          videoTitle,
          videoAuthor,
          videoDate
        );
        const cleanupVideoPath = path.join(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.mp4`
        );
        const cleanupThumbnailPath = path.join(
          IMAGES_DIR,
          `${cleanupSafeBaseFilename}.jpg`
        );
        if (fs.existsSync(cleanupVideoPath)) await safeRemove(cleanupVideoPath);
        if (fs.existsSync(cleanupThumbnailPath))
          await safeRemove(cleanupThumbnailPath);
      }
      throw error;
    }
  }

  // Helper to select best m3u8 URL
  static selectBestM3u8Url(
    urls: string[],
    hasFormatSort: boolean
  ): string | null {
    if (urls.length === 0) return null;

    const sortedUrls = [...urls].sort((a, b) => {
      // 1. Priority: surrit.com
      const aIsSurrit = a.includes("surrit.com");
      const bIsSurrit = b.includes("surrit.com");
      if (aIsSurrit && !bIsSurrit) return -1;
      if (!aIsSurrit && bIsSurrit) return 1;

      // 2. Priority: Master playlist (playlist.m3u8 specifically for surrit, or general master)
      // We generally prefer master playlists because they contain all variants, allowing yt-dlp to pick the best.
      // The previous logic penalized master playlists without explicit resolution, which caused issues.
      const aIsMaster = a.includes("/playlist.m3u8") || a.includes("/master/");
      const bIsMaster = b.includes("/playlist.m3u8") || b.includes("/master/");

      // If we are strictly comparing surrit URLs (both are surrit), we prefer the master playlist
      // because it's the "cleanest" source.
      if (aIsSurrit && bIsSurrit) {
        const aIsPlaylistM3u8 = a.includes("playlist.m3u8");
        const bIsPlaylistM3u8 = b.includes("playlist.m3u8");
        if (aIsPlaylistM3u8 && !bIsPlaylistM3u8) return -1;
        if (!aIsPlaylistM3u8 && bIsPlaylistM3u8) return 1;
      }

      // If format sort is enabled, we almost always want the master playlist
      if (hasFormatSort) {
        if (aIsMaster && !bIsMaster) return -1;
        if (!aIsMaster && bIsMaster) return 1;
      } else {
        // If NO format sort, previously we preferred specific resolution.
        // BUT, given the bug report where a 240p stream was picked over a master,
        // we should probably trust the master playlist more particularly if the alternative is low quality.
        // However, if we have a high quality specific stream (e.g. 720p/1080p explicit), that might be fine.
        // Let's refine: If one is surrit master, pick it. (Handled by step 1 & surrit sub-logic)
        // If neither is surrit, and one is master...
        // If both are master or both are not master, compare resolution.
      }

      // 3. Priority: Resolution (detected from URL)
      const aQuality = a.match(/(\d+p)/)?.[1] || "0p";
      const bQuality = b.match(/(\d+p)/)?.[1] || "0p";
      const aQualityNum = parseInt(aQuality) || 0;
      const bQualityNum = parseInt(bQuality) || 0;

      // If we have a significant resolution difference, we might prefer the higher one
      // UNLESS one is a master playlist and the other is a low res specific one.
      // If one is master (0p detected) and other is 240p, 0p (master) should win if it's likely to contain better streams.

      // Updated Strategy:
      // If both have resolution, compare them.
      if (aQualityNum > 0 && bQualityNum > 0) {
        return bQualityNum - aQualityNum; // Higher quality first
      }

      // If one is master (assumed 0p from URL) and other is specific resolution:
      // If we are prioritizing master playlists (e.g. because of surrit or format sort), master wins.
      // If we are NOT specifically prioritizing master, we still might want to prefer it over very low res (e.g. < 480p).
      if (aIsMaster && bQualityNum > 0 && bQualityNum < 480) return -1; // Master wins over < 480p
      if (bIsMaster && aQualityNum > 0 && aQualityNum < 480) return 1; // Master wins over < 480p

      // Fallback: Default to higher number (so 720p wins over 0p/master if we didn't catch it above)
      // This preserves 'best attempt' for specific high quality URLs if they exist not on surrit.
      if (aQualityNum !== bQualityNum) {
        return bQualityNum - aQualityNum;
      }

      // Final tie-breaker: prefer master if all else equal
      if (aIsMaster && !bIsMaster) return -1;
      if (!aIsMaster && bIsMaster) return 1;

      return 0;
    });

    return sortedUrls[0];
  }
}
