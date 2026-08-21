import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.hoisted(() => vi.fn());
const getCollectionByIdMock = vi.hoisted(() => vi.fn());
const acquireRenameLockMock = vi.hoisted(() => vi.fn());
const releaseRenameLockMock = vi.hoisted(() => vi.fn());
const resolveCollectionMetadataMock = vi.hoisted(() => vi.fn());
const downloadPosterMock = vi.hoisted(() => vi.fn());
const dbUpdateSetMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvForCollectionMock = vi.hoisted(() => vi.fn());

vi.mock("../../../db", () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        dbUpdateSetMock(values);
        return { where: () => ({ run: () => undefined }) };
      },
    }),
  },
}));

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: getSettingsMock,
}));

vi.mock("../../../services/storageService/collectionRepository", () => ({
  getCollectionById: getCollectionByIdMock,
}));

vi.mock("../../../services/filenameTemplate/renameLockService", () => ({
  acquireRenameLock: acquireRenameLockMock,
  releaseRenameLock: releaseRenameLockMock,
}));

vi.mock("../../../services/tmdbService/collectionSearch", () => ({
  resolveCollectionMetadata: resolveCollectionMetadataMock,
}));

vi.mock("../../../services/tmdbService/poster", () => ({
  downloadPoster: downloadPosterMock,
  resolveCollectionPosterSaveLocation: (
    collectionId: string,
    mediaType: string,
    tmdbId: number
  ) => ({
    absolutePath: `/images/tmdb/collections/hash/${mediaType}-${tmdbId}.jpg`,
    relativePath: `tmdb/collections/hash/${mediaType}-${tmdbId}.jpg`,
    webPath: `/images/tmdb/collections/hash/${mediaType}-${tmdbId}.jpg`,
  }),
}));

