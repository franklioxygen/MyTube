/**
 * Test helpers: an HTTP-ish fetch over an in-memory buffer, plus tiny synthetic
 * MP4 and WebM builders so the demuxers can be exercised without binary
 * fixtures in the repository.
 */

export interface FakeFetchOptions {
  /** Emulate a server that ignores `Range` and always replies with the whole file. */
  ignoreRange?: boolean;
  chunkSize?: number;
}

export interface FakeFetch {
  fetchImpl: typeof fetch;
  /** Byte ranges requested so far, as `[start]` offsets. */
  requestedOffsets: number[];
}

export const createFakeMediaFetch = (
  bytes: Uint8Array,
  options: FakeFetchOptions = {}
): FakeFetch => {
  const { ignoreRange = false, chunkSize = 8 } = options;
  const requestedOffsets: number[] = [];

  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const rangeHeader = (init?.headers as Record<string, string> | undefined)
      ?.Range;
    const start =
      !ignoreRange && rangeHeader
        ? Number.parseInt(rangeHeader.replace("bytes=", ""), 10)
        : 0;
    requestedOffsets.push(start);

    const payload = bytes.subarray(start);
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= payload.length) {
          controller.close();
          return;
        }
        controller.enqueue(payload.subarray(offset, offset + chunkSize));
        offset += chunkSize;
      },
    });

    const headers = new Headers({ "Content-Length": String(payload.length) });
    const ranged = Boolean(rangeHeader) && !ignoreRange;
    if (ranged) {
      headers.set(
        "Content-Range",
        `bytes ${start}-${bytes.length - 1}/${bytes.length}`
      );
    }

    return {
      ok: true,
      status: ranged ? 206 : 200,
      headers,
      body,
    } as unknown as Response;
  }) as typeof fetch;

  return { fetchImpl, requestedOffsets };
};

// --------------------------------------------------------------- byte helpers

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const u8 = (...values: number[]): Uint8Array => Uint8Array.from(values);

const u16 = (value: number): Uint8Array => u8((value >> 8) & 0xff, value & 0xff);

const u32 = (value: number): Uint8Array =>
  u8(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  );

const ascii = (text: string): Uint8Array =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

const zeros = (count: number): Uint8Array => new Uint8Array(count);

// ------------------------------------------------------------------- MP4

const mp4Box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const content = concat(payload);
  return concat([u32(content.length + 8), ascii(type), content]);
};

export const AVC_C = u8(0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x04);

export interface SyntheticMp4Options {
  /** Place `moov` after `mdat`, the way ffmpeg writes without +faststart. */
  moovLast?: boolean;
  sampleSizes?: number[];
}

/**
 * A single-video-track MP4 whose samples are filled with their own index, so a
 * demuxer's byte offsets can be checked against the payload it returns.
 */
