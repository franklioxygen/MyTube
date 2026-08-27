import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.hoisted(() => vi.fn());
const httpGetMock = vi.hoisted(() => vi.fn());
const getTVShowDetailsMock = vi.hoisted(() => vi.fn());
const getMovieDetailsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: getSettingsMock,
}));

// No test may reach api.themoviedb.org.
vi.mock("../../../services/tmdbService/httpClient", () => ({
  tmdbHttpClient: { get: httpGetMock },
  buildTMDBEndpointPath: (p: string) => p,
  validateTMDBNumericId: (id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Invalid TMDB id: ${id}`);
    }
    return String(id);
  },
}));

vi.mock("../../../services/tmdbService/search", () => ({
  getTVShowDetails: getTVShowDetailsMock,
  getMovieDetails: getMovieDetailsMock,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  hasTMDBCredential,
  MAX_COLLECTION_SEARCH_CANDIDATES,
  resolveCollectionMetadata,
  searchCollectionCandidates,
} from "../../../services/tmdbService/collectionSearch";

function useCredential(value = "abcdef1234567890abcdef1234567890"): void {
  getSettingsMock.mockReturnValue({ tmdbApiKey: value, language: "zh" });
}

function tvResult(id: number, name: string) {
  return {
    media_type: "tv",
    id,
    name,
    original_name: name,
    overview: `overview ${id}`,
    first_air_date: "2017-03-28",
    poster_path: `/p${id}.jpg`,
  };
}

describe("tmdbService collectionSearch", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    httpGetMock.mockReset();
    getTVShowDetailsMock.mockReset();
    getMovieDetailsMock.mockReset();
    delete process.env.TMDB_API_KEY;
  });

  describe("credential handling", () => {
    it("reports no credential and performs no request", async () => {
      getSettingsMock.mockReturnValue({});

      expect(hasTMDBCredential()).toBe(false);
      await expect(searchCollectionCandidates("人民的名义")).resolves.toEqual({
        status: "no_credential",
      });
      expect(httpGetMock).not.toHaveBeenCalled();
    });

    it("falls back to the TMDB_API_KEY environment variable", () => {
      getSettingsMock.mockReturnValue({});
      process.env.TMDB_API_KEY = "abcdef1234567890abcdef1234567890";

      expect(hasTMDBCredential()).toBe(true);
    });
  });

  describe("searching", () => {
    it("issues exactly one multi-search with the literal query", async () => {
      useCredential();
      httpGetMock.mockResolvedValue({ data: { results: [tvResult(1, "人民的名义")] } });

      await searchCollectionCandidates("  人民的名义  ");

      expect(httpGetMock).toHaveBeenCalledTimes(1);
      const [path, config] = httpGetMock.mock.calls[0];
      expect(path).toBe("/search/multi");
      // Trimmed, but never transformed into a second narrowed query.
      expect(config.params.query).toBe("人民的名义");
      expect(config.params.language).toBe("zh-CN");
    });

    it("drops person results", async () => {
      useCredential();
      httpGetMock.mockResolvedValue({
        data: {
          results: [
            { media_type: "person", id: 9, name: "Some Actor" },
            tvResult(1, "人民的名义"),
          ],
        },
      });

      const result = await searchCollectionCandidates("人民的名义");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].mediaType).toBe("tv");
    });

    it("annotates confidence without filtering low-confidence results out", async () => {
      useCredential();
      httpGetMock.mockResolvedValue({
        data: {
          results: [
            tvResult(1, "Something Unrelated"),
            tvResult(2, "人民的名义"),
          ],
        },
      });

      const result = await searchCollectionCandidates("人民的名义");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      // Both survive — the user chooses. Confidence only ranks and labels.
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]).toMatchObject({
        tmdbId: 2,
        highConfidence: true,
      });
      expect(result.candidates[1]).toMatchObject({
        tmdbId: 1,
        highConfidence: false,
      });
    });

    it("ranks TV ahead of an equally confident movie", async () => {
      useCredential();
      httpGetMock.mockResolvedValue({
        data: {
          results: [
            {
              media_type: "movie",
              id: 10,
              title: "人民的名义",
              release_date: "2017-01-01",
            },
            tvResult(11, "人民的名义"),
          ],
        },
      });

      const result = await searchCollectionCandidates("人民的名义");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.candidates[0].mediaType).toBe("tv");
    });

    it("caps the candidate list", async () => {
      useCredential();
      httpGetMock.mockResolvedValue({
        data: {
          results: Array.from({ length: 25 }, (_, index) =>
            tvResult(index + 1, `Title ${index + 1}`)
          ),
        },
      });

      const result = await searchCollectionCandidates("Title");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.candidates).toHaveLength(MAX_COLLECTION_SEARCH_CANDIDATES);
    });

    it("reports no results for a blank query without calling TMDB", async () => {
      useCredential();

      await expect(searchCollectionCandidates("   ")).resolves.toEqual({
        status: "no_results",
      });
      expect(httpGetMock).not.toHaveBeenCalled();
    });

    it("reports no results when the request fails", async () => {
      useCredential();
      httpGetMock.mockRejectedValue(new Error("network down"));

      await expect(searchCollectionCandidates("人民的名义")).resolves.toEqual({
        status: "no_results",
      });
    });

    it("skips results with an unusable id or title", async () => {
      useCredential();
      httpGetMock.mockResolvedValue({
        data: {
          results: [
            { media_type: "tv", id: 0, name: "Zero Id" },
            { media_type: "tv", id: 5, name: "   " },
            tvResult(6, "Good"),
          ],
        },
      });

      const result = await searchCollectionCandidates("Good");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.candidates.map((c) => c.tmdbId)).toEqual([6]);
    });
  });

  describe("resolving a confirmed selection", () => {
    it("refetches TV details rather than trusting the client", async () => {
      useCredential();
      getTVShowDetailsMock.mockResolvedValue({
        tv: {
          id: 42,
          name: "人民的名义",
          overview: "authoritative overview",
          first_air_date: "2017-03-28",
          poster_path: "/real.jpg",
        },
      });

      const resolved = await resolveCollectionMetadata(42, "tv");

      expect(getTVShowDetailsMock).toHaveBeenCalledWith(
        42,
        expect.any(String),
        "zh-CN"
      );
      expect(resolved).toEqual({
        tmdbId: 42,
        mediaType: "tv",
        title: "人民的名义",
        overview: "authoritative overview",
        premiereDate: "2017-03-28",
        posterPath: "/real.jpg",
      });
    });

    it("refetches movie details", async () => {
      useCredential();
      getMovieDetailsMock.mockResolvedValue({
        movie: {
          id: 7,
          title: "A Film",
          release_date: "2001-02-03",
          poster_path: "/f.jpg",
        },
      });

      await expect(resolveCollectionMetadata(7, "movie")).resolves.toMatchObject(
        { mediaType: "movie", title: "A Film", premiereDate: "2001-02-03" }
      );
    });

    it("rejects a non-positive id before any request", async () => {
      useCredential();

      await expect(resolveCollectionMetadata(0, "tv")).rejects.toThrow(
        /Invalid TMDB id/
      );
      expect(getTVShowDetailsMock).not.toHaveBeenCalled();
    });

    it("returns null when details are unavailable", async () => {
      useCredential();
      getTVShowDetailsMock.mockResolvedValue(null);

      await expect(resolveCollectionMetadata(42, "tv")).resolves.toBeNull();
    });

    it("returns null without a credential", async () => {
      getSettingsMock.mockReturnValue({});

      await expect(resolveCollectionMetadata(42, "tv")).resolves.toBeNull();
      expect(getTVShowDetailsMock).not.toHaveBeenCalled();
    });
  });
});
