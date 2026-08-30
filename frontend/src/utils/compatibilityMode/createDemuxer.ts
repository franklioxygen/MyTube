/**
 * Container sniffing and demuxer construction for compatibility mode.
 */

import { ByteStream } from "./byteStream";
import { createMp4Demuxer } from "./mp4Demuxer";
import { MediaDemuxer, UnsupportedMediaError } from "./types";
import { createWebmDemuxer } from "./webmDemuxer";
import { isCrossOriginMediaSrc } from "../mediaOrigin";

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

export type ContainerFormat = "mp4" | "webm";

/** Identify the container from the first bytes of the file. */
export function sniffContainer(header: Uint8Array): ContainerFormat | null {
  if (header.length >= 4 && EBML_MAGIC.every((byte, i) => header[i] === byte)) {
    return "webm";
  }
  if (header.length >= 8) {
    const type = String.fromCharCode(header[4], header[5], header[6], header[7]);
    if (type === "ftyp" || type === "moov" || type === "styp") {
      return "mp4";
    }
  }
  return null;
}

export interface CreateDemuxerOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function createDemuxer(
  url: string,
  options: CreateDemuxerOptions = {}
): Promise<MediaDemuxer> {
  const stream = new ByteStream(url, {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    // Cloud sources are signed URLs on another origin, where sending cookies
    // would trip the wildcard CORS policy the media routes use.
    credentials: isCrossOriginMediaSrc(url) ? "omit" : "same-origin",
  });

  if (!(await stream.ensure(8))) {
    await stream.close();
    throw new UnsupportedMediaError("Media file is too short to identify");
  }

  const container = sniffContainer(stream.peek(8));
  if (container === "webm") {
    return createWebmDemuxer(stream);
  }
  if (container === "mp4") {
    return createMp4Demuxer(stream);
  }

  await stream.close();
  throw new UnsupportedMediaError(
    "Compatibility mode supports MP4 and WebM sources only"
  );
}
