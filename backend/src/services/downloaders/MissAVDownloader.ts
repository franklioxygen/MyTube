import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";
import { DATA_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { resolveExplicitPreferredVideoContainer } from "../../types/settings";
import {
  DownloadCancelledError,
  isCancelledError,
} from "../../errors/DownloadErrors";
import { cleanupTemporaryFiles, safeRemove } from "../../utils/downloadUtils";
import {
  extractSourceVideoId,
  formatVideoFilename,
  getMissAVPlaceholderTitle,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { ProgressTracker } from "../../utils/progressTracker";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
  statSafeSync,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import {
  planOwnedReplacementStagingPathSync,
  replaceOwnedFileWithBackupSync,
} from "../filenameTemplate/outputPathAllocator";
import { resolveSupersededManagedPath } from "./supersededOutput";
import { FilenameTemplateSourceOptions } from "../filenameTemplate/types";
import {
  flagsToArgs,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
  isYtDlpImpersonateAvailable,
} from "../../utils/ytDlpUtils";
import { appendYtDlpInputOperand } from "../../utils/ytdlp/flags";
import { spawnYtDlp, withYtDlpRelease } from "../../utils/ytdlp/release";
import {
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "../mediaServerExport";
import { regenerateSmallThumbnailForThumbnailPath } from "../thumbnailMirrorService";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";
import {
  MISSAV_DEFAULT_CONCURRENT_FRAGMENTS,
  MISSAV_PROGRESS_LOG_INTERVAL_MS,
} from "./missav/constants";
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

function resolveMissAvMergeOutputFormat(
  userConfig: Record<string, unknown>,
  settings: { preferredVideoContainer?: unknown },
): string {
  const userMergeOutputFormat =
    typeof userConfig.mergeOutputFormat === "string" &&
    userConfig.mergeOutputFormat
      ? userConfig.mergeOutputFormat
      : undefined;

  if (userMergeOutputFormat) {
    return userMergeOutputFormat;
  }

  const preferredContainer = resolveExplicitPreferredVideoContainer(settings);

  // MissAV downloads extracted HLS streams, which are normally H.264/AAC.
  // Applying a global WebM container would force an incompatible remux; keep
  // MP4 unless the user explicitly overrides MissAV mergeOutputFormat.
  if (preferredContainer === "webm") {
    return "mp4";
  }

  return preferredContainer || "mp4";
}

/**
 * Resolve how many HLS fragments yt-dlp may fetch in parallel.
 *
 * The MissAV flag set is assembled from `getNetworkConfigFromUserConfig`, whose
 * allow-list carries no `-N`, so a user's own `--concurrent-fragments` never
 * reached this downloader and every stream fell back to yt-dlp's default of 1.
 * Honour the setting here, and default to a small parallel fetch so the
 * fragment round trip stops being the bottleneck (issue #446).
 *
 * A non-numeric value is ignored rather than forwarded: yt-dlp rejects it
 * outright, which would break downloads that work today.
 */
function resolveMissAvConcurrentFragments(
  userConfig: Record<string, unknown>,
): number {
  const configured = userConfig.N ?? userConfig.concurrentFragments;
  const raw = typeof configured === "number" ? String(configured) : configured;

  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    if (parsed > 0) {
      return parsed;
    }
  }

  return MISSAV_DEFAULT_CONCURRENT_FRAGMENTS;
}

function isPuppeteerTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function resolveExistingVideoForRedownload(
  url: string,
  existingLocalVideoId?: string
): Video | undefined {
  if (!existingLocalVideoId) {
    return storageService.getVideoBySourceUrl(url, "video");
  }

  const selectedVideo = storageService.getVideoById(existingLocalVideoId);
  if (!selectedVideo) {
    throw new Error(
      `Requested MissAV redownload target ${existingLocalVideoId} was not found`
    );
  }

  const selectedMediaType = selectedVideo.mediaType === "audio" ? "audio" : "video";
  if (selectedMediaType !== "video") {
    throw new Error(
      `Requested MissAV redownload target ${existingLocalVideoId} has media type ${selectedMediaType}, expected video`
    );
  }

  return selectedVideo;
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

      const browser = await puppeteer.launch(
        getMissAvPuppeteerLaunchOptions(getUserYtDlpConfig(url)),
      );

      let html: string;
      try {
        const page = await browser.newPage();
        await configureMissAvPage(page);
        await navigateMissAvPage(page, safeNavigationUrl);
        html = await page.content();
      } finally {
        // Always close the browser, even when navigation throws - which is
        // exactly what a Cloudflare challenge does. Closing only on the happy
        // path orphaned one Chromium per failed lookup, and a run of failures
        // is precisely when they pile up.
        try {
          await browser.close();
        } catch (closeError: unknown) {
          logger.warn("Failed to close Puppeteer browser:", closeError);
        }
      }

      // A challenge page parses perfectly well - it just has no og: tags - so
      // without this it is indistinguishable from a video page that happens to
      // carry no metadata, and the placeholder below is returned as if the
      // lookup had succeeded. The check is free here because the HTML is
      // already in hand, and unlike the title probe in navigateMissAvPage it
      // catches challenge pages whatever they are titled.
      if (isCloudflareChallengeHtml(html)) {
        logger.warn(
          `MissAV metadata lookup for ${safeNavigationUrl} was served a Cloudflare ` +
            "challenge; returning placeholder metadata. Downloads from this host " +
            "will fail until the challenge clears - see the outbound proxy section " +
            "of the Docker guide.",
        );
      }

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
      options?.existingLocalVideoId,
    );
  }

  // Helper function to download MissAV video (Static wrapper/Implementation)
  static async downloadVideo(
    url: string,
    downloadId?: string,
    onStart?: (cancel: () => void) => void,
    filenameTemplateSourceOptions?: FilenameTemplateSourceOptions,
    existingLocalVideoId?: string,
  ): Promise<Video> {
    logger.info("Detected MissAV-family URL:", url);

    const timestamp = Date.now();
    const downloadedAtIso = new Date(timestamp).toISOString();
    const sourceVideoId = extractSourceVideoId(url).id || undefined;

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
    let releaseOutputReservation: (() => void) | null = null;
    let stagedVideoPathForCleanup: string | null = null;
    let stagedThumbnailPathForCleanup: string | null = null;
    // Final destinations of any in-place owned replacement. Once we commit to
    // replacing an owned file, its destination always holds a live library file
    // (the original before publication, the new download afterwards) with the
    // backup already removed, so the failure cleanup below must never delete it.
    let ownedVideoDestinationPath: string | null = null;
    let ownedThumbnailDestinationPath: string | null = null;
    let existingLocalVideo: Video | undefined;

    try {
      existingLocalVideo = resolveExistingVideoForRedownload(
        url,
        existingLocalVideoId,
      );

      // 1. Extract m3u8 URL and metadata using Puppeteer
      // (yt-dlp doesn't support MissAV natively, so we extract the m3u8 URL first)
      const { url: safeNavigationUrl } =
        buildSafeMissAvNavigationTarget(url);

      logger.info("Launching Puppeteer to extract m3u8 URL...");

      // Resolved before the launch rather than after it: the browser step has
      // to follow the same proxy decision as the yt-dlp download it feeds.
      const userConfig = getUserYtDlpConfig(url);

      const browser = await puppeteer.launch(
        getMissAvPuppeteerLaunchOptions(userConfig),
      );

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

      // 3. The user's yt-dlp configuration, resolved before the browser launch
      // above, also decides the m3u8 URL selection strategy.
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
            "MissAV access is blocked by Cloudflare verification. This is usually the " +
              "container's egress IP being challenged rather than anything about " +
              "this video, so it often succeeds on a later attempt: enable Auto " +
              "Retry in Settings, or route the container through a cleaner egress.",
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
          "MissAV page loaded but its player never requested the video stream. " +
            "The page itself was fetched fine, so this is not a Cloudflare block; " +
            `the saved HTML at ${debugFile} shows what was actually served.`,
        );
      }

      // 5. Get network configuration from user config (already loaded above)
      const networkConfig = getNetworkConfigFromUserConfig(userConfig);

      // Get merge output format from user config, app settings, or default to mp4.
      const settings = storageService.getSettings();
      const mergeOutputFormat = resolveMissAvMergeOutputFormat(
        userConfig,
        settings,
      );
      // 6. Compute output paths using template or legacy formatter
      const {
        finalVideoFilename,
        finalThumbnailFilename,
        newVideoPath,
        newThumbnailPath,
        finalVideoWebPath,
        finalThumbnailWebPath,
        releaseOutputReservation: releasePlannedOutput,
      } = planMissAvOutputPaths(settings, {
        videoTitle,
        videoAuthor,
        videoDate,
        url,
        mergeOutputFormat,
        filenameTemplateSourceOptions,
        existingLocalVideoId: existingLocalVideo?.id,
      });
      releaseOutputReservation = releasePlannedOutput;
      const ownedVideoReplacement = planOwnedReplacementStagingPathSync(
        newVideoPath,
        VIDEOS_DIR,
        existingLocalVideo?.id
      );
      const ownedThumbnailReplacement = planOwnedReplacementStagingPathSync(
        newThumbnailPath,
        [IMAGES_DIR, VIDEOS_DIR],
        existingLocalVideo?.id
      );
      ownedVideoDestinationPath = ownedVideoReplacement?.finalPath ?? null;
      ownedThumbnailDestinationPath =
        ownedThumbnailReplacement?.finalPath ?? null;
      const videoDownloadPath = ownedVideoReplacement?.stagingPath ?? newVideoPath;
      const thumbnailDownloadPath =
        ownedThumbnailReplacement?.stagingPath ?? newThumbnailPath;
      stagedVideoPathForCleanup = ownedVideoReplacement?.stagingPath ?? null;
      stagedThumbnailPathForCleanup =
        ownedThumbnailReplacement?.stagingPath ?? null;

      // 7. Download the video using yt-dlp with the m3u8 URL
      logger.info("Downloading video from m3u8 URL using yt-dlp:", m3u8Url);
      logger.info("Downloading video to:", videoDownloadPath);
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
      await withYtDlpRelease(async (release) => {
        const canImpersonate = await isYtDlpImpersonateAvailable(release);
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
          output: videoDownloadPath,
          format: downloadFormat,
          mergeOutputFormat: mergeOutputFormat,
          noOverwrites: true,
          ...(canImpersonate ? { impersonate: "chrome" } : {}),
          // Must come after the network config: fragment concurrency is what
          // keeps a proxied HLS download from serialising on round trips.
          N: resolveMissAvConcurrentFragments(userConfig),
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
          await cleanupTemporaryFiles(videoDownloadPath);
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
        const args = [...flagsToArgs(flags)];
        appendYtDlpInputOperand(args, m3u8Url);

        // Log the full command for debugging
        logger.info(
          `[yt-dlp] executing release=${release.releaseId} version=${release.version ?? "unknown"}`
        );

        try {
          await new Promise<void>((resolve, reject) => {
            const child = spawnYtDlp(release, args);
            let cancellationRequested = false;

            child.stdout?.on("data", (data) => {
              parseProgress(data.toString(), "stdout");
            });

            child.stderr?.on("data", (data) => {
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
      });

      // Check if download was cancelled (it might have been removed from active downloads)
      const downloader = new MissAVDownloader();
      try {
        downloader.throwIfCancelled(downloadId);
      } catch (error) {
        await cleanupTemporaryFiles(videoDownloadPath);
        throw error;
      }

      if (ownedVideoReplacement) {
        replaceOwnedFileWithBackupSync(
          ownedVideoReplacement.stagingPath,
          ownedVideoReplacement.stagingRootDir,
          ownedVideoReplacement.finalPath,
          ownedVideoReplacement.destinationRootDir,
          existingLocalVideo?.id
        );
        stagedVideoPathForCleanup = null;
        await cleanupTemporaryFiles(videoDownloadPath);
      }

      // 8. Download and save the thumbnail
      if (thumbnailUrl) {
        // Use base class method via temporary instance
        let axiosConfig = {};
        // An empty string is yt-dlp's "connect directly" value, so it must reach
        // axios too: it disables axios' own HTTP_PROXY handling, keeping this
        // request on the same egress path as the download it belongs to.
        if (typeof userConfig.proxy === "string") {
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
          thumbnailDownloadPath,
          axiosConfig,
        );
        if (thumbnailSaved && ownedThumbnailReplacement) {
          replaceOwnedFileWithBackupSync(
            ownedThumbnailReplacement.stagingPath,
            ownedThumbnailReplacement.stagingRootDir,
            ownedThumbnailReplacement.finalPath,
            ownedThumbnailReplacement.destinationRootDir,
            existingLocalVideo?.id
          );
          stagedThumbnailPathForCleanup = null;
          await regenerateSmallThumbnailForThumbnailPath(finalThumbnailWebPath);
        }
      }

      // 9. Get video duration
      let duration: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
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

      try {
        const { getVideoDimensions } =
          await import("../../services/metadataService");
        const dimensions = await getVideoDimensions(newVideoPath);
        if (dimensions) {
          width = dimensions.width;
          height = dimensions.height;
        }
      } catch (e) {
        logger.error("Failed to extract dimensions from MissAV video:", e);
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
        mediaType: "video",
        sourceUrl: url,
        sourceVideoId,
        videoFilename: finalVideoFilename,
        thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        videoPath: finalVideoWebPath,
        thumbnailPath: thumbnailSaved ? finalThumbnailWebPath : null,
        duration: duration,
        fileSize: fileSize,
        width,
        height,
        addedAt: downloadedAtIso,
        createdAt: downloadedAtIso,
      };

      let persistedVideoData = videoData;
      if (existingLocalVideo) {
        videoData.id = existingLocalVideo.id;
        videoData.createdAt = existingLocalVideo.createdAt;
        const updatedVideo = storageService.updateVideo(existingLocalVideo.id, {
          title: videoData.title,
          author: videoData.author,
          date: videoData.date,
          source: videoData.source,
          mediaType: videoData.mediaType,
          sourceUrl: videoData.sourceUrl,
          sourceVideoId: videoData.sourceVideoId,
          videoFilename: videoData.videoFilename,
          videoPath: videoData.videoPath,
          thumbnailFilename: thumbnailSaved
            ? videoData.thumbnailFilename
            : existingLocalVideo.thumbnailFilename,
          thumbnailUrl: videoData.thumbnailUrl || existingLocalVideo.thumbnailUrl,
          thumbnailPath: thumbnailSaved
            ? videoData.thumbnailPath
            : existingLocalVideo.thumbnailPath,
          duration: videoData.duration,
          fileSize: videoData.fileSize,
          width: videoData.width,
          height: videoData.height,
          addedAt: downloadedAtIso,
        });

        if (!updatedVideo) {
          throw new Error(`Failed to update existing MissAV video ${existingLocalVideo.id}`);
        }

        const previousVideoPath = resolveSupersededManagedPath({
          previousWebPath: existingLocalVideo.videoPath,
          previousFilename: existingLocalVideo.videoFilename,
          fallbackRootDir: VIDEOS_DIR,
          newAbsolutePath: newVideoPath,
        });
        if (previousVideoPath) {
          try {
            if (
              pathExistsSafeSync(previousVideoPath, VIDEOS_DIR) &&
              !storageService.isVideoFileReferencedByOtherVideo(
                existingLocalVideo,
                existingLocalVideo.id,
              )
            ) {
              unlinkSafeSync(previousVideoPath, VIDEOS_DIR);
              logger.info(
                `Deleted superseded MissAV video file: ${existingLocalVideo.videoPath || existingLocalVideo.videoFilename}`
              );
            }
          } catch (e) {
            logger.error("Failed to delete superseded MissAV video file:", e);
          }
        }

        removeMediaServerArtifactsForVideo(existingLocalVideo);
        persistedVideoData = updatedVideo;
        if (sourceVideoId) {
          persistedVideoData = storageService.persistDownloadedMediaIdentity({
            video: persistedVideoData,
            identity: {
              platform: "missav",
              sourceVideoId,
              mediaType: "video",
              localVideoId: persistedVideoData.id,
            },
            sourceUrl: url,
            trackingMode: "redownload",
            downloadedAtMs: timestamp,
          });
        }
      } else if (sourceVideoId) {
        persistedVideoData = storageService.persistDownloadedMediaIdentity({
          video: videoData,
          identity: {
            platform: "missav",
            sourceVideoId,
            mediaType: "video",
            localVideoId: videoData.id,
          },
          sourceUrl: url,
          trackingMode: "new",
          downloadedAtMs: timestamp,
        });
      } else {
        storageService.saveVideo(videoData);
      }
      logger.info("MissAV video saved to database");

      // Add video to author collection if enabled
      const authorOrganization = storageService.organizeVideoByAuthor(
        persistedVideoData.id,
        videoAuthor,
        settings.authorOrganizationMode,
        settings.downloadFilenamePresetId,
      );

      if (authorOrganization) {
        // If video was added to a collection, the file paths might have changed
        const updatedVideo = storageService.getVideoById(persistedVideoData.id);
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

      syncMediaServerArtifactsForRecord(persistedVideoData, {
        rawSourceInfo: {
          title: videoTitle,
          uploader: videoAuthor,
          upload_date: videoDate,
          webpage_url: url,
          thumbnail: thumbnailUrl || undefined,
          extractor: "missav",
        },
      });
      return persistedVideoData;
    } catch (error: unknown) {
      if (isCancelledError(error)) {
        logger.info("MissAV-family download cancelled:", { downloadId });
        throw error;
      }

      logger.error("Error in downloadMissAVVideo:", error);
      // When an in-place owned replacement was planned, its final destination is
      // a live library file (its backup is already gone once the replacement
      // commits). In legacy root naming that destination coincides with the
      // filename recomputed below, so removing it blindly would leave the
      // existing row pointing at a missing file. Skip those paths during cleanup.
      const removeUnlessOwnedDestination = async (
        candidatePath: string,
      ): Promise<void> => {
        const normalized = path.normalize(candidatePath);
        if (
          (ownedVideoDestinationPath &&
            path.normalize(ownedVideoDestinationPath) === normalized) ||
          (ownedThumbnailDestinationPath &&
            path.normalize(ownedThumbnailDestinationPath) === normalized)
        ) {
          return;
        }
        await safeRemove(candidatePath);
      };
      // Cleanup - try to get the correct extension from config, fallback to mp4
      try {
        if (stagedVideoPathForCleanup) {
          await cleanupTemporaryFiles(stagedVideoPathForCleanup);
        }
        if (stagedThumbnailPathForCleanup) {
          await safeRemove(stagedThumbnailPathForCleanup);
        }
        const cleanupConfig = getUserYtDlpConfig(url);
        const cleanupFormat = resolveMissAvMergeOutputFormat(
          cleanupConfig,
          storageService.getSettings(),
        );
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
        await removeUnlessOwnedDestination(cleanupVideoPath);
        await removeUnlessOwnedDestination(cleanupThumbnailPath);
        // Also try mp4 in case the file was created with default extension
        const cleanupVideoPathMp4 = resolveSafeChildPath(
          VIDEOS_DIR,
          `${cleanupSafeBaseFilename}.mp4`
        );
        await removeUnlessOwnedDestination(cleanupVideoPathMp4);
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
        await removeUnlessOwnedDestination(cleanupVideoPath);
        await removeUnlessOwnedDestination(cleanupThumbnailPath);
      }
      throw error;
    } finally {
      releaseOutputReservation?.();
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
