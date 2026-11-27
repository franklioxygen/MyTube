import { createHash } from "node:crypto";
import axios from "axios";
import { SPONSORBLOCK_CATEGORIES } from "../../types/settings";
import { VERSION } from "../../version";
import { resolveProxiedAxiosConfigForUrl } from "../downloaders/bilibili/bilibiliConfig";

/**
 * Read-only SponsorBlock lookups (issue #555). Only the server talks to
 * sponsor.ajay.app, and only through the hash-prefix endpoint, so upstream
 * learns that one of roughly 1/65536 of all videos was looked up, never which.
 */

const SPONSORBLOCK_API_URL = "https://sponsor.ajay.app/api/skipSegments";
const HASH_PREFIX_LENGTH = 4;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SEGMENTS = 200;
const MAX_UUID_LENGTH = 128;

// Everything a later phase may use is fetched up front, so the cache never
// depends on the viewer's category settings. Chapters are not fetched.
const FETCHED_CATEGORIES: readonly string[] = [
  ...SPONSORBLOCK_CATEGORIES,
  "poi_highlight",
  "exclusive_access",
];
const FETCHED_ACTION_TYPES = ["skip", "mute", "poi", "full"] as const;
export type SponsorActionType = (typeof FETCHED_ACTION_TYPES)[number];

export interface SponsorSegment {
  uuid: string;
  category: string;
  actionType: SponsorActionType;
  start: number;
  end: number;
  /** Duration of the video the segment was submitted against; 0 when unknown. */
  videoDuration: number;
}

/**
 * `proxy`: the configured proxy is unusable, so nothing was sent.
 * `rateLimited`: upstream answered 429. `upstream`: any other failure.
 */
export type SponsorBlockFailureKind = "proxy" | "rateLimited" | "upstream";

export class SponsorBlockUnavailableError extends Error {
  constructor(readonly kind: SponsorBlockFailureKind) {
    super(`SponsorBlock lookup failed (${kind})`);
    this.name = "SponsorBlockUnavailableError";
  }
}

export function sponsorBlockHashPrefix(youtubeId: string): string {
  return createHash("sha256")
    .update(youtubeId)
    .digest("hex")
    .slice(0, HASH_PREFIX_LENGTH);
}

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Upstream data is untrusted: keep only well-formed, known segments. */
export function normalizeSponsorSegments(raw: unknown): SponsorSegment[] {
  if (!Array.isArray(raw)) return [];
  const segments: SponsorSegment[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { segment, category, actionType, UUID, videoDuration } =
      item as Record<string, unknown>;
    if (!Array.isArray(segment) || segment.length !== 2) continue;
    const [start, end] = segment;
    if (!finiteNonNegative(start) || !finiteNonNegative(end) || end < start) continue;
    if (typeof category !== "string" || !FETCHED_CATEGORIES.includes(category)) continue;
    if (!FETCHED_ACTION_TYPES.includes(actionType as SponsorActionType)) continue;
    if (typeof UUID !== "string" || !UUID || UUID.length > MAX_UUID_LENGTH) continue;
    segments.push({
      uuid: UUID,
      category,
      actionType: actionType as SponsorActionType,
      start,
      end,
      videoDuration: finiteNonNegative(videoDuration) ? videoDuration : 0,
    });
  }
  return segments
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_SEGMENTS);
}

/** Segments for one YouTube video; an empty list when it has none. */
export async function fetchSponsorSegments(
  youtubeId: string
): Promise<SponsorSegment[]> {
  // Resolved for the video's YouTube URL on purpose: "proxy only YouTube"
  // users need the proxy for YouTube-side services, and a broken proxy must
  // mean "do not send", never "send directly".
  const proxyConfig = resolveProxiedAxiosConfigForUrl(
    `https://www.youtube.com/watch?v=${youtubeId}`
  );
  if (proxyConfig === null) throw new SponsorBlockUnavailableError("proxy");

  try {
    const response = await axios.get(
      `${SPONSORBLOCK_API_URL}/${sponsorBlockHashPrefix(youtubeId)}`,
      {
        ...proxyConfig,
        params: {
          categories: JSON.stringify(FETCHED_CATEGORIES),
          actionTypes: JSON.stringify(FETCHED_ACTION_TYPES),
        },
        headers: {
          Accept: "application/json",
          "User-Agent": `MyTube/${VERSION.number}`,
        },
        responseType: "json",
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        // 404 is how the prefix endpoint says "no video with this prefix".
        validateStatus: (status) => status === 200 || status === 404,
      }
    );
    if (response.status === 404) return [];
    if (!Array.isArray(response.data)) {
      throw new SponsorBlockUnavailableError("upstream");
    }
    const entry = response.data.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        (item as { videoID?: unknown }).videoID === youtubeId
    ) as { segments?: unknown } | undefined;
    return entry ? normalizeSponsorSegments(entry.segments) : [];
  } catch (error) {
    if (error instanceof SponsorBlockUnavailableError) throw error;
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    throw new SponsorBlockUnavailableError(
      status === 429 ? "rateLimited" : "upstream"
    );
  }
}
