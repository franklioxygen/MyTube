import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Video } from "../../../services/storageService";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  syncPlaylistTvForVideo: vi.fn(),
  syncPlaylistTvForCollection: vi.fn(),
  removePlaylistTvArtifactsForVideo: vi.fn(),
  parkPendingRawSourceInfo: vi.fn(),
  planMediaServerExportPaths: vi.fn(),
}));

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("../../../services/mediaServerExport/playlistTvSync", () => ({
  syncPlaylistTvForVideo: mocks.syncPlaylistTvForVideo,
  syncPlaylistTvForCollection: mocks.syncPlaylistTvForCollection,
  removePlaylistTvArtifactsForVideo: mocks.removePlaylistTvArtifactsForVideo,
  parkPendingRawSourceInfo: mocks.parkPendingRawSourceInfo,
}));

vi.mock("../../../services/mediaServerExport/pathPlanner", () => ({
  planMediaServerExportPaths: mocks.planMediaServerExportPaths,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  getMediaServerCopyFallback,
  getMediaServerExportLayout,
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForCollection,
  syncMediaServerArtifactsForRecord,
  syncMediaServerShowArtifactsForRecord,
} from "../../../services/mediaServerExport/syncService";

const VIDEO = {
  id: "video-1",
  title: "Ants",
  videoPath: "/videos/Kurzgesagt/ants.mp4",
} as unknown as Video;

describe("mediaServerExport layout dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue({
      mediaServerExportMode: "nfo",
      mediaServerExportLayout: "playlist_tv",
    });
  });

  it("defaults to adjacent for an absent or unrecognized layout", () => {
    mocks.getSettings.mockReturnValue({});
    expect(getMediaServerExportLayout()).toBe("adjacent");

    mocks.getSettings.mockReturnValue({ mediaServerExportLayout: "bogus" });
    expect(getMediaServerExportLayout()).toBe("adjacent");
  });

  it("treats copy fallback as enabled unless explicitly disabled", () => {
    mocks.getSettings.mockReturnValue({});
    expect(getMediaServerCopyFallback()).toBe(true);

    mocks.getSettings.mockReturnValue({ mediaServerCopyFallback: false });
    expect(getMediaServerCopyFallback()).toBe(false);
  });

  it("routes a record sync to the managed mirror in playlist_tv", () => {
    syncMediaServerArtifactsForRecord(VIDEO, { rawSourceInfo: { channel: "K" } });

    expect(mocks.syncPlaylistTvForVideo).toHaveBeenCalledWith(VIDEO, {
      mode: "nfo",
      copyFallback: true,
      rawSourceInfo: { channel: "K" },
    });
    expect(mocks.planMediaServerExportPaths).not.toHaveBeenCalled();
  });

  it("defers the export when a collection link is about to commit", () => {
    syncMediaServerArtifactsForRecord(VIDEO, { pendingCollectionLink: true });
    expect(mocks.syncPlaylistTvForVideo).not.toHaveBeenCalled();
  });

  it("parks the raw extractor object for the deferred collection hook", () => {
    const rawSourceInfo = { extractor: "youtube", chapters: [] };
    syncMediaServerArtifactsForRecord(VIDEO, {
      pendingCollectionLink: true,
      rawSourceInfo,
    });

    // Without this the deferred path is the only one that drops the raw
    // object, so every fresh playlist download would write a synthesized-only
    // .info.json while the adjacent layout preserved the extractor fields.
    expect(mocks.parkPendingRawSourceInfo).toHaveBeenCalledWith(
      VIDEO.id,
      rawSourceInfo
    );
  });

  it("does nothing at all when the export mode is off", () => {
    mocks.getSettings.mockReturnValue({
      mediaServerExportMode: "off",
      mediaServerExportLayout: "playlist_tv",
    });

    syncMediaServerArtifactsForRecord(VIDEO);
    syncMediaServerArtifactsForCollection("col-1", "video-1");

    expect(mocks.syncPlaylistTvForVideo).not.toHaveBeenCalled();
    expect(mocks.syncPlaylistTvForCollection).not.toHaveBeenCalled();
  });

  it("leaves show artifacts to the mirror in playlist_tv", () => {
    syncMediaServerShowArtifactsForRecord(VIDEO);
    expect(mocks.planMediaServerExportPaths).not.toHaveBeenCalled();
  });

  it("retires assignments only when the video row is actually going away", () => {
    // A redownload, a batch rename and a file move all remove-then-resync a
    // video that still exists. Retiring there would tombstone the episode
    // number and force the resync to allocate a new one, renumbering the
    // episode on every routine refresh.
    removeMediaServerArtifactsForVideo(VIDEO, { preserveSharedArtifacts: true });
    expect(mocks.removePlaylistTvArtifactsForVideo).not.toHaveBeenCalled();

    removeMediaServerArtifactsForVideo(VIDEO, { videoDeleted: true });
    expect(mocks.removePlaylistTvArtifactsForVideo).toHaveBeenCalledWith(
      VIDEO.id,
      // A surviving show is replanned, so the removal is handed the mode and
      // copy policy it needs to re-materialize.
      { mode: "nfo", copyFallback: true }
    );
  });

  it("removes mirror artifacts by video id in playlist_tv", () => {
    removeMediaServerArtifactsForVideo(VIDEO, { videoDeleted: true });
    expect(mocks.removePlaylistTvArtifactsForVideo).toHaveBeenCalledWith(
      "video-1",
      { mode: "nfo", copyFallback: true }
    );
    expect(mocks.planMediaServerExportPaths).not.toHaveBeenCalled();
  });

  it("honours an explicit adjacent override even while playlist_tv is saved", () => {
    mocks.planMediaServerExportPaths.mockReturnValue(null);

    removeMediaServerArtifactsForVideo(VIDEO, { layoutOverride: "adjacent" });

    expect(mocks.removePlaylistTvArtifactsForVideo).not.toHaveBeenCalled();
    expect(mocks.planMediaServerExportPaths).toHaveBeenCalledWith(VIDEO);
  });

  it("reconciles a collection mutation only in playlist_tv", () => {
    syncMediaServerArtifactsForCollection("col-1", "video-1");
    expect(mocks.syncPlaylistTvForCollection).toHaveBeenCalledWith("col-1", {
      mode: "nfo",
      copyFallback: true,
      videoId: "video-1",
    });

    mocks.getSettings.mockReturnValue({
      mediaServerExportMode: "nfo",
      mediaServerExportLayout: "adjacent",
    });
    mocks.syncPlaylistTvForCollection.mockClear();
    syncMediaServerArtifactsForCollection("col-1", "video-1");
    expect(mocks.syncPlaylistTvForCollection).not.toHaveBeenCalled();
  });

  it("never lets a mirror failure escape into the caller's operation", () => {
    mocks.syncPlaylistTvForVideo.mockImplementation(() => {
      throw new Error("mirror exploded");
    });
    mocks.syncPlaylistTvForCollection.mockImplementation(() => {
      throw new Error("mirror exploded");
    });

    expect(() => syncMediaServerArtifactsForRecord(VIDEO)).not.toThrow();
    expect(() =>
      syncMediaServerArtifactsForCollection("col-1", "video-1")
    ).not.toThrow();
  });
});
