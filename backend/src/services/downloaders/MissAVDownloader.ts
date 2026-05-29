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
  ensureDirSafeSync,
  pathExistsSafeSync,
  pathExistsTrustedSync,
  resolveSafeChildPath,
  statSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import { applyDedupeToRelatedPaths, dedupeRelativePath } from "../filenameTemplate/dedupe";
import { planVideoOutputPaths } from "../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../filenameTemplate/sourceOptions";
import { FilenameTemplateContext, FilenameTemplateSourceOptions } from "../filenameTemplate/types";
import {
  flagsToArgs,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
} from "../../utils/ytDlpUtils";
import { syncMediaServerArtifactsForRecord } from "../mediaServerExport";
import * as storageService from "../storageService";
import { Video } from "../storageService";
import { BaseDownloader, DownloadOptions, VideoInfo } from "./BaseDownloader";

const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
const MISSAV_PROGRESS_LOG_INTERVAL_MS = 10_000;
const ALLOWED_MISSAV_LANGUAGE_SEGMENTS = new Set(["en", "ja", "zh", "ko"]);
const ALLOWED_ROUTED_VIDEO_LANGUAGE_SEGMENTS = new Set([
  ...ALLOWED_MISSAV_LANGUAGE_SEGMENTS,
  "th",
  "ms",
  "de",
  "fr",
  "vi",
  "id",
  "fil",
  "hi",
]);
const MISSAV_NAVIGATION_ORIGINS: Record<string, string> = {
  "missav.com": "https://missav.com",
  "missav.ai": "https://missav.ai",
  "missav.ws": "https://missav.ws",
  "missav.live": "https://missav.live",
  "123av.com": "https://123av.com",
  "123av.ai": "https://123av.ai",
  "123av.ws": "https://123av.ws",
  "javxx.com": "https://javxx.com",
  "njavtv.com": "https://njavtv.com",
};
const PUPPETEER_MACOS_EXECUTABLE_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const PUPPETEER_LINUX_EXECUTABLE_PATHS = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];
const MISSAV_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const MISSAV_BROWSER_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const MISSAV_ROUTE_PREFIX_PATTERN = /^[a-zA-Z0-9_-]{2,20}$/;
const MISSAV_CLOUDFLARE_CHALLENGE_PATTERN =
  /cf-turnstile|Just a moment|security verification|challenge-platform/i;

