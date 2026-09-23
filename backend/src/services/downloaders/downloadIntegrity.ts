import { VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  execFileSafe,
  pathExistsSafeSync,
  validateVideoPath,
} from "../../utils/security";

/**
 * Post-download completeness checks.
 *
 * A yt-dlp download can end with a file that looks fine — the merge succeeds,
 * the container is valid and ffprobe reads it — while one or both media streams
 * were cut short mid-transfer. The merged output then plays until the truncation
 * point and dies there (Chromium reports PIPELINE_ERROR_DECODE), and because the
 * stored duration is measured from that same file, nothing downstream notices.
 *
 * Two signals catch this without needing to trust yt-dlp's exit code:
 *  - the file is materially shorter than the duration the source reported, and
 *  - the audio and video tracks of one file disagree about how long it is.
 *
 * Both are deliberately loose: the goal is to reject half-downloads, not to
 * police the muxing slack that normal files carry.
 */

export interface MediaTrackDurations {
  /** Container duration, i.e. the longest track. */
  container: number | null;
  /** First video stream duration, null when absent or not stored. */
  video: number | null;
  /** First audio stream duration, null when absent or not stored. */
  audio: number | null;
}

export interface MediaCompletenessVerdict {
  complete: boolean;
  /** Human-readable explanation, set only when `complete` is false. */
  reason?: string;
}

export interface VerifyMediaOptions {
  /** Duration the source reported, in seconds. Unknown/live sources pass null. */
  sourceDurationSeconds?: number | null;
  /**
   * Effective yt-dlp config for this download. A config that clips the output
   * makes the source-duration comparison meaningless, so it is skipped.
   */
  userConfig?: Record<string, unknown> | null;
}

// A download is only rejected once it misses by more than this much, so normal
// container padding, a trailing partial fragment or a source whose reported
// duration is rounded never fails an otherwise good file.
const DURATION_TOLERANCE_RATIO = 0.05;
const DURATION_TOLERANCE_FLOOR_SECONDS = 10;

// yt-dlp options that legitimately produce a file shorter than the source.
// Parsed config keys are camelCased, so `--download-sections` arrives as
// `downloadSections`.
const CLIPPING_CONFIG_KEYS = [
  "downloadSections",
  "downloadSection",
  "sponsorblockRemove",
  "removeChapters",
];

/**
 * How far two durations may drift before the difference counts as damage rather
 * than muxing slack. Exported so the library-wide audit applies the same rule as
 * the download-time check; the two must never disagree about what "truncated"
 * means.
 */
