import { VIDEOS_DIR } from "../config/paths";
import { execFileSafe, resolveSafeChildPath, statSafeSync } from "../utils/security";
import { logger } from "../utils/logger";
import type { FilenameTemplateSourceOptions } from "./filenameTemplate/types";
import type { DownloadMediaInfo, Video } from "./storageService/types";

type Probe = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    disposition?: { attached_pic?: number };
    side_data_list?: Array<{ rotation?: number }>;
  }>;
  format?: { format_name?: string; bit_rate?: string };
};

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/** Corrupt or pre-snapshot history records remain readable without probing current files. */
export function parseStoredMediaInfo(raw: string | null | undefined): DownloadMediaInfo | undefined {
  try {
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      !["measured", "unavailable"].includes(value.state) ||
      typeof value.capturedAt !== "number"
    ) return undefined;
    return {
      version: 1,
      state: value.state,
      capturedAt: value.capturedAt,
      sizeBytes: typeof value.sizeBytes === "string" && /^\d+$/.test(value.sizeBytes) ? value.sizeBytes : undefined,
      width: positiveNumber(value.width),
      height: positiveNumber(value.height),
      bitrateBps: positiveNumber(value.bitrateBps),
      videoCodec: optionalText(value.videoCodec),
      audioCodec: optionalText(value.audioCodec),
      container: optionalText(value.container),
      sourceCollectionName: optionalText(value.sourceCollectionName),
    };
  } catch {
    return undefined;
  }
}

/** Parse real output streams, excluding embedded album art; dimensions follow display rotation. */
export function parseMediaInfo(raw: string, audioOnly = false): Partial<DownloadMediaInfo> {
  const probe: Probe = JSON.parse(raw);
  if (!Array.isArray(probe.streams) || !probe.format) throw new Error("Missing media probe data");
  const video = !audioOnly
    ? probe.streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic)
    : undefined;
  const audio = probe.streams.find(stream => stream.codec_type === "audio");
  if (!video && !audio) throw new Error("No media streams");
  const rotated = video?.side_data_list?.some(data => Math.abs(data.rotation ?? 0) % 180 === 90);
  return {
    width: positiveNumber(rotated ? video?.height : video?.width),
    height: positiveNumber(rotated ? video?.width : video?.height),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    container: probe.format.format_name,
    bitrateBps: positiveNumber(Number(probe.format.bit_rate)),
  };
}

let activeProbes = 0;
const waitingProbes: Array<() => void> = [];
async function acquireProbe(): Promise<() => void> {
  if (activeProbes >= 2) await new Promise<void>(resolve => waitingProbes.push(resolve));
  else activeProbes++;
  return () => {
    const next = waitingProbes.shift();
    if (next) next();
    else activeProbes--;
  };
}

/** Capture the published file once per output. A probe failure never fails an otherwise saved download. */
export async function captureDownloadMediaInfo<T extends Video>(video: T, source?: FilenameTemplateSourceOptions): Promise<T> {
  const info: DownloadMediaInfo = {
    version: 1,
    state: "unavailable",
    capturedAt: Date.now(),
    sourceCollectionName: source?.sourceCollectionType === "playlist" ? source.sourceCollectionName : undefined,
  };
  let release: (() => void) | undefined;
  try {
    if (typeof video.videoPath !== "string" || !video.videoPath.startsWith("/videos/")) {
      throw new Error("No local published media path");
    }
    const file = resolveSafeChildPath(VIDEOS_DIR, video.videoPath.slice("/videos/".length));
    const before = statSafeSync(file, VIDEOS_DIR);
    if (!before.isFile()) throw new Error("Not a media file");
    if (Number.isSafeInteger(before.size) && before.size > 0) info.sizeBytes = String(before.size);
    release = await acquireProbe();
    const unchanged = (after: typeof before) =>
      before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
    if (!unchanged(statSafeSync(file, VIDEOS_DIR))) {
      delete info.sizeBytes;
      throw new Error("Media changed while waiting for probe");
    }
    const { stdout } = await execFileSafe("ffprobe", [
      "-v", "error", "-protocol_whitelist", "file", "-show_entries",
      "format=format_name,bit_rate:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic:stream_side_data=rotation",
      "-of", "json", file,
    ], { timeout: 10_000 });
    const parsed = parseMediaInfo(stdout, video.mediaType === "audio");
    const after = statSafeSync(file, VIDEOS_DIR);
    if (!unchanged(after)) {
      delete info.sizeBytes;
      throw new Error("Media changed during probe");
    }
    Object.assign(info, parsed, { state: "measured" });
  } catch (error) {
    logger.warn("Download media information unavailable", {
      videoId: video.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    release?.();
  }
  return { ...video, downloadMediaInfo: info };
}
