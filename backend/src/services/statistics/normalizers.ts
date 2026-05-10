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

const URL_PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const NUMERIC_DURATION_PATTERN = /^\d+(\.\d+)?$/;
const ISO_DURATION_PATTERN = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i;
const CLOCK_DURATION_PATTERN = /^\d+:\d{1,2}(?::\d{1,2})?$/;
const COMPACT_DURATION_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i;

const PLATFORM_HOST_RULES: ReadonlyArray<{
  platform: CanonicalPlatform;
  hosts: readonly string[];
}> = [
  { platform: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "bilibili", hosts: ["bilibili.com", "b23.tv"] },
  { platform: "twitch", hosts: ["twitch.tv"] },
  {
    platform: "missav",
    hosts: ["missav.com", "missav.ai", "missav.ws", "missav.live"],
  },
];

const DOWNLOAD_ERROR_BUCKET_RULES: ReadonlyArray<{
  bucket: DownloadFailureBucket;
  needles: readonly string[];
}> = [
  {
    bucket: "auth_required",
    needles: ["login required", "cookies", "authentication", "403", "members-only"],
  },
  {
    bucket: "source_unavailable",
    needles: ["video unavailable", "private video", "removed", "does not exist", "not found", "404"],
  },
  {
    bucket: "geo_or_network_blocked",
    needles: ["geo", "region", "blocked", "network is unreachable", "connection"],
  },
  {
    bucket: "extractor_changed",
    needles: ["extractor", "update yt-dlp", "could not find", "unable to extract"],
  },
  {
    bucket: "filesystem_error",
    needles: ["enospc", "eperm", "eacces", "disk", "read-only file system", "file system"],
  },
  {
    bucket: "cloud_upload_failed",
    needles: ["cloud", "openlist", "upload failed"],
  },
];

type DurationParser = (value: string) => number | null;

function getNormalizedHostname(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const candidate = URL_PROTOCOL_PATTERN.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(candidate).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
}

function matchesHostname(hostname: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some(
    (allowedHost) =>
      hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
  );
}

function normalizeKnownValue(
  value: unknown,
  knownValues: ReadonlySet<string>,
  fallback: string | null
): string | null {
  if (typeof value !== "string") return fallback;
  const lower = value.trim().toLowerCase();
  return knownValues.has(lower) ? lower : fallback;
}

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function normalizeDurationTotal(total: number): number | null {
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

function parseNumericSeconds(value: string): number | null {
  if (!NUMERIC_DURATION_PATTERN.test(value)) return null;
  return normalizeDurationTotal(Number(value));
}

function parseIsoDuration(value: string): number | null {
  const match = ISO_DURATION_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return normalizeDurationTotal(hours * 3600 + minutes * 60 + seconds);
}

function parseClockDuration(value: string): number | null {
  if (!CLOCK_DURATION_PATTERN.test(value)) return null;
  const segments = value.split(":").map((segment) => Number(segment));
  if (segments.some((segment) => !Number.isFinite(segment))) return null;
  const [hours, minutes, seconds = 0] =
    segments.length === 3 ? segments : [0, segments[0], segments[1]];
  return normalizeDurationTotal(hours * 3600 + minutes * 60 + seconds);
}

function parseCompactDuration(value: string): number | null {
  const match = COMPACT_DURATION_PATTERN.exec(value);
  if (!match || match[0].length === 0) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return normalizeDurationTotal(hours * 3600 + minutes * 60 + seconds);
}

const DURATION_PARSERS: readonly DurationParser[] = [
  parseNumericSeconds,
  parseIsoDuration,
  parseClockDuration,
  parseCompactDuration,
];

export function normalizePlatform(value: unknown): CanonicalPlatform {
  return (normalizeKnownValue(value, PLATFORM_VALUES, "unknown") ?? "unknown") as CanonicalPlatform;
}

export function normalizeSourceKind(value: unknown): CanonicalSourceKind {
  return (normalizeKnownValue(value, SOURCE_KIND_VALUES, "unknown") ?? "unknown") as CanonicalSourceKind;
}

export function normalizeSurface(value: unknown): StatisticsSurface {
  return (normalizeKnownValue(value, SURFACE_VALUES, "web") ?? "web") as StatisticsSurface;
}

export function normalizeActorRole(value: unknown): ActorRole | null {
  return normalizeKnownValue(value, ACTOR_VALUES, null) as ActorRole | null;
}

// Map a host string from a URL to a canonical platform bucket.
export function platformFromUrl(url: string | null | undefined): CanonicalPlatform {
  if (!url) return "unknown";
  const hostname = getNormalizedHostname(url);
  if (!hostname) return "unknown";
  const match = PLATFORM_HOST_RULES.find(({ hosts }) => matchesHostname(hostname, hosts));
  return match?.platform ?? "unknown";
}

// Best-effort classification of yt-dlp / downloader error strings into stable buckets.
export function bucketDownloadError(error: string | null | undefined): DownloadFailureBucket {
  if (!error) return "unknown";
  const text = error.toLowerCase();
  const match = DOWNLOAD_ERROR_BUCKET_RULES.find(({ needles }) => includesAny(text, needles));
  return match?.bucket ?? "unknown";
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
  for (const parseDuration of DURATION_PARSERS) {
    const parsed = parseDuration(trimmed);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}
