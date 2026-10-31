import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generation: 0, revision: "r1", mode: "nfo" as string,
  getVideos: vi.fn(), getVideosStrict: vi.fn(), sync: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock("../../db", () => ({ getDatabaseGeneration: () => mocks.generation }));
vi.mock("../../services/storageService/settings", () => ({ getSettings: () => ({ mediaServerExportMode: mocks.mode }) }));
vi.mock("../../services/storageService/videoListRevision", () => ({ getVideosListETag: () => mocks.revision }));
vi.mock("../../services/storageService/videos", () => ({
  getVideos: mocks.getVideos, getVideosStrict: mocks.getVideosStrict,
}));
vi.mock("../../services/mediaServerExport/syncService", () => ({ syncMediaServerArtifactsForRecord: mocks.sync }));
vi.mock("../../utils/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

let queue: typeof import("../../services/mediaServerExport/bulkArtifactRefresh").queueBulkArtifactRefresh;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.generation = 0; mocks.revision = "r1"; mocks.mode = "nfo";
  mocks.getVideos.mockReturnValue([]);
  mocks.getVideosStrict.mockReturnValue(Array.from({ length: 25 }, (_, i) => ({ id: `v${i}`, title: "latest" })));
  ({ queueBulkArtifactRefresh: queue } = await import("../../services/mediaServerExport/bulkArtifactRefresh"));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("post-commit derived artifact queue", () => {
  it("defers work, deduplicates IDs, and yields after ten videos without reloading an unchanged library", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `v${i}`);
    queue(ids); queue(ids);
    expect(mocks.sync).not.toHaveBeenCalled();
    vi.advanceTimersToNextTimer();
    expect(mocks.sync).toHaveBeenCalledTimes(10);
    vi.runAllTimers();
    expect(mocks.sync).toHaveBeenCalledTimes(25);
    expect(mocks.getVideosStrict).toHaveBeenCalledOnce();
  });
  it("refreshes the shared snapshot after another edit and skips deleted videos", () => {
    queue(Array.from({ length: 12 }, (_, i) => `v${i}`));
    vi.advanceTimersToNextTimer();
    mocks.revision = "r2";
    mocks.getVideosStrict.mockReturnValue([{ id: "v10", title: "edited" }]);
    vi.runAllTimers();
    expect(mocks.getVideosStrict).toHaveBeenCalledTimes(2);
    expect(mocks.sync).toHaveBeenCalledTimes(11);
    expect(mocks.sync).toHaveBeenLastCalledWith(
      { id: "v10", title: "edited" }, { libraryVideos: [{ id: "v10", title: "edited" }] },
    );
  });
  it("discards work after a database replacement", () => {
    queue(["v1"]); mocks.generation++;
    vi.runAllTimers();
    expect(mocks.getVideosStrict).not.toHaveBeenCalled();
    queue(["v2"]); vi.runAllTimers();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.sync.mock.calls[0][0].id).toBe("v2");
  });
  it("does not scan the library when export is off", () => {
    mocks.mode = "off"; queue(["v1"]); vi.runAllTimers();
    expect(mocks.getVideosStrict).not.toHaveBeenCalled();
  });
  it("bounds pending work and reports overflow without throwing", () => {
    queue(Array.from({ length: 5_001 }, (_, i) => `v${i}`));
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));
    vi.runAllTimers();
  });
  it("logs derived export failures without propagating them", () => {
    mocks.sync.mockImplementationOnce(() => { throw new Error("disk failure"); });
    queue(["v1"]);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(mocks.error).toHaveBeenCalled();
  });
  it("logs a failed library read and recovers on a later batch without a revision change", () => {
    const failure = new Error("library read failure");
    mocks.getVideosStrict.mockImplementationOnce(() => { throw failure; });
    queue(["v1"]);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(mocks.getVideosStrict).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Bulk media artifact refresh failed", failure);
    expect(mocks.sync).not.toHaveBeenCalled();

    queue(["v1"]);
    vi.runAllTimers();
    expect(mocks.getVideosStrict).toHaveBeenCalledTimes(2);
    expect(mocks.getVideos).not.toHaveBeenCalled();
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(
      { id: "v1", title: "latest" }, { libraryVideos: mocks.getVideosStrict.mock.results[1].value },
    );
  });
});
