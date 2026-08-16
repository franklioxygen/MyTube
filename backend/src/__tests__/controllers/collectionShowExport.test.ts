import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError, NotFoundError } from "../../errors/DownloadErrors";

const getCollectionByIdMock = vi.hoisted(() => vi.fn());
const searchCollectionCandidatesMock = vi.hoisted(() => vi.fn());
const activateCollectionShowMock = vi.hoisted(() => vi.fn());
const deactivateCollectionShowMock = vi.hoisted(() => vi.fn());
const getCollectionsMock = vi.hoisted(() => vi.fn());
const listMediaServerShowsMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/storageService", () => ({
  getCollectionById: getCollectionByIdMock,
  getCollections: getCollectionsMock,
  saveCollection: vi.fn(),
  deleteCollection: vi.fn(),
  atomicUpdateCollection: vi.fn(),
  generateUniqueCollectionName: vi.fn(),
  getCollectionByName: vi.fn(),
  deleteCollectionWithFiles: vi.fn(),
  deleteCollectionAndVideos: vi.fn(),
  renameCollection: vi.fn(),
}));

vi.mock("../../services/tmdbService/collectionSearch", () => ({
  searchCollectionCandidates: searchCollectionCandidatesMock,
}));

vi.mock("../../services/mediaServerExport/collectionShowActivation", () => ({
  activateCollectionShow: activateCollectionShowMock,
  deactivateCollectionShow: deactivateCollectionShowMock,
}));

