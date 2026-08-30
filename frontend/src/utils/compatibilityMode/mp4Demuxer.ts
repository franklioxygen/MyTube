/**
 * Minimal ISO-BMFF (MP4) demuxer for compatibility mode.
 *
 * Parses `moov` into flat sample tables for one video and one audio track,
 * then hands the encoded samples out in file order so the caller can push them
 * straight into a `VideoDecoder` / `AudioDecoder`. Only non-fragmented files
 * are handled — that is what the downloader produces.
 */

import { ByteStream } from "./byteStream";
import {
  aacCodecString,
  av1CodecString,
  avcCodecString,
  hevcCodecString,
  vp9CodecStringFromVpcC,
} from "./codecStrings";
import { DemuxedPacket, MediaDemuxer, UnsupportedMediaError } from "./types";

interface Box {
  type: string;
  contentStart: number;
  contentEnd: number;
  end: number;
}

interface Sample {
  kind: "video" | "audio";
  offset: number;
  size: number;
  /** Presentation timestamp in microseconds. */
  timestamp: number;
  /** Duration in microseconds. */
  duration: number;
  key: boolean;
}

interface ParsedTrack {
  kind: "video" | "audio";
  samples: Sample[];
  videoConfig: VideoDecoderConfig | null;
  audioConfig: AudioDecoderConfig | null;
}

/**
 * A `trak` is either usable, a media track whose sample entry we cannot map to
 * a decoder configuration, or something we do not care about (subtitles, timed
 * metadata). The middle case has to stay distinguishable from the last.
 */
type ParsedTrackResult =
  | { status: "ok"; track: ParsedTrack }
  | { status: "unsupported"; label: string }
  | { status: "ignored" };

const MAX_MOOV_BYTES = 64 * 1024 * 1024;

const readType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );

const parseBoxes = (bytes: Uint8Array, start: number, end: number): Box[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = readType(bytes, offset + 4);
    let contentStart = offset + 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      // 64-bit sizes above 2^53 cannot occur in a file we can address anyway.
      size =
        view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      contentStart = offset + 16;
    } else if (size === 0) {
      size = end - offset;
    }

    const boxEnd = Math.min(offset + size, end);
    if (size < 8 || contentStart > boxEnd) break;

    found.push({ type, contentStart, contentEnd: boxEnd, end: boxEnd });
    offset = boxEnd;
  }

  return found;
};

const findBox = (boxes: Box[], type: string): Box | undefined =>
  boxes.find((box) => box.type === type);

const childBoxes = (bytes: Uint8Array, box: Box): Box[] =>
  parseBoxes(bytes, box.contentStart, box.contentEnd);

const descend = (
  bytes: Uint8Array,
  boxes: Box[],
  path: string[]
): Box | undefined => {
  let current = findBox(boxes, path[0]);
  for (let i = 1; current && i < path.length; i += 1) {
    current = findBox(childBoxes(bytes, current), path[i]);
  }
  return current;
};

/** Locate `moov` by walking top-level boxes; it may sit after `mdat`. */
const readMoov = async (stream: ByteStream): Promise<Uint8Array> => {
  await stream.seek(0);

  for (;;) {
    if (!(await stream.ensure(8))) {
      throw new UnsupportedMediaError("MP4 file has no moov box");
    }
    const header = stream.peek(16);
    const headerView = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength
    );
    let size = headerView.getUint32(0);
    const type = readType(header, 4);
    let headerSize = 8;

    if (size === 1) {
      if (!(await stream.ensure(16))) {
        throw new UnsupportedMediaError("Truncated MP4 box header");
      }
      const large = stream.peek(16);
      const largeView = new DataView(
        large.buffer,
        large.byteOffset,
        large.byteLength
      );
      size = largeView.getUint32(8) * 2 ** 32 + largeView.getUint32(12);
      headerSize = 16;
    }

    if (type === "moof") {
      throw new UnsupportedMediaError(
        "Fragmented MP4 files are not supported in compatibility mode yet"
      );
    }

    if (type === "moov") {
      const contentSize = size - headerSize;
      if (contentSize <= 0 || contentSize > MAX_MOOV_BYTES) {
        throw new UnsupportedMediaError("MP4 moov box has an unusable size");
      }
      await stream.seek(stream.position + headerSize);
      return stream.require(contentSize);
    }

    if (size < headerSize) {
      throw new UnsupportedMediaError("Malformed MP4 box header");
    }
    await stream.seek(stream.position + size);
  }
};

const parseFullBoxVersion = (view: DataView, offset: number): number =>
  view.getUint8(offset);

