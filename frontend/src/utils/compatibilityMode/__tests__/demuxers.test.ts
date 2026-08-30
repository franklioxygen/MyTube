import { describe, expect, it } from "vitest";
import { createDemuxer, sniffContainer } from "../createDemuxer";
import { DemuxedPacket } from "../types";
import {
  AVC_C,
  buildSyntheticMp4,
  buildSyntheticWebm,
  createFakeMediaFetch,
} from "./fakeMediaFetch";

const drain = async (
  bytes: Uint8Array
): Promise<{
  demuxer: Awaited<ReturnType<typeof createDemuxer>>;
  packets: DemuxedPacket[];
}> => {
  const { fetchImpl } = createFakeMediaFetch(bytes);
  const demuxer = await createDemuxer("https://example.test/media", {
    fetchImpl,
  });

  const packets: DemuxedPacket[] = [];
  for (;;) {
    const packet = await demuxer.next();
    if (!packet) break;
    packets.push(packet);
  }
  return { demuxer, packets };
};

describe("sniffContainer", () => {
  it("recognises the EBML and ISO-BMFF signatures", () => {
    expect(sniffContainer(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
      "webm"
    );
    expect(
      sniffContainer(
        Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])
      )
    ).toBe("mp4");
    expect(sniffContainer(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("createDemuxer", () => {
  it("rejects containers it cannot parse", async () => {
    const { fetchImpl } = createFakeMediaFetch(new Uint8Array(32));
    await expect(
      createDemuxer("https://example.test/media", { fetchImpl })
    ).rejects.toThrow(/MP4 and WebM/);
  });
});

describe("MP4 demuxing", () => {
  it("reads the sample table and returns samples in file order", async () => {
    const { bytes, sampleSizes } = buildSyntheticMp4();
    const { demuxer, packets } = await drain(bytes);

    expect(demuxer.container).toBe("mp4");
    expect(demuxer.video?.codec).toBe("avc1.42C01E");
    expect(demuxer.video?.codedWidth).toBe(320);
    expect(demuxer.video?.codedHeight).toBe(180);
    expect(demuxer.video?.description).toEqual(AVC_C);
    expect(demuxer.durationUs).toBe(300_000);

    expect(packets).toHaveLength(sampleSizes.length);
    expect(packets.map((packet) => packet.data.length)).toEqual(sampleSizes);
    // stss lists sample 1 only, so the rest must be flagged as delta samples.
    expect(packets.map((packet) => packet.key)).toEqual([true, false, false]);
    // stts delta is 100 ticks at a 1000 timescale, i.e. 100 ms per sample.
    expect(packets.map((packet) => packet.timestamp)).toEqual([
      0, 100_000, 200_000,
    ]);
    // Each synthetic sample is filled with its own 1-based index.
    expect(packets.map((packet) => packet.data[0])).toEqual([1, 2, 3]);

    await demuxer.close();
  });

  it("finds moov when it is written after mdat", async () => {
    const { bytes } = buildSyntheticMp4({ moovLast: true });
    const { demuxer, packets } = await drain(bytes);

    expect(demuxer.video?.codec).toBe("avc1.42C01E");
    expect(packets.map((packet) => packet.data[0])).toEqual([1, 2, 3]);

    await demuxer.close();
  });
});

describe("WebM demuxing", () => {
  it("reads track configs and cluster-relative timestamps", async () => {
    const bytes = buildSyntheticWebm([
      { track: 1, relativeTime: 0, key: true, payload: [0x11] },
      { track: 2, relativeTime: 0, key: true, payload: [0x21, 0x22] },
      { track: 1, relativeTime: 40, key: false, payload: [0x12] },
    ]);
    const { demuxer, packets } = await drain(bytes);

    expect(demuxer.container).toBe("webm");
    expect(demuxer.video?.codec).toBe("vp09.00.10.08");
    expect(demuxer.videoCodecFallbacks?.length).toBeGreaterThan(0);
    expect(demuxer.video?.codedWidth).toBe(320);
    expect(demuxer.audio?.codec).toBe("opus");
    expect(demuxer.audio?.numberOfChannels).toBe(2);
    expect(demuxer.audio?.sampleRate).toBe(48000);
    expect(new TextDecoder().decode(demuxer.audio?.description as Uint8Array)).toBe(
      "OpusHead"
    );
    expect(demuxer.durationUs).toBe(2_500_000);

    expect(packets.map((packet) => packet.kind)).toEqual([
      "video",
      "audio",
      "video",
    ]);
    // Cluster timestamp 1000 ms plus the block's own relative offset.
    expect(packets.map((packet) => packet.timestamp)).toEqual([
      1_000_000, 1_000_000, 1_040_000,
    ]);
    expect(packets.map((packet) => packet.key)).toEqual([true, true, false]);
    expect(Array.from(packets[1].data)).toEqual([0x21, 0x22]);

    await demuxer.close();
  });
});
