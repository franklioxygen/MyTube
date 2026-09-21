import { allowedDurationDrift } from "../downloadIntegrity";

// How many renditions of a master are read to corroborate its duration.
const MAX_COMPARED_VARIANTS = 2;

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

/**
 * Total duration of a VOD HLS playlist, in seconds, or null when it cannot be
 * established with confidence.
 *
 * MissAV is the one download path with no source duration, so only the
 * audio/video track comparison applies to it and a download shortened equally
 * across both tracks goes unnoticed. The playlist answers this better than the
 * page would: it describes the exact stream being fetched rather than the title,
 * so it cannot disagree with the rendition yt-dlp downloads.
 *
 * Every uncertain case returns null, which is the existing behaviour. A source
 * duration that is wrong in the *long* direction would reject good downloads,
 * which is far worse than the gap it closes, so nothing is guessed.
 */
export async function resolveM3u8DurationSeconds(
  m3u8Url: string,
  fetchText: (url: string) => Promise<string>,
): Promise<number | null> {
  try {
    const playlist = await fetchText(m3u8Url);
    if (typeof playlist !== "string" || playlist.trim().split(/\r?\n/)[0] !== "#EXTM3U") {
      return null;
    }

    // Format selection belongs to yt-dlp, so which rendition it ends up
    // downloading is not known here. Rather than guess, corroborate: see
    // resolveMasterDuration.
    if (playlist.includes("#EXT-X-STREAM-INF")) {
      return await resolveMasterDuration(playlist, m3u8Url, fetchText);
    }

    return sumMediaPlaylistDuration(playlist);
  } catch {
    return null;
  }
}

/**
 * Duration of a master playlist, corroborated across renditions.
 *
 * Variants of one VOD should describe the same content at different bitrates,
 * but nothing guarantees it, and yt-dlp - not this module - decides which one is
 * downloaded. So two are read and compared instead of one being trusted: if they
 * disagree by more than the completeness check itself tolerates, the master is
 * treated as unusable. Reading only the first two bounds the cost; a master whose
 * first two renditions agree but whose third does not is not worth a request per
 * variant to catch.
 */
async function resolveMasterDuration(
  masterPlaylist: string,
  baseUrl: string,
  fetchText: (url: string) => Promise<string>,
): Promise<number | null> {
  const uris = comparableVariantUris(masterPlaylist);
  if (!uris) return null;

  const durations: number[] = [];
  for (const uri of uris.slice(0, MAX_COMPARED_VARIANTS)) {
    let variantUrl: string;
    try {
      variantUrl = new URL(uri, baseUrl).toString();
    } catch {
      return null;
    }
    // One level only: sumMediaPlaylistDuration rejects a nested master outright
    // rather than following it.
    const duration = sumMediaPlaylistDuration(await fetchText(variantUrl));
    if (duration == null) return null;
    durations.push(duration);
  }

  if (durations.length === 1) return durations[0];

  const [first, second] = durations;
  // Accept the pair only when the disagreement is smaller than what the check
  // tolerates, so whichever rendition yt-dlp downloads, this number cannot by
  // itself produce a rejection.
  if (Math.abs(first - second) > allowedDurationDrift(Math.max(first, second))) {
    return null;
  }
  // The shorter one is the conservative choice: the check flags a shortfall
  // only, so understating the source can never cause a false rejection.
  return Math.min(first, second);
}

/**
 * Variant URIs of a master, in playlist order, or null when the master cannot
 * be interpreted.
 */
function comparableVariantUris(masterPlaylist: string): string[] | null {
  const lines = masterPlaylist.split(/\r?\n/).map((line) => line.trim());

  // A separate audio or subtitle rendition means each variant playlist covers
  // only part of the muxed result, so its duration is not the download's.
  if (lines.some((line) => line.startsWith("#EXT-X-MEDIA:") && /\bURI=/.test(line))) {
    return null;
  }

  const uris: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    // The URI is the next non-blank, non-comment line.
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (!candidate) continue;
      if (candidate.startsWith("#")) break;
      uris.push(candidate);
      break;
    }
  }

  return uris.length > 0 ? uris : null;
}

function sumMediaPlaylistDuration(playlist: string): number | null {
  if (typeof playlist !== "string") return null;
  const lines = playlist.trim().split(/\r?\n/).map((line) => line.trim());
  // A live/growing playlist cannot establish the final duration. Reject nested
  // masters too, rather than treating any incidental EXTINF tags as authoritative.
  if (lines[0] !== "#EXTM3U" || !lines.includes("#EXT-X-ENDLIST") ||
      lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:"))) return null;

  let total = 0;
  let segments = 0;
  for (const line of lines) {
    if (!line.startsWith("#EXTINF:")) continue;
    const duration = line.slice("#EXTINF:".length).split(",")[0];
    if (!/^\d+(?:\.\d+)?$/.test(duration)) return null;
    const value = Number(duration);
    if (!Number.isFinite(value) || value < 0) return null;
    total += value;
    segments += 1;
  }

  if (segments === 0 || total <= 0 || !Number.isFinite(total)) return null;
  return total;
}
