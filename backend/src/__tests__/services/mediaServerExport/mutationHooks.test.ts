import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvForVideoMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvForCollectionMock = vi.hoisted(() => vi.fn());
const removePlaylistTvArtifactsForVideoMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvForShowsMock = vi.hoisted(() => vi.fn());
const listAssignmentsForShowMock = vi.hoisted(() => vi.fn());
const cleanupMediaServerMirrorMock = vi.hoisted(() => vi.fn());
const getCollectionShowMock = vi.hoisted(() => vi.fn());
const releaseCollectionShowOwnershipMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: getSettingsMock,
}));

vi.mock("../../../services/mediaServerExport/playlistTvSync", () => ({
  syncPlaylistTvForVideo: syncPlaylistTvForVideoMock,
  syncPlaylistTvForCollection: syncPlaylistTvForCollectionMock,
  removePlaylistTvArtifactsForVideo: removePlaylistTvArtifactsForVideoMock,
  syncPlaylistTvForShows: syncPlaylistTvForShowsMock,
}));

vi.mock("../../../services/mediaServerExport/catalogRepository", () => ({
  listAssignmentsForShow: listAssignmentsForShowMock,
  getCollectionShow: getCollectionShowMock,
  releaseCollectionShowOwnership: releaseCollectionShowOwnershipMock,
}));

vi.mock("../../../services/mediaServerExport/hierarchyMaterializer", () => ({
  cleanupMediaServerMirror: cleanupMediaServerMirrorMock,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  onCollectionLinkCommitted,
  onCollectionMetadataCommitted,
  onCollectionUnlinkCommitted,
  onCollectionDeletePending,
  onVideoDeleteCommitted,
  onVideoDeletePending,
} from "../../../services/mediaServerExport/mutationHooks";

/**
 * Issue #411 §9. These hooks run after the triggering mutation commits and must
 * never fail the user's actual operation.
 */
describe("mediaServerExport mutationHooks", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    syncPlaylistTvForShowsMock.mockReset();
    listAssignmentsForShowMock.mockReset();
    listAssignmentsForShowMock.mockReturnValue([]);
    cleanupMediaServerMirrorMock.mockReset();
    getCollectionShowMock.mockReset();
    getCollectionShowMock.mockReturnValue(undefined);
    releaseCollectionShowOwnershipMock.mockReset();
    removePlaylistTvArtifactsForVideoMock.mockReturnValue({
      removedArtifacts: 0,
      failures: [],
      affectedShowIds: new Set<string>(),
    });
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

  /**
   * The two halves of a deletion must agree about when they run. The pending
   * half deliberately runs with the export off, because that is the last moment
   * the artifacts can be identified; if the committed half skipped that case it
   * would strip the episodes and strand tvshow.nfo, season.nfo and the poster -
   * a worse state than never having cleaned.
   */
  describe("post-delete show reconcile", () => {
    it("returns the shows that lost an episode", () => {
      usePlaylistTv();
      removePlaylistTvArtifactsForVideoMock.mockReturnValue({
        removedArtifacts: 3,
        failures: [],
        affectedShowIds: new Set(["show-1"]),
      });

      expect(onVideoDeletePending("v1")).toEqual(new Set(["show-1"]));
    });

    it("re-plans the affected shows while the export is on", () => {
      usePlaylistTv();

      onVideoDeleteCommitted(new Set(["show-1"]));

      expect(syncPlaylistTvForShowsMock).toHaveBeenCalledWith(
        new Set(["show-1"]),
        expect.objectContaining({ mode: "nfo" })
      );
    });

    it("sweeps an emptied show even when the export mode is off", () => {
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "off",
        mediaServerExportLayout: "playlist_tv",
      });
      listAssignmentsForShowMock.mockReturnValue([]);

      onVideoDeleteCommitted(new Set(["show-1"]));

      expect(cleanupMediaServerMirrorMock).toHaveBeenCalledWith(new Set(["show-1"]));
      // Nothing may be written while the export is off.
      expect(syncPlaylistTvForShowsMock).not.toHaveBeenCalled();
    });

    it("leaves a show that still has episodes alone when the mode is off", () => {
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "off",
        mediaServerExportLayout: "playlist_tv",
      });
      listAssignmentsForShowMock.mockReturnValue([{ id: "a1" }]);

      onVideoDeleteCommitted(new Set(["show-1"]));

      expect(cleanupMediaServerMirrorMock).not.toHaveBeenCalled();
    });

    it("does nothing in the adjacent layout", () => {
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "nfo",
        mediaServerExportLayout: "adjacent",
      });

      onVideoDeleteCommitted(new Set(["show-1"]));

      expect(syncPlaylistTvForShowsMock).not.toHaveBeenCalled();
      expect(cleanupMediaServerMirrorMock).not.toHaveBeenCalled();
    });

    it("never lets a reconcile failure escape", () => {
      usePlaylistTv();
      syncPlaylistTvForShowsMock.mockImplementation(() => {
        throw new Error("plan exploded");
      });

      expect(() => onVideoDeleteCommitted(new Set(["show-1"]))).not.toThrow();
    });
  });

  describe("collection deletion", () => {
    it("sweeps the show and releases its claim on the collection", () => {
      usePlaylistTv();
      getCollectionShowMock.mockReturnValue({ id: "show-1" });

      onCollectionDeletePending("c1");

      expect(cleanupMediaServerMirrorMock).toHaveBeenCalledWith(new Set(["show-1"]));
      expect(releaseCollectionShowOwnershipMock).toHaveBeenCalledWith("show-1");
    });

    it("does nothing for a collection that was never a show", () => {
      usePlaylistTv();
      getCollectionShowMock.mockReturnValue(undefined);

      onCollectionDeletePending("c1");

      expect(cleanupMediaServerMirrorMock).not.toHaveBeenCalled();
      expect(releaseCollectionShowOwnershipMock).not.toHaveBeenCalled();
    });

    it("still releases when the export mode is off", () => {
      // The artifacts were written while it was on; this is the last moment the
      // catalog still connects them to this collection.
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "off",
        mediaServerExportLayout: "playlist_tv",
      });
      getCollectionShowMock.mockReturnValue({ id: "show-1" });

      onCollectionDeletePending("c1");

      expect(releaseCollectionShowOwnershipMock).toHaveBeenCalledWith("show-1");
    });

    it("does nothing in the adjacent layout", () => {
      getSettingsMock.mockReturnValue({
        mediaServerExportMode: "nfo",
        mediaServerExportLayout: "adjacent",
      });
      getCollectionShowMock.mockReturnValue({ id: "show-1" });

      onCollectionDeletePending("c1");

      expect(releaseCollectionShowOwnershipMock).not.toHaveBeenCalled();
    });

    it("never lets a failure block the deletion", () => {
      usePlaylistTv();
      getCollectionShowMock.mockImplementation(() => {
        throw new Error("catalog exploded");
      });

      expect(() => onCollectionDeletePending("c1")).not.toThrow();
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