export function allowedDurationDrift(referenceSeconds: number): number {
  return Math.max(
    DURATION_TOLERANCE_FLOOR_SECONDS,
    referenceSeconds * DURATION_TOLERANCE_RATIO
  );
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

/**
 * Whether the config removes content (sections, SponsorBlock or chapters),
 * which makes a short file expected rather than a failure.
 */
export function clipsDownloadOutput(
  userConfig?: Record<string, unknown> | null
): boolean {
  if (!userConfig) {
    return false;
  }
  return CLIPPING_CONFIG_KEYS.some((key) => key in userConfig);
}

/**
 * Normalize a reported duration into positive seconds, or null when it is not a
 * usable one: a live stream with no duration, an ffprobe field that is absent or
 * "N/A", or a zero. Shared by the source metadata and the ffprobe output, which
 * spell the same value as a number and as a string respectively.
 */
export function parseSourceDurationSeconds(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface FfprobeStream {
  codec_type?: unknown;
  duration?: unknown;
  disposition?: { attached_pic?: unknown };
}

/**
 * Embedded cover art (`--embed-thumbnail`) is carried as a video stream, so an
 * audio-only download can report a "video track" that is really a still image.
 * ffmpeg happens to give that track the same duration as the audio today, which
 * is why the comparison has not misfired, but that is a muxer detail rather than
 * a guarantee, and it makes the audio-only case silently depend on it. Selecting
 * a real track by disposition removes the dependency.
 */
function isAttachedPicture(stream: FfprobeStream): boolean {
  return Number(stream?.disposition?.attached_pic) === 1;
}

/**
 * Parse the durations out of `ffprobe -show_entries format=duration:stream=...`
 * JSON output. Exported for tests; tolerant of missing fields because Matroska
 * and WebM routinely omit per-stream durations.
 */
export function parseMediaTrackDurations(stdout: string): MediaTrackDurations {
  const empty: MediaTrackDurations = {
    container: null,
    video: null,
    audio: null,
  };

  let payload: { format?: { duration?: unknown }; streams?: FfprobeStream[] };
  try {
    payload = JSON.parse(stdout);
  } catch {
    return empty;
  }

  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const firstOfType = (type: string): number | null => {
    const stream = streams.find(
      (entry) => entry?.codec_type === type && !isAttachedPicture(entry)
    );
    return parseSourceDurationSeconds(stream?.duration);
  };

  return {
    container: parseSourceDurationSeconds(payload?.format?.duration),
    video: firstOfType("video"),
    audio: firstOfType("audio"),
  };
}

/**
 * Read container and per-track durations from a downloaded media file.
 *
 * Deliberately swallows every failure and reports all-null instead: a host
 * without ffprobe, or a probe that errors for any other reason, must leave
 * downloads working exactly as they did before this check existed. This check
 * may only reject a file it has positively measured as truncated.
 */
export async function probeMediaTrackDurations(
  filePath: string
): Promise<MediaTrackDurations> {
  const unknown: MediaTrackDurations = {
    container: null,
    video: null,
    audio: null,
  };

  try {
    const validatedPath = validateVideoPath(filePath);

    if (!pathExistsSafeSync(validatedPath, VIDEOS_DIR)) {
      logger.warn(
        `Skipping the completeness check: ${validatedPath} is missing.`
      );
      return unknown;
    }

    const { stdout } = await execFileSafe(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,duration:stream_disposition=attached_pic",
        "-of",
        "json",
        validatedPath,
      ],
      { timeout: 30_000 }
    );

    return parseMediaTrackDurations(stdout);
  } catch (error) {
    logger.warn(
      `Skipping the completeness check for ${filePath}; ffprobe failed:`,
      error
    );
    return unknown;
  }
}

/**
 * Only a *shortfall* counts: a file that runs longer than the reported duration
 * is a rounding or metadata quirk, not a truncation. Returns null when the check
 * does not apply or the file passes it.
 */
function findSourceDurationShortfall(
  container: number | null,
  source: number | null
): MediaCompletenessVerdict | null {
  if (source == null || container == null) {
    return null;
  }

  const shortfall = source - container;
  if (shortfall <= allowedDurationDrift(source)) {
    return null;
  }

  return {
    complete: false,
    reason:
      `the file is ${formatSeconds(container)} long but the source reports ` +
      `${formatSeconds(source)} (${formatSeconds(shortfall)} missing)`,
  };
}

/**
 * A merge of one complete and one truncated stream keeps the container duration
 * honest, so the tracks have to be compared against each other too. Returns null
 * when the check does not apply or the file passes it.
 */
function findTrackDisagreement(
  video: number | null,
  audio: number | null
): MediaCompletenessVerdict | null {
  if (video == null || audio == null) {
    return null;
  }

  const drift = Math.abs(video - audio);
  if (drift <= allowedDurationDrift(Math.max(video, audio))) {
    return null;
  }

  return {
    complete: false,
    reason:
      `the video track is ${formatSeconds(video)} but the audio track is ` +
      `${formatSeconds(audio)}, so one of them was truncated`,
  };
}

/**
 * Decide whether the probed file looks like a complete download. Pure, so the
 * thresholds can be unit tested without touching ffprobe.
 */
export function evaluateMediaCompleteness(
  tracks: MediaTrackDurations,
  sourceDurationSeconds?: number | null
): MediaCompletenessVerdict {
  return (
    findSourceDurationShortfall(
      tracks.container,
      parseSourceDurationSeconds(sourceDurationSeconds)
    ) ??
    findTrackDisagreement(tracks.video, tracks.audio) ?? { complete: true }
  );
}

/**
 * Probe a freshly downloaded file and report whether it is complete.
 *
 * Never throws for an unreadable file: a missing probe yields all-null
 * durations, both checks are skipped and the download is accepted, matching the
 * behaviour before this check existed.
 */
export async function verifyDownloadedMediaComplete(
  filePath: string,
  options: VerifyMediaOptions = {}
): Promise<MediaCompletenessVerdict> {
  const tracks = await probeMediaTrackDurations(filePath);
  const sourceDurationSeconds = clipsDownloadOutput(options.userConfig)
    ? null
    : options.sourceDurationSeconds;

  const verdict = evaluateMediaCompleteness(tracks, sourceDurationSeconds);
  if (!verdict.complete) {
    logger.error("Downloaded media failed its completeness check:", {
      filePath,
      sourceDurationSeconds: sourceDurationSeconds ?? null,
      ...tracks,
      reason: verdict.reason,
    });
  }

  return verdict;
}
