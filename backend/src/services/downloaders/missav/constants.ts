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

export const MISSAV_BROWSER_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
// MissAV-style video URLs are at most three segments deep: an optional route
// prefix and/or language segment followed by the video id, e.g.
// /dm9/cn/tysf-026-uncensored-leak, /en/fc2-ppv-1627274 or /en/v/fc2-ppv-2683017.
export const MISSAV_MAX_VIDEO_PATH_PREFIX_SEGMENTS = 2;
export const MISSAV_PATH_PREFIX_SEGMENT_PATTERN = /^[a-z0-9_-]{1,20}$/;
export const MISSAV_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{2,120}$/;
// Cloudflare injects /cdn-cgi/challenge-platform/scripts/jsd/main.js into every
// page it fronts, challenge or not, so matching a bare "challenge-platform"
// reported an interstitial on a perfectly good video page - and since that check
// only runs once no m3u8 was captured, a player that simply never started was
// reported as a Cloudflare block, sending diagnosis the wrong way entirely.
//
// Every marker here belongs to the interstitial itself:
//   _cf_chl_opt                          the challenge script's config object
//   challenge-platform/h/<x>/orchestrate the challenge orchestration endpoint,
//                                        as opposed to the beacon above
//   challenge-form|running|error-title   interstitial markup
//   cf-turnstile                         the widget, which a video page never embeds
//   Just a moment / Performing security verification   the interstitial's own copy
//                                        ("security verification" alone was loose
//                                        enough to hit ordinary page text)
export const MISSAV_CLOUDFLARE_CHALLENGE_PATTERN =
  /cf-turnstile|Just a moment|Performing security verification|_cf_chl_opt|challenge-platform\/h\/[a-z0-9]+\/orchestrate|challenge-(?:form|running|error-title)/i;

// yt-dlp defaults `--concurrent-fragments` to 1, so its native HLS downloader
// fetches every fragment strictly one after another. A MissAV stream is
// hundreds of fragments, so the per-request round trip — not bandwidth —
// decides throughput, and an outbound HTTP proxy that adds latency to each
// request collapses it (issue #446). Four parallel fetches hide that latency
// without hammering the CDN; users who want more can set `-N` themselves.
export const MISSAV_DEFAULT_CONCURRENT_FRAGMENTS = 4;
