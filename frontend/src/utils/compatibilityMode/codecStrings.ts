/**
 * Codec-string builders for WebCodecs configurations.
 *
 * `VideoDecoder.configure()` wants an RFC 6381 codec string plus, for most
 * codecs, the raw decoder-configuration record from the container. These
 * helpers turn the container's sample-description bytes into that string so
 * compatibility mode can configure a decoder without a `<video>` element
 * doing the negotiation for us.
 */

const hex2 = (value: number): string =>
  value.toString(16).padStart(2, "0").toUpperCase();

const dec2 = (value: number): string => value.toString().padStart(2, "0");

/** `avcC` -> e.g. `avc1.640028`. */
export function avcCodecString(avcC: Uint8Array, fourCC = "avc1"): string {
  if (avcC.length < 4) {
    return fourCC;
  }
  return `${fourCC}.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`;
}

/** `hvcC` -> e.g. `hvc1.1.6.L93.B0`. */
export function hevcCodecString(hvcC: Uint8Array, fourCC = "hvc1"): string {
  if (hvcC.length < 13) {
    return fourCC;
  }

  const profileSpace = (hvcC[1] >> 6) & 0x03;
  const tierFlag = (hvcC[1] >> 5) & 0x01;
  const profileIdc = hvcC[1] & 0x1f;

  // The compatibility flags are written most-significant-bit first but the
  // codec string carries them bit-reversed, per ISO/IEC 14496-15 Annex E.
  let compatibility = 0;
  for (let i = 0; i < 32; i += 1) {
    const bit = (hvcC[2 + (i >> 3)] >> (7 - (i & 7))) & 1;
    compatibility = (compatibility | (bit << i)) >>> 0;
  }

  const parts = [
    fourCC,
    `${["", "A", "B", "C"][profileSpace]}${profileIdc}`,
    compatibility.toString(16),
    `${tierFlag ? "H" : "L"}${hvcC[12]}`,
  ];

  // Trailing all-zero constraint bytes are omitted.
  const constraints = Array.from(hvcC.subarray(6, 12));
  while (constraints.length > 0 && constraints[constraints.length - 1] === 0) {
    constraints.pop();
  }
  parts.push(...constraints.map((byte) => byte.toString(16).toUpperCase()));

  return parts.join(".");
}

/** `av1C` -> e.g. `av01.0.05M.08`. */
export function av1CodecString(av1C: Uint8Array): string {
  if (av1C.length < 3) {
    return "av01.0.01M.08";
  }
  const profile = (av1C[1] >> 5) & 0x07;
  const level = av1C[1] & 0x1f;
  const tier = (av1C[2] >> 7) & 0x01;
  const highBitdepth = (av1C[2] >> 6) & 0x01;
  const twelveBit = (av1C[2] >> 5) & 0x01;

  let bitDepth = 8;
  if (profile === 2 && highBitdepth) {
    bitDepth = twelveBit ? 12 : 10;
  } else if (highBitdepth) {
    bitDepth = 10;
  }

  return `av01.${profile}.${dec2(level)}${tier ? "H" : "M"}.${dec2(bitDepth)}`;
}

/** `vpcC` (full box) -> e.g. `vp09.00.10.08`. */
export function vp9CodecStringFromVpcC(vpcC: Uint8Array): string | null {
  // version (1) + flags (3) precede the payload in this FullBox.
  if (vpcC.length < 7) {
    return null;
  }
  const profile = vpcC[4];
  const level = vpcC[5];
  const bitDepth = (vpcC[6] >> 4) & 0x0f;
  return `vp09.${dec2(profile)}.${dec2(level)}.${dec2(bitDepth)}`;
}

/**
 * Read the VP9 profile and bit depth from an uncompressed frame header.
 *
 * WebM does not carry the `vpcC` decoder configuration record used by MP4,
 * but every VP9 frame starts with this small clear-text header. Platform
 * support probing alone cannot choose a profile: a browser may support several
 * profiles while the encoded chunks are valid for exactly one of them.
 */
export function vp9CodecStringFromFrameHeader(
  frame: Uint8Array
): string | null {
  let bitOffset = 0;
  const readBits = (count: number): number | null => {
    if (bitOffset + count > frame.length * 8) return null;
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = frame[bitOffset >> 3];
      value = value * 2 + ((byte >> (7 - (bitOffset & 7))) & 1);
      bitOffset += 1;
    }
    return value;
  };

  if (readBits(2) !== 0b10) return null;
  const profileLow = readBits(1);
  const profileHigh = readBits(1);
  if (profileLow === null || profileHigh === null) return null;
  const profile = profileLow + profileHigh * 2;
  if (profile === 3 && readBits(1) !== 0) return null;

  // A show-existing-frame header has no color configuration. It cannot be the
  // random-access frame used to configure a new decoder, so decline to guess.
  if (readBits(1) !== 0) return null;
  const frameType = readBits(1);
  readBits(1); // show_frame
  readBits(1); // error_resilient_mode
  if (frameType !== 0) return null;

  if (readBits(24) !== 0x498342) return null;
  const bitDepth = profile >= 2 ? (readBits(1) === 1 ? 12 : 10) : 8;
  return `vp09.${dec2(profile)}.10.${dec2(bitDepth)}`;
}

/**
 * AAC object type from an `esds`/CodecPrivate DecoderSpecificInfo.
 * Defaults to AAC-LC (`mp4a.40.2`) when the record is missing or truncated.
 */
export function aacCodecString(decoderSpecificInfo: Uint8Array | null): string {
  if (!decoderSpecificInfo || decoderSpecificInfo.length === 0) {
    return "mp4a.40.2";
  }
  let objectType = (decoderSpecificInfo[0] >> 3) & 0x1f;
  if (objectType === 31 && decoderSpecificInfo.length >= 2) {
    objectType =
      32 +
      (((decoderSpecificInfo[0] & 0x07) << 3) |
        ((decoderSpecificInfo[1] >> 5) & 0x07));
  }
  return `mp4a.40.${objectType}`;
}
