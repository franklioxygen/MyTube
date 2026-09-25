import { spawn } from "child_process";
import { VIDEOS_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  execFileSafe,
  pathExistsSafeSync,
  validateVideoPath,
} from "../../utils/security";
import type { IncompleteDownloadNote } from "../storageService/types";
import { parseSourceDurationSeconds } from "./downloadIntegrity";

/**
 * Finds content missing from the middle of a media file.
 *
 * yt-dlp's native HLS and DASH downloaders skip an unavailable fragment by
 * default and carry on (`skip_unavailable_fragments`). The merged file keeps its
 * timeline - the timestamps jump over the missing span - so its duration is
 * intact and the audio and video tracks still agree. Neither of the checks in
 * downloadIntegrity can see it. A scan of one production library found 16 of 351
 * MissAV downloads missing between 1.5 and 115 seconds this way, mostly exactly
 * one 4-second segment.
 *
 * Detection runs in two stages, because the reliable signal is expensive:
 *
 *  1. The frame count in the stream header implies a duration. When timestamps
 *     jump over missing frames, the stream's duration exceeds it by roughly the
 *     missing span. Reading the header costs nothing, and on a complete file the
 *     two agree to within a few milliseconds.
 *  2. A stream whose frame count falls short is then scanned packet by packet
 *     for a contiguous jump in its timestamps.
 *
 * The second stage is what keeps this honest. Some sources are packaged with a
 * frame or two missing at every segment boundary; their frame counts fall short
 * by tens of seconds in total, but no single step exceeds a few frames. That is
 * how the source is published, not a failed download, and a re-download would
 * reproduce it exactly - so it is not reported. Only a contiguous jump is.
 *
 * A contiguous jump is usually a dropped fragment but not always: a source can
 * carry one too, and the file cannot say which. In the same library, 2 of the 19
 * files reported had gaps that looked like the source's own. So this only ever
 * describes and recommends. At download time it runs only once yt-dlp has said
 * it skipped a fragment, to say where the resulting gap is.
 */

export type TimelineStream = "video" | "audio";

export interface TimelineGap {
  stream: TimelineStream;
  /** Where the jump starts, in seconds from the start of the stream. */
  atSeconds: number;
  /** How much time the jump skips. */
  gapSeconds: number;
}

export interface FrameShortfall {
  /**
   * How far the stream's duration exceeds what its frame count accounts for.
   * Positive means frames are missing; null when it cannot be computed.
   */
  video: number | null;
  audio: number | null;
  /** Null when the header could not be read; absent streams are omitted. */
  presentStreams: TimelineStream[] | null;
}

export interface TimelineGapResult {
  gaps: TimelineGap[];
  /** Streams scanned because of a shortfall or an unavailable frame count. */
  scannedStreams: TimelineStream[];
  /** False when the header probe or any required packet scan could not finish. */
  complete: boolean;
}

// Stage one: a stream is worth scanning once its frame count accounts for at
// least this much less time than its duration. Complete files agree to within a
// few milliseconds; the smallest real gap found in production was 1.06s.
const FRAME_SHORTFALL_PREFILTER_SECONDS = 1.0;

// Stage two: a timestamp step larger than this is a gap. Normal steps are a
// single frame (0.02-0.04s), and the per-segment packaging artefacts described
// above never exceeded 0.06s. A dropped HLS segment is several seconds.
const CONTIGUOUS_GAP_SECONDS = 1.0;

// Keep the report readable for a file with a burst of dropped fragments.
const MAX_REPORTED_GAPS = 50;

// A packet scan reads the whole file; an eight-hour download off a NAS can take a
// couple of minutes. Past this the scan is abandoned and reported as unknown.
const PACKET_SCAN_TIMEOUT_MS = 10 * 60 * 1000;
const SCAN_STDERR_TAIL_CHARS = 4096;

// AAC frames carry a fixed 1024 samples, which is what makes an audio frame count
// convertible into a duration. Other codecs are left unmeasured.
const AAC_SAMPLES_PER_FRAME = 1024;

