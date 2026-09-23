import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { runWithConcurrencyLimit } from "../utils/concurrency";
import { logger } from "../utils/logger";
import { pathExistsSafeSync, readdirSafeSync, statSafeSync } from "../utils/security";
import {
  allowedDurationDrift,
  evaluateMediaCompleteness,
  parseSourceDurationSeconds,
  probeMediaTrackDurations,
  type MediaTrackDurations,
} from "./downloaders/downloadIntegrity";
import { findTimelineGaps, type TimelineGap } from "./downloaders/timelineGaps";
import { resolveManagedWebPath } from "./filenameTemplate/pathHelpers";
import * as storageService from "./storageService";
import { normalizeMediaType, type MediaType, type Video } from "./storageService/types";

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
  | "unprobeable"
  /** Content missing mid-file: the timestamps jump over it (usually a dropped fragment). */
  | "timeline_gap";

export type MediaIntegrityRecommendedAction =
  | "redownload"
  | "refresh_duration"
  | "manual_review";

export interface MediaIntegrityAuditItem {
  localVideoId: string;
  title: string;
  /** Audio and video are separate rows; a re-download must replace the same kind. */
  mediaType: MediaType;
  sourceUrl: string | null;
  videoPath: string | null;
  reasons: MediaIntegrityAuditReason[];
  detail: string;
  storedDurationSeconds: number | null;
  measured: MediaTrackDurations;
  recommendedAction: MediaIntegrityRecommendedAction;
  /** Where content is missing, when the timeline check ran and found any. */
  gaps?: TimelineGap[];
}

export interface MediaIntegrityAuditSummary {
  totalVideos: number;
  probed: number;
  /** cloud:, mount: and http(s) rows — not ours to probe. */
  skippedExternal: number;
  filesMissing: number;
  trackDisagreements: number;
  durationMismatches: number;
  unprobeable: number;
  /** Only counted when the audit ran with the timeline check enabled. */
  timelineGaps: number;
  /** Whether this audit ran the timeline check at all. */
  timelineChecked: boolean;
}

export interface MediaIntegrityAuditResult {
  generatedAt: string;
  summary: MediaIntegrityAuditSummary;
  items: MediaIntegrityAuditItem[];
  humanSummary: string;
}

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

// The timeline scan reads the whole file, where the probe above reads only its
// header - roughly a thousand times the cost. Ten minutes would expire a result
// before a long scan of the rest of the library had even finished. mtime and size
// still invalidate it immediately whenever the application replaces a file.
const TIMELINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface TimelineCacheEntry {
  mtimeMs: number;
  size: number;
  cachedAtMs: number;
  gaps: TimelineGap[];
}

const timelineCache = new Map<string, TimelineCacheEntry>();

/** Exposed for tests; a fresh process starts with an empty cache anyway. */
export function clearMediaIntegrityProbeCache(): void {
  probeCache.clear();
  timelineCache.clear();
}

async function timelineGapsWithCache(absolutePath: string): Promise<TimelineGap[]> {
  let stat: { mtimeMs: number; size: number } | null = null;
  try {
    stat = statSafeSync(absolutePath, VIDEOS_DIR);
  } catch {
    stat = null;
  }

  const now = Date.now();
  const cached = stat ? timelineCache.get(absolutePath) : undefined;
  if (
    stat &&
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size &&
    now - cached.cachedAtMs < TIMELINE_CACHE_MAX_AGE_MS
  ) {
    return cached.gaps;
  }

  const { gaps } = await findTimelineGaps(absolutePath);
  if (stat) {
    timelineCache.set(absolutePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      cachedAtMs: now,
      gaps,
    });
  }
  return gaps;
}

function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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

/**
 * Interpret the `duration` column, which is free-form text.
 *
 * Every writer in this application stores whole seconds, and the Bilibili search
 * path converts colon notation before it ever reaches storage. But the column
 * accepts anything, and `formatRssDuration` already passes a colon-formatted
 * value straight through, so one can be present. `parseSourceDurationSeconds`
 * would read "01:23" as 1 via parseFloat, and the audit would then report an
 * intact 83-second file as a duration mismatch.
 *
 * Clock notation is unambiguous, so it is parsed. Anything else yields null,
 * which skips the comparison rather than inventing an interpretation - the
 * audit must not manufacture findings out of a value it does not understand.
 */
function parseStoredDurationSeconds(value: unknown): number | null {
  if (typeof value === "string" && value.includes(":")) {
    const parts = value.trim().split(":");
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((part) => /^\d+$/.test(part))) return null;
    const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  // Anything else must be an exact number. parseSourceDurationSeconds is
  // parseFloat-based, which is right for ffprobe output and source metadata but
  // not for a free-form column: it reads "1 hour" as 1, and the audit would then
  // report a 3600-second file as mismatched by 3599 seconds.
  if (typeof value === "string" && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
    return null;
  }
  return parseSourceDurationSeconds(value);
}

