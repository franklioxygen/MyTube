import * as cheerio from "cheerio";
import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";
import { DATA_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import {
  DownloadCancelledError,
  isCancelledError,
} from "../../errors/DownloadErrors";
import { cleanupTemporaryFiles, safeRemove } from "../../utils/downloadUtils";
import {
  formatVideoFilename,
  getMissAVPlaceholderTitle,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { ProgressTracker } from "../../utils/progressTracker";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
  statSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import { FilenameTemplateSourceOptions } from "../filenameTemplate/types";
import {
  flagsToArgs,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
  isYtDlpImpersonateAvailable,
} from "../../utils/ytDlpUtils";
import { syncMediaServerArtifactsForRecord } from "../mediaServerExport";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";
import { MISSAV_PROGRESS_LOG_INTERVAL_MS, YT_DLP_PATH } from "./missav/constants";
import {
  buildSafeMissAvNavigationTarget,
  isCloudflareChallengeHtml,
} from "./missav/navigation";
import {
  configureMissAvPage,
  getMissAvPuppeteerLaunchOptions,
  navigateMissAvPage,
} from "./missav/puppeteer";
import { selectBestM3u8Url } from "./missav/m3u8";
import { planMissAvOutputPaths } from "./missav/outputPaths";

const MISSAV_FAILED_REQUEST_LOG_LIMIT = 10;

function isPuppeteerTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export class MissAVDownloader extends BaseDownloader {
  // Implementation of IDownloader.getVideoInfo
  async getVideoInfo(url: string): Promise<VideoInfo> {
    return MissAVDownloader.getVideoInfo(url);
  }

  // Get video info without downloading (Static wrapper)
  static async getVideoInfo(url: string): Promise<VideoInfo> {
    try {
      const { url: safeNavigationUrl } =
        buildSafeMissAvNavigationTarget(url);

      logger.info(
        `Fetching page content for ${safeNavigationUrl} with Puppeteer...`,
      );

      const browser = await puppeteer.launch(getMissAvPuppeteerLaunchOptions());
      const page = await browser.newPage();
      await configureMissAvPage(page);
      await navigateMissAvPage(page, safeNavigationUrl);

      const html = await page.content();
      await browser.close();

      const $ = cheerio.load(html);
      const pageTitle = $('meta[property="og:title"]').attr("content");
      const ogImage = $('meta[property="og:image"]').attr("content");

      let author = "missav.com";
      try {
        const urlObj = new URL(url);
        author = urlObj.hostname.replace("www.", "");
      } catch {
        // Keep default author on malformed URL.
      }

      return {
        title: pageTitle || getMissAVPlaceholderTitle(url),
        author: author,
        date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        thumbnailUrl: ogImage || null,
      };
    } catch (error) {
      logger.error("Error fetching MissAV video info:", error);
      let author = "missav.com";
      try {
        const urlObj = new URL(url);
        author = urlObj.hostname.replace("www.", "");
      } catch {
        // Use default author for malformed URL fallback.
      }

      return {
        title: getMissAVPlaceholderTitle(url),
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
      options?.onStart,
      options?.filenameTemplateSourceOptions,
    );
  }

  // Helper function to download MissAV video (Static wrapper/Implementation)
  static async downloadVideo(
    url: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void,
    filenameTemplateSourceOptions?: FilenameTemplateSourceOptions,
  ): Promise<Video> {
    logger.info("Detected MissAV-family URL:", url);

    const timestamp = Date.now();

    // Ensure directories exist
    fs.ensureDirSync(VIDEOS_DIR);
    fs.ensureDirSync(IMAGES_DIR);

    const urlObj = new URL(url);
    const author = urlObj.hostname.replace("www.", "");

    let videoTitle = getMissAVPlaceholderTitle(url);
    let videoAuthor = author;
    let videoDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    let thumbnailUrl: string | null = null;
    let thumbnailSaved = false;

    try {
      // 1. Extract m3u8 URL and metadata using Puppeteer
      // (yt-dlp doesn't support MissAV natively, so we extract the m3u8 URL first)
      const { url: safeNavigationUrl } =
        buildSafeMissAvNavigationTarget(url);

      logger.info("Launching Puppeteer to extract m3u8 URL...");

      const browser = await puppeteer.launch(getMissAvPuppeteerLaunchOptions());

      // Declared before try so they are accessible after browser is closed.
      const m3u8Urls: string[] = [];
      const isM3u8 = (u: string) => u.includes(".m3u8") && !u.includes("preview");
      let failedRequestLogCount = 0;
      let html = "";

      try {
        const page = await browser.newPage();
        await configureMissAvPage(page);

        // Collect all m3u8 URLs seen during page load via the request event.
        page.on("request", (request) => {
          const reqUrl = request.url();
          if (isM3u8(reqUrl) && !m3u8Urls.includes(reqUrl)) {
            logger.info("Found m3u8 URL via network interception:", reqUrl);
            m3u8Urls.push(reqUrl);
          }
        });

        // Telemetry: record the status the browser gets for each m3u8 response
        // (plus Cloudflare markers). When a download later 403s, this line shows
        // whether the CDN still serves the browser — distinguishing a yt-dlp/
        // impersonation regression from the CDN blocking this host outright.
        page.on("response", (response) => {
          const resUrl = response.url();
          if (!isM3u8(resUrl)) return;
          const headers = response.headers();
          logger.info(
            `[MissAV m3u8 probe] status=${response.status()} ` +
              `cf-mitigated=${headers["cf-mitigated"] ?? "none"} ` +
              `cf-ray=${headers["cf-ray"] ?? "none"} ` +
              `server=${headers["server"] ?? "?"} ` +
              `set-cookie=${headers["set-cookie"] ? "yes" : "no"} ${resUrl}`,
          );
        });

        page.on("requestfailed", (request) => {
          if (failedRequestLogCount >= MISSAV_FAILED_REQUEST_LOG_LIMIT) return;
          failedRequestLogCount += 1;

          const failure = request.failure();
          logger.warn(
            `[MissAV request failed] resource=${request.resourceType()} ` +
              `method=${request.method()} ` +
              `error=${failure?.errorText ?? "unknown"} ${request.url()}`,
          );

          if (failedRequestLogCount === MISSAV_FAILED_REQUEST_LOG_LIMIT) {
            logger.warn(
              `[MissAV request failed] further failures suppressed after ${MISSAV_FAILED_REQUEST_LOG_LIMIT} entries.`,
            );
          }
        });

        try {
          await navigateMissAvPage(page, safeNavigationUrl);
        } catch (error) {
          if (isPuppeteerTimeoutError(error) && m3u8Urls.length > 0) {
            logger.warn(
              "MissAV page navigation timed out after m3u8 capture; continuing with captured stream URLs.",
            );
          } else {
            throw error;
          }
        }

        // Extra wait is created AFTER networkidle2, so the full 20 s budget
        // belongs entirely to player initialisation — not shared with page load.
        // Only entered when nothing was captured during navigation, so the warn
        // only fires on a genuine timeout, never as a false positive.
        if (m3u8Urls.length === 0) {
          logger.info(
            "No m3u8 URL captured during page load — waiting up to 20 s for video player...",
          );
          await page
            .waitForResponse((res) => isM3u8(res.url()), { timeout: 20_000 })
            .then((res) => {
              const u = res.url();
              if (!m3u8Urls.includes(u)) m3u8Urls.push(u);
            })
            .catch((err: unknown) => {
              if (err instanceof Error && err.name === "TimeoutError") {
                logger.warn("Video player did not fire an m3u8 request within 20 s.");
                return;
              }
              throw err;
            });
        }

        html = await page.content();
      } finally {
        // Always close the browser, even when a non-timeout error is thrown,
        // to prevent Chromium processes from being left behind.
        await browser.close().catch((closeErr: unknown) => {
          logger.warn("Failed to close Puppeteer browser:", closeErr);
        });
      }

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
          m3u8Url,
        );
        const alternatives = m3u8Urls.filter((u) => u !== m3u8Url);
        if (alternatives.length > 0) {
          logger.info("Alternative URLs:", alternatives);
        }
      }

      // 5. If m3u8 URL was not found via network, try regex extraction as fallback
      if (!m3u8Url) {
        if (isCloudflareChallengeHtml(html)) {
          throw new Error(
            "MissAV access is blocked by Cloudflare verification. Retry with PUPPETEER_HEADLESS=false if needed.",
          );
        }

        logger.info(
          "m3u8 URL not found via network, trying regex extraction...",
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
        const debugFile = resolveSafeChildPath(
          DATA_DIR,
          `missav_debug_${timestamp}.html`
        );
        writeFileSafeSync(debugFile, DATA_DIR, html);
        logger.error(`Could not find m3u8 URL. HTML dumped to ${debugFile}`);
        throw new Error(
          "Could not find m3u8 URL in page source or network requests",
        );
      }

      // 5. Get network configuration from user config (already loaded above)
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      // Get merge output format from user config or default to mp4
      const mergeOutputFormat = userConfig.mergeOutputFormat || "mp4";

      // 6. Compute output paths using template or legacy formatter
      const settings = storageService.getSettings();
      const {
        finalVideoFilename,
        finalThumbnailFilename,
        newVideoPath,
        newThumbnailPath,
        finalVideoWebPath,
        finalThumbnailWebPath,
      } = planMissAvOutputPaths(settings, {
        videoTitle,
        videoAuthor,
        videoDate,
        url,
        mergeOutputFormat,
        filenameTemplateSourceOptions,
      });

      // 7. Download the video using yt-dlp with the m3u8 URL
      logger.info("Downloading video from m3u8 URL using yt-dlp:", m3u8Url);
      logger.info("Downloading video to:", newVideoPath);
      logger.info("Download ID:", downloadId);

      if (downloadId) {
        storageService.updateActiveDownload(downloadId, {
          title: videoTitle,
          filename: videoTitle,
          progress: 0,
        });
      } else {
        logger.warn(
          "[MissAV] Warning: downloadId is not set, progress updates will not work!",
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
          formatSortValue,
        );
      }

      // Prepare flags for yt-dlp to download m3u8 stream
      // Dynamically determine Referer based on the input URL domain
      const urlObjForReferer = new URL(url);
      const referer = `${urlObjForReferer.protocol}//${urlObjForReferer.host}/`;
      logger.info("Using Referer:", referer);

      // The m3u8 host (e.g. surrit.com) sits behind Cloudflare bot management
      // that fingerprints the TLS/JA3 handshake; a default yt-dlp request gets a
      // 403. Route every request through curl_cffi browser impersonation so the
      // handshake matches a real browser.
      //
      // IMPORTANT: this must be the GLOBAL `--impersonate` flag, not the
      // `--extractor-args generic:impersonate` arg that yt-dlp's own error
      // message suggests. The extractor-arg only impersonates the initial
      // webpage fetch; the m3u8 manifest (and segment) downloads still go out
      // with the default fingerprint and 403. The global flag impersonates the
      // whole session. Verified directly against surrit.com from the deployment
      // environment: `--impersonate chrome` succeeds where the extractor-arg
      // returns 403. Referer is the only extra header the CDN needs.
      //
      // Gate on availability: `--impersonate` hard-fails ("target not available")
      // when curl_cffi is missing, which can happen on non-Docker installs. When
      // unavailable, omit it and warn — the download proceeds unimpersonated
      // (works for non-blocked hosts) instead of erroring outright.
      const canImpersonate = await isYtDlpImpersonateAvailable();
      if (!canImpersonate) {
        logger.warn(
          "[MissAV] yt-dlp browser impersonation is unavailable (curl_cffi not installed); " +
            "proceeding without --impersonate. Cloudflare-protected hosts may return 403. " +
            "Install it with: pip install curl-cffi",
        );
      }

      // Prepare flags object - merge user config with required settings
      const flags: any = {
        ...networkConfig, // Apply network settings (proxy, etc.)
        output: newVideoPath,
        format: downloadFormat,
        mergeOutputFormat: mergeOutputFormat,
        ...(canImpersonate ? { impersonate: "chrome" } : {}),
        addHeader: [`Referer:${referer}`],
      };

      // Apply format sort if user specified it
      if (formatSortValue) {
        flags.formatSort = formatSortValue;
        logger.info("Using format sort for MissAV:", formatSortValue);
      }

      logger.info("Final MissAV yt-dlp flags:", flags);

      // Use ProgressTracker for centralized progress parsing
      const progressTracker = new ProgressTracker(downloadId);
      // Capped ring-buffer for stderr: retain only the last 4 KB so that
      // long downloads with chatty ffmpeg/yt-dlp output don't grow memory unboundedly.
      const STDERR_MAX_BYTES = 4 * 1024;
      let stderrBuffer = "";
      let lastProgressLogAt = 0;
      let cleanedTemporaryFiles = false;
      const cleanupTemporaryFilesOnce = async (): Promise<void> => {
        if (cleanedTemporaryFiles) return;
        cleanedTemporaryFiles = true;
        await cleanupTemporaryFiles(newVideoPath);
      };
      const shouldLogDownloadProgress = (line: string): boolean => {
        const now = Date.now();
        const percentMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        const percent = percentMatch ? Number(percentMatch[1]) : null;
        const isComplete = percent !== null && percent >= 100;

        if (
          lastProgressLogAt === 0 ||
          now - lastProgressLogAt >= MISSAV_PROGRESS_LOG_INTERVAL_MS ||
          isComplete
        ) {
          lastProgressLogAt = now;
          return true;
        }

        return false;
      };
      const parseProgress = (output: string, source: "stdout" | "stderr") => {
        const lines = output
          .split(/[\r\n]+/)
          .filter((line) => line.trim());
        for (const line of lines) {
          if (line.includes("[download]")) {
            if (shouldLogDownloadProgress(line)) {
              logger.info(`[MissAV Progress ${source}]:`, line.substring(0, 120));
            }
          } else if (source === "stderr" && line.trim()) {
            // Only log actual errors/warnings, not generic informational lines.
            // yt-dlp/ffmpeg stderr is very chatty during HLS segment downloads.
            if (line.startsWith("ERROR") || line.startsWith("WARNING")) {
              logger.warn(`[MissAV stderr]:`, line);
            }
            // Append to ring-buffer, trimming the oldest content when over the cap.
            stderrBuffer += line + "\n";
            if (stderrBuffer.length > STDERR_MAX_BYTES) {
              stderrBuffer = stderrBuffer.slice(stderrBuffer.length - STDERR_MAX_BYTES);
            }
          }
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
          let cancellationRequested = false;

          child.stdout.on("data", (data) => {
            parseProgress(data.toString(), "stdout");
          });

          child.stderr.on("data", (data) => {
            parseProgress(data.toString(), "stderr");
          });

          child.on("close", (code, signal) => {
            // Flush any throttled progress and clear the tracker's timer.
            progressTracker.dispose();
            if (code === 0) {
              resolve();
            } else if (
              cancellationRequested ||
              signal === "SIGTERM" ||
              signal === "SIGINT"
            ) {
              reject(DownloadCancelledError.create());
            } else {
              const err = new Error(`yt-dlp process exited with code ${code}`);
              (err as any).stderr = stderrBuffer;
              reject(err);
            }
          });

          child.on("error", (err) => {
            reject(err);
          });

          if (onStart) {
            onStart(async () => {
              cancellationRequested = true;
              logger.info("Killing subprocess for download:", downloadId);
              child.kill();

              // Clean up temporary files created by yt-dlp (*.part, *.ytdl, etc.)
              logger.info("Cleaning up temporary files...");
              await cleanupTemporaryFilesOnce();
            });
          }
        });

        logger.info("Video downloaded successfully");
      } catch (err: unknown) {
        // Use base class helper for cancellation handling
        const downloader = new MissAVDownloader();
        await downloader.handleCancellationError(err, async () => {
          await cleanupTemporaryFilesOnce();
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
                error.message,
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
          axiosConfig,
        );
      }

      // 9. Get video duration
      let duration: string | undefined;
      try {
        const { getVideoDuration } =
          await import("../../services/metadataService");
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
        if (pathExistsSafeSync(newVideoPath, VIDEOS_DIR)) {
          const stats = statSafeSync(newVideoPath, VIDEOS_DIR);
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
        videoFilename: finalVideoFilename,
        thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        videoPath: finalVideoWebPath,
        thumbnailPath: thumbnailSaved ? finalThumbnailWebPath : null,
        duration: duration,
        fileSize: fileSize,
        addedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      storageService.saveVideo(videoData);
      logger.info("MissAV video saved to database");

      // Add video to author collection if enabled
      const authorOrganization = storageService.organizeVideoByAuthor(
        videoData.id,
        videoAuthor,
        settings.authorOrganizationMode,
        settings.downloadFilenamePresetId,
      );

      if (authorOrganization) {
        // If video was added to a collection, the file paths might have changed
        // Fetch the updated video from storage (using videoData.id which is timestamp string)
        const updatedVideo = storageService.getVideoById(videoData.id);
        if (updatedVideo) {
          syncMediaServerArtifactsForRecord(updatedVideo, {
            rawSourceInfo: {
              title: videoTitle,
              uploader: videoAuthor,
              upload_date: videoDate,
              webpage_url: url,
              thumbnail: thumbnailUrl || undefined,
              extractor: "missav",
            },
          });
          return updatedVideo;
        }
      }

      syncMediaServerArtifactsForRecord(videoData, {
        rawSourceInfo: {
          title: videoTitle,
          uploader: videoAuthor,
          upload_date: videoDate,
          webpage_url: url,
          thumbnail: thumbnailUrl || undefined,
          extractor: "missav",
        },
      });
      return videoData;
    } catch (error: unknown) {
      if (isCancelledError(error)) {
        logger.info("MissAV-family download cancelled:", { downloadId });
        throw error;
      }

      logger.error("Error in downloadMissAVVideo:", error);
      // Cleanup - try to get the correct extension from config, fallback to mp4
      try {
        const cleanupConfig = getUserYtDlpConfig(url);
        const cleanupFormat = cleanupConfig.mergeOutputFormat || "mp4";
        const cleanupSafeBaseFilename = formatVideoFilename(
          videoTitle,
          videoAuthor,
          videoDate,
        );
        const cleanupVideoPath = resolveSafeChildPath(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.${cleanupFormat}`
        );
        const cleanupThumbnailPath = resolveSafeChildPath(
          IMAGES_DIR,
          `${cleanupSafeBaseFilename}.jpg`
        );
        await safeRemove(cleanupVideoPath);
        await safeRemove(cleanupThumbnailPath);
        // Also try mp4 in case the file was created with default extension
        const cleanupVideoPathMp4 = resolveSafeChildPath(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.mp4`
        );
        await safeRemove(cleanupVideoPathMp4);
      } catch (cleanupError) {
        // If cleanup fails, try with default mp4 extension
        const cleanupSafeBaseFilename = formatVideoFilename(
          videoTitle,
          videoAuthor,
          videoDate,
        );
        const cleanupVideoPath = resolveSafeChildPath(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.mp4`
        );
        const cleanupThumbnailPath = resolveSafeChildPath(
          IMAGES_DIR,
          `${cleanupSafeBaseFilename}.jpg`
        );
        await safeRemove(cleanupVideoPath);
        await safeRemove(cleanupThumbnailPath);
      }
      throw error;
    }
  }

  // Helper to select best m3u8 URL (delegates to ./missav/m3u8).
  static selectBestM3u8Url(
    urls: string[],
    hasFormatSort: boolean,
  ): string | null {
    return selectBestM3u8Url(urls, hasFormatSort);
  }
}
