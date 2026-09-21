import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { runWithConcurrencyLimit } from "../utils/concurrency";
import { logger } from "../utils/logger";
import { pathExistsSafeSync, statSafeSync } from "../utils/security";
import {
  allowedDurationDrift,
  evaluateMediaCompleteness,
  parseSourceDurationSeconds,
  probeMediaTrackDurations,
  type MediaTrackDurations,
} from "./downloaders/downloadIntegrity";
import { resolveManagedWebPath } from "./filenameTemplate/pathHelpers";
import * as storageService from "./storageService";
import type { Video } from "./storageService/types";

/**
 * Library-wide media integrity audit.
 *
 * The download-time completeness check protects new downloads only. A file that
 * was already damaged when it entered the library is never re-examined, so the
 * only way to discover it is to play it until it breaks. This re-runs the same
 * verdict over what is already on disk.
 *
 * It is read-only and reports findings. It never repairs: re-downloading is
 * expensive, can fail, and for a source that has gone offline would replace a
 * partially watchable file with nothing. That call belongs to the user.
 */

export type MediaIntegrityAuditReason =
  | "file_missing"
  | "track_disagreement"
  | "duration_mismatch"
  | "unprobeable";

export type MediaIntegrityRecommendedAction =
  | "redownload"
  | "refresh_duration"
  | "manual_review";

export interface MediaIntegrityAuditItem {
  localVideoId: string;
  title: string;
  sourceUrl: string | null;
  videoPath: string | null;
  reasons: MediaIntegrityAuditReason[];
  detail: string;
  storedDurationSeconds: number | null;
  measured: MediaTrackDurations;
  recommendedAction: MediaIntegrityRecommendedAction;
}

export interface MediaIntegrityAuditSummary {
  totalVideos: number;
  probed: number;
  /** cloud:, mount: and http(s) rows — not ours to probe. */
  skippedExternal: number;
  /** Rows still pointing at a yt-dlp intermediate. */
  skippedTemporaryArtifacts: number;
  filesMissing: number;
  trackDisagreements: number;
  durationMismatches: number;
  unprobeable: number;
}

export interface MediaIntegrityAuditResult {
  generatedAt: string;
  summary: MediaIntegrityAuditSummary;
  items: MediaIntegrityAuditItem[];
  humanSummary: string;
}

// Same definition the backfills use to skip yt-dlp intermediates.
const TEMPORARY_VIDEO_ARTIFACT_PATTERN = /(\.temp\.)|(\.part$)|(\.ytdl$)|(\.f\d+\.)/i;

// Probing is IO-bound and spawns a process per file; a handful at a time keeps a
// large library from serialising without flooding the host.
const PROBE_CONCURRENCY = 4;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  cachedAtMs: number;
  tracks: MediaTrackDurations;
}

// mtime and size catch every replacement this application performs - a
// re-download or a repair writes a new file - but they are not proof of
// identity: a file rewritten in place to the same length with its timestamp
// restored would read as unchanged. Content hashing would be exact, and is the
// wrong trade here, since digesting every media file costs far more than the
// ffprobe call it is meant to save. Bounding how long an entry may be trusted
// keeps the cache useful for a repeat audit in the same sitting while capping
// staleness at something short.
const PROBE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

// Re-auditing an unchanged library should not re-probe it. Keyed by absolute
// path and invalidated by mtime+size, so a repaired or replaced file is probed
// again. In-memory only: a restart simply costs one full pass.
const probeCache = new Map<string, CacheEntry>();

