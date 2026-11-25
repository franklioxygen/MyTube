import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import type { Video } from "../storageService/types";
import {
  fetchSponsorSegments,
  SponsorBlockUnavailableError,
  type SponsorSegment,
} from "./client";

// `source` is not a typed member of Video; the row carries it all the same.
type SponsorBlockVideo = Pick<Video, "sourceVideoId"> & { source?: unknown };

/**
 * Playback-time SponsorBlock data for library videos (issue #555).
 *
 * Results live in memory only: a restart costs one lookup per video watched
 * again, and playback never waits on them. Persisting them is the second
 * phase, together with fetching at download time, which is what offline
 * playback would need.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const CACHE_LIMIT = 500;
const TTL_WITH_SEGMENTS_MS = 24 * 60 * 60 * 1000;
// Fresh subscription downloads are often watched before anyone has submitted
// segments, so an empty answer is rechecked sooner.
const TTL_WITHOUT_SEGMENTS_MS = 60 * 60 * 1000;
const MAX_IN_FLIGHT = 4;
const UPSTREAM_BACKOFF_MS = 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;

export type SponsorBlockStatus =
  | "disabled"
  | "unsupported"
  | "ready"
  | "none"
  | "unavailable";

export interface SponsorBlockResult {
  status: SponsorBlockStatus;
  segments: SponsorSegment[];
}

interface CacheEntry {
  segments: SponsorSegment[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry | null>>();
let backoffUntil = 0;

/**
 * SponsorBlock only knows YouTube IDs. source_video_id is backfilled from
 * source_url at startup, so no URL parsing is needed here.
 */
export function youtubeIdForVideo(video: SponsorBlockVideo): string | null {
  const id = video.source === "youtube" ? video.sourceVideoId : null;
  return id && YOUTUBE_ID.test(id) ? id : null;
}

function isFresh(entry: CacheEntry, now: number): boolean {
  const ttl = entry.segments.length > 0 ? TTL_WITH_SEGMENTS_MS : TTL_WITHOUT_SEGMENTS_MS;
  return now - entry.fetchedAt < ttl;
}

/** Re-inserting keeps Map order as least-recently-used first. */
function remember(id: string, entry: CacheEntry): void {
  cache.delete(id);
  cache.set(id, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Never rejects: a failed lookup is null, and upstream trouble backs off. */
function refresh(id: string): Promise<CacheEntry | null> {
  const pending = inFlight.get(id);
  if (pending) return pending;
  if (Date.now() < backoffUntil || inFlight.size >= MAX_IN_FLIGHT) {
    return Promise.resolve(null);
  }
  const request = fetchSponsorSegments(id)
    .then((segments) => {
      const entry = { segments, fetchedAt: Date.now() };
      remember(id, entry);
      return entry;
    })
    .catch((error: unknown) => {
      const kind = error instanceof SponsorBlockUnavailableError ? error.kind : "upstream";
      // A broken proxy sends nothing, so there is nothing to back off from.
      if (kind !== "proxy") {
        backoffUntil =
          Date.now() + (kind === "rateLimited" ? RATE_LIMIT_BACKOFF_MS : UPSTREAM_BACKOFF_MS);
      }
      logger.warn("SponsorBlock lookup failed", { kind });
      return null;
    })
    .finally(() => {
      inFlight.delete(id);
    });
  inFlight.set(id, request);
  return request;
}

const resultOf = (entry: CacheEntry): SponsorBlockResult => ({
  status: entry.segments.length > 0 ? "ready" : "none",
  segments: entry.segments,
});

export async function getSponsorBlockSegments(
  video: SponsorBlockVideo
): Promise<SponsorBlockResult> {
  // Checked here too: a client can hold settings older than the switch.
  if (storageService.getSettings().sponsorBlockEnabled !== true) {
    return { status: "disabled", segments: [] };
  }
  const id = youtubeIdForVideo(video);
  if (!id) return { status: "unsupported", segments: [] };

  const cached = cache.get(id);
  if (cached && isFresh(cached, Date.now())) {
    remember(id, cached);
    return resultOf(cached);
  }
  // An expired answer is still better than none while upstream is down.
  const entry = (await refresh(id)) ?? cached;
  return entry ? resultOf(entry) : { status: "unavailable", segments: [] };
}

export function resetSponsorBlockCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  backoffUntil = 0;
}
