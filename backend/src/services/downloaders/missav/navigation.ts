import {
  MISSAV_CLOUDFLARE_CHALLENGE_PATTERN,
  MISSAV_MAX_VIDEO_PATH_PREFIX_SEGMENTS,
  MISSAV_NAVIGATION_ORIGINS,
  MISSAV_PATH_PREFIX_SEGMENT_PATTERN,
  MISSAV_VIDEO_ID_PATTERN,
} from "./constants";

export function isCloudflareChallengeHtml(html: string): boolean {
  return MISSAV_CLOUDFLARE_CHALLENGE_PATTERN.test(html);
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

export function buildSafeMissAvNavigationTarget(url: string): {
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
  if (!videoId || !MISSAV_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(
      `SSRF protection: Invalid MissAV video path in URL: ${parsedUrl.pathname}`,
    );
  }

  // Everything before the video id is a route prefix and/or a language segment
  // (e.g. /dm9/cn/<id>, /en/v/<id>, /cn/<id>). The exact segments differ per
  // mirror and per locale, so they are validated by shape rather than against a
  // fixed list, and the result is always re-pinned to an allow-listed origin.
  const prefixSegments = pathSegments.slice(0, -1);
  if (prefixSegments.length > MISSAV_MAX_VIDEO_PATH_PREFIX_SEGMENTS) {
    throw new Error(
      `SSRF protection: Invalid MissAV video path in URL: ${parsedUrl.pathname}`,
    );
  }

  const normalizedPrefixSegments = prefixSegments.map((segment) =>
    segment.toLowerCase(),
  );
  const invalidPrefixSegment = normalizedPrefixSegments.find(
    (segment) => !MISSAV_PATH_PREFIX_SEGMENT_PATTERN.test(segment),
  );
  if (invalidPrefixSegment !== undefined) {
    throw new Error(
      `SSRF protection: Invalid MissAV route segment "${invalidPrefixSegment}" in URL: ${parsedUrl.pathname}`,
    );
  }

  const encodedVideoId = encodeURIComponent(videoId);
  const safePath = `/${[...normalizedPrefixSegments, encodedVideoId].join("/")}`;

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
