import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generation: 0, revision: "r1", mode: "nfo" as string,
  library: [] as Array<{ id: string; title: string }>,
  read: vi.fn(), sync: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock("../../db", () => ({ getDatabaseGeneration: () => mocks.generation }));
vi.mock("../../services/storageService/settings", () => ({ getSettings: () => ({ mediaServerExportMode: mocks.mode }) }));
vi.mock("../../services/storageService/videoListRevision", () => ({ getVideosListETag: () => mocks.revision }));
vi.mock("../../services/storageService/videos", () => ({ getVideosForExport: mocks.read }));
vi.mock("../../services/mediaServerExport/syncService", () => ({ syncMediaServerArtifactsForRecord: mocks.sync }));
vi.mock("../../utils/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

let queue: typeof import("../../services/mediaServerExport/bulkArtifactRefresh").queueBulkArtifactRefresh;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.generation = 0; mocks.revision = "r1"; mocks.mode = "nfo";
  mocks.library = Array.from({ length: 25 }, (_, i) => ({ id: `v${i}`, title: "latest" }));
  mocks.read.mockImplementation((ids?: string[]) => ids
    ? mocks.library.filter((video) => ids.includes(video.id)) : mocks.library);
  ({ queueBulkArtifactRefresh: queue } = await import("../../services/mediaServerExport/bulkArtifactRefresh"));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("post-commit derived artifact queue", () => {
  it("deduplicates IDs, yields after ten videos, and never scans the library for ordinary videos", () => {
    const ids = mocks.library.map((video) => video.id);
    queue(ids); queue(ids);
    expect(mocks.sync).not.toHaveBeenCalled();
    vi.advanceTimersToNextTimer();
    expect(mocks.sync).toHaveBeenCalledTimes(10);
    vi.runAllTimers();
    expect(mocks.sync).toHaveBeenCalledTimes(25);
    expect(mocks.read.mock.calls.map(([chunk]) => chunk.length)).toEqual([10, 10, 5]);
  });
  it("lazily shares a TV library snapshot and refreshes it after another edit", () => {
    const snapshots: unknown[] = [];
    mocks.sync.mockImplementation((_video, options) => snapshots.push(options.loadLibraryVideos()));
    queue(mocks.library.map((video) => video.id));
    vi.advanceTimersToNextTimer();
    expect(mocks.read.mock.calls.filter((args) => args.length === 0)).toHaveLength(1);
    mocks.revision = "r2";
    mocks.library = [{ id: "v10", title: "edited" }, { id: "v20", title: "edited too" }];
    vi.runAllTimers();
    expect(mocks.sync).toHaveBeenCalledTimes(12);
    expect(mocks.read.mock.calls.filter((args) => args.length === 0)).toHaveLength(2);
    expect(snapshots[0]).not.toBe(snapshots[10]);
    expect(snapshots[10]).toBe(snapshots[11]);
    expect(snapshots[10]).toEqual(mocks.library);
  });
  it("discards work after a database replacement", () => {
    queue(["v1"]); mocks.generation++;
    vi.runAllTimers();
    expect(mocks.read).not.toHaveBeenCalled();
    queue(["v2"]); vi.runAllTimers();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.sync.mock.calls[0][0].id).toBe("v2");
  });
  it("does not read videos when export is off", () => {
    mocks.mode = "off"; queue(["v1"]); vi.runAllTimers();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("bounds pending work and reports overflow without throwing", () => {
    queue(Array.from({ length: 5_001 }, (_, i) => `v${i}`));
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));
    vi.runAllTimers();
  });
  it("skips unreadable or deleted records and continues across chunks", () => {
    mocks.library = Array.from({ length: 25 }, (_, i) => ({ id: `v${i}`, title: "latest" }));
    const ids = mocks.library.map((video) => video.id);
    mocks.library = mocks.library.filter((video) => !["v0", "v9", "v10", "v24"].includes(video.id));
    queue(ids);
    vi.runAllTimers();
    expect(mocks.sync.mock.calls.map(([video]) => video.id)).toEqual(mocks.library.map((video) => video.id));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("logs a failed database read and recovers on a later batch without a revision change", () => {
    const failure = new Error("database read failure");
    mocks.read.mockImplementationOnce(() => { throw failure; });
    queue(["v1"]);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Bulk media artifact refresh failed", failure);
    expect(mocks.sync).not.toHaveBeenCalled();
    queue(["v1"]); vi.runAllTimers();
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
});