vi.mock("../../services/mediaServerExport/catalogRepository", () => ({
  listMediaServerShows: listMediaServerShowsMock,
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  getCollections,
  searchCollectionTmdb,
  updateCollectionShowExport,
} from "../../controllers/collectionController";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function req(body: unknown, id = "c1") {
  return { params: { id }, body } as never;
}

describe("collection show-export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCollectionByIdMock.mockReturnValue({
      id: "c1",
      title: "人民的名义超高清版",
    });
    activateCollectionShowMock.mockResolvedValue({
      status: "ok",
      collection: { id: "c1" },
    });
    deactivateCollectionShowMock.mockResolvedValue({
      status: "ok",
      collection: { id: "c1" },
    });
    getCollectionsMock.mockReturnValue([]);
    listMediaServerShowsMock.mockReturnValue([]);
  });

  describe("TMDB search", () => {
    it("falls back to the collection title when no query is given", async () => {
      searchCollectionCandidatesMock.mockResolvedValue({
        status: "ok",
        candidates: [],
      });

      await searchCollectionTmdb(req({}), mockRes());

      expect(searchCollectionCandidatesMock).toHaveBeenCalledWith(
        "人民的名义超高清版"
      );
    });

    it("uses an explicit query when supplied", async () => {
      searchCollectionCandidatesMock.mockResolvedValue({
        status: "ok",
        candidates: [],
      });

      await searchCollectionTmdb(req({ query: "  人民的名义  " }), mockRes());

      expect(searchCollectionCandidatesMock).toHaveBeenCalledWith("人民的名义");
    });

    it("surfaces a missing credential without failing the request", async () => {
      searchCollectionCandidatesMock.mockResolvedValue({
        status: "no_credential",
      });
      const res = mockRes();

      await searchCollectionTmdb(req({}), res);

      expect(res.json).toHaveBeenCalledWith({
        status: "no_credential",
        candidates: [],
      });
    });

    it("rejects an overlong query", async () => {
      await expect(
        searchCollectionTmdb(req({ query: "x".repeat(201) }), mockRes())
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a missing collection", async () => {
      getCollectionByIdMock.mockReturnValue(undefined);

      await expect(searchCollectionTmdb(req({}), mockRes())).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("activation validation", () => {
    it("rejects unknown fields", async () => {
      await expect(
        updateCollectionShowExport(
          req({ enabled: true, mode: "collection", sneaky: 1 }),
          mockRes()
        )
      ).rejects.toThrow(ValidationError);
      expect(activateCollectionShowMock).not.toHaveBeenCalled();
    });

    it("requires a boolean enabled", async () => {
      for (const enabled of ["yes", 1, undefined, null]) {
        await expect(
          updateCollectionShowExport(req({ enabled }), mockRes())
        ).rejects.toThrow(ValidationError);
      }
    });

    it("rejects an unknown mode", async () => {
      await expect(
        updateCollectionShowExport(
          req({ enabled: true, mode: "guess" }),
          mockRes()
        )
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a blank or overlong manual title", async () => {
      for (const title of ["", "   ", "x".repeat(201)]) {
        await expect(
          updateCollectionShowExport(
            req({ enabled: true, mode: "manual", title }),
            mockRes()
          )
        ).rejects.toThrow(ValidationError);
      }
      expect(activateCollectionShowMock).not.toHaveBeenCalled();
    });

    it("rejects a non-positive or non-integer TMDB id", async () => {
      for (const tmdbId of [0, -1, 1.5, "42", undefined]) {
        await expect(
          updateCollectionShowExport(
            req({ enabled: true, mode: "tmdb", tmdbId, mediaType: "tv" }),
            mockRes()
          )
        ).rejects.toThrow(ValidationError);
      }
    });

    it("rejects an invalid media type", async () => {
      await expect(
        updateCollectionShowExport(
          req({ enabled: true, mode: "tmdb", tmdbId: 42, mediaType: "person" }),
          mockRes()
        )
      ).rejects.toThrow(ValidationError);
    });

    it("passes a valid TMDB selection through as id and media type only", async () => {
      await updateCollectionShowExport(
        req({
          enabled: true,
          mode: "tmdb",
          tmdbId: 72517,
          mediaType: "tv",
          // A tampered title must never reach the service.
          title: "Something Else",
        }),
        mockRes()
      );

      expect(activateCollectionShowMock).toHaveBeenCalledWith("c1", {
        kind: "tmdb",
        tmdbId: 72517,
        mediaType: "tv",
      });
    });

    it("passes a manual selection through trimmed", async () => {
      await updateCollectionShowExport(
        req({
          enabled: true,
          mode: "manual",
          title: "My Drama",
          description: "Notes",
        }),
        mockRes()
      );

      expect(activateCollectionShowMock).toHaveBeenCalledWith("c1", {
        kind: "manual",
        title: "My Drama",
        description: "Notes",
      });
    });
  });

  describe("activation outcomes", () => {
    it("maps a held maintenance lock to 409", async () => {
      activateCollectionShowMock.mockResolvedValue({
        status: "error",
        reason: "lock_unavailable",
      });
      const res = mockRes();

      await updateCollectionShowExport(
        req({ enabled: true, mode: "collection" }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "lock_unavailable" })
      );
    });

    it("maps a wrong layout to 409 and a missing collection to 404", async () => {
      for (const [reason, status] of [
        ["layout_not_playlist_tv", 409],
        ["collection_not_found", 404],
        ["tmdb_unavailable", 502],
      ] as const) {
        activateCollectionShowMock.mockResolvedValue({ status: "error", reason });
        const res = mockRes();

        await updateCollectionShowExport(
          req({ enabled: true, mode: "collection" }),
          res
        );

        expect(res.status).toHaveBeenCalledWith(status);
      }
    });

    it("returns the poster warning alongside the collection", async () => {
      activateCollectionShowMock.mockResolvedValue({
        status: "ok",
        collection: { id: "c1" },
        posterWarning: true,
      });
      const res = mockRes();

      await updateCollectionShowExport(
        req({ enabled: true, mode: "tmdb", tmdbId: 1, mediaType: "tv" }),
        res
      );

      expect(res.json).toHaveBeenCalledWith({
        collection: { id: "c1" },
        posterWarning: true,
      });
    });

    it("deactivates without requiring a mode", async () => {
      await updateCollectionShowExport(req({ enabled: false }), mockRes());

      expect(deactivateCollectionShowMock).toHaveBeenCalledWith("c1");
      expect(activateCollectionShowMock).not.toHaveBeenCalled();
    });
  });

  /**
   * The show folder is allocated once from the accepted title and never
   * renamed, so sanitization or a de-duplication suffix can make it differ from
   * that title. Responses therefore carry the stored name, never a re-derivation.
   */
  describe("show directory name", () => {
    it("attaches the allocated directory to a marked collection", async () => {
      listMediaServerShowsMock.mockReturnValue([
        {
          id: "s1",
          sourceCollectionId: "c1",
          directoryName: "人民的名义 (2017)",
        },
      ]);
      activateCollectionShowMock.mockResolvedValue({
        status: "ok",
        collection: { id: "c1", exportAsShow: 1, title: "人民的名义/超清" },
      });
      const res = mockRes();

      await updateCollectionShowExport(
        req({ enabled: true, mode: "tmdb", tmdbId: 1, mediaType: "tv" }),
        res
      );

      expect(res.json).toHaveBeenCalledWith({
        collection: expect.objectContaining({
          mediaServerShowDirectoryName: "人民的名义 (2017)",
        }),
        posterWarning: false,
      });
    });

    it("omits the field before the reconciler has allocated a folder", async () => {
      listMediaServerShowsMock.mockReturnValue([]);
      activateCollectionShowMock.mockResolvedValue({
        status: "ok",
        collection: { id: "c1", exportAsShow: 1 },
      });
      const res = mockRes();

      await updateCollectionShowExport(
        req({ enabled: true, mode: "collection" }),
        res
      );

      expect(res.json).toHaveBeenCalledWith({
        collection: { id: "c1", exportAsShow: 1 },
        posterWarning: false,
      });
    });

    it("never reads the catalog when nothing is marked", async () => {
      getCollectionsMock.mockReturnValue([{ id: "c1" }, { id: "c2" }]);
      const res = mockRes();

      await getCollections({} as never, res);

      expect(listMediaServerShowsMock).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([{ id: "c1" }, { id: "c2" }]);
    });

    it("enriches only the marked collections in the list", async () => {
      getCollectionsMock.mockReturnValue([
        { id: "c1", exportAsShow: 1 },
        { id: "c2" },
      ]);
      listMediaServerShowsMock.mockReturnValue([
        { id: "s1", sourceCollectionId: "c1", directoryName: "Drama" },
        // An author show: no sourceCollectionId, so it maps to nothing.
        { id: "s2", directoryName: "Some Channel" },
      ]);
      const res = mockRes();

      await getCollections({} as never, res);

      expect(res.json).toHaveBeenCalledWith([
        { id: "c1", exportAsShow: 1, mediaServerShowDirectoryName: "Drama" },
        { id: "c2" },
      ]);
    });
  });
});
