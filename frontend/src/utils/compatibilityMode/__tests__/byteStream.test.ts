import { describe, expect, it } from "vitest";
import { ByteStream } from "../byteStream";
import { createFakeMediaFetch } from "./fakeMediaFetch";

const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);

const openStream = (options?: { ignoreRange?: boolean }) => {
  const fake = createFakeMediaFetch(bytes, options);
  return {
    fake,
    stream: new ByteStream("https://example.test/media", {
      fetchImpl: fake.fetchImpl,
    }),
  };
};

describe("ByteStream", () => {
  it("reads sequentially and reports the total size", async () => {
    const { stream } = openStream();

    expect(await stream.ensure(4)).toBe(true);
    expect(Array.from(stream.read(4))).toEqual([0, 1, 2, 3]);
    expect(stream.position).toBe(4);
    expect(stream.totalSize).toBe(64);

    expect(Array.from(await stream.require(2))).toEqual([4, 5]);
  });

  it("reports end of stream instead of over-reading", async () => {
    const { stream } = openStream();

    await stream.seek(60);
    expect(await stream.ensure(8)).toBe(false);
    await expect(stream.require(8)).rejects.toThrow(/Unexpected end of media/);
  });

  it("serves a short forward seek from the open connection", async () => {
    const { fake, stream } = openStream();

    await stream.require(1);
    await stream.seek(20);
    expect(Array.from(await stream.require(2))).toEqual([20, 21]);
    expect(fake.requestedOffsets).toEqual([0]);
  });

  it("reopens with a Range request when seeking backwards", async () => {
    const { fake, stream } = openStream();

    await stream.seek(40);
    expect(Array.from(await stream.require(2))).toEqual([40, 41]);
    await stream.seek(8);
    expect(Array.from(await stream.require(2))).toEqual([8, 9]);

    expect(fake.requestedOffsets).toEqual([40, 8]);
  });

  it("skips the prefix itself when the server ignores Range", async () => {
    const { fake, stream } = openStream({ ignoreRange: true });

    await stream.seek(40);
    expect(Array.from(await stream.require(3))).toEqual([40, 41, 42]);
    expect(fake.requestedOffsets).toEqual([0]);
  });

  it("returns copies so later reads cannot mutate earlier ones", async () => {
    const { stream } = openStream();

    const first = await stream.require(4);
    await stream.require(4);
    expect(Array.from(first)).toEqual([0, 1, 2, 3]);
  });
});
