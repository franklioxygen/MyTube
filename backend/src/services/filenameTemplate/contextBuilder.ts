import { FilenameTemplateContext, FilenameTemplateSourceOptions } from "./types";
import { Video } from "../storageService/types";

const UNKNOWN = "Unknown";

function sanitizeUploadDate(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[^0-9]/g, "");
  if (cleaned.length >= 8) return cleaned.slice(0, 8);
  return "";
}

function parseDateParts(yyyymmdd: string): {
  year: string;
  month: string;
  day: string;
} {
  if (yyyymmdd.length >= 8) {
    return {
      year: yyyymmdd.slice(0, 4),
      month: yyyymmdd.slice(4, 6),
      day: yyyymmdd.slice(6, 8),
    };
  }
  const today = new Date();
  return {
    year: String(today.getFullYear()),
    month: String(today.getMonth() + 1).padStart(2, "0"),
    day: String(today.getDate()).padStart(2, "0"),
  };
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "00-00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${String(h).padStart(2, "0")}-${mm}-${ss}`;
  }
  return `${mm}-${ss}`;
}

// Map of platform -> allowed hostname suffixes. Matched against the parsed
// URL hostname only (not via substring includes()), so an attacker URL like
// "https://evil.com/?youtube.com" is correctly classified as "unknown".
const PLATFORM_HOST_SUFFIXES: Array<{
  platform: FilenameTemplateContext["platform"];
  suffixes: string[];
}> = [
  { platform: "youtube", suffixes: ["youtube.com", "youtu.be"] },
  { platform: "twitch", suffixes: ["twitch.tv"] },
  { platform: "bilibili", suffixes: ["bilibili.com", "b23.tv"] },
  { platform: "missav", suffixes: ["missav.com"] },
];

function getHostnameSafely(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchPlatformByHostname(
  hostname: string
): FilenameTemplateContext["platform"] | null {
  for (const { platform, suffixes } of PLATFORM_HOST_SUFFIXES) {
    for (const suffix of suffixes) {
      if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
        return platform;
      }
    }
  }
  return null;
}

function extractPlatform(
  source: string | undefined,
  url: string | undefined
): FilenameTemplateContext["platform"] {
  const s = (source || "").toLowerCase();
  if (s === "youtube" || s.includes("youtube")) return "youtube";
  if (s === "twitch" || s.includes("twitch")) return "twitch";
  if (s === "bilibili" || s.includes("bilibili")) return "bilibili";
  if (s === "missav" || s.includes("missav")) return "missav";
  if (url) {
    const hostname = getHostnameSafely(url);
    if (hostname) {
      const matched = matchPlatformByHostname(hostname);
      if (matched) return matched;
    }
  }
  return "unknown";
}

/**
 * Builds a FilenameTemplateContext from yt-dlp info object.
 */
export function buildContextFromYtDlpInfo(
  videoUrl: string,
  info: Record<string, any>,
  options: FilenameTemplateSourceOptions = {}
): FilenameTemplateContext {
  const uploadDate = sanitizeUploadDate(info.upload_date);
  const dateParts = parseDateParts(uploadDate);
  const durationSec = typeof info.duration === "number" ? info.duration : undefined;

  const uploader = info.uploader || info.channel || info.creator || UNKNOWN;
  const channel = info.channel || info.uploader || UNKNOWN;
  const title = info.title || UNKNOWN;
  const id = info.id || "";

  const platform = extractPlatform(info.extractor, videoUrl);

  return {
    title,
    id,
    ext: "",
    uploader,
    channel,
    uploadDate: uploadDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    uploadYear: dateParts.year,
    uploadMonth: dateParts.month,
    uploadDay: dateParts.day,
    durationSeconds: durationSec,
    durationString: formatDuration(durationSec),
    artistName: uploader,
    sourceCustomName: options.sourceCustomName || "",
    sourceCollectionName: options.sourceCollectionName || info.playlist_title || info.channel || "",
    sourceCollectionId: options.sourceCollectionId || info.playlist_id || info.channel_id || "",
    sourceCollectionType: options.sourceCollectionType || "single",
    mediaPlaylistIndex: options.mediaPlaylistIndex ?? (typeof info.playlist_index === "number" ? info.playlist_index : undefined),
    mediaPlaylistIndexWithinDate: options.mediaPlaylistIndexWithinDate,
    platform,
    sourceUrl: videoUrl,
    rawInfo: info,
  };
}

/**
 * Builds a FilenameTemplateContext from Bilibili metadata.
 */
export function buildContextFromBilibiliMetadata(
  url: string,
  metadata: Record<string, any>,
  options: FilenameTemplateSourceOptions = {}
): FilenameTemplateContext {
  const rawDate =
    metadata.pubdate
      ? new Date(metadata.pubdate * 1000).toISOString().slice(0, 10).replace(/-/g, "")
      : metadata.publishDate || "";
  const uploadDate = sanitizeUploadDate(rawDate);
  const dateParts = parseDateParts(uploadDate);
  const durationSec = typeof metadata.duration === "number" ? metadata.duration : undefined;
  const owner = metadata.owner?.name || metadata.ownerName || UNKNOWN;

  return {
    title: metadata.title || UNKNOWN,
    id: metadata.bvid || metadata.aid || "",
    ext: "",
    uploader: owner,
    channel: owner,
    uploadDate: uploadDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    uploadYear: dateParts.year,
    uploadMonth: dateParts.month,
    uploadDay: dateParts.day,
    durationSeconds: durationSec,
    durationString: formatDuration(durationSec),
    artistName: owner,
    sourceCustomName: options.sourceCustomName || "",
    sourceCollectionName: options.sourceCollectionName || metadata.seriesTitle || "",
    sourceCollectionId: options.sourceCollectionId || metadata.seasonId || "",
    sourceCollectionType: options.sourceCollectionType || "single",
    mediaPlaylistIndex: options.mediaPlaylistIndex ?? metadata.partIndex,
    mediaPlaylistIndexWithinDate: options.mediaPlaylistIndexWithinDate,
    platform: "bilibili",
    sourceUrl: url,
    rawInfo: metadata,
  };
}

/**
 * Builds a FilenameTemplateContext from an existing Video DB record.
 * Used during batch rename.
 */
export function buildContextFromVideoRecord(
  video: Video,
  options: FilenameTemplateSourceOptions = {}
): FilenameTemplateContext {
  const rawDate = video.date || "";
  const uploadDate = sanitizeUploadDate(rawDate);
  const dateParts = parseDateParts(uploadDate);
  const durationSec =
    video.duration ? parseFloat(video.duration) || undefined : undefined;

  const author = video.author || UNKNOWN;

  const platform = extractPlatform(video.source, video.sourceUrl);

  return {
    title: video.title || UNKNOWN,
    id: video.id || "",
    ext: "",
    uploader: author,
    channel: author,
    uploadDate: uploadDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    uploadYear: dateParts.year,
    uploadMonth: dateParts.month,
    uploadDay: dateParts.day,
    durationSeconds: durationSec,
    durationString: formatDuration(durationSec),
    artistName: author,
    sourceCustomName: options.sourceCustomName || "",
    sourceCollectionName: options.sourceCollectionName || author,
    sourceCollectionId: options.sourceCollectionId || "",
    sourceCollectionType: options.sourceCollectionType || "unknown",
    mediaPlaylistIndex: options.mediaPlaylistIndex,
    mediaPlaylistIndexWithinDate: options.mediaPlaylistIndexWithinDate,
    platform,
    sourceUrl: video.sourceUrl,
  };
}