interface FfprobeFrameStream {
  codec_type?: unknown;
  codec_name?: unknown;
  duration?: unknown;
  nb_frames?: unknown;
  r_frame_rate?: unknown;
  sample_rate?: unknown;
  disposition?: { attached_pic?: unknown };
}

function parseRational(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator <= 0 || denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * Compute each stream's frame shortfall from `ffprobe -of json` output. Pure, so
 * the arithmetic is testable without a media file.
 */
export function parseFrameShortfall(stdout: string): FrameShortfall {
  const none: FrameShortfall = { video: null, audio: null, presentStreams: null };
  let payload: { streams?: FfprobeFrameStream[] };
  try {
    payload = JSON.parse(stdout);
  } catch {
    return none;
  }

  if (!Array.isArray(payload?.streams)) return none;
  const streams = payload.streams;
  const real = (type: string) =>
    streams.find(
      (stream) =>
        stream?.codec_type === type &&
        Number(stream?.disposition?.attached_pic) !== 1
    );

  const shortfall = (duration: number | null, implied: number | null) =>
    duration != null && implied != null ? duration - implied : null;

  const video = real("video");
  const videoFrames = parseSourceDurationSeconds(video?.nb_frames);
  // r_frame_rate is the nominal rate. avg_frame_rate is useless here: for MP4 it
  // is derived as frames / duration, so it would hide exactly this discrepancy.
  const videoRate = parseRational(video?.r_frame_rate);
  const videoImplied =
    videoFrames != null && videoRate != null ? videoFrames / videoRate : null;

  const audio = real("audio");
  const audioFrames = parseSourceDurationSeconds(audio?.nb_frames);
  const sampleRate = parseSourceDurationSeconds(audio?.sample_rate);
  const audioImplied =
    audio?.codec_name === "aac" && audioFrames != null && sampleRate != null
      ? (audioFrames * AAC_SAMPLES_PER_FRAME) / sampleRate
      : null;

  return {
    video: shortfall(parseSourceDurationSeconds(video?.duration), videoImplied),
    audio: shortfall(parseSourceDurationSeconds(audio?.duration), audioImplied),
    presentStreams: (["video", "audio"] as const).filter((stream) =>
      stream === "video" ? video !== undefined : audio !== undefined
    ),
  };
}

/** Stage one. Header only - no media data is read. Fails open to all-null. */
export async function probeFrameShortfall(filePath: string): Promise<FrameShortfall> {
  try {
    const validatedPath = validateVideoPath(filePath);
    if (!pathExistsSafeSync(validatedPath, VIDEOS_DIR)) {
      return { video: null, audio: null, presentStreams: null };
    }
    const { stdout } = await execFileSafe(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,duration,nb_frames,r_frame_rate,sample_rate:stream_disposition=attached_pic",
        "-of",
        "json",
        validatedPath,
      ],
      { timeout: 30_000 }
    );
    return parseFrameShortfall(stdout);
  } catch (error) {
    logger.warn(`Could not read frame counts for ${filePath}:`, error);
    return { video: null, audio: null, presentStreams: null };
  }
}

/**
 * Find contiguous jumps in a sequence of timestamps. Pure, and fed a line at a
 * time so a multi-hour stream never has to be held in memory.
 */
export function createGapFinder(stream: TimelineStream) {
  let previous: number | null = null;
  let timestampCount = 0;
  const gaps: TimelineGap[] = [];
  return {
    push(line: string): void {
      const timestamp = Number.parseFloat(line);
      if (!Number.isFinite(timestamp)) return;
      timestampCount += 1;
      if (previous !== null) {
        const step = timestamp - previous;
        if (step > CONTIGUOUS_GAP_SECONDS && gaps.length < MAX_REPORTED_GAPS) {
          gaps.push({
            stream,
            atSeconds: Math.round(previous * 100) / 100,
            gapSeconds: Math.round(step * 100) / 100,
          });
        }
      }
      previous = timestamp;
    },
    gaps: (): TimelineGap[] => gaps,
    hasComparableTimestamps: (): boolean => timestampCount >= 2,
  };
}

