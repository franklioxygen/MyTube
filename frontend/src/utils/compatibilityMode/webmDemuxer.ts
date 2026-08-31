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
  vp9CodecStringFromFrameHeader,
} from "./codecStrings";
import {
  MAX_ENCODED_PAYLOAD_BYTES,
  MAX_HEADER_ELEMENT_BYTES,
} from "./limits";
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
  blockDuration: 0x9b,
  referenceBlock: 0xfb,
  defaultDuration: 0x23e383,
  codecDelay: 0x56aa,
  seekHead: 0x114d9b74,
  seekEntry: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueClusterPosition: 0xf1,
} as const;

const DEFAULT_TIMESTAMP_SCALE_NS = 1_000_000;

interface Element {
  id: number;
  contentStart: number;
  contentEnd: number;
}

interface CuePoint {
  /** Presentation time in microseconds. */
  timeUs: number;
  /** Absolute byte offset of the cluster holding it. */
  clusterOffset: number;
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
  /** Nominal frame duration in nanoseconds, used to space laced frames. */
  defaultDurationNs: number;
  /** Codec priming delay in nanoseconds (Opus, mainly). */
  codecDelayNs: number;
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
    defaultDurationNs: 0,
    codecDelayNs: 0,
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
      case ID.defaultDuration:
        track.defaultDurationNs = readUint(bytes, field);
        break;
      case ID.codecDelay:
        track.codecDelayNs = readUint(bytes, field);
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
      // WebM carries no vpcC. This provisional value is replaced from the
      // first keyframe's uncompressed header before the config is exposed.
      return {
        config: { ...base, codec: "vp09.00.10.08" },
        fallbacks: ["vp09.00.41.08"],
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

/** Flatten a `Cues` element into time -> cluster offset pairs. */
const parseCuesWith = (
  bytes: Uint8Array,
  segmentDataStart: number,
  timestampScaleNs: number
): CuePoint[] => {
  const points: CuePoint[] = [];
  for (const point of parseElements(bytes, 0, bytes.length)) {
    if (point.id !== ID.cuePoint) continue;
    const fields = parseElements(bytes, point.contentStart, point.contentEnd);
    const time = fields.find((field) => field.id === ID.cueTime);
    const positions = fields.find((field) => field.id === ID.cueTrackPositions);
    if (!time || !positions) continue;
    const cluster = parseElements(
      bytes,
      positions.contentStart,
      positions.contentEnd
    ).find((field) => field.id === ID.cueClusterPosition);
    if (!cluster) continue;
    points.push({
      timeUs: (readUint(bytes, time) * timestampScaleNs) / 1000,
      clusterOffset: segmentDataStart + readUint(bytes, cluster),
    });
  }
  return points.sort((a, b) => a.timeUs - b.timeUs);
};

export async function createWebmDemuxer(
  stream: ByteStream
): Promise<MediaDemuxer> {
  await stream.seek(0);

  let timestampScaleNs = DEFAULT_TIMESTAMP_SCALE_NS;
  let rawDuration = 0;

  // Seeking needs the byte offset the Segment's payload starts at, because
  // every position in SeekHead and Cues is stated relative to it. Held in an
  // object so the assignments made inside the async parser survive narrowing.
  const index: {
    segmentDataStart: number | null;
    cuesOffset: number | null;
    cuePoints: CuePoint[] | null;
  } = { segmentDataStart: null, cuesOffset: null, cuePoints: null };

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
    options: {
      /** SimpleBlock carries a keyframe flag; a Block inside a BlockGroup does not. */
      fromSimpleBlock: boolean;
      /** For a BlockGroup: whether the group contained a ReferenceBlock. */
      hasReference?: boolean;
      /** BlockDuration for the whole block, in microseconds. */
      blockDurationUs?: number;
    }
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

    const track =
      selected.videoTrack && trackNumber === selected.videoTrack.number
        ? selected.videoTrack
        : selected.audioTrack && trackNumber === selected.audioTrack.number
        ? selected.audioTrack
        : null;
    if (!track) return;
    const kind = track.type === 1 ? "video" : "audio";

    // A SimpleBlock states its own keyframe status. Inside a BlockGroup,
    // Matroska instead marks a frame as *not* a random-access point by giving
    // the group a ReferenceBlock — so a group without one is a keyframe.
    // Treating every grouped block as a delta frame left such files black,
    // because the engine drops input until it sees a keyframe.
    const key = options.fromSimpleBlock
      ? (flags & 0x80) !== 0
      : options.hasReference !== true;

    const frames = splitLacedFrames(
      payload.subarray(offset),
      (flags >> 1) & 0x03
    );

    // A block timestamp applies to the *first* frame of a lace; the rest follow
    // contiguously. Giving them all the same timestamp stacks separately
    // decoded packets on top of each other at playback time.
    const frameDurationUs =
      track.defaultDurationNs > 0
        ? track.defaultDurationNs / 1000
        : options.blockDurationUs !== undefined && frames.length > 0
        ? options.blockDurationUs / frames.length
        : 0;

    const blockTimestampUs =
      ((clusterTimestamp + relativeTimestamp) * timestampScaleNs) / 1000 -
      track.codecDelayNs / 1000;

    frames.forEach((frame, index) => {
      pending.push({
        kind,
        data: frame.slice(),
        timestamp: blockTimestampUs + index * frameDurationUs,
        ...(frameDurationUs > 0 ? { duration: frameDurationUs } : {}),
        key,
      });
    });
  };

  const readHeaderElement = async (size: number): Promise<Uint8Array> => {
    if (size > MAX_HEADER_ELEMENT_BYTES) {
      throw new UnsupportedMediaError("WebM header element is unusably large");
    }
    return stream.require(size);
  };

  /**
   * Load the Cues index on first use. It normally sits at the end of the file,
   * so this is deliberately deferred: startup should not pay for a seek the
   * viewer may never make.
   */
  const ensureCues = async (): Promise<CuePoint[] | null> => {
    if (index.cuePoints !== null) return index.cuePoints;
    if (index.cuesOffset === null || index.segmentDataStart === null) return null;

    await stream.seek(index.cuesOffset);
    const id = await readId();
    const size = await readSize();
    if (id !== ID.cues || size === null || size > MAX_HEADER_ELEMENT_BYTES) {
      index.cuePoints = [];
      return index.cuePoints;
    }
    index.cuePoints = parseCuesWith(
      await stream.require(size),
      index.segmentDataStart,
      timestampScaleNs
    );
    return index.cuePoints;
  };

  /** Advance the parser until at least one packet is queued, or EOF. */
  const advance = async (
    ready: () => boolean = () => pending.length > 0
  ): Promise<void> => {
    while (!ready() && !finished) {
      const id = await readId();
      if (id === null) {
        finished = true;
        return;
      }
      const size = await readSize();

      switch (id) {
        case ID.segment:
        case ID.cluster:
          // Master elements we walk into rather than skip.
          if (id === ID.segment && index.segmentDataStart === null) {
            index.segmentDataStart = stream.position;
          }
          if (id === ID.cluster) clusterTimestamp = 0;
          break;
        case ID.seekHead: {
          // Points at the other top-level elements. Cues normally sits at the
          // end of the file, so this is how it is found without reading through
          // every cluster to get there.
          if (size === null || size > MAX_HEADER_ELEMENT_BYTES) break;
          const bytes = await stream.require(size);
          for (const entry of parseElements(bytes, 0, bytes.length)) {
            if (entry.id !== ID.seekEntry) continue;
            const fields = parseElements(bytes, entry.contentStart, entry.contentEnd);
            const seekId = fields.find((field) => field.id === ID.seekId);
            const position = fields.find((field) => field.id === ID.seekPosition);
            if (!seekId || !position) continue;
            let target = 0;
            for (let i = seekId.contentStart; i < seekId.contentEnd; i += 1) {
              target = target * 256 + bytes[i];
            }
            if (target === ID.cues && index.segmentDataStart !== null) {
              index.cuesOffset =
                index.segmentDataStart + readUint(bytes, position);
            }
          }
          break;
        }
        case ID.cues:
          // Some muxers place Cues before the clusters; take it in passing.
          if (
            size !== null &&
            size <= MAX_HEADER_ELEMENT_BYTES &&
            index.segmentDataStart !== null
          ) {
            index.cuePoints = parseCuesWith(
              await stream.require(size),
              index.segmentDataStart,
              timestampScaleNs
            );
          } else if (size !== null) {
            await stream.seek(stream.position + size);
          }
          break;
        case ID.blockGroup: {
          // Read as a unit: the keyframe status of the Block inside depends on
          // whether the group also carries a ReferenceBlock, which we can only
          // know by looking at its siblings.
          if (size === null || size > MAX_HEADER_ELEMENT_BYTES) {
            finished = true;
            return;
          }
          const group = await stream.require(size);
          const children = parseElements(group, 0, group.length);
          const block = children.find((child) => child.id === ID.block);
          if (!block) break;
          const duration = children.find(
            (child) => child.id === ID.blockDuration
          );
          emitBlock(group.slice(block.contentStart, block.contentEnd), {
            fromSimpleBlock: false,
            hasReference: children.some(
              (child) => child.id === ID.referenceBlock
            ),
            ...(duration
              ? {
                  blockDurationUs:
                    (readUint(group, duration) * timestampScaleNs) / 1000,
                }
              : {}),
          });
          break;
        }
        case ID.clusterTimestamp:
          if (size === null || size > 8) {
            finished = true;
            return;
          }
          clusterTimestamp = size
            ? Array.from(await stream.require(size)).reduce(
                (total, byte) => total * 256 + byte,
                0
              )
            : 0;
          break;
        case ID.simpleBlock:
        case ID.block:
          if (size === null || size > MAX_ENCODED_PAYLOAD_BYTES) {
            finished = true;
            return;
          }
          emitBlock(await stream.require(size), {
            fromSimpleBlock: id === ID.simpleBlock,
          });
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

  // Unlike MP4, WebM has no VP9 decoder-configuration record. Inspect the
  // actual first random-access frame before returning the config; choosing the
  // first profile supported by the platform can configure the decoder for a
  // different profile than the file contains. Audio blocks encountered while
  // looking for the video frame stay queued in their original order.
  if (selected.videoTrack?.codecId === "V_VP9") {
    await advance(() =>
      pending.some((packet) => packet.kind === "video" && packet.key)
    );
    const firstKeyframe = pending.find(
      (packet) => packet.kind === "video" && packet.key
    );
    const codec = firstKeyframe
      ? vp9CodecStringFromFrameHeader(firstKeyframe.data)
      : null;
    if (codec && selected.videoConfig) {
      const [prefix, profile, , bitDepth] = codec.split(".");
      selected.videoConfig = {
        config: { ...selected.videoConfig.config, codec },
        // Level is not encoded in the frame header. Keep the fallback on the
        // same profile/bit depth so support probing cannot select another one.
        fallbacks: [`${prefix}.${profile}.41.${bitDepth}`],
      };
    }
  }

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
    // Matroska cluster timestamps are relative to the segment, which starts at
    // zero; there is no equivalent of MP4's composition-time reordering here.
    startTimeUs: 0,
    // Only a kind with no usable track at all counts as unsupported; a file
    // with two audio tracks is fine as long as one of them decodes.
    unsupportedTracks: [
      ...(selected.videoTrack ? [] : selected.rejectedVideo),
      ...(selected.audioTrack ? [] : selected.rejectedAudio),
    ],

    canSeek: index.cuesOffset !== null || (index.cuePoints?.length ?? 0) > 0,

    async seek(timeUs: number): Promise<number> {
      const points = await ensureCues();
      if (!points || points.length === 0) {
        return 0;
      }
      // Last cue at or before the target: cues mark cluster starts, which is
      // where decoding can actually resume.
      let chosen = points[0];
      for (const point of points) {
        if (point.timeUs > timeUs) break;
        chosen = point;
      }

      await stream.seek(chosen.clusterOffset);
      pending.length = 0;
      clusterTimestamp = 0;
      finished = false;
      return chosen.timeUs;
    },

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