/** Exposed for tests; a fresh process starts with an empty cache anyway. */
export function clearMediaIntegrityProbeCache(): void {
  probeCache.clear();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function probeWithCache(
  absolutePath: string
): Promise<MediaTrackDurations> {
  let stat: { mtimeMs: number; size: number } | null = null;
  try {
    stat = statSafeSync(absolutePath, VIDEOS_DIR);
  } catch {
    stat = null;
  }

  const now = Date.now();
  if (stat) {
    const cached = probeCache.get(absolutePath);
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      now - cached.cachedAtMs < PROBE_CACHE_MAX_AGE_MS
    ) {
      return cached.tracks;
    }
  }

  const tracks = await probeMediaTrackDurations(absolutePath);
  // An all-null result can be a temporary ffprobe failure. Do not retain it
  // until the media changes: a later audit should retry the probe.
  if (stat && (tracks.container != null || tracks.video != null || tracks.audio != null)) {
    probeCache.set(absolutePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      cachedAtMs: now,
      tracks,
    });
  }
  return tracks;
}

function describe(
  reasons: MediaIntegrityAuditReason[],
  tracks: MediaTrackDurations,
  storedDurationSeconds: number | null
): string {
  const parts: string[] = [];
  for (const reason of reasons) {
    if (reason === "file_missing") {
      parts.push("the file this row points at does not exist");
    } else if (reason === "track_disagreement") {
      parts.push(
        `the video track is ${tracks.video?.toFixed(1)}s but the audio track is ` +
          `${tracks.audio?.toFixed(1)}s, so one of them is truncated`
      );
    } else if (reason === "duration_mismatch") {
      parts.push(
        `the stored duration is ${storedDurationSeconds?.toFixed(1)}s but the ` +
          `file measures ${tracks.container?.toFixed(1)}s`
      );
    } else {
      parts.push("the file exists but ffprobe could not read it");
    }
  }
  return parts.join("; ");
}

function resolveAction(
  reasons: MediaIntegrityAuditReason[]
): MediaIntegrityRecommendedAction {
  if (reasons.includes("file_missing") || reasons.includes("track_disagreement")) {
    return "redownload";
  }
  if (reasons.includes("unprobeable")) {
    return "manual_review";
  }
  return "refresh_duration";
}

/**
 * Audit every managed video row. Returns findings only; nothing is modified.
 *
 * Uses getVideosStrict: a failed database read must fail the audit rather than
 * report a clean library, the same rule destructive callers follow.
 */
