import {
  ALLOWED_MISSAV_LANGUAGE_SEGMENTS,
  ALLOWED_ROUTED_VIDEO_LANGUAGE_SEGMENTS,
  MISSAV_CLOUDFLARE_CHALLENGE_PATTERN,
  MISSAV_NAVIGATION_ORIGINS,
  MISSAV_ROUTE_PREFIX_PATTERN,
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

function usesRoutedVideoPath(canonicalHost: string): boolean {
  return canonicalHost.startsWith("123av.") || canonicalHost === "javxx.com";
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
