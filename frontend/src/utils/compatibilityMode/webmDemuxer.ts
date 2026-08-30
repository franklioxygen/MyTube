/**
 * Minimal EBML/Matroska (WebM) demuxer for compatibility mode.
 *
 * WebM has no global sample table, so this is a straight forward pass: read
 * `Info` and `Tracks`, then walk clusters and hand out the frames inside
 * `SimpleBlock` / `BlockGroup`. Master elements are entered rather than
 * skipped, which keeps unknown-size segments and clusters working.
 */

import { ByteStream } from "./byteStream";
import {
  aacCodecString,
  av1CodecString,
  avcCodecString,
  hevcCodecString,
} from "./codecStrings";
import { DemuxedPacket, MediaDemuxer, UnsupportedMediaError } from "./types";

const ID = {
  ebmlHeader: 0x1a45dfa3,
  segment: 0x18538067,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  videoSettings: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  audioSettings: 0xe1,
  samplingFrequency: 0xb5,
  channels: 0x9f,
  cluster: 0x1f43b675,
  clusterTimestamp: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
} as const;

const DEFAULT_TIMESTAMP_SCALE_NS = 1_000_000;
const MAX_HEADER_ELEMENT_BYTES = 8 * 1024 * 1024;

interface Element {
  id: number;
  contentStart: number;
  contentEnd: number;
}

interface WebmTrack {
  number: number;
  type: number;
  codecId: string;
  codecPrivate: Uint8Array | null;
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
}

const vintLength = (firstByte: number): number => {
  for (let i = 0; i < 8; i += 1) {
    if (firstByte & (0x80 >> i)) {
      return i + 1;
    }
  }
  return 0;
};

/** Parse an in-memory run of EBML elements (used for `Info` and `Tracks`). */
const parseElements = (
  bytes: Uint8Array,
  start: number,
  end: number
): Element[] => {
  const elements: Element[] = [];
  let offset = start;

  while (offset < end) {
    const idLength = vintLength(bytes[offset]);
    if (idLength === 0 || idLength > 4 || offset + idLength > end) break;
    let id = 0;
    for (let i = 0; i < idLength; i += 1) {
      id = id * 256 + bytes[offset + i];
    }
    offset += idLength;

    if (offset >= end) break;
    const sizeLength = vintLength(bytes[offset]);
    if (sizeLength === 0 || offset + sizeLength > end) break;
    let size = bytes[offset] & (0xff >> sizeLength);
    for (let i = 1; i < sizeLength; i += 1) {
      size = size * 256 + bytes[offset + i];
    }
    offset += sizeLength;

    const contentEnd = Math.min(offset + size, end);
    elements.push({ id, contentStart: offset, contentEnd });
    offset = contentEnd;
  }

  return elements;
};

const readUint = (bytes: Uint8Array, element: Element): number => {
  let value = 0;
  for (let i = element.contentStart; i < element.contentEnd; i += 1) {
    value = value * 256 + bytes[i];
  }
  return value;
};

const readFloat = (bytes: Uint8Array, element: Element): number => {
  const length = element.contentEnd - element.contentStart;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (length === 4) return view.getFloat32(element.contentStart);
  if (length === 8) return view.getFloat64(element.contentStart);
  return 0;
};

const readString = (bytes: Uint8Array, element: Element): string =>
  new TextDecoder()
    .decode(bytes.subarray(element.contentStart, element.contentEnd))
    .replace(/\0+$/, "");