vi.mock("../../../services/mediaServerExport/playlistTvSync", () => ({
  syncPlaylistTvForCollection: syncPlaylistTvForCollectionMock,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  activateCollectionShow,
  deactivateCollectionShow,
} from "../../../services/mediaServerExport/collectionShowActivation";

describe("collection-show activation", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    getCollectionByIdMock.mockReset();
    acquireRenameLockMock.mockReset();
    releaseRenameLockMock.mockReset();
    resolveCollectionMetadataMock.mockReset();
    downloadPosterMock.mockReset();
    dbUpdateSetMock.mockReset();

    getSettingsMock.mockReturnValue({ mediaServerExportLayout: "playlist_tv" });
    getCollectionByIdMock.mockReturnValue({ id: "c1", title: "A Collection" });
    acquireRenameLockMock.mockReturnValue(true);
    downloadPosterMock.mockResolvedValue(true);
  });

  describe("guards", () => {
    it("refuses activation while the layout is not playlist_tv", async () => {
      getSettingsMock.mockReturnValue({ mediaServerExportLayout: "adjacent" });

      await expect(
        activateCollectionShow("c1", { kind: "collection" })
      ).resolves.toEqual({ status: "error", reason: "layout_not_playlist_tv" });
      expect(dbUpdateSetMock).not.toHaveBeenCalled();
      expect(acquireRenameLockMock).not.toHaveBeenCalled();
    });

    it("refuses activation for a missing collection", async () => {
      getCollectionByIdMock.mockReturnValue(undefined);

      await expect(
        activateCollectionShow("c1", { kind: "collection" })
      ).resolves.toEqual({ status: "error", reason: "collection_not_found" });
    });

    /**
     * A rebuild or batch rename holds this lock; the mirror must not change
     * underneath it.
     */
    it("reports a retryable failure when the maintenance lock is held", async () => {
      acquireRenameLockMock.mockReturnValue(false);

      await expect(
        activateCollectionShow("c1", { kind: "collection" })
      ).resolves.toEqual({ status: "error", reason: "lock_unavailable" });
      expect(dbUpdateSetMock).not.toHaveBeenCalled();
    });

    it("releases the lock even when the update throws", async () => {
      resolveCollectionMetadataMock.mockResolvedValue({
        tmdbId: 1,
        mediaType: "tv",
        title: "T",
      });
      getCollectionByIdMock
        .mockReturnValueOnce({ id: "c1" })
        .mockImplementationOnce(() => {
          throw new Error("boom");
        });

      await expect(
        activateCollectionShow("c1", { kind: "tmdb", tmdbId: 1, mediaType: "tv" })
      ).rejects.toThrow("boom");
      expect(releaseRenameLockMock).toHaveBeenCalled();
    });
  });

  describe("network ordering", () => {
    /**
     * §6.1: TMDB details and the poster download happen before the lock is
     * taken, so an interactive request never holds it across an HTTP round trip.
     */
    it("finishes all network work before acquiring the lock", async () => {
      const order: string[] = [];
      resolveCollectionMetadataMock.mockImplementation(async () => {
        order.push("tmdb");
        return { tmdbId: 42, mediaType: "tv", title: "人民的名义" };
      });
      downloadPosterMock.mockImplementation(async () => {
        order.push("poster");
        return true;
      });
      acquireRenameLockMock.mockImplementation(() => {
        order.push("lock");
        return true;
      });

      await activateCollectionShow("c1", {
        kind: "tmdb",
        tmdbId: 42,
        mediaType: "tv",
      });

      expect(order).toEqual(["tmdb", "lock"]);
    });
  });

  describe("metadata modes", () => {
    it("stores a confirmed TMDB identity with its poster", async () => {
      resolveCollectionMetadataMock.mockResolvedValue({
        tmdbId: 72517,
        mediaType: "tv",
        title: "人民的名义",
        overview: "Anti-corruption drama.",
        premiereDate: "2017-03-28",
        posterPath: "/poster.jpg",
      });

      const result = await activateCollectionShow("c1", {
        kind: "tmdb",
        tmdbId: 72517,
        mediaType: "tv",
      });

      expect(result.status).toBe("ok");
      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          exportAsShow: 1,
          mediaServerTitle: "人民的名义",
          mediaServerDescription: "Anti-corruption drama.",
          mediaServerMetadataSource: "tmdb",
          mediaServerPosterPath:
            "/images/tmdb/collections/hash/tv-72517.jpg",
          tmdbId: 72517,
          tmdbMediaType: "tv",
          tmdbPremiereDate: "2017-03-28",
        })
      );
      expect(dbUpdateSetMock.mock.calls[0][0].tmdbMatchConfirmedAt).toEqual(
        expect.any(Number)
      );
    });

    it("commits metadata with a warning when the poster fails", async () => {
      resolveCollectionMetadataMock.mockResolvedValue({
        tmdbId: 72517,
        mediaType: "tv",
        title: "人民的名义",
        posterPath: "/poster.jpg",
      });
      downloadPosterMock.mockResolvedValue(false);

      const result = await activateCollectionShow("c1", {
        kind: "tmdb",
        tmdbId: 72517,
        mediaType: "tv",
      });

      expect(result).toMatchObject({ status: "ok", posterWarning: true });
      // A poster failure must not block the identity itself.
      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaServerTitle: "人民的名义",
          mediaServerPosterPath: null,
        })
      );
    });

    it("clears every TMDB field for a manual title", async () => {
      await activateCollectionShow("c1", {
        kind: "manual",
        title: "  My Drama  ",
        description: "Typed by hand.",
      });

      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          exportAsShow: 1,
          mediaServerTitle: "My Drama",
          mediaServerDescription: "Typed by hand.",
          mediaServerMetadataSource: "manual",
          tmdbId: null,
          tmdbMediaType: null,
          tmdbMatchConfirmedAt: null,
        })
      );
    });

    it("rejects a blank or overlong manual title before taking the lock", async () => {
      for (const title of ["", "   ", "x".repeat(201)]) {
        await expect(
          activateCollectionShow("c1", { kind: "manual", title })
        ).resolves.toEqual({ status: "error", reason: "invalid_title" });
      }
      expect(acquireRenameLockMock).not.toHaveBeenCalled();
    });

    it("clears both sets when falling back to collection metadata", async () => {
      await activateCollectionShow("c1", { kind: "collection" });

      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          exportAsShow: 1,
          mediaServerTitle: null,
          mediaServerMetadataSource: null,
          tmdbId: null,
        })
      );
    });

    it("reports tmdb_unavailable without writing anything", async () => {
      resolveCollectionMetadataMock.mockResolvedValue(null);

      await expect(
        activateCollectionShow("c1", { kind: "tmdb", tmdbId: 1, mediaType: "tv" })
      ).resolves.toEqual({ status: "error", reason: "tmdb_unavailable" });
      expect(dbUpdateSetMock).not.toHaveBeenCalled();
    });
  });

  describe("deactivation", () => {
    it("clears only the flag, retaining the resolved identity", async () => {
      await deactivateCollectionShow("c1");

      const values = dbUpdateSetMock.mock.calls[0][0];
      expect(values.exportAsShow).toBe(0);
      // Retained so a later re-enable reuses the identity without another lookup.
      expect(values).not.toHaveProperty("tmdbId");
      expect(values).not.toHaveProperty("mediaServerTitle");
    });

    it("refuses when the lock is held", async () => {
      acquireRenameLockMock.mockReturnValue(false);

      await expect(deactivateCollectionShow("c1")).resolves.toEqual({
        status: "error",
        reason: "lock_unavailable",
      });
    });
  });
});