/** Walk the MPEG-4 descriptor chain in `esds` down to the AudioSpecificConfig. */
const parseEsdsDecoderSpecificInfo = (
  bytes: Uint8Array,
  box: Box
): Uint8Array | null => {
  let offset = box.contentStart + 4; // version + flags
  const end = box.contentEnd;

  const readLength = (): number => {
    let length = 0;
    for (let i = 0; i < 4 && offset < end; i += 1) {
      const byte = bytes[offset];
      offset += 1;
      length = (length << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return length;
  };

  while (offset < end) {
    const tag = bytes[offset];
    offset += 1;
    const length = readLength();
    const payloadEnd = Math.min(offset + length, end);

    if (tag === 0x03) {
      // ES_Descriptor: skip ES_ID + flag-dependent extras, then recurse inline.
      offset += 2;
      const flags = bytes[offset];
      offset += 1;
      if (flags & 0x80) offset += 2;
      if (flags & 0x40) offset += 1 + bytes[offset];
      if (flags & 0x20) offset += 2;
      continue;
    }
    if (tag === 0x04) {
      // DecoderConfigDescriptor: objectType + streamType + buffer/bitrate info.
      offset += 13;
      continue;
    }
    if (tag === 0x05) {
      return bytes.slice(offset, payloadEnd);
    }
    offset = payloadEnd;
  }

  return null;
};

const buildVideoConfig = (
  bytes: Uint8Array,
  entry: Box,
  format: string,
  codedWidth: number,
  codedHeight: number
): VideoDecoderConfig | null => {
  const children = parseBoxes(bytes, entry.contentStart + 78, entry.contentEnd);
  const base = { codedWidth, codedHeight, optimizeForLatency: false };

  const avcC = findBox(children, "avcC");
  if (avcC && (format === "avc1" || format === "avc3")) {
    const description = bytes.slice(avcC.contentStart, avcC.contentEnd);
    return { ...base, codec: avcCodecString(description, format), description };
  }

  const hvcC = findBox(children, "hvcC");
  if (hvcC && (format === "hvc1" || format === "hev1")) {
    const description = bytes.slice(hvcC.contentStart, hvcC.contentEnd);
    return { ...base, codec: hevcCodecString(description, format), description };
  }

  const av1C = findBox(children, "av1C");
  if (av1C && format === "av01") {
    const description = bytes.slice(av1C.contentStart, av1C.contentEnd);
    return { ...base, codec: av1CodecString(description), description };
  }

  const vpcC = findBox(children, "vpcC");
  if (vpcC && (format === "vp09" || format === "vp08")) {
    const codec = vp9CodecStringFromVpcC(
      bytes.slice(vpcC.contentStart, vpcC.contentEnd)
    );
    if (codec) {
      return { ...base, codec: format === "vp08" ? "vp8" : codec };
    }
  }

  return null;
};

const buildAudioConfig = (
  bytes: Uint8Array,
  entry: Box,
  format: string
): AudioDecoderConfig | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(entry.contentStart + 8);
  const numberOfChannels = view.getUint16(entry.contentStart + 16);
  const sampleRate = view.getUint32(entry.contentStart + 24) >>> 16;

  let childOffset = entry.contentStart + 28;
  if (version === 1) childOffset += 16;
  if (version === 2) childOffset += 36;
  const children = parseBoxes(bytes, childOffset, entry.contentEnd);

  if (format === "mp4a") {
    const esds = findBox(children, "esds");
    const description = esds
      ? parseEsdsDecoderSpecificInfo(bytes, esds)
      : null;
    return {
      codec: aacCodecString(description),
      sampleRate,
      numberOfChannels,
      ...(description ? { description } : {}),
    };
  }

  if (format === "Opus" || format === "opus") {
    const dOps = findBox(children, "dOps");
    return {
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: numberOfChannels || 2,
      ...(dOps
        ? { description: bytes.slice(dOps.contentStart, dOps.contentEnd) }
        : {}),
    };
  }

  if (format === "fLaC") {
    const dfLa = findBox(children, "dfLa");
    return {
      codec: "flac",
      sampleRate,
      numberOfChannels,
      ...(dfLa
        ? { description: bytes.slice(dfLa.contentStart, dfLa.contentEnd) }
        : {}),
    };
  }

  return null;
};

/** Expand `stts`/`ctts`/`stsc`/`stsz`/`stco`/`stss` into a flat sample list. */
const buildSamples = (
  bytes: Uint8Array,
  stbl: Box,
  timescale: number,
  kind: "video" | "audio"
): Sample[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = childBoxes(bytes, stbl);

  const stsz = findBox(boxes, "stsz");
  const stsc = findBox(boxes, "stsc");
  const chunkOffsetBox = findBox(boxes, "stco") ?? findBox(boxes, "co64");
  const stts = findBox(boxes, "stts");
  if (!stsz || !stsc || !chunkOffsetBox || !stts) {
    return [];
  }

  const uniformSize = view.getUint32(stsz.contentStart + 4);
  const sampleCount = view.getUint32(stsz.contentStart + 8);
  const sizeAt = (index: number): number =>
    uniformSize !== 0
      ? uniformSize
      : view.getUint32(stsz.contentStart + 12 + index * 4);

  const chunkCount = view.getUint32(chunkOffsetBox.contentStart + 4);
  const is64 = chunkOffsetBox.type === "co64";
  const chunkOffsetAt = (index: number): number =>
    is64
      ? view.getUint32(chunkOffsetBox.contentStart + 8 + index * 8) * 2 ** 32 +
        view.getUint32(chunkOffsetBox.contentStart + 12 + index * 8)
      : view.getUint32(chunkOffsetBox.contentStart + 8 + index * 4);

  const stscCount = view.getUint32(stsc.contentStart + 4);
  const stscEntry = (index: number) => {
    const at = stsc.contentStart + 8 + index * 12;
    return {
      firstChunk: view.getUint32(at),
      samplesPerChunk: view.getUint32(at + 4),
    };
  };

  // Decode-time deltas.
  const sttsCount = view.getUint32(stts.contentStart + 4);
  const decodeTimes = new Float64Array(sampleCount);
  const durations = new Float64Array(sampleCount);
  let sampleIndex = 0;
  let decodeTime = 0;
  for (let i = 0; i < sttsCount && sampleIndex < sampleCount; i += 1) {
    const at = stts.contentStart + 8 + i * 8;
    const count = view.getUint32(at);
    const delta = view.getUint32(at + 4);
    for (let j = 0; j < count && sampleIndex < sampleCount; j += 1) {
      decodeTimes[sampleIndex] = decodeTime;
      durations[sampleIndex] = delta;
      decodeTime += delta;
      sampleIndex += 1;
    }
  }

  // Composition offsets (B-frame reordering).
  const ctts = findBox(boxes, "ctts");
  const compositionOffsets = new Float64Array(sampleCount);
  if (ctts) {
    const signed = parseFullBoxVersion(view, ctts.contentStart) === 1;
    const cttsCount = view.getUint32(ctts.contentStart + 4);
    let index = 0;
    for (let i = 0; i < cttsCount && index < sampleCount; i += 1) {
      const at = ctts.contentStart + 8 + i * 8;
      const count = view.getUint32(at);
      const offset = signed ? view.getInt32(at + 4) : view.getUint32(at + 4);
      for (let j = 0; j < count && index < sampleCount; j += 1) {
        compositionOffsets[index] = offset;
        index += 1;
      }
    }
  }

  // Sync samples; absent means every sample is a random-access point.
  const stss = findBox(boxes, "stss");
  let syncSamples: Set<number> | null = null;
  if (stss) {
    syncSamples = new Set<number>();
    const count = view.getUint32(stss.contentStart + 4);
    for (let i = 0; i < count; i += 1) {
      syncSamples.add(view.getUint32(stss.contentStart + 8 + i * 4) - 1);
    }
  }

  const samples: Sample[] = [];
  let currentSample = 0;
  for (let chunk = 0; chunk < chunkCount && currentSample < sampleCount; ) {
    let entryIndex = 0;
    for (let i = 1; i < stscCount; i += 1) {
      if (stscEntry(i).firstChunk - 1 <= chunk) entryIndex = i;
    }
    const { samplesPerChunk } = stscEntry(entryIndex);
    let offset = chunkOffsetAt(chunk);

    for (let i = 0; i < samplesPerChunk && currentSample < sampleCount; i += 1) {
      const size = sizeAt(currentSample);
      samples.push({
        kind,
        offset,
        size,
        timestamp:
          ((decodeTimes[currentSample] + compositionOffsets[currentSample]) /
            timescale) *
          1e6,
        duration: (durations[currentSample] / timescale) * 1e6,
        key: syncSamples ? syncSamples.has(currentSample) : true,
      });
      offset += size;
      currentSample += 1;
    }
    chunk += 1;
  }

  return samples;
};

const parseTrack = (bytes: Uint8Array, trak: Box): ParsedTrackResult => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trakChildren = childBoxes(bytes, trak);

  const hdlr = descend(bytes, trakChildren, ["mdia", "hdlr"]);
  const mdhd = descend(bytes, trakChildren, ["mdia", "mdhd"]);
  const stbl = descend(bytes, trakChildren, ["mdia", "minf", "stbl"]);
  const stsd = stbl ? findBox(childBoxes(bytes, stbl), "stsd") : undefined;
  if (!hdlr || !mdhd || !stbl || !stsd) {
    return { status: "ignored" };
  }

  const handler = readType(bytes, hdlr.contentStart + 8);
  const kind =
    handler === "vide" ? "video" : handler === "soun" ? "audio" : null;
  if (!kind) {
    return { status: "ignored" };
  }

  const mdhdVersion = parseFullBoxVersion(view, mdhd.contentStart);
  const timescale =
    mdhdVersion === 1
      ? view.getUint32(mdhd.contentStart + 20)
      : view.getUint32(mdhd.contentStart + 12);
  if (!timescale) {
    return { status: "ignored" };
  }

  const entry = parseBoxes(bytes, stsd.contentStart + 8, stsd.contentEnd)[0];
  if (!entry) {
    return { status: "ignored" };
  }

  let videoConfig: VideoDecoderConfig | null = null;
  let audioConfig: AudioDecoderConfig | null = null;
  if (kind === "video") {
    videoConfig = buildVideoConfig(
      bytes,
      entry,
      entry.type,
      view.getUint16(entry.contentStart + 24),
      view.getUint16(entry.contentStart + 26)
    );
    if (!videoConfig) {
      return { status: "unsupported", label: entry.type };
    }
  } else {
    audioConfig = buildAudioConfig(bytes, entry, entry.type);
    if (!audioConfig) {
      return { status: "unsupported", label: entry.type };
    }
  }

  return {
    status: "ok",
    track: {
      kind,
      samples: buildSamples(bytes, stbl, timescale, kind),
      videoConfig,
      audioConfig,
    },
  };
};

