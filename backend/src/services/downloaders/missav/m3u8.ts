// Select the best m3u8 URL from a set of candidates captured during page load.
export function selectBestM3u8Url(
  urls: string[],
  hasFormatSort: boolean,
): string | null {
  if (urls.length === 0) return null;

  const getUrlParts = (
    input: string,
  ): { hostname: string; pathname: string } => {
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