const parseTrackEntry = (bytes: Uint8Array, entry: Element): WebmTrack => {
  const track: WebmTrack = {
    number: 0,
    type: 0,
    codecId: "",
    codecPrivate: null,
    width: 0,
    height: 0,
    sampleRate: 48000,
    channels: 2,
  };

  for (const field of parseElements(bytes, entry.contentStart, entry.contentEnd)) {
    switch (field.id) {
      case ID.trackNumber:
        track.number = readUint(bytes, field);
        break;
      case ID.trackType:
        track.type = readUint(bytes, field);
        break;
      case ID.codecId:
        track.codecId = readString(bytes, field);
        break;
      case ID.codecPrivate:
        track.codecPrivate = bytes.slice(field.contentStart, field.contentEnd);
        break;
      case ID.videoSettings:
        for (const setting of parseElements(
          bytes,
          field.contentStart,
          field.contentEnd
        )) {
          if (setting.id === ID.pixelWidth) track.width = readUint(bytes, setting);
          if (setting.id === ID.pixelHeight) track.height = readUint(bytes, setting);
        }
        break;
      case ID.audioSettings:
        for (const setting of parseElements(
          bytes,
          field.contentStart,
          field.contentEnd
        )) {
          if (setting.id === ID.samplingFrequency) {
            track.sampleRate = Math.round(readFloat(bytes, setting));
          }
          if (setting.id === ID.channels) {
            track.channels = readUint(bytes, setting);
          }
        }
        break;
      default:
        break;
    }
  }

  return track;
};

interface VideoTrackConfig {
  config: VideoDecoderConfig;
  fallbacks: string[];
}

const buildVideoConfig = (track: WebmTrack): VideoTrackConfig | null => {
  const base = {
    codedWidth: track.width || undefined,
    codedHeight: track.height || undefined,
  };
  const description = track.codecPrivate ?? undefined;

  switch (track.codecId) {
    case "V_VP8":
      return { config: { ...base, codec: "vp8" }, fallbacks: [] };
    case "V_VP9":
      // WebM carries no vpcC, so start at the common profile-0 8-bit string and
      // let the engine fall back through the higher-bit-depth profiles.
      return {
        config: { ...base, codec: "vp09.00.10.08" },
        fallbacks: ["vp09.00.41.08", "vp09.02.10.10", "vp09.01.10.08"],
      };
    case "V_AV1":
      return {
        config: {
          ...base,
          codec: description ? av1CodecString(description) : "av01.0.05M.08",
          ...(description ? { description } : {}),
        },
        fallbacks: ["av01.0.05M.08"],
      };
    case "V_MPEG4/ISO/AVC":
      if (!description) return null;
      return {
        config: { ...base, codec: avcCodecString(description), description },
        fallbacks: [],
      };
    case "V_MPEGH/ISO/HEVC":
      if (!description) return null;
      return {
        config: { ...base, codec: hevcCodecString(description), description },
        fallbacks: [],
      };
    default:
      return null;
  }
};

const buildAudioConfig = (track: WebmTrack): AudioDecoderConfig | null => {
  const description = track.codecPrivate ?? undefined;

  switch (track.codecId) {
    case "A_OPUS":
      return {
        codec: "opus",
        sampleRate: track.sampleRate || 48000,
        numberOfChannels: track.channels || 2,
        ...(description ? { description } : {}),
      };
    case "A_AAC":
      return {
        codec: aacCodecString(track.codecPrivate),
        sampleRate: track.sampleRate,
        numberOfChannels: track.channels,
        ...(description ? { description } : {}),
      };
    case "A_FLAC":
      return {
        codec: "flac",
        sampleRate: track.sampleRate,
        numberOfChannels: track.channels,
        ...(description ? { description } : {}),
      };
    default:
      return null;
  }
};

/** Split a block payload according to its lacing mode. */
const splitLacedFrames = (
  payload: Uint8Array,
  lacing: number
): Uint8Array[] => {
  if (lacing === 0) {
    return [payload];
  }

  const frameCount = payload[0] + 1;
  let offset = 1;
  const sizes: number[] = [];

  if (lacing === 2) {
    const size = Math.floor((payload.length - offset) / frameCount);
    for (let i = 0; i < frameCount; i += 1) sizes.push(size);
  } else if (lacing === 1) {
    for (let i = 0; i < frameCount - 1; i += 1) {
      let size = 0;
      while (payload[offset] === 0xff) {
        size += 255;
        offset += 1;
      }
      size += payload[offset];
      offset += 1;
      sizes.push(size);
    }
  } else {
    // EBML lacing: first size is a plain vint, the rest are signed deltas.
    const readVint = (signed: boolean): number => {
      const length = vintLength(payload[offset]);
      let value = payload[offset] & (0xff >> length);
      for (let i = 1; i < length; i += 1) {
        value = value * 256 + payload[offset + i];
      }
      offset += length;
      return signed ? value - (2 ** (7 * length - 1) - 1) : value;
    };

    let previous = readVint(false);
    sizes.push(previous);
    for (let i = 1; i < frameCount - 1; i += 1) {
      previous += readVint(true);
      sizes.push(previous);
    }
  }

  const frames: Uint8Array[] = [];
  for (const size of sizes) {
    frames.push(payload.subarray(offset, offset + size));
    offset += size;
  }
  if (lacing !== 2) {
    frames.push(payload.subarray(offset));
  }
  return frames.filter((frame) => frame.length > 0);
};

