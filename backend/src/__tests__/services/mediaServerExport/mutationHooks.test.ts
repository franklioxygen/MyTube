import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvForVideoMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvForCollectionMock = vi.hoisted(() => vi.fn());
const removePlaylistTvArtifactsForVideoMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: getSettingsMock,
}));

vi.mock("../../../services/mediaServerExport/playlistTvSync", () => ({
  syncPlaylistTvForVideo: syncPlaylistTvForVideoMock,
  syncPlaylistTvForCollection: syncPlaylistTvForCollectionMock,
  removePlaylistTvArtifactsForVideo: removePlaylistTvArtifactsForVideoMock,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  onCollectionLinkCommitted,
  onCollectionMetadataCommitted,
  onCollectionUnlinkCommitted,
  onVideoDeletePending,
} from "../../../services/mediaServerExport/mutationHooks";

/**
 * Issue #411 §9. These hooks run after the triggering mutation commits and must
 * never fail the user's actual operation.
 */
describe("mediaServerExport mutationHooks", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    syncPlaylistTvForVideoMock.mockReset();
    syncPlaylistTvForCollectionMock.mockReset();
    removePlaylistTvArtifactsForVideoMock.mockReset();
    removePlaylistTvArtifactsForVideoMock.mockReturnValue({
      removedArtifacts: 0,
      failures: [],
    });
  });

  function usePlaylistTv(overrides: Record<string, unknown> = {}): void {
    getSettingsMock.mockReturnValue({
      mediaServerExportMode: "nfo",
      mediaServerExportLayout: "playlist_tv",
      ...overrides,
    });
  }

  describe("layout gating", () => {
    it("does nothing in adjacent layout", () => {
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "nfo",
        mediaServerExportLayout: "adjacent",
      });

      onCollectionLinkCommitted("c1", "v1");
      onCollectionUnlinkCommitted("c1", "v1");
      onCollectionMetadataCommitted("c1");

      expect(syncPlaylistTvForVideoMock).not.toHaveBeenCalled();
      expect(syncPlaylistTvForCollectionMock).not.toHaveBeenCalled();
    });

    it("does nothing when the layout setting is absent", () => {
      getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo" });

      onCollectionLinkCommitted("c1", "v1");

      expect(syncPlaylistTvForVideoMock).not.toHaveBeenCalled();
    });

    it("does nothing when the export mode is off", () => {
      usePlaylistTv({ mediaServerExportMode: "off" });

      onCollectionLinkCommitted("c1", "v1");
      onCollectionMetadataCommitted("c1");

      expect(syncPlaylistTvForVideoMock).not.toHaveBeenCalled();
      expect(syncPlaylistTvForCollectionMock).not.toHaveBeenCalled();
    });
  });

  describe("collection hooks", () => {
    it("reconciles the linked video", () => {
      usePlaylistTv();

      onCollectionLinkCommitted("c1", "v1");

      expect(syncPlaylistTvForVideoMock).toHaveBeenCalledWith("v1", {
        mode: "nfo",
        copyFallbackEnabled: true,
      });
    });

    it("reconciles the unlinked video", () => {
      usePlaylistTv();

      onCollectionUnlinkCommitted("c1", "v1");

      expect(syncPlaylistTvForVideoMock).toHaveBeenCalledWith("v1", {
        mode: "nfo",
        copyFallbackEnabled: true,
      });
    });

    it("reconciles the collection on a metadata change", () => {
      usePlaylistTv({ mediaServerExportMode: "nfo_and_source_json" });

      onCollectionMetadataCommitted("c1");

      expect(syncPlaylistTvForCollectionMock).toHaveBeenCalledWith("c1", {
        mode: "nfo_and_source_json",
        copyFallbackEnabled: true,
      });
    });

    it("passes the copy fallback setting through", () => {
      usePlaylistTv({ mediaServerCopyFallback: false });

      onCollectionLinkCommitted("c1", "v1");

      expect(syncPlaylistTvForVideoMock).toHaveBeenCalledWith("v1", {
        mode: "nfo",
        copyFallbackEnabled: false,
      });
    });

    it("never lets a mirror failure escape into the caller's operation", () => {
      usePlaylistTv();
      syncPlaylistTvForVideoMock.mockImplementation(() => {
        throw new Error("mirror exploded");
      });

      expect(() => onCollectionLinkCommitted("c1", "v1")).not.toThrow();
    });
  });

  describe("video deletion", () => {
    it("cleans the mirror before the row is deleted", () => {
      usePlaylistTv();

      onVideoDeletePending("v1");

      expect(removePlaylistTvArtifactsForVideoMock).toHaveBeenCalledWith("v1");
    });

    it("still cleans when the export mode has since been turned off", () => {
      // The artifacts were generated while the mode was on; this is the last
      // moment at which they can still be identified.
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "off",
        mediaServerExportLayout: "playlist_tv",
      });

      onVideoDeletePending("v1");

      expect(removePlaylistTvArtifactsForVideoMock).toHaveBeenCalledWith("v1");
    });

    it("does nothing in adjacent layout", () => {
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "nfo",
        mediaServerExportLayout: "adjacent",
      });

      onVideoDeletePending("v1");

      expect(removePlaylistTvArtifactsForVideoMock).not.toHaveBeenCalled();
    });

    it("never lets a cleanup failure block the deletion", () => {
      usePlaylistTv();
      removePlaylistTvArtifactsForVideoMock.mockImplementation(() => {
        throw new Error("cleanup exploded");
      });

      expect(() => onVideoDeletePending("v1")).not.toThrow();
    });
  });
});
