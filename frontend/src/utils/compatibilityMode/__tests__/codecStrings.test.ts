import { describe, expect, it } from "vitest";
import {
  aacCodecString,
  av1CodecString,
  avcCodecString,
  hevcCodecString,
  vp9CodecStringFromFrameHeader,
  vp9CodecStringFromVpcC,
} from "../codecStrings";

describe("codecStrings", () => {
  it("builds an AVC codec string from avcC", () => {
    // configurationVersion, High profile, no constraints, level 4.0.
    const avcC = Uint8Array.from([0x01, 0x64, 0x00, 0x28, 0xff]);
    expect(avcCodecString(avcC)).toBe("avc1.640028");
    expect(avcCodecString(avcC, "avc3")).toBe("avc3.640028");
  });

  it("falls back to the four-character code for a truncated avcC", () => {
    expect(avcCodecString(Uint8Array.from([0x01]))).toBe("avc1");
  });

  it("bit-reverses the HEVC compatibility flags and trims constraints", () => {
    const hvcC = new Uint8Array(13);
    hvcC[0] = 0x01;
    hvcC[1] = 0x01; // profile space 0, main tier, profile 1
    hvcC[2] = 0x60; // compatibility flags 0x60000000 -> 6 once reversed
    hvcC[6] = 0xb0; // first constraint byte, rest zero and therefore omitted
    hvcC[12] = 93; // level
    expect(hevcCodecString(hvcC)).toBe("hvc1.1.6.L93.B0");
  });

  it("derives AV1 profile, level, tier and bit depth from av1C", () => {
    // seq_profile 0, level 5, main tier, 8-bit.
    expect(av1CodecString(Uint8Array.from([0x81, 0x05, 0x00]))).toBe(
      "av01.0.05M.08"
    );
    // seq_profile 2, level 8, high tier, 10-bit.
    expect(av1CodecString(Uint8Array.from([0x81, 0x48, 0xc0]))).toBe(
      "av01.2.08H.10"
    );
  });

  it("reads VP9 profile, level and bit depth past the vpcC full-box header", () => {
    const vpcC = Uint8Array.from([0x01, 0, 0, 0, 0x02, 0x1f, 0xa0]);
    expect(vp9CodecStringFromVpcC(vpcC)).toBe("vp09.02.31.10");
    expect(vp9CodecStringFromVpcC(Uint8Array.from([0x01]))).toBeNull();
  });

  it("reads the VP9 profile and bit depth from a WebM keyframe", () => {
    // Profile 1: frame marker 2, profile bits 1/0, keyframe, show frame,
    // followed by the VP9 sync code. Profiles below 2 are always 8-bit.
    expect(
      vp9CodecStringFromFrameHeader(
        Uint8Array.from([0xa2, 0x49, 0x83, 0x42, 0x00])
      )
    ).toBe("vp09.01.10.08");

    // Profile 2 with the high-bit-depth flag clear is 10-bit.
    expect(
      vp9CodecStringFromFrameHeader(
        Uint8Array.from([0x92, 0x49, 0x83, 0x42, 0x00])
      )
    ).toBe("vp09.02.10.10");
  });

  it("reads the AAC object type, defaulting to LC", () => {
    // AudioSpecificConfig: audioObjectType 2 (AAC LC), 48 kHz, stereo.
    expect(aacCodecString(Uint8Array.from([0x11, 0x90]))).toBe("mp4a.40.2");
    // audioObjectType 5 (HE-AAC).
    expect(aacCodecString(Uint8Array.from([0x2b, 0x11]))).toBe("mp4a.40.5");
    expect(aacCodecString(null)).toBe("mp4a.40.2");
  });
});