function describe(
  reasons: MediaIntegrityAuditReason[],
  tracks: MediaTrackDurations,
  storedDurationSeconds: number | null,
  gaps: TimelineGap[] = []
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
      const measuredIsShorter =
        storedDurationSeconds != null &&
        tracks.container != null &&
        tracks.container < storedDurationSeconds;
      parts.push(
        `the stored duration is ${storedDurationSeconds?.toFixed(1)}s but the ` +
          `file measures ${tracks.container?.toFixed(1)}s` +
          (measuredIsShorter
            ? ", so it looks like the file was truncated after the row was written"
            : "")
      );
    } else if (reason === "timeline_gap") {
      const byStream = (stream: TimelineGap["stream"]) =>
        gaps.filter((gap) => gap.stream === stream);
      for (const stream of ["video", "audio"] as const) {
        const found = byStream(stream);
        if (found.length === 0) continue;
        const total = found.reduce((sum, gap) => sum + gap.gapSeconds, 0);
        const where = found
          .slice(0, 5)
          .map((gap) => `${formatClock(gap.atSeconds)} (${gap.gapSeconds.toFixed(1)}s)`)
          .join(", ");
        const more = found.length > 5 ? ` and ${found.length - 5} more` : "";
        parts.push(
          `${total.toFixed(1)}s of ${stream} is missing across ${found.length} ` +
            `gap(s), at ${where}${more}`
        );
      }
      // Most are fragments lost during the download, but a source can carry a
      // gap of its own, and nothing in the file tells the two apart.
      parts.push("if a re-download has the same gap, the source is missing it too");
    } else {
      parts.push("the file exists but ffprobe could not read it");
    }
  }
  return parts.join("; ");
}

function resolveAction(
  reasons: MediaIntegrityAuditReason[],
  /**
   * Whether the file measures shorter than its stored duration. The direction
   * matters: a file that grew is stale metadata, but one that shrank has the
   * shape of a truncation that happened after the row was written.
   */
  measuredIsShorter: boolean
): MediaIntegrityRecommendedAction {
  if (
    reasons.includes("file_missing") ||
    reasons.includes("track_disagreement") ||
    reasons.includes("timeline_gap")
  ) {
    return "redownload";
  }
  // Refreshing the duration of a file that shrank would overwrite the only
  // record that it used to be longer - the evidence of the corruption - and
  // every later audit would then pass. Only a file that is longer than its
  // stored duration is safely a metadata problem.
  if (measuredIsShorter) {
    return "redownload";
  }
  if (reasons.includes("unprobeable")) {
    return "manual_review";
  }
  return "refresh_duration";
}

/**
 * Confirm that a file which "does not exist" is actually absent rather than
 * unreadable.
 *
 * pathExistsSafeSync is fs.existsSync underneath, which answers false for a
 * permission error or an I/O failure exactly as it does for a missing file. On
 * its own that turns a storage outage - a dropped NAS mount - into every row
 * being reported missing, with a recommendation to redownload the library. Only
 * ENOENT and ENOTDIR mean absent; anything else is thrown, so the per-row catch
 * reports the row as unprobeable instead.
 */
function confirmAbsent(absolutePath: string): void {
  try {
    statSafeSync(absolutePath, VIDEOS_DIR);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw error;
  }
  // existsSync said no but stat succeeded: a race, or a permission shape the two
  // disagree on. Either way this is not a missing file.
  throw new Error(`${absolutePath} was reported missing but could be stat'ed`);
}

/**
 * Audit every managed video row. Returns findings only; nothing is modified.
 *
 * Uses getVideosStrict: a failed database read must fail the audit rather than
 * report a clean library, the same rule destructive callers follow.
 */
export interface MediaIntegrityAuditOptions {
  /**
   * Also look for content missing mid-file. Off by default because it reads the
   * whole of every file whose frame counts fall short: on a large library that
   * takes minutes, past the API proxy's read timeout. Results are cached, so a
   * repeat run is cheap.
   */
  timeline?: boolean;
}