function resolvePuppeteerExecutablePath(): string | undefined {
  const overridePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (overridePath) {
    return overridePath;
  }

  const windowsPaths = [
    process.env["PROGRAMFILES"]
      ? path.join(
          process.env["PROGRAMFILES"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    process.env["PROGRAMFILES(X86)"]
      ? path.join(
          process.env["PROGRAMFILES(X86)"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const candidatePaths =
    process.platform === "darwin"
      ? PUPPETEER_MACOS_EXECUTABLE_PATHS
      : process.platform === "win32"
        ? windowsPaths
        : PUPPETEER_LINUX_EXECUTABLE_PATHS;

  const resolvedPath = candidatePaths.find((candidatePath) =>
    pathExistsTrustedSync(candidatePath),
  );
  if (resolvedPath) {
    logger.info(`Using system Chrome for Puppeteer: ${resolvedPath}`);
  }

  return resolvedPath;
}

function resolvePuppeteerHeadlessMode(): boolean {
  const override = process.env.PUPPETEER_HEADLESS?.trim().toLowerCase();
  if (override === "false" || override === "0" || override === "no") {
    return false;
  }

  return true;
}

function getMissAvPuppeteerLaunchOptions(): Parameters<typeof puppeteer.launch>[0] {
  return {
    headless: resolvePuppeteerHeadlessMode(),
    executablePath: resolvePuppeteerExecutablePath(),
    defaultViewport: {
      width: 1280,
      height: 900,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
      `--user-agent=${MISSAV_BROWSER_USER_AGENT}`,
    ],
  };
}

async function configureMissAvPage(page: {
  setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<unknown>;
  evaluateOnNewDocument?: (fn: () => void) => Promise<unknown>;
}): Promise<void> {
  await page.setExtraHTTPHeaders?.({
    "accept-language": MISSAV_BROWSER_ACCEPT_LANGUAGE,
  });
  await page.evaluateOnNewDocument?.(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
      configurable: true,
    });
  });
}

async function navigateMissAvPage(
  page: {
    goto: (
      url: string,
      options: { waitUntil: "domcontentloaded"; timeout: number },
    ) => Promise<unknown>;
    title?: () => Promise<string>;
    content?: () => Promise<string>;
    waitForFunction?: (
      pageFunction: () => boolean,
      options: { timeout: number },
    ) => Promise<unknown>;
  },
  safeNavigationUrl: string,
): Promise<void> {
  logger.info("Navigating to:", safeNavigationUrl);
  await page.goto(safeNavigationUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const title = typeof page.title === "function" ? await page.title() : "";
  if (title === "Just a moment..." && typeof page.waitForFunction === "function") {
    logger.info(
      "Cloudflare verification page detected; waiting up to 30 s for automatic completion...",
    );
    try {
      await page.waitForFunction(
        () =>
          document.title !== "Just a moment..." &&
          !document.body.innerText.includes("Performing security verification"),
        { timeout: 30000 },
      );
    } catch (error) {
      const html = typeof page.content === "function" ? await page.content() : "";
      if (isCloudflareChallengeHtml(html)) {
        throw new Error(
          "MissAV access is blocked by Cloudflare verification. Retry with PUPPETEER_HEADLESS=false if needed.",
        );
      }
      throw error;
    }
  }
}

function isCloudflareChallengeHtml(html: string): boolean {
  return MISSAV_CLOUDFLARE_CHALLENGE_PATTERN.test(html);
}

function stripTrailingExtension(value: string, extension: string): string {
  return value.endsWith(extension) ? value.slice(0, -extension.length) : value;
}

function getCanonicalMissAvHost(hostname: string): string | null {
  const normalized = hostname.toLowerCase();

  if (normalized === "missav.com" || normalized.endsWith(".missav.com")) {
    return "missav.com";
  }
  if (normalized === "missav.ai" || normalized.endsWith(".missav.ai")) {
    return "missav.ai";
  }
  if (normalized === "missav.ws" || normalized.endsWith(".missav.ws")) {
    return "missav.ws";
  }
  if (normalized === "missav.live" || normalized.endsWith(".missav.live")) {
    return "missav.live";
  }
  if (normalized === "123av.com" || normalized.endsWith(".123av.com")) {
    return "123av.com";
  }
  if (normalized === "123av.ai" || normalized.endsWith(".123av.ai")) {
    return "123av.ai";
  }
  if (normalized === "123av.ws" || normalized.endsWith(".123av.ws")) {
    return "123av.ws";
  }
  if (normalized === "javxx.com" || normalized.endsWith(".javxx.com")) {
    return "javxx.com";
  }
  if (normalized === "njavtv.com" || normalized.endsWith(".njavtv.com")) {
    return "njavtv.com";
  }

  return null;
}

function usesRoutedVideoPath(canonicalHost: string): boolean {
  return canonicalHost.startsWith("123av.") || canonicalHost === "javxx.com";
}

function buildSafeMissAvNavigationTarget(url: string): {
  origin: string;
  path: string;
  url: string;
} {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsupported protocol for MissAV URL: ${parsedUrl.protocol}`);
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.port) {
    throw new Error(
      "SSRF protection: URLs with credentials or explicit ports are not allowed.",
    );
  }

  const canonicalHost = getCanonicalMissAvHost(parsedUrl.hostname);
  if (!canonicalHost) {
    throw new Error(`SSRF protection: Hostname ${parsedUrl.hostname} is not allowed.`);
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  if (pathSegments.some((segment) => segment === "..")) {
    throw new Error("SSRF protection: Path traversal is not allowed in URL path.");
  }

  const videoId = pathSegments[pathSegments.length - 1];
  if (!videoId || !/^[a-zA-Z0-9_-]{2,120}$/.test(videoId)) {
    throw new Error(
      `SSRF protection: Invalid MissAV video path in URL: ${parsedUrl.pathname}`,
    );
  }

  if (
    usesRoutedVideoPath(canonicalHost) &&
    pathSegments[pathSegments.length - 2]?.toLowerCase() === "v"
  ) {
    const prefixSegments = pathSegments.slice(0, -2);
    if (prefixSegments.length > 1) {
      throw new Error(
        `SSRF protection: Invalid routed video path in URL: ${parsedUrl.pathname}`,
      );
    }

    const normalizedRouteLanguage =
      prefixSegments.length === 1 ? prefixSegments[0].toLowerCase() : null;
    if (
      normalizedRouteLanguage &&
      !ALLOWED_ROUTED_VIDEO_LANGUAGE_SEGMENTS.has(normalizedRouteLanguage)
    ) {
      throw new Error(
        `SSRF protection: Invalid routed video language segment in URL: ${parsedUrl.pathname}`,
      );
    }

    const encodedVideoId = encodeURIComponent(videoId);
    const safeOrigin = MISSAV_NAVIGATION_ORIGINS[canonicalHost];
    if (!safeOrigin) {
      throw new Error(
        `SSRF protection: Hostname ${canonicalHost} has no allowed navigation origin.`,
      );
    }

    const path = normalizedRouteLanguage
      ? `/${normalizedRouteLanguage}/v/${encodedVideoId}`
      : `/v/${encodedVideoId}`;
    return {
      origin: safeOrigin,
      path,
      url: `${safeOrigin}${path}`,
    };
  }

  const maybeLanguage = pathSegments[pathSegments.length - 2]?.toLowerCase();
  const normalizedLanguage =
    maybeLanguage && ALLOWED_MISSAV_LANGUAGE_SEGMENTS.has(maybeLanguage)
      ? maybeLanguage
      : null;
  const prefixSegments = normalizedLanguage
    ? pathSegments.slice(0, -2)
    : pathSegments.slice(0, -1);
  if (prefixSegments.length > 1) {
    throw new Error(
      `SSRF protection: Invalid MissAV video path in URL: ${parsedUrl.pathname}`,
    );
  }

  let normalizedRoutePrefix: string | null = null;
  if (prefixSegments.length === 1) {
    const candidatePrefix = prefixSegments[0]?.toLowerCase();
    if (!candidatePrefix || !MISSAV_ROUTE_PREFIX_PATTERN.test(candidatePrefix)) {
      throw new Error(
        `SSRF protection: Invalid MissAV route prefix in URL: ${parsedUrl.pathname}`,
      );
    }
    normalizedRoutePrefix = candidatePrefix;
  }

  const encodedVideoId = encodeURIComponent(videoId);
  const safePath = normalizedRoutePrefix
    ? normalizedLanguage
      ? `/${normalizedRoutePrefix}/${normalizedLanguage}/${encodedVideoId}`
      : `/${normalizedRoutePrefix}/${encodedVideoId}`
    : normalizedLanguage
      ? `/${normalizedLanguage}/${encodedVideoId}`
      : `/${encodedVideoId}`;

  const safeOrigin = MISSAV_NAVIGATION_ORIGINS[canonicalHost];
  if (!safeOrigin) {
    throw new Error(
      `SSRF protection: Hostname ${canonicalHost} has no allowed navigation origin.`,
    );
  }

  return {
    origin: safeOrigin,
    path: safePath,
    url: `${safeOrigin}${safePath}`,
  };
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

        await navigateMissAvPage(page, safeNavigationUrl);

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
      const moveThumbnailsToVideoFolder = settings.moveThumbnailsToVideoFolder || false;
      const presetId = settings.downloadFilenamePresetId || "legacy";

      let finalVideoFilename: string;
      let finalThumbnailFilename: string;
      let newVideoPath: string;
      let newThumbnailPath: string;
      let finalVideoWebPath: string;
      let finalThumbnailWebPath: string | null;

      if (presetId !== "legacy") {
        // Non-legacy: use path planner
        const uploadDateClean = videoDate.replace(/[^0-9]/g, "").slice(0, 8);
        const year = uploadDateClean.length >= 4 ? uploadDateClean.slice(0, 4) : String(new Date().getFullYear());
        const month = uploadDateClean.length >= 6 ? uploadDateClean.slice(4, 6) : String(new Date().getMonth() + 1).padStart(2, "0");
        const day = uploadDateClean.length >= 8 ? uploadDateClean.slice(6, 8) : String(new Date().getDate()).padStart(2, "0");

        const srcOpts = enrichSourceOptionsForDownload(
          filenameTemplateSourceOptions || {},
          {
            author: videoAuthor,
            uploadDate: videoDate,
          }
        );
        const ctx: FilenameTemplateContext = {
          title: videoTitle,
          id: "",
          ext: "",
          uploader: videoAuthor,
          channel: videoAuthor,
          uploadDate: uploadDateClean,
          uploadYear: year,
          uploadMonth: month,
          uploadDay: day,
          durationSeconds: undefined,
          durationString: "00-00",
          artistName: videoAuthor,
          sourceCustomName: srcOpts.sourceCustomName || "",
          sourceCollectionName: srcOpts.sourceCollectionName || videoAuthor,
          sourceCollectionId: srcOpts.sourceCollectionId || "",
          sourceCollectionType: srcOpts.sourceCollectionType || "single",
          mediaPlaylistIndex: srcOpts.mediaPlaylistIndex,
          mediaPlaylistIndexWithinDate: srcOpts.mediaPlaylistIndexWithinDate,
          platform: "missav",
          sourceUrl: url,
        };

        const planned = planVideoOutputPaths({
          settings,
          context: ctx,
          videoExtension: mergeOutputFormat,
          thumbnailExtension: "jpg",
          moveThumbnailsToVideoFolder,
          moveSubtitlesToVideoFolder: settings.moveSubtitlesToVideoFolder || false,
        });

        const reserved = new Set<string>();
        const deduped = dedupeRelativePath(planned.video.relativePath, VIDEOS_DIR, reserved);
        const { thumbnail: dedupedThumb } = applyDedupeToRelatedPaths(
          planned.video.relativePath,
          deduped,
          planned.thumbnail.relativePath,
          planned.subtitle.baseNameWithoutLanguageOrExt,
        );

        finalVideoFilename = path.basename(deduped);
        newVideoPath = resolveSafeChildPath(VIDEOS_DIR, deduped);
        finalThumbnailFilename = path.basename(dedupedThumb);
        finalVideoWebPath = `/videos/${deduped}`;

        const thumbnailDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
        newThumbnailPath = resolveSafeChildPath(thumbnailDir, dedupedThumb);
        finalThumbnailWebPath = moveThumbnailsToVideoFolder
          ? `/videos/${dedupedThumb}`
          : `/images/${dedupedThumb}`;

        ensureDirSafeSync(path.dirname(newVideoPath), VIDEOS_DIR);
        ensureDirSafeSync(path.dirname(newThumbnailPath), [IMAGES_DIR, VIDEOS_DIR]);
      } else {
        // Legacy mode: use formatVideoFilename
        const newSafeBaseFilename = formatVideoFilename(videoTitle, videoAuthor, videoDate);
        const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
        const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

        finalVideoFilename = newVideoFilename;
        finalThumbnailFilename = newThumbnailFilename;
        newVideoPath = resolveSafeChildPath(VIDEOS_DIR, finalVideoFilename);

        const thumbnailDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;

        // If file already exists (e.g. redownload), deduplicate the filename
        if (pathExistsSafeSync(newVideoPath, VIDEOS_DIR)) {
          let counter = 1;
          const ext = `.${mergeOutputFormat}`;
          const basePath = stripTrailingExtension(newVideoPath, ext);
          const baseName = newSafeBaseFilename;
          while (pathExistsSafeSync(`${basePath}_${counter}${ext}`, VIDEOS_DIR)) {
            counter++;
          }
          newVideoPath = `${basePath}_${counter}${ext}`;
          finalVideoFilename = `${baseName}_${counter}${ext}`;
          finalThumbnailFilename = `${baseName}_${counter}.jpg`;
          logger.info(`File exists, using deduplicated filename: ${finalVideoFilename}`);
        }

        newThumbnailPath = resolveSafeChildPath(thumbnailDir, finalThumbnailFilename);
        finalVideoWebPath = `/videos/${finalVideoFilename}`;
        finalThumbnailWebPath = moveThumbnailsToVideoFolder
          ? `/videos/${finalThumbnailFilename}`
          : `/images/${finalThumbnailFilename}`;
      }

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

      // Prepare flags object - merge user config with required settings
      const flags: any = {
        ...networkConfig, // Apply network settings (proxy, etc.)
        output: newVideoPath,
        format: downloadFormat,
        mergeOutputFormat: mergeOutputFormat,
        addHeader: [
          `Referer:${referer}`,
          `User-Agent:${MISSAV_BROWSER_USER_AGENT}`,
        ],
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
      } catch (err: any) {
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
      const authorCollection = storageService.addVideoToAuthorCollection(
        videoData.id,
        videoAuthor,
        settings.saveAuthorFilesToCollection || false,
        settings.downloadFilenamePresetId,
      );

      if (authorCollection) {
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
    } catch (error: any) {
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

  // Helper to select best m3u8 URL
  static selectBestM3u8Url(
    urls: string[],
    hasFormatSort: boolean,
  ): string | null {
    if (urls.length === 0) return null;

    const getUrlParts = (input: string): { hostname: string; pathname: string } => {
      try {
        const parsedUrl = new URL(input);
        return {
          hostname: parsedUrl.hostname.toLowerCase(),
          pathname: parsedUrl.pathname,
        };
      } catch {
        return { hostname: "", pathname: "" };
      }
    };

    const sortedUrls = [...urls].sort((a, b) => {
      const aParts = getUrlParts(a);
      const bParts = getUrlParts(b);

      // 1. Priority: surrit.com
      const aIsSurrit =
        aParts.hostname === "surrit.com" ||
        aParts.hostname.endsWith(".surrit.com");
      const bIsSurrit =
        bParts.hostname === "surrit.com" ||
        bParts.hostname.endsWith(".surrit.com");
      if (aIsSurrit && !bIsSurrit) return -1;
      if (!aIsSurrit && bIsSurrit) return 1;

      // 2. Priority: Master playlist (playlist.m3u8 specifically for surrit, or general master)
      // We generally prefer master playlists because they contain all variants, allowing yt-dlp to pick the best.
      // The previous logic penalized master playlists without explicit resolution, which caused issues.
      const aIsMaster =
        aParts.pathname.endsWith("/playlist.m3u8") ||
        aParts.pathname.includes("/master/");
      const bIsMaster =
        bParts.pathname.endsWith("/playlist.m3u8") ||
        bParts.pathname.includes("/master/");

      // If we are strictly comparing surrit URLs (both are surrit), we prefer the master playlist
      // because it's the "cleanest" source.
      if (aIsSurrit && bIsSurrit) {
        const aIsPlaylistM3u8 = aParts.pathname.includes("playlist.m3u8");
        const bIsPlaylistM3u8 = bParts.pathname.includes("playlist.m3u8");
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