/**
 * The toggle is not just a database flag. Until the catalog is reconciled the
 * episodes stay under the author season and no collection-show folder exists,
 * so the UI would report the collection as exported while the media server
 * showed nothing at all until an unrelated mutation or a full rebuild.
 */
describe("collection show toggle reconciles the mirror", () => {
  beforeEach(() => {
    syncPlaylistTvForCollectionMock.mockReset();
    getSettingsMock.mockReturnValue({
      mediaServerExportLayout: "playlist_tv",
      mediaServerExportMode: "nfo",
    });
    getCollectionByIdMock.mockReturnValue({ id: "c1", name: "Drama" });
    acquireRenameLockMock.mockReturnValue(true);
  });

  it("reconciles after activation, before returning to the caller", async () => {
    const result = await activateCollectionShow("c1", { kind: "collection" });

    expect(result.status).toBe("ok");
    expect(syncPlaylistTvForCollectionMock).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ mode: "nfo" })
    );
    // Still inside the lock when it ran.
    expect(releaseRenameLockMock).toHaveBeenCalled();
  });

  it("reconciles after deactivation too", async () => {
    const result = await deactivateCollectionShow("c1");

    expect(result.status).toBe("ok");
    expect(syncPlaylistTvForCollectionMock).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ mode: "nfo" })
    );
  });

  it("does not touch the mirror when the export mode is off", async () => {
    getSettingsMock.mockReturnValue({
      mediaServerExportLayout: "playlist_tv",
      mediaServerExportMode: "off",
    });

    await deactivateCollectionShow("c1");

    expect(syncPlaylistTvForCollectionMock).not.toHaveBeenCalled();
  });

  /**
   * Deactivation, unlike activation, does not reject a non-managed layout - so
   * the guard has to live here, or an adjacent-layout deployment would have a
   * managed mirror built for it by a toggle it never opted into.
   */
  it("does not run the managed reconciler in the adjacent layout", async () => {
    getSettingsMock.mockReturnValue({
      mediaServerExportLayout: "adjacent",
      mediaServerExportMode: "nfo",
    });

    await deactivateCollectionShow("c1");

    expect(syncPlaylistTvForCollectionMock).not.toHaveBeenCalled();
  });

  it("still reports success when the reconcile fails", async () => {
    syncPlaylistTvForCollectionMock.mockImplementation(() => {
      throw new Error("materialize exploded");
    });

    const result = await activateCollectionShow("c1", { kind: "collection" });

    // The flag is committed; the next rebuild converges.
    expect(result.status).toBe("ok");
  });
});
