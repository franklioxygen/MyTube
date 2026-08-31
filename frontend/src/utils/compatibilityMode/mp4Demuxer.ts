/**
 * Minimal ISO-BMFF (MP4) demuxer for compatibility mode.
 *
 * Parses `moov` into flat sample tables for one video and one audio track,
 * then hands the encoded samples out in timeline order while preserving each
 * track's decode order. Only non-fragmented files are handled — that is what
 * the downloader produces.
 */

import { ByteStream } from "./byteStream";
import {
  aacCodecString,
  av1CodecString,
  avcCodecString,
  hevcCodecString,
  vp9CodecStringFromVpcC,
} from "./codecStrings";
import {
  MAX_ENCODED_PAYLOAD_BYTES,
  MAX_MOOV_BYTES,
  MAX_SAMPLE_TABLE_ENTRIES,
  recordsThatFit,
} from "./limits";
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

/**
 * Media-timescale offset from a track's edit list.
 *
 * The common single-entry case ffmpeg writes carries the codec's priming delay
 * (`media_time` is the first sample meant to be presented). Subtracting it puts
 * audio and video on the same presentation timeline instead of leaving a
 * constant offset between them. Multi-entry edit lists are rare in downloaded
 * media and are ignored rather than half-applied.
 */
const readEditListOffset = (bytes: Uint8Array, trakChildren: Box[]): number => {
  const elst = descend(bytes, trakChildren, ["edts", "elst"]);
  if (!elst) {
    return 0;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = parseFullBoxVersion(view, elst.contentStart);
  if (view.getUint32(elst.contentStart + 4) !== 1) {
    return 0;
  }
  const at = elst.contentStart + 8;
  const mediaTime =
    version === 1
      ? Number(
          new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength
          ).getBigInt64(at + 8)
        )
      : view.getInt32(at + 4);
  return mediaTime > 0 ? mediaTime : 0;
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
  kind: "video" | "audio",
  /** Media-timescale offset from the track's edit list, if any. */
  mediaTimeOffset: number,
  /** Total file size when the server reported one, for bounding offsets. */
  fileSize: number | null
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
  // A declared sample count must be backed by real bytes: either an entry table
  // inside `stsz`, or — for uniform sizes — enough file to hold the samples.
  const declaredSampleCount = view.getUint32(stsz.contentStart + 8);
  const sampleCountCeiling =
    uniformSize !== 0
      ? fileSize !== null
        ? Math.floor(fileSize / Math.max(1, uniformSize))
        : MAX_SAMPLE_TABLE_ENTRIES
      : recordsThatFit(stsz.contentStart, stsz.contentEnd, 12, 4);
  const sampleCount = Math.min(
    declaredSampleCount,
    sampleCountCeiling,
    MAX_SAMPLE_TABLE_ENTRIES
  );
  const sizeAt = (index: number): number =>
    uniformSize !== 0
      ? uniformSize
      : view.getUint32(stsz.contentStart + 12 + index * 4);

  const is64 = chunkOffsetBox.type === "co64";
  const chunkCount = Math.min(
    view.getUint32(chunkOffsetBox.contentStart + 4),
    recordsThatFit(
      chunkOffsetBox.contentStart,
      chunkOffsetBox.contentEnd,
      8,
      is64 ? 8 : 4
    )
  );
  const chunkOffsetAt = (index: number): number =>
    is64
      ? view.getUint32(chunkOffsetBox.contentStart + 8 + index * 8) * 2 ** 32 +
        view.getUint32(chunkOffsetBox.contentStart + 12 + index * 8)
      : view.getUint32(chunkOffsetBox.contentStart + 8 + index * 4);

  const stscCount = Math.min(
    view.getUint32(stsc.contentStart + 4),
    recordsThatFit(stsc.contentStart, stsc.contentEnd, 8, 12)
  );
  // Read the sample-to-chunk table into flat arrays once. Files remuxed by
  // concatenation can carry one entry per chunk — 94k of them in a one-hour
  // file — so this is read hot and must not go back to the DataView per chunk.
  const stscFirstChunk = new Uint32Array(stscCount);
  const stscSamplesPerChunk = new Uint32Array(stscCount);
  for (let i = 0; i < stscCount; i += 1) {
    const at = stsc.contentStart + 8 + i * 12;
    stscFirstChunk[i] = view.getUint32(at);
    stscSamplesPerChunk[i] = view.getUint32(at + 4);
  }

  // Decode-time deltas.
  const sttsCount = Math.min(
    view.getUint32(stts.contentStart + 4),
    recordsThatFit(stts.contentStart, stts.contentEnd, 8, 8)
  );
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
    const cttsCount = Math.min(
      view.getUint32(ctts.contentStart + 4),
      recordsThatFit(ctts.contentStart, ctts.contentEnd, 8, 8)
    );
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
    const count = Math.min(
      view.getUint32(stss.contentStart + 4),
      recordsThatFit(stss.contentStart, stss.contentEnd, 8, 4)
    );
    for (let i = 0; i < count; i += 1) {
      syncSamples.add(view.getUint32(stss.contentStart + 8 + i * 4) - 1);
    }
  }

  const samples: Sample[] = [];
  let currentSample = 0;
  // `stsc` entries are ordered by firstChunk, so the applicable entry only ever
  // moves forwards. Rescanning the table for every chunk made this O(chunks x
  // entries): ten billion iterations on a one-hour file, which showed up as a
  // fifteen-second wait before playback could start.
  let stscIndex = 0;
  for (let chunk = 0; chunk < chunkCount && currentSample < sampleCount; ) {
    while (
      stscIndex + 1 < stscCount &&
      stscFirstChunk[stscIndex + 1] - 1 <= chunk
    ) {
      stscIndex += 1;
    }
    const samplesPerChunk = stscSamplesPerChunk[stscIndex] ?? 0;
    let offset = chunkOffsetAt(chunk);

    for (let i = 0; i < samplesPerChunk && currentSample < sampleCount; i += 1) {
      const size = sizeAt(currentSample);
      if (size > MAX_ENCODED_PAYLOAD_BYTES) {
        throw new UnsupportedMediaError(
          `Sample size ${size} exceeds the supported limit`
        );
      }
      if (fileSize !== null && offset + size > fileSize) {
        throw new UnsupportedMediaError(
          "Sample table points past the end of the file"
        );
      }
      samples.push({
        kind,
        offset,
        size,
        timestamp:
          ((decodeTimes[currentSample] +
            compositionOffsets[currentSample] -
            mediaTimeOffset) /
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

const parseTrack = (
  bytes: Uint8Array,
  trak: Box,
  fileSize: number | null
): ParsedTrackResult => {
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
      samples: buildSamples(
        bytes,
        stbl,
        timescale,
        kind,
        readEditListOffset(bytes, trakChildren),
        fileSize
      ),
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

  const fileSize = stream.totalSize;
  const results = moovBoxes
    .filter((box) => box.type === "trak")
    .map((trak) => parseTrack(moov, trak, fileSize));

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

  // Merge by media time, not file offset. Some valid MP4s store one complete
  // track before the other; file order lets that first track fill its decoder
  // queue and prevents the engine from ever reaching the starved track. The
  // per-track cursors preserve decode order (including video B-frames), while
  // the merged stream keeps both decoders reachable. ByteStream seeks when the
  // physical layout is non-interleaved.
  const sampleTracks = [
    videoTrack?.samples ?? [],
    audioTrack?.samples ?? [],
  ];
  const trackCursors = sampleTracks.map(() => 0);
  const samples: Sample[] = [];
  for (;;) {
    let chosenTrack = -1;
    let chosenTimestamp = Number.POSITIVE_INFINITY;
    sampleTracks.forEach((trackSamples, trackIndex) => {
      const sample = trackSamples[trackCursors[trackIndex]];
      if (sample && sample.timestamp < chosenTimestamp) {
        chosenTrack = trackIndex;
        chosenTimestamp = sample.timestamp;
      }
    });
    if (chosenTrack < 0) break;
    samples.push(sampleTracks[chosenTrack][trackCursors[chosenTrack]]);
    trackCursors[chosenTrack] += 1;
  }

  // The exact earliest presentation time, which the sample table knows and the
  // first packet in file order does not: with B-frames the opening sample's
  // composition time is not the minimum. Clamped at zero so an edit list that
  // pushes priming samples negative keeps presentation starting at zero.
  const startTimeUs = Math.max(
    0,
    samples.reduce(
      (earliest, sample) => Math.min(earliest, sample.timestamp),
      Number.POSITIVE_INFINITY
    )
  );

  // Random-access points, in presentation order. Video can only be decoded
  // from a sync sample; an audio-only file can start anywhere.
  const seekTrack = videoTrack ?? audioTrack;
  const syncSamples = (seekTrack?.samples ?? [])
    .filter((sample) => sample.key)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Separate cursors let time-interleaved reads stay sequential within each
  // physical track even when the file stores all video bytes before all audio
  // bytes. Sharing one ByteStream here would turn every packet into a backward
  // range request for that layout.
  const videoStream = stream;
  const audioStream = videoTrack && audioTrack ? stream.fork() : stream;

  let cursor = 0;

  return {
    container: "mp4",
    video: videoTrack?.videoConfig ?? null,
    audio: audioTrack?.audioConfig ?? null,
    durationUs: readMovieDurationUs(moov, moovBoxes),
    startTimeUs: Number.isFinite(startTimeUs) ? startTimeUs : 0,
    unsupportedTracks,

    canSeek: syncSamples.length > 0,

    async seek(timeUs: number): Promise<number> {
      if (syncSamples.length === 0) {
        return 0;
      }
      // Last sync sample at or before the target; never past it, or the seek
      // would skip content the viewer asked to see.
      let chosen = syncSamples[0];
      for (const sample of syncSamples) {
        if (sample.timestamp > timeUs) break;
        chosen = sample;
      }
      cursor = samples.indexOf(chosen);
      return chosen.timestamp;
    },

    async next(): Promise<DemuxedPacket | null> {
      if (cursor >= samples.length) {
        return null;
      }
      const sample = samples[cursor];
      cursor += 1;

      const sampleStream = sample.kind === "video" ? videoStream : audioStream;
      if (sampleStream.position !== sample.offset) {
        await sampleStream.seek(sample.offset);
      }
      const data = await sampleStream.require(sample.size);
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
      await Promise.all(
        Array.from(new Set([videoStream, audioStream]), (trackStream) =>
          trackStream.close()
        )
      );
    },
  };
}