export const buildSyntheticMp4 = (
  options: SyntheticMp4Options = {}
): { bytes: Uint8Array; sampleSizes: number[] } => {
  const { moovLast = false, sampleSizes = [4, 5, 6] } = options;
  const timescale = 1000;
  const sampleDelta = 100;

  const sampleData = concat(
    sampleSizes.map((size, index) => new Uint8Array(size).fill(index + 1))
  );
  const ftyp = mp4Box("ftyp", ascii("isom"), u32(512), ascii("isomiso2"));
  const mdat = mp4Box("mdat", sampleData);

  // The chunk offset is only known once the layout is fixed.
  const mdatDataOffset = moovLast
    ? ftyp.length + 8
    : 0; // patched below for the moov-first layout

  const buildMoov = (chunkOffset: number): Uint8Array => {
    const avc1 = mp4Box(
      "avc1",
      zeros(6),
      u16(1), // data_reference_index
      zeros(16),
      u16(320), // width
      u16(180), // height
      u32(0x00480000),
      u32(0x00480000),
      u32(0),
      u16(1),
      zeros(32),
      u16(24),
      u16(0xffff),
      mp4Box("avcC", AVC_C)
    );

    const stbl = mp4Box(
      "stbl",
      mp4Box("stsd", u32(0), u32(1), avc1),
      mp4Box("stts", u32(0), u32(1), u32(sampleSizes.length), u32(sampleDelta)),
      mp4Box("stsc", u32(0), u32(1), u32(1), u32(sampleSizes.length), u32(1)),
      mp4Box(
        "stsz",
        u32(0),
        u32(0),
        u32(sampleSizes.length),
        ...sampleSizes.map((size) => u32(size))
      ),
      mp4Box("stco", u32(0), u32(1), u32(chunkOffset)),
      mp4Box("stss", u32(0), u32(1), u32(1))
    );

    return mp4Box(
      "moov",
      mp4Box(
        "mvhd",
        u32(0),
        u32(0),
        u32(0),
        u32(timescale),
        u32(sampleDelta * sampleSizes.length),
        zeros(80)
      ),
      mp4Box(
        "trak",
        mp4Box("tkhd", u32(0), zeros(80)),
        mp4Box(
          "mdia",
          mp4Box("mdhd", u32(0), u32(0), u32(0), u32(timescale), u32(300), u32(0)),
          mp4Box("hdlr", u32(0), u32(0), ascii("vide"), zeros(12), u8(0)),
          mp4Box("minf", stbl)
        )
      )
    );
  };

  if (moovLast) {
    return {
      bytes: concat([ftyp, mdat, buildMoov(mdatDataOffset)]),
      sampleSizes,
    };
  }

  // Two passes: the moov size determines where mdat lands.
  const provisional = buildMoov(0);
  const chunkOffset = ftyp.length + provisional.length + 8;
  return {
    bytes: concat([ftyp, buildMoov(chunkOffset), mdat]),
    sampleSizes,
  };
};

// ------------------------------------------------------------------ WebM

const ebmlSize = (size: number): Uint8Array => {
  if (size < 0x7f) return u8(0x80 | size);
  if (size < 0x3fff) return u8(0x40 | (size >> 8), size & 0xff);
  return u8(0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff);
};

const ebml = (id: number[], ...payload: Uint8Array[]): Uint8Array => {
  const content = concat(payload);
  return concat([u8(...id), ebmlSize(content.length), content]);
};

const ebmlUint = (value: number): Uint8Array => {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return u8(...bytes);
};

const ebmlFloat = (value: number): Uint8Array => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value);
  return new Uint8Array(buffer);
};

export interface SyntheticBlock {
  track: number;
  /** Milliseconds relative to the cluster. */
  relativeTime: number;
  key: boolean;
  payload: number[];
}

/** A two-track (VP9 + Opus) WebM with a single cluster. */
export const buildSyntheticWebm = (blocks: SyntheticBlock[]): Uint8Array => {
  const simpleBlock = (block: SyntheticBlock): Uint8Array =>
    ebml(
      [0xa3],
      u8(0x80 | block.track),
      u16(block.relativeTime),
      u8(block.key ? 0x80 : 0x00),
      u8(...block.payload)
    );

  return concat([
    ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x86], ebmlUint(1))),
    ebml(
      [0x18, 0x53, 0x80, 0x67],
      ebml(
        [0x15, 0x49, 0xa9, 0x66],
        ebml([0x2a, 0xd7, 0xb1], ebmlUint(1_000_000)),
        ebml([0x44, 0x89], ebmlFloat(2500))
      ),
      ebml(
        [0x16, 0x54, 0xae, 0x6b],
        ebml(
          [0xae],
          ebml([0xd7], ebmlUint(1)),
          ebml([0x83], ebmlUint(1)),
          ebml([0x86], ascii("V_VP9")),
          ebml([0xe0], ebml([0xb0], ebmlUint(320)), ebml([0xba], ebmlUint(180)))
        ),
        ebml(
          [0xae],
          ebml([0xd7], ebmlUint(2)),
          ebml([0x83], ebmlUint(2)),
          ebml([0x86], ascii("A_OPUS")),
          ebml([0x63, 0xa2], ascii("OpusHead")),
          ebml(
            [0xe1],
            ebml([0xb5], ebmlFloat(48000)),
            ebml([0x9f], ebmlUint(2))
          )
        )
      ),
      ebml(
        [0x1f, 0x43, 0xb6, 0x75],
        ebml([0xe7], ebmlUint(1000)),
        ...blocks.map(simpleBlock)
      )
    ),
  ]);
};
