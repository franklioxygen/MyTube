import {
  ActorRole,
  CanonicalPlatform,
  CanonicalSourceKind,
  DownloadFailureBucket,
  StatisticsSurface,
} from "./eventTypes";

const PLATFORM_VALUES: ReadonlySet<CanonicalPlatform> = new Set<CanonicalPlatform>([
  "youtube",
  "bilibili",
  "twitch",
  "missav",
  "local",
  "cloud",
  "unknown",
]);

const SOURCE_KIND_VALUES: ReadonlySet<CanonicalSourceKind> = new Set<CanonicalSourceKind>([
  "manual",
  "search_result",
  "subscription",
  "extension",
  "upload",
  "scan",
  "rss",
  "library",
  "task",
  "api",
  "unknown",
]);

const SURFACE_VALUES: ReadonlySet<StatisticsSurface> = new Set<StatisticsSurface>([
  "web",
  "extension",
  "api",
  "background",
  "unknown",
]);

const ACTOR_VALUES: ReadonlySet<ActorRole> = new Set<ActorRole>([
  "admin",
  "visitor",
  "system",
]);

export function normalizePlatform(value: unknown): CanonicalPlatform {
  if (typeof value !== "string") return "unknown";
  const lower = value.trim().toLowerCase();
  if (PLATFORM_VALUES.has(lower as CanonicalPlatform)) return lower as CanonicalPlatform;
  return "unknown";
}

export function normalizeSourceKind(value: unknown): CanonicalSourceKind {
  if (typeof value !== "string") return "unknown";
  const lower = value.trim().toLowerCase();
  if (SOURCE_KIND_VALUES.has(lower as CanonicalSourceKind))
    return lower as CanonicalSourceKind;
  return "unknown";
}

export function normalizeSurface(value: unknown): StatisticsSurface {
  if (typeof value !== "string") return "web";
  const lower = value.trim().toLowerCase();
  if (SURFACE_VALUES.has(lower as StatisticsSurface)) return lower as StatisticsSurface;
  return "unknown";
}

export function normalizeActorRole(value: unknown): ActorRole | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (ACTOR_VALUES.has(lower as ActorRole)) return lower as ActorRole;
  return null;
}

// Map a host string from a URL to a canonical platform bucket.
export function platformFromUrl(url: string | null | undefined): CanonicalPlatform {
  if (!url) return "unknown";
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("bilibili.com") || lower.includes("b23.tv")) return "bilibili";
  if (lower.includes("twitch.tv")) return "twitch";
  if (lower.includes("missav")) return "missav";
  return "unknown";
}

// Best-effort classification of yt-dlp / downloader error strings into stable buckets.
export function bucketDownloadError(error: string | null | undefined): DownloadFailureBucket {
  if (!error) return "unknown";
  const text = error.toLowerCase();

  if (
    text.includes("login required") ||
    text.includes("cookies") ||
    text.includes("authentication") ||
    text.includes("403") ||
    text.includes("members-only")
  ) {
    return "auth_required";
  }

  if (
    text.includes("video unavailable") ||
    text.includes("private video") ||
    text.includes("removed") ||
    text.includes("does not exist") ||
    text.includes("not found") ||
    text.includes("404")
  ) {
    return "source_unavailable";
  }

  if (
    text.includes("geo") ||
    text.includes("region") ||
    text.includes("blocked") ||
    text.includes("network is unreachable") ||
    text.includes("connection")
  ) {
    return "geo_or_network_blocked";
  }

  if (
    text.includes("extractor") ||
    text.includes("update yt-dlp") ||
    text.includes("could not find") ||
    text.includes("unable to extract")
  ) {
    return "extractor_changed";
  }

  if (
    text.includes("enospc") ||
    text.includes("eperm") ||
    text.includes("eacces") ||
    text.includes("disk") ||
    text.includes("read-only file system") ||
    text.includes("file system")
  ) {
    return "filesystem_error";
  }

  if (
    text.includes("cloud") ||
    text.includes("openlist") ||
    text.includes("upload failed")
  ) {
    return "cloud_upload_failed";
  }

  return "unknown";
}

// Stable, ordered JSON for hashing dimensions in the daily rollup.
export function canonicalDimensionsJson(
  dimensions: Record<string, unknown> | null | undefined
): string {
  if (!dimensions) return "{}";
  const entries = Object.entries(dimensions)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "{}";
  const obj: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    obj[k] = v;
  }
  return JSON.stringify(obj);
}

// Compute a stable, short hash for the canonical dimensions string.
export function dimensionsHash(canonicalJson: string): string {
  // FNV-1a 32-bit -> hex. Sufficient for upsert keys; not security-sensitive.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonicalJson.length; i++) {
    h ^= canonicalJson.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Compute YYYY-MM-DD in the frozen statistics timezone using Intl.DateTimeFormat.
export function dayBucket(epochMs: number, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(epochMs));
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    // Fallback to UTC if timezone string is not understood.
    const date = new Date(epochMs);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

// Parse a duration like "1h2m3s", "01:23:45", "PT1H2M3S", or seconds string.
export function parseDurationSeconds(value: string | null | undefined): number | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Plain integer/float seconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) return Math.round(num);
    return null;
  }

  // ISO-8601 duration: PT#H#M#S
  const isoMatch = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(trimmed);
  if (isoMatch) {
    const h = Number(isoMatch[1] ?? 0);
    const m = Number(isoMatch[2] ?? 0);
    const s = Number(isoMatch[3] ?? 0);
    const total = Math.round(h * 3600 + m * 60 + s);
    return total > 0 ? total : null;
  }

  // HH:MM:SS or MM:SS
  if (/^\d+:\d{1,2}(?::\d{1,2})?$/.test(trimmed)) {
    const segs = trimmed.split(":").map((seg) => Number(seg));
    if (segs.some((n) => !Number.isFinite(n))) return null;
    let total = 0;
    if (segs.length === 3) total = segs[0] * 3600 + segs[1] * 60 + segs[2];
    else if (segs.length === 2) total = segs[0] * 60 + segs[1];
    return total > 0 ? Math.round(total) : null;
  }

  // 1h2m3s
  const compactMatch = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i.exec(trimmed);
  if (compactMatch && compactMatch[0].length > 0) {
    const h = Number(compactMatch[1] ?? 0);
    const m = Number(compactMatch[2] ?? 0);
    const s = Number(compactMatch[3] ?? 0);
    const total = Math.round(h * 3600 + m * 60 + s);
    return total > 0 ? total : null;
  }

  return null;
}