const readMovieDurationUs = (bytes: Uint8Array, boxes: Box[]): number | null => {
  const mvhd = findBox(boxes, "mvhd");
  if (!mvhd) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = parseFullBoxVersion(view, mvhd.contentStart);
  const timescale = version === 1
    ? view.getUint32(mvhd.contentStart + 20)
    : view.getUint32(mvhd.contentStart + 12);
  const duration = version === 1
    ? view.getUint32(mvhd.contentStart + 24) * 2 ** 32 +
      view.getUint32(mvhd.contentStart + 28)
    : view.getUint32(mvhd.contentStart + 16);
  if (!timescale || !duration) return null;
  return (duration / timescale) * 1e6;
};

export async function createMp4Demuxer(
  stream: ByteStream
): Promise<MediaDemuxer> {
  const moov = await readMoov(stream);
  const moovBoxes = parseBoxes(moov, 0, moov.length);

  const results = moovBoxes
    .filter((box) => box.type === "trak")
    .map((trak) => parseTrack(moov, trak));

  const tracks = results
    .filter(
      (result): result is { status: "ok"; track: ParsedTrack } =>
        result.status === "ok"
    )
    .map((result) => result.track);

  const videoTrack = tracks.find((track) => track.kind === "video") ?? null;
  const audioTrack = tracks.find((track) => track.kind === "audio") ?? null;
  if (!videoTrack && !audioTrack) {
    throw new UnsupportedMediaError(
      "No decodable video or audio track found in this MP4 file"
    );
  }

  const unsupportedTracks = results
    .filter(
      (result): result is { status: "unsupported"; label: string } =>
        result.status === "unsupported"
    )
    .map((result) => result.label);

  // File order keeps the interleaved tracks in step and turns playback into a
  // single forward pass over the byte stream.
  const samples = [
    ...(videoTrack?.samples ?? []),
    ...(audioTrack?.samples ?? []),
  ].sort((a, b) => a.offset - b.offset);

  let cursor = 0;

  return {
    container: "mp4",
    video: videoTrack?.videoConfig ?? null,
    audio: audioTrack?.audioConfig ?? null,
    durationUs: readMovieDurationUs(moov, moovBoxes),
    unsupportedTracks,

    async next(): Promise<DemuxedPacket | null> {
      if (cursor >= samples.length) {
        return null;
      }
      const sample = samples[cursor];
      cursor += 1;

      if (stream.position !== sample.offset) {
        await stream.seek(sample.offset);
      }
      const data = await stream.require(sample.size);
      return {
        kind: sample.kind,
        data,
        timestamp: sample.timestamp,
        duration: sample.duration,
        key: sample.key,
      };
    },

    async close(): Promise<void> {
      cursor = samples.length;
      await stream.close();
    },
  };
}
