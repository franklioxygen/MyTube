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
      logger.info(`Fetching page content for ${url} with Puppeteer...`);

      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

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
      logger.info("Launching Puppeteer to extract m3u8 URL...");

      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();

      // Set a real user agent
      const userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      await page.setUserAgent(userAgent);

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

      logger.info("Navigating to:", url);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

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

      // 3. Select the best m3u8 URL from collected URLs
      // Prefer specific quality playlists over master playlists
      let m3u8Url: string | null = null;
      if (m3u8Urls.length > 0) {
        // Sort URLs: prefer specific quality playlists, avoid master playlists
        const sortedUrls = m3u8Urls.sort((a, b) => {
          const aIsMaster =
            a.includes("/playlist.m3u8") || a.includes("/master/");
          const bIsMaster =
            b.includes("/playlist.m3u8") || b.includes("/master/");

          // Prefer non-master playlists
          if (aIsMaster && !bIsMaster) return 1;
          if (!aIsMaster && bIsMaster) return -1;

          // Among non-master playlists, prefer higher quality (480p > 240p)
          const aQuality = a.match(/(\d+p)/)?.[1] || "0p";
          const bQuality = b.match(/(\d+p)/)?.[1] || "0p";
          const aQualityNum = parseInt(aQuality) || 0;
          const bQualityNum = parseInt(bQuality) || 0;

          return bQualityNum - aQualityNum; // Higher quality first
        });

        m3u8Url = sortedUrls[0];
        logger.info(
          `Selected m3u8 URL from ${m3u8Urls.length} candidates:`,
          m3u8Url
        );
        if (sortedUrls.length > 1) {
          logger.info("Alternative URLs:", sortedUrls.slice(1));
        }
      }

      // 4. If m3u8 URL was not found via network, try regex extraction as fallback
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

      // 5. Update the safe base filename with the actual title
      const newSafeBaseFilename = formatVideoFilename(
        videoTitle,
        videoAuthor,
        videoDate
      );
      const newVideoFilename = `${newSafeBaseFilename}.mp4`;
      const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

      const newVideoPath = path.join(VIDEOS_DIR, newVideoFilename);
      const newThumbnailPath = path.join(IMAGES_DIR, newThumbnailFilename);

      // 6. Download the video using yt-dlp with the m3u8 URL
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

      // Prepare flags for yt-dlp to download m3u8 stream
      // Dynamically determine Referer based on the input URL domain
      const urlObj = new URL(url);
      const referer = `${urlObj.protocol}//${urlObj.host}/`;
      logger.info("Using Referer:", referer);

      const flags: any = {
        output: newVideoPath,
        format: "best",
        mergeOutputFormat: "mp4",
        addHeader: [`Referer:${referer}`, `User-Agent:${userAgent}`],
      };

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

      // Convert flags object to array of args
      const args = [
        m3u8Url,
        "--output",
        newVideoPath,
        "--format",
        "best",
        "--merge-output-format",
        "mp4",
        "--add-header",
        `Referer:${referer}`,
        "--add-header",
        `User-Agent:${userAgent}`,
      ];

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

      // 7. Download and save the thumbnail
      if (thumbnailUrl) {
        // Use base class method via temporary instance
        const downloader = new MissAVDownloader();
        thumbnailSaved = await downloader.downloadThumbnail(
          thumbnailUrl,
          newThumbnailPath
        );
      }

      // 8. Get video duration
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

      // 9. Get file size
      let fileSize: string | undefined;
      try {
        if (fs.existsSync(newVideoPath)) {
          const stats = fs.statSync(newVideoPath);
          fileSize = stats.size.toString();
        }
      } catch (e) {
        logger.error("Failed to get file size:", e);
      }

      // 10. Save metadata
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
          ? `/images/${newThumbnailFilename}`
          : null,
        duration: duration,
        fileSize: fileSize,
        addedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      storageService.saveVideo(videoData);
      logger.info("MissAV video saved to database");

      return videoData;
    } catch (error: any) {
      logger.error("Error in downloadMissAVVideo:", error);
      // Cleanup
      const newSafeBaseFilename = formatVideoFilename(
        videoTitle,
        videoAuthor,
        videoDate
      );
      const newVideoPath = path.join(VIDEOS_DIR, `${newSafeBaseFilename}.mp4`);
      const newThumbnailPath = path.join(
        IMAGES_DIR,
        `${newSafeBaseFilename}.jpg`
      );
      if (fs.existsSync(newVideoPath)) await safeRemove(newVideoPath);
      if (fs.existsSync(newThumbnailPath)) await safeRemove(newThumbnailPath);
      throw error;
    }
  }
}