/**
 * Stage two: scan one stream's timestamps for contiguous jumps.
 *
 * Streams ffprobe's output rather than buffering it - an eight-hour file has
 * over a million packets. Uses an argument array, so no shell is involved. Returns
 * null when the scan could not complete, which callers treat as unknown.
 */
async function scanStreamForGaps(
  validatedPath: string,
  stream: TimelineStream
): Promise<TimelineGap[] | null> {
  const finder = createGapFinder(stream);
  return new Promise((resolve) => {
    // "V" skips attached pictures, matching the stream the header probe measured.
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      stream === "video" ? "V:0" : "a:0",
      "-show_entries",
      "packet=dts_time",
      "-of",
      "csv=p=0",
      validatedPath,
    ]);
    let buffered = "";
    let stderrTail = "";
    let settled = false;
    const finish = (result: TimelineGap[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      logger.warn(`Timeline scan of ${validatedPath} timed out.`);
      finish(null);
    }, PACKET_SCAN_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        finder.push(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
      }
    });
    // A noisy malformed file can fill an unread stderr pipe and stall ffprobe.
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-SCAN_STDERR_TAIL_CHARS);
    });
    child.on("error", (error) => {
      logger.warn(`Timeline scan of ${validatedPath} failed:`, error);
      finish(null);
    });
    child.on("close", (code) => {
      if (buffered) finder.push(buffered);
      if (code !== 0) {
        logger.warn(`Timeline scan of ${validatedPath} exited with code ${code}:`, stderrTail);
      }
      finish(code === 0 && finder.hasComparableTimestamps() ? finder.gaps() : null);
    });
  });
}

function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Describe gaps per stream for a person to read: how much is missing, and where.
 * Shared by the library audit and the note on a download saved with gaps.
 */
export function summarizeTimelineGaps(gaps: TimelineGap[]): string {
  const parts: string[] = [];
  for (const stream of ["video", "audio"] as const) {
    const found = gaps.filter((gap) => gap.stream === stream);
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
  return parts.join("; ");
}

/**
 * Find content missing from the middle of a file. Runs the expensive packet scan
 * only on streams whose frame count says something is missing.
 *
 * Fails open like the rest of the integrity checks: anything that cannot be
 * measured reports no gaps.
 */
export async function findTimelineGaps(filePath: string): Promise<TimelineGapResult> {
  const shortfall = await probeFrameShortfall(filePath);
  if (!shortfall.presentStreams?.length) {
    return { gaps: [], scannedStreams: [], complete: false };
  }
  const suspicious = shortfall.presentStreams.filter(
    (stream) =>
      shortfall[stream] === null || shortfall[stream] > FRAME_SHORTFALL_PREFILTER_SECONDS
  );
  if (suspicious.length === 0) {
    return { gaps: [], scannedStreams: [], complete: true };
  }

  let validatedPath: string;
  try {
    validatedPath = validateVideoPath(filePath);
  } catch {
    return { gaps: [], scannedStreams: [], complete: false };
  }

  const gaps: TimelineGap[] = [];
  let complete = true;
  for (const stream of suspicious) {
    const found = await scanStreamForGaps(validatedPath, stream);
    if (found) gaps.push(...found);
    else complete = false;
  }
  gaps.sort((a, b) => a.atSeconds - b.atSeconds);
  return { gaps, scannedStreams: suspicious, complete };
}

/**
 * The note for a download saved although yt-dlp left fragments out, or null
 * when none were. Locates the gaps so the note can say what is missing and
 * where; if they cannot be located, it still records that fragments were lost.
 * It is data rather than a sentence so the client can word it in the viewer's
 * language.
 */
export async function describeSkippedFragments(
  filePath: string,
  skippedFragments: number
): Promise<IncompleteDownloadNote | null> {
  if (skippedFragments <= 0) return null;
  const { gaps } = await findTimelineGaps(filePath);
  logger.warn(
    `Download saved with ${skippedFragments} fragment(s) missing (${filePath})` +
      (gaps.length > 0 ? `: ${summarizeTimelineGaps(gaps)}` : "")
  );
  return { kind: "incomplete_download", skippedFragments, gaps };
}