export async function auditMediaIntegrity(): Promise<MediaIntegrityAuditResult> {
  const videos: Video[] = storageService.getVideosStrict("admin");

  const summary: MediaIntegrityAuditSummary = {
    totalVideos: videos.length,
    probed: 0,
    skippedExternal: 0,
    skippedTemporaryArtifacts: 0,
    filesMissing: 0,
    trackDisagreements: 0,
    durationMismatches: 0,
    unprobeable: 0,
  };
  const items: MediaIntegrityAuditItem[] = [];

  type Candidate = { video: Video; absolutePath: string };
  const candidates: Candidate[] = [];
  let collections: ReturnType<typeof storageService.getCollections> | undefined;

  for (const video of videos) {
    const webPath = readString(video.videoPath);
    // Case-insensitive: `HTTP://` is a valid external URL, and the managed-path
    // resolver matches lowercase only, so an uppercase scheme would fall through
    // to the local branch and be reported as a missing file.
    if (webPath && /^(?:cloud:|mount:|https?:\/\/)/i.test(webPath)) {
      summary.skippedExternal += 1;
      continue;
    }

    try {
      const resolved = webPath ? resolveManagedWebPath(webPath) : null;
      const filename = readString(video.videoFilename);
      // Older rows identify their file by filename and collection only. Missing
      // or invalid local paths are findings, not evidence of an external video.
      const absolutePath = webPath
        ? (resolved?.prefix === "/videos" ? resolved.absolutePath : null)
        : (filename ? storageService.findVideoFile(filename, (collections ??= storageService.getCollections())) : null);

      if (TEMPORARY_VIDEO_ARTIFACT_PATTERN.test(path.basename(absolutePath ?? webPath ?? filename ?? ""))) {
        summary.skippedTemporaryArtifacts += 1;
        continue;
      }

      if (!absolutePath || !pathExistsSafeSync(absolutePath, VIDEOS_DIR)) {
        summary.filesMissing += 1;
        items.push({
          localVideoId: video.id,
          title: video.title || "",
          sourceUrl: readString(video.sourceUrl),
          videoPath: webPath,
          reasons: ["file_missing"],
          detail: describe(["file_missing"], { container: null, video: null, audio: null }, null),
          storedDurationSeconds: parseSourceDurationSeconds(video.duration),
          measured: { container: null, video: null, audio: null },
          recommendedAction: "redownload",
        });
        continue;
      }

      candidates.push({ video, absolutePath });
    } catch (error) {
      // A path or filesystem failure belongs to this row, not the whole audit.
      logger.warn(`Integrity audit could not inspect video ${video.id}:`, error);
      summary.unprobeable += 1;
      items.push({
        localVideoId: video.id,
        title: video.title || "",
        sourceUrl: readString(video.sourceUrl),
        videoPath: webPath,
        reasons: ["unprobeable"],
        detail: `could not resolve or access the media file: ${error instanceof Error ? error.message : String(error)}`,
        storedDurationSeconds: parseSourceDurationSeconds(video.duration),
        measured: { container: null, video: null, audio: null },
        recommendedAction: "manual_review",
      });
    }
  }

  await runWithConcurrencyLimit(candidates, PROBE_CONCURRENCY, async ({ video, absolutePath }) => {
    let tracks: MediaTrackDurations;
    try {
      tracks = await probeWithCache(absolutePath);
    } catch (error) {
      // probeMediaTrackDurations swallows its own failures, so reaching here
      // means something unexpected. Record it rather than failing the audit.
      logger.warn(`Integrity audit could not probe ${absolutePath}:`, error);
      tracks = { container: null, video: null, audio: null };
    }
    summary.probed += 1;

    const reasons: MediaIntegrityAuditReason[] = [];

    if (tracks.container == null && tracks.video == null && tracks.audio == null) {
      reasons.push("unprobeable");
      summary.unprobeable += 1;
    } else {
      // No live source lookup here, so only the track comparison applies - the
      // same position MissAV downloads are in.
      if (!evaluateMediaCompleteness(tracks, null).complete) {
        reasons.push("track_disagreement");
        summary.trackDisagreements += 1;
      }

      const stored = parseSourceDurationSeconds(video.duration);
      if (
        stored != null &&
        tracks.container != null &&
        Math.abs(stored - tracks.container) > allowedDurationDrift(Math.max(stored, tracks.container))
      ) {
        reasons.push("duration_mismatch");
        summary.durationMismatches += 1;
      }
    }

    if (reasons.length === 0) {
      return;
    }

    const stored = parseSourceDurationSeconds(video.duration);
    items.push({
      localVideoId: video.id,
      title: video.title || "",
      sourceUrl: readString(video.sourceUrl),
      videoPath: readString(video.videoPath),
      reasons,
      detail: describe(reasons, tracks, stored),
      storedDurationSeconds: stored,
      measured: tracks,
      recommendedAction: resolveAction(reasons),
    });
  });

  // Concurrency makes completion order arbitrary; sort so repeated audits of an
  // unchanged library return the same document.
  items.sort((a, b) => a.localVideoId.localeCompare(b.localVideoId));

  const problems =
    summary.filesMissing +
    summary.trackDisagreements +
    summary.durationMismatches +
    summary.unprobeable;

  const humanSummary =
    problems === 0
      ? `Checked ${summary.probed} file(s); no integrity problems found.`
      : `Checked ${summary.probed} file(s) and found ${problems} problem(s): ` +
        `${summary.filesMissing} missing, ${summary.trackDisagreements} truncated, ` +
        `${summary.durationMismatches} with a stale stored duration, ` +
        `${summary.unprobeable} unreadable.`;

  return {
    generatedAt: new Date().toISOString(),
    summary,
    items,
    humanSummary,
  };
}