export async function createWebmDemuxer(
  stream: ByteStream
): Promise<MediaDemuxer> {
  await stream.seek(0);

  let timestampScaleNs = DEFAULT_TIMESTAMP_SCALE_NS;
  let rawDuration = 0;

  // Held in one object so the selections survive control-flow narrowing across
  // the async parser calls that fill them in.
  const selected: {
    videoTrack: WebmTrack | null;
    audioTrack: WebmTrack | null;
    videoConfig: VideoTrackConfig | null;
    audioConfig: AudioDecoderConfig | null;
    rejectedVideo: string[];
    rejectedAudio: string[];
  } = {
    videoTrack: null,
    audioTrack: null,
    videoConfig: null,
    audioConfig: null,
    rejectedVideo: [],
    rejectedAudio: [],
  };

  let clusterTimestamp = 0;
  let finished = false;
  const pending: DemuxedPacket[] = [];

  const readId = async (): Promise<number | null> => {
    if (!(await stream.ensure(1))) return null;
    const length = vintLength(stream.peek(1)[0]);
    if (length === 0 || length > 4) return null;
    if (!(await stream.ensure(length))) return null;
    const bytes = stream.read(length);
    let id = 0;
    for (const byte of bytes) {
      id = id * 256 + byte;
    }
    return id;
  };

  /** Element size, or null when the writer used the "unknown size" encoding. */
  const readSize = async (): Promise<number | null> => {
    if (!(await stream.ensure(1))) return null;
    const length = vintLength(stream.peek(1)[0]);
    if (length === 0) return null;
    if (!(await stream.ensure(length))) return null;
    const bytes = stream.read(length);
    let size = bytes[0] & (0xff >> length);
    let unknown = size === (0xff >> length);
    for (let i = 1; i < length; i += 1) {
      size = size * 256 + bytes[i];
      unknown = unknown && bytes[i] === 0xff;
    }
    return unknown ? null : size;
  };

  const emitBlock = (
    payload: Uint8Array,
    fromSimpleBlock: boolean,
    durationOverrideUs?: number
  ): void => {
    const trackNumberLength = vintLength(payload[0]);
    if (trackNumberLength === 0) return;
    let trackNumber = payload[0] & (0xff >> trackNumberLength);
    for (let i = 1; i < trackNumberLength; i += 1) {
      trackNumber = trackNumber * 256 + payload[i];
    }

    let offset = trackNumberLength;
    const view = new DataView(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength
    );
    const relativeTimestamp = view.getInt16(offset);
    offset += 2;
    const flags = payload[offset];
    offset += 1;

    const kind =
      selected.videoTrack && trackNumber === selected.videoTrack.number
        ? "video"
        : selected.audioTrack && trackNumber === selected.audioTrack.number
        ? "audio"
        : null;
    if (!kind) return;

    // BlockGroup blocks carry no keyframe flag; audio is always intra-coded and
    // video keyframes in WebM are written as SimpleBlocks in practice.
    const key = fromSimpleBlock ? (flags & 0x80) !== 0 : kind === "audio";
    const timestamp =
      ((clusterTimestamp + relativeTimestamp) * timestampScaleNs) / 1000;

    for (const frame of splitLacedFrames(payload.subarray(offset), (flags >> 1) & 0x03)) {
      pending.push({
        kind,
        data: frame.slice(),
        timestamp,
        ...(durationOverrideUs !== undefined
          ? { duration: durationOverrideUs }
          : {}),
        key,
      });
    }
  };

  const readHeaderElement = async (size: number): Promise<Uint8Array> => {
    if (size > MAX_HEADER_ELEMENT_BYTES) {
      throw new UnsupportedMediaError("WebM header element is unusably large");
    }
    return stream.require(size);
  };

  /** Advance the parser until at least one packet is queued, or EOF. */
  const advance = async (): Promise<void> => {
    while (pending.length === 0 && !finished) {
      const id = await readId();
      if (id === null) {
        finished = true;
        return;
      }
      const size = await readSize();

      switch (id) {
        case ID.segment:
        case ID.cluster:
        case ID.blockGroup:
          // Master elements we walk into rather than skip.
          if (id === ID.cluster) clusterTimestamp = 0;
          break;
        case ID.clusterTimestamp:
          clusterTimestamp = size
            ? Array.from(await stream.require(size)).reduce(
                (total, byte) => total * 256 + byte,
                0
              )
            : 0;
          break;
        case ID.simpleBlock:
        case ID.block:
          if (size === null) {
            finished = true;
            return;
          }
          emitBlock(await stream.require(size), id === ID.simpleBlock);
          break;
        case ID.info: {
          if (size === null) break;
          const bytes = await readHeaderElement(size);
          for (const field of parseElements(bytes, 0, bytes.length)) {
            if (field.id === ID.timestampScale) {
              timestampScaleNs = readUint(bytes, field) || DEFAULT_TIMESTAMP_SCALE_NS;
            }
            if (field.id === ID.duration) {
              rawDuration = readFloat(bytes, field);
            }
          }
          break;
        }
        case ID.tracks: {
          if (size === null) break;
          const bytes = await readHeaderElement(size);
          for (const entry of parseElements(bytes, 0, bytes.length)) {
            if (entry.id !== ID.trackEntry) continue;
            const track = parseTrackEntry(bytes, entry);
            if (track.type === 1 && !selected.videoTrack) {
              const config = buildVideoConfig(track);
              if (config) {
                selected.videoTrack = track;
                selected.videoConfig = config;
              } else {
                selected.rejectedVideo.push(track.codecId);
              }
            }
            if (track.type === 2 && !selected.audioTrack) {
              const config = buildAudioConfig(track);
              if (config) {
                selected.audioTrack = track;
                selected.audioConfig = config;
              } else {
                selected.rejectedAudio.push(track.codecId);
              }
            }
          }
          break;
        }
        default:
          if (size === null) {
            finished = true;
            return;
          }
          await stream.seek(stream.position + size);
          break;
      }
    }
  };

  // Prime the parser so the track configurations are known before playback.
  if (!(await stream.ensure(4))) {
    throw new UnsupportedMediaError("Empty WebM stream");
  }
  await advance();

  if (!selected.videoConfig && !selected.audioConfig) {
    throw new UnsupportedMediaError(
      "No decodable video or audio track found in this WebM file"
    );
  }

  const durationUs =
    rawDuration > 0 ? (rawDuration * timestampScaleNs) / 1000 : null;

  return {
    container: "webm",
    video: selected.videoConfig?.config ?? null,
    audio: selected.audioConfig,
    videoCodecFallbacks: selected.videoConfig?.fallbacks ?? [],
    durationUs,
    // Only a kind with no usable track at all counts as unsupported; a file
    // with two audio tracks is fine as long as one of them decodes.
    unsupportedTracks: [
      ...(selected.videoTrack ? [] : selected.rejectedVideo),
      ...(selected.audioTrack ? [] : selected.rejectedAudio),
    ],

    async next(): Promise<DemuxedPacket | null> {
      if (pending.length === 0) {
        await advance();
      }
      return pending.shift() ?? null;
    },

    async close(): Promise<void> {
      finished = true;
      pending.length = 0;
      await stream.close();
    },
  };
}