export async function auditMediaIntegrity(
  options: MediaIntegrityAuditOptions = {}
): Promise<MediaIntegrityAuditResult> {
  const videos: Video[] = storageService.getVideosStrict("admin");

  const summary: MediaIntegrityAuditSummary = {
    totalVideos: videos.length,
    probed: 0,
    skippedExternal: 0,
    filesMissing: 0,
    trackDisagreements: 0,
    durationMismatches: 0,
    unprobeable: 0,
    timelineGaps: 0,
    timelineChecked: options.timeline === true,
  };
  const items: MediaIntegrityAuditItem[] = [];

  type Candidate = { video: Video; absolutePath: string };
  const candidates: Candidate[] = [];
  let collections: ReturnType<typeof storageService.getCollections> | undefined;
  let libraryReadable: true | Error | undefined;

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

      if (absolutePath && pathExistsSafeSync(absolutePath, VIDEOS_DIR)) {
        candidates.push({ video, absolutePath });
        continue;
      }

      if (absolutePath) {
        confirmAbsent(absolutePath);
      } else if (!webPath && filename) {
        // findVideoFile catches its own filesystem errors and returns null, so a
        // miss here cannot tell "not there" from "could not look". There is no
        // path to stat, so check that the library itself is readable before
        // calling the file missing. Evaluated once per audit.
        libraryReadable ??= (() => {
          try {
            readdirSafeSync(VIDEOS_DIR, VIDEOS_DIR);
            return true;
          } catch (error) {
            return error instanceof Error ? error : new Error(String(error));
          }
        })();
        if (libraryReadable !== true) throw libraryReadable;
      }

      summary.filesMissing += 1;
      items.push({
        localVideoId: video.id,
        title: video.title || "",
        mediaType: normalizeMediaType(video.mediaType),
        sourceUrl: readString(video.sourceUrl),
        videoPath: webPath,
        reasons: ["file_missing"],
        detail: describe(["file_missing"], { container: null, video: null, audio: null }, null),
        storedDurationSeconds: parseStoredDurationSeconds(video.duration),
        measured: { container: null, video: null, audio: null },
        recommendedAction: "redownload",
      });
    } catch (error) {
      // A path or filesystem failure belongs to this row, not the whole audit.
      logger.warn(`Integrity audit could not inspect video ${video.id}:`, error);
      summary.unprobeable += 1;
      items.push({
        localVideoId: video.id,
        title: video.title || "",
        mediaType: normalizeMediaType(video.mediaType),
        sourceUrl: readString(video.sourceUrl),
        videoPath: webPath,
        reasons: ["unprobeable"],
        detail: `could not resolve or access the media file: ${error instanceof Error ? error.message : String(error)}`,
        storedDurationSeconds: parseStoredDurationSeconds(video.duration),
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
    let gaps: TimelineGap[] = [];

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

      const stored = parseStoredDurationSeconds(video.duration);
      if (
        stored != null &&
        tracks.container != null &&
        Math.abs(stored - tracks.container) > allowedDurationDrift(Math.max(stored, tracks.container))
      ) {
        reasons.push("duration_mismatch");
        summary.durationMismatches += 1;
      }

      if (options.timeline) {
        try {
          gaps = await timelineGapsWithCache(absolutePath);
        } catch (error) {
          // findTimelineGaps fails open on its own; reaching here is unexpected.
          logger.warn(`Integrity audit could not scan ${absolutePath}:`, error);
        }
        if (gaps.length > 0) {
          reasons.push("timeline_gap");
          summary.timelineGaps += 1;
        }
      }
    }

    if (reasons.length === 0) {
      return;
    }

    const stored = parseStoredDurationSeconds(video.duration);
    items.push({
      localVideoId: video.id,
      title: video.title || "",
      mediaType: normalizeMediaType(video.mediaType),
      sourceUrl: readString(video.sourceUrl),
      videoPath: readString(video.videoPath),
      reasons,
      detail: describe(reasons, tracks, stored, gaps),
      storedDurationSeconds: stored,
      measured: tracks,
      ...(gaps.length > 0 ? { gaps } : {}),
      recommendedAction: resolveAction(
        reasons,
        stored != null && tracks.container != null && tracks.container < stored
      ),
    });
  });

  // Concurrency makes completion order arbitrary; sort so repeated audits of an
  // unchanged library return the same document.
  items.sort((a, b) => a.localVideoId.localeCompare(b.localVideoId));

  const problems =
    summary.filesMissing +
    summary.trackDisagreements +
    summary.durationMismatches +
    summary.unprobeable +
    summary.timelineGaps;

  // Without the timeline check, "no problems" would be read as covering content
  // missing mid-file, which it does not look for - say so rather than imply it.
  const scope = summary.timelineChecked
    ? ""
    : " Content missing mid-file was not checked; run with timeline=1 to include it.";
  const humanSummary =
    (problems === 0
      ? `Checked ${summary.probed} file(s); no integrity problems found.`
      : `Checked ${summary.probed} file(s) and found ${problems} problem(s): ` +
        `${summary.filesMissing} missing, ${summary.trackDisagreements} truncated, ` +
        `${summary.durationMismatches} with a stale stored duration, ` +
        `${summary.unprobeable} unreadable` +
        (summary.timelineChecked
          ? `, ${summary.timelineGaps} with content missing mid-file.`
          : ".")) + scope;

  return {
    generatedAt: new Date().toISOString(),
    summary,
    items,
    humanSummary,
  };
}
