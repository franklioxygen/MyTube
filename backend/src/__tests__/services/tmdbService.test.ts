import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGES_DIR } from "../../config/paths";
import { parseFilename, scrapeMetadataFromTMDB } from "../../services/tmdbService";
import * as settingsService from "../../services/storageService/settings";

vi.mock("axios");
vi.mock("fs-extra");
vi.mock("../../services/storageService/settings", () => ({
  getSettings: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function getCallsBySegment(segment: string) {
  return vi
    .mocked(axios.get)
    .mock.calls.filter(([url]) => String(url).includes(segment));
}

describe("tmdbService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.getSettings).mockReturnValue({
      tmdbApiKey: "tmdb-key",
      language: "en",
    } as any);
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
  });

  describe("parseFilename", () => {
    it("should parse movie filename with year quality and source", () => {
      const parsed = parseFilename("The.Matrix.1999.1080p.BluRay.x264-DTS.mkv");

      expect(parsed.isTVShow).toBe(false);
      expect(parsed.year).toBe(1999);
      expect(parsed.quality).toBe("1080P");
      expect(parsed.source?.toLowerCase()).toBe("bluray");
      expect(parsed.titles[0]).toContain("The Matrix");
    });

    it("should parse tv metadata from SxxExx format", () => {
      const parsed = parseFilename(
        "Game.of.Thrones.S01E02.720p.WEB-DL.H265.AAC.mkv"
      );

      expect(parsed.isTVShow).toBe(true);
      expect(parsed.season).toBe(1);
      expect(parsed.episode).toBe(2);
      expect(parsed.titles[0]).toBe("Game of Thrones");
    });

    it("should parse tv metadata from Season Episode format", () => {
      const parsed = parseFilename(
        "Dark Season 2 Episode 5 1080p WEBRip x265.mkv"
      );

      expect(parsed.isTVShow).toBe(true);
      expect(parsed.season).toBe(2);
      expect(parsed.episode).toBe(5);
      expect(parsed.titles[0]).toContain("Dark");
      expect(parsed.titles[0]).toContain("Season 2 Episode 5");
    });

    it("should keep cjk titles and compose bilingual candidate", () => {
      const parsed = parseFilename(
        "有话好好说.Keep.Cool.1997.1080p.WEB-DL.H265.AAC.mkv"
      );

      expect(parsed.year).toBe(1997);
      expect(parsed.titles).toEqual(["有话好好说"]);
      expect(parsed.quality).toBe("1080P");
      expect(parsed.source?.toUpperCase()).toBe("WEB-DL");
    });

    it("should fallback to cleaned filename when no title candidates exist", () => {
      const parsed = parseFilename("1080p.WEB.H265.AAC.mkv");

      expect(parsed.titles).toEqual(["1080p.WEB.H265.AAC"]);
      expect(parsed.isTVShow).toBe(false);
      expect(parsed.quality).toBe("1080P");
    });

    it("should remove metadata tokens and keep meaningful words", () => {
      const parsed = parseFilename("A.and.of.web.rip.upload.hello.world.2020.mkv");

      expect(parsed.year).toBe(2020);
      expect(parsed.titles).toEqual(["A and of upload hello world"]);
      expect(parsed.source?.toLowerCase()).toBe("web");
    });
  });

  describe("scrapeMetadataFromTMDB", () => {
    it("should return null when tmdb api key is missing", async () => {
      vi.mocked(settingsService.getSettings).mockReturnValue({
        tmdbApiKey: "",
        language: "en",
      } as any);

      const result = await scrapeMetadataFromTMDB("Some.Movie.2021.mkv");
      expect(result).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });

    it("should scrape movie metadata and download poster with safe nested thumbnail path", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          return {
            data: {
              results: [
                {
                  media_type: "movie",
                  id: 100,
                  title: "Inception",
                  release_date: "2010-07-16",
                  popularity: 99,
                  vote_average: 8.8,
                  poster_path: "/inception.jpg",
                },
              ],
            },
          } as any;
        }
        if (asText.endsWith("/movie/100")) {
          return {
            data: {
              id: 100,
              title: "Inception",
              release_date: "2010-07-16",
              overview: "Dreams within dreams",
              vote_average: 8.8,
              poster_path: "/inception.jpg",
            },
          } as any;
        }
        if (asText.endsWith("/movie/100/credits")) {
          return {
            data: {
              crew: [{ job: "Director", name: "Christopher Nolan" }],
            },
          } as any;
        }
        if (asText.startsWith("https://image.tmdb.org/t/p/w500/")) {
          return { data: Buffer.from("img-data") } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const result = await scrapeMetadataFromTMDB(
        "Inception.2010.1080p.mkv",
        "nested/folder/original-thumb.jpg"
      );

      expect(result).toMatchObject({
        title: "Inception",
        year: "2010",
        rating: 8.8,
        director: "Christopher Nolan",
      });
      expect(result?.thumbnailPath).toContain("/images/nested/folder/");
      expect(result?.thumbnailUrl).toContain("/images/nested/folder/");
      expect(fs.ensureDir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should return metadata without poster when poster path is invalid", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          return {
            data: {
              results: [
                {
                  media_type: "movie",
                  id: 101,
                  title: "Unsafe Poster",
                  release_date: "2022-01-01",
                  popularity: 95,
                  vote_average: 7.2,
                },
              ],
            },
          } as any;
        }
        if (asText.endsWith("/movie/101")) {
          return {
            data: {
              id: 101,
              title: "Unsafe Poster",
              release_date: "2022-01-01",
              overview: "poster path is unsafe",
              vote_average: 7.2,
              poster_path: "../passwd",
            },
          } as any;
        }
        if (asText.endsWith("/movie/101/credits")) {
          return { data: { crew: [] } } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const result = await scrapeMetadataFromTMDB("Unsafe.Poster.2022.mkv");
      expect(result?.title).toBe("Unsafe Poster");
      expect(result?.thumbnailPath).toBeUndefined();
      expect(getCallsBySegment("image.tmdb.org")).toHaveLength(0);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should fallback to safe filename when provided thumbnail directory is path traversal", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          return {
            data: {
              results: [
                {
                  media_type: "movie",
                  id: 102,
                  title: "Path Safe",
                  release_date: "2020-01-01",
                  popularity: 90,
                  vote_average: 6.8,
                  poster_path: "/path-safe.jpg",
                },
              ],
            },
          } as any;
        }
        if (asText.endsWith("/movie/102")) {
          return {
            data: {
              id: 102,
              title: "Path Safe",
              release_date: "2020-01-01",
              overview: "safe fallback",
              vote_average: 6.8,
              poster_path: "/path-safe.jpg",
            },
          } as any;
        }
        if (asText.endsWith("/movie/102/credits")) {
          return { data: { crew: [] } } as any;
        }
        if (asText.startsWith("https://image.tmdb.org/t/p/w500/")) {
          return { data: Buffer.from("img-data") } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const result = await scrapeMetadataFromTMDB(
        "Path.Safe.2020.mkv",
        "../outside/unsafe.jpg"
      );
      expect(result?.title).toBe("Path Safe");
      expect(result?.thumbnailPath).toBeDefined();
      expect(result?.thumbnailPath).not.toContain("..");
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writePath = vi.mocked(fs.writeFile).mock.calls[0][0] as string;
      expect(path.normalize(writePath).startsWith(path.normalize(IMAGES_DIR))).toBe(
        true
      );
    });

    it("should use strategy 2 for tv search when multi search with year misses", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          return { data: { results: [] } } as any;
        }
        if (asText.includes("/search/tv")) {
          return {
            data: {
              results: [
                { id: 300, name: "Dark", first_air_date: "2017-12-01" },
              ],
            },
          } as any;
        }
        if (asText.endsWith("/tv/300")) {
          return {
            data: {
              id: 300,
              name: "Dark",
              first_air_date: "2017-12-01",
              overview: "Time travel",
              vote_average: 8.5,
              poster_path: "/dark.jpg",
              created_by: [{ id: 1, name: "Baran bo Odar" }],
            },
          } as any;
        }
        if (asText.endsWith("/tv/300/credits")) {
          return { data: { crew: [] } } as any;
        }
        if (asText.startsWith("https://image.tmdb.org/t/p/w500/")) {
          return { data: Buffer.from("img-data") } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const result = await scrapeMetadataFromTMDB("Dark.S01E01.2017.1080p.mkv");

      expect(result).toMatchObject({
        title: "Dark",
        year: "2017",
        director: "Baran bo Odar",
      });
      expect(getCallsBySegment("/search/tv").length).toBeGreaterThan(0);
    });

    it("should use strategy 5 fuzzy title search", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any, config: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          const q = config?.params?.query;
          if (String(q).includes("MovieName")) {
            return {
              data: {
                results: [
                  {
                    media_type: "movie",
                    id: 500,
                    title: "Movie Name",
                    release_date: "2021-11-11",
                    popularity: 77,
                    vote_average: 7.9,
                    poster_path: "/movie-name.jpg",
                  },
                ],
              },
            } as any;
          }
          return { data: { results: [] } } as any;
        }
        if (asText.endsWith("/movie/500")) {
          return {
            data: {
              id: 500,
              title: "Movie Name",
              release_date: "2021-11-11",
              overview: "fuzzy matched",
              vote_average: 7.9,
              poster_path: "/movie-name.jpg",
            },
          } as any;
        }
        if (asText.endsWith("/movie/500/credits")) {
          return { data: { crew: [] } } as any;
        }
        if (asText.startsWith("https://image.tmdb.org/t/p/w500/")) {
          return { data: Buffer.from("img-data") } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const result = await scrapeMetadataFromTMDB("Movie@Name!!2021.1080p.mkv");

      expect(result?.title).toBe("Movie Name");
      expect(getCallsBySegment("/search/multi").length).toBeGreaterThan(1);
    });

    it("should cache search results for identical requests", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          return {
            data: {
              results: [
                {
                  media_type: "movie",
                  id: 700,
                  title: "Cache Hit",
                  release_date: "2019-01-01",
                  popularity: 80,
                  vote_average: 7.1,
                  poster_path: "/cache-hit.jpg",
                },
              ],
            },
          } as any;
        }
        if (asText.endsWith("/movie/700")) {
          return {
            data: {
              id: 700,
              title: "Cache Hit",
              release_date: "2019-01-01",
              overview: "cache",
              vote_average: 7.1,
              poster_path: "/cache-hit.jpg",
            },
          } as any;
        }
        if (asText.endsWith("/movie/700/credits")) {
          return { data: { crew: [] } } as any;
        }
        if (asText.startsWith("https://image.tmdb.org/t/p/w500/")) {
          return { data: Buffer.from("img-data") } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const first = await scrapeMetadataFromTMDB("Cache.Hit.2019.mkv");
      const second = await scrapeMetadataFromTMDB("Cache.Hit.2019.mkv");

      expect(first?.title).toBe("Cache Hit");
      expect(second?.title).toBe("Cache Hit");
      expect(getCallsBySegment("/search/multi")).toHaveLength(1);
      expect(getCallsBySegment("/movie/700").length).toBeGreaterThanOrEqual(2);
      expect(getCallsBySegment("image.tmdb.org")).toHaveLength(2);
    });

    it("should return null when all strategies fail", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { results: [] } } as any);

      const result = await scrapeMetadataFromTMDB("Nothing.Match.2099.mkv");
      expect(result).toBeNull();
      expect(getCallsBySegment("/search/multi").length).toBeGreaterThan(0);
    });
  });
});
