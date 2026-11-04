import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), stat: vi.fn() }));
vi.mock("../../utils/security", async original => ({ ...await original<typeof import("../../utils/security")>(), execFileSafe: mocks.exec, statSafeSync: mocks.stat }));
import { captureDownloadMediaInfo, parseMediaInfo, parseStoredMediaInfo } from "../../services/mediaInfoService";
import type { Video } from "../../services/storageService/types";

const probe = (codec = "h264") => JSON.stringify({ streams: [
  { codec_type: "video", codec_name: codec, width: 1920, height: 1080 },
  { codec_type: "audio", codec_name: "aac" },
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", bit_rate: "2500000" } });
const video = (): Video => ({ id: "v1", title: "Media", sourceUrl: "https://example.test/video", createdAt: "now", videoPath: "/videos/file.mp4" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.stat.mockReturnValue({ size: 1048576, ino: 1, mtimeMs: 1, isFile: () => true });
  mocks.exec.mockResolvedValue({ stdout: probe() });
});

describe("published media snapshots", () => {
  it.each(["h264", "hevc", "av1", "future_codec"])("records %s independently from the file extension", async codec => {
    mocks.exec.mockResolvedValue({ stdout: probe(codec) });
    const original = video();
    const result = await captureDownloadMediaInfo(original, { sourceCollectionType: "playlist", sourceCollectionName: "Source list" });
    expect(result.downloadMediaInfo).toMatchObject({ state: "measured", videoCodec: codec, audioCodec: "aac", width: 1920, height: 1080, sizeBytes: "1048576", bitrateBps: 2500000, sourceCollectionName: "Source list" });
    expect(original.downloadMediaInfo).toBeUndefined();
    expect(mocks.exec).toHaveBeenCalledWith("ffprobe", expect.arrayContaining(["-of", "json"]), { timeout: 10000 });
  });
  it("handles portrait rotation and ignores album art in pure audio", () => {
    const payload = JSON.parse(probe());
    payload.streams[0].side_data_list = [{ rotation: -90 }];
    expect(parseMediaInfo(JSON.stringify(payload))).toMatchObject({ width: 1080, height: 1920 });
    payload.streams[0].disposition = { attached_pic: 1 };
    expect(parseMediaInfo(JSON.stringify(payload))).toMatchObject({ width: undefined, height: undefined, videoCodec: undefined, audioCodec: "aac" });
    expect(parseMediaInfo(probe(), true).videoCodec).toBeUndefined();
  });
  it("keeps each attempt's snapshot separate when the same video is re-downloaded", async () => {
    const first = await captureDownloadMediaInfo(video());
    mocks.exec.mockResolvedValue({ stdout: probe("hevc") });
    const second = await captureDownloadMediaInfo(video());
    expect(first.downloadMediaInfo?.videoCodec).toBe("h264");
    expect(second.downloadMediaInfo?.videoCodec).toBe("hevc");
  });
  it("does not fail the download when FFprobe fails, and keeps the measured file size", async () => {
    mocks.exec.mockRejectedValue(new Error("ffprobe unavailable"));
    const result = await captureDownloadMediaInfo(video());
    expect(result.downloadMediaInfo).toMatchObject({ state: "unavailable", sizeBytes: "1048576" });
    expect(result.downloadMediaInfo?.videoCodec).toBeUndefined();
  });
  it("rejects metadata from a file that changed while it was being probed", async () => {
    mocks.stat.mockReturnValueOnce({ size: 100, ino: 1, mtimeMs: 1, isFile: () => true })
      .mockReturnValueOnce({ size: 100, ino: 1, mtimeMs: 1, isFile: () => true })
      .mockReturnValueOnce({ size: 200, ino: 2, mtimeMs: 2, isFile: () => true });
    const result = await captureDownloadMediaInfo(video());
    expect(result.downloadMediaInfo?.state).toBe("unavailable");
    expect(result.downloadMediaInfo?.sizeBytes).toBeUndefined();
    expect(result.downloadMediaInfo?.videoCodec).toBeUndefined();
  });
  it("never probes arbitrary remote or traversing paths", async () => {
    for (const videoPath of ["https://example.test/private.mp4", "/videos/../../outside.mp4"]) {
      const result = await captureDownloadMediaInfo({ ...video(), videoPath });
      expect(result.downloadMediaInfo?.state).toBe("unavailable");
    }
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
  });
  it("limits simultaneous probes to two", async () => {
    const releases: Array<() => void> = [];
    mocks.exec.mockImplementation(() => new Promise(resolve => releases.push(() => resolve({ stdout: probe() }))));
    const jobs = [captureDownloadMediaInfo(video()), captureDownloadMediaInfo(video()), captureDownloadMediaInfo(video())];
    await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(2));
    releases[0]();
    await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(3));
    releases[1](); releases[2]();
    expect((await Promise.all(jobs)).every(result => result.downloadMediaInfo?.state === "measured")).toBe(true);
  });
  it("does not label an author's folder as a source playlist", async () => {
    const result = await captureDownloadMediaInfo(video(), { sourceCollectionType: "channel", sourceCollectionName: "Author folder" });
    expect(result.downloadMediaInfo?.sourceCollectionName).toBeUndefined();
  });
  it("keeps malformed legacy snapshots readable and drops invalid field types", () => {
    expect(parseStoredMediaInfo("{broken")).toBeUndefined();
    expect(parseStoredMediaInfo(undefined)).toBeUndefined();
    expect(parseStoredMediaInfo(JSON.stringify({ version: 1, state: "measured", capturedAt: 1, width: -1, videoCodec: 42 }))).toMatchObject({ width: undefined, videoCodec: undefined });
  });
});
