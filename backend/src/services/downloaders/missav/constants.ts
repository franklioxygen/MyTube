export const YT_DLP_PATH = process.env.YT_DLP_PATH || "yt-dlp";
export const MISSAV_PROGRESS_LOG_INTERVAL_MS = 10_000;

export const MISSAV_NAVIGATION_ORIGINS: Record<string, string> = {
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

export const PUPPETEER_MACOS_EXECUTABLE_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
export const PUPPETEER_LINUX_EXECUTABLE_PATHS = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

export const MISSAV_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
export const MISSAV_BROWSER_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
// MissAV-style video URLs are at most three segments deep: an optional route
// prefix and/or language segment followed by the video id, e.g.
// /dm9/cn/tysf-026-uncensored-leak, /en/fc2-ppv-1627274 or /en/v/fc2-ppv-2683017.
export const MISSAV_MAX_VIDEO_PATH_PREFIX_SEGMENTS = 2;
export const MISSAV_PATH_PREFIX_SEGMENT_PATTERN = /^[a-z0-9_-]{1,20}$/;
export const MISSAV_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{2,120}$/;
export const MISSAV_CLOUDFLARE_CHALLENGE_PATTERN =
  /cf-turnstile|Just a moment|security verification|challenge-platform/i;
