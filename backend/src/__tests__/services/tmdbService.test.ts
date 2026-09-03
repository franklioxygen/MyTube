/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGES_DIR } from "../../config/paths";
import {
  parseFilename,
  scrapeMetadataFromTMDB,
  testTMDBCredential,
} from "../../services/tmdbService";
import * as settingsService from "../../services/storageService/settings";
import {
  getTMDBTitleMatchStrength,
  isConfidentTMDBTitleMatch,
  TMDB_TITLE_MATCH_EXACT,
  TMDB_TITLE_MATCH_LOOSE,
  TMDB_TITLE_MATCH_NONE,
} from "../../services/tmdbService/titleMatch";

const axiosMocks = vi.hoisted(() => {
  const get = vi.fn();
  let lastCreateConfig: unknown;
  return {
    get,
    create: vi.fn((config: unknown) => {
      lastCreateConfig = config;
      return { get };
    }),
    getLastCreateConfig: () => lastCreateConfig,
  };
});

vi.mock("axios", () => ({
  default: {
    get: axiosMocks.get,
    create: axiosMocks.create,
  },
}));
vi.mock("fs-extra");
vi.mock("../../services/storageService/settings", () => ({
  getSettings: vi.fn(),
}));
vi.mock("../../services/thumbnailMirrorService", () => ({
  regenerateSmallThumbnailForThumbnailPath: vi.fn(() => Promise.resolve(null)),
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
      expect(parsed.titles[0]).toBe("Dark");
    });

    it("should keep cjk titles and compose bilingual candidate", () => {
      const parsed = parseFilename(
        "有话好好说.Keep.Cool.1997.1080p.WEB-DL.H265.AAC.mkv"
      );

      expect(parsed.year).toBe(1997);
      expect(parsed.titles[0]).toBe("有话好好说");
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
      expect(parsed.titles[0]).toBe("A and of upload hello world");
      expect(parsed.source?.toLowerCase()).toBe("web");
    });

    it("should preserve bracketed cjk titles and strip trailing audio metadata", () => {
      const parsed = parseFilename(
        "[BTSCHOOL].[重返寂静岭]Return.to.Silent.Hill.2026.Bluray.1080p.x264.DTS-HD.MA.5.1-BtsHD.mp4"
      );

      expect(parsed.year).toBe(2026);
      expect(parsed.source?.toLowerCase()).toBe("bluray");
      expect(parsed.quality).toBe("1080P");
      expect(parsed.titles).toContain("重返寂静岭");
      expect(parsed.titles).toContain("Return to Silent Hill");
      expect(parsed.titles.join(" | ")).not.toMatch(/\bHD\b|\bMA\b|\b5 1\b/i);
      expect(parsed.titles.join(" | ")).not.toContain("BtsHD");
    });

    it("should strip mixed-case release group tails after technical metadata", () => {
      const playBdParsed = parseFilename(
        "Movie.Title.2022.2160p.UHD.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos-playBD.mkv"
      );
      const muhdParsed = parseFilename(
        "Movie.Title.2022.2160p.UHD.BluRay.REMUX.HEVC.TrueHD.7.1.Atmos-mUHD-FRDS.mkv"
      );

      expect(playBdParsed.titles[0]).toBe("Movie Title");
      expect(muhdParsed.titles[0]).toBe("Movie Title");
      expect(playBdParsed.titles.join(" | ")).not.toMatch(/playBD|UHD|7 1/i);
      expect(muhdParsed.titles.join(" | ")).not.toMatch(/mUHD|FRDS|UHD|7 1/i);
    });

    it("should keep short all-caps title suffixes instead of treating them as release groups", () => {
      const parsed = parseFilename("Title.US.2022.1080p.WEB-DL.mkv");

      expect(parsed.titles[0]).toBe("Title US");
      expect(parsed.source?.toUpperCase()).toBe("WEB-DL");
    });

    it("should keep numeric camera suffixes instead of stripping them as release groups", () => {
      const parsed = parseFilename("IMG_0999.MOV");

      expect(parsed.titles[0]).toBe("IMG 0999");
      expect(parsed.year).toBeUndefined();
    });
  });

  describe("parseFilename release-name cleanup", () => {
    it("strips language, edition and disc tags", () => {
      // Hyphenated "Blu-ray" never matched the BluRay word pattern, and
      // nothing removed hardcoded-subtitle or language markers.
      expect(
        parseFilename(
          "Hibiscus.Town.1986.Blu-ray.1080p.REMUX.AVC.FLAC.2.0-HDH.mkv"
        ).titles
      ).toContain("Hibiscus Town");
      expect(
        parseFilename(
          "No More Bets 2023 1080p Chinese WEB-DL HC HEVC x265-BONE.mkv"
        ).titles
      ).toContain("No More Bets");
    });

    it("keeps shortening the title while trailing junk remains", () => {
      // "The Godfather UHD 5Audio beAst" needs three words removed.
      expect(
        parseFilename(
          "The.Godfather.1972.UHD.BluRay.2160p.10bit.HDR.5Audio.TrueHD.5.1.x265-beAst.mkv"
        ).titles
      ).toContain("The Godfather");
    });

    // Real names from a media library; each previously left junk in the title
    // that sank the TMDB lookup.
    const cases: Array<[string, string]> = [
      ["A.Foggy.Tale.2025.1080p.NF.WEB-DL.DDP5.1.H.264-MWeb", "A Foggy Tale"],
      [
        "All.Quiet.on.the.Western.Front.2022.1080p.NF.WEBRip.1600MB.DD5.1.x264-GalaxyRG",
        "All Quiet on the Western Front",
      ],
      [
        "Avatar.The.Way.of.Water.2022.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10.HEVC-CMRG",
        "Avatar The Way of Water",
      ],
      [
        "An.Unfinished.Film.2024.1080p.CATCHPLAY+.WEB-DL.AAC2.0.H.264-CHDWEB",
        "An Unfinished Film",
      ],
    ];

    it.each(cases)("cleans %s", (filename, expected) => {
      expect(parseFilename(`${filename}.mkv`).titles[0]).toBe(expected);
    });

    it("offers a candidate without the trailing release group", () => {
      // Groups are endlessly varied, so rather than enumerate them the search
      // gets a shortened candidate to try as well.
      const parsed = parseFilename(
        "A.Simple.Life.2011.2160p.WEB-DL.H265.AAC.2.0-Zaxyzit.mkv"
      );
      expect(parsed.titles).toContain("A Simple Life");
    });
  });

  describe("isConfidentTMDBTitleMatch", () => {
    // Searched under zh-CN, TMDB answers with the localized title and the
    // original-language one. For a French film named in English by the release
    // name, neither is what the filename says.
    const anatomyOfAFall = {
      title: "坠落的审判",
      original_title: "Anatomie d'une chute",
    };

    it("rejects a result whose returned titles are in other languages", () => {
      expect(isConfidentTMDBTitleMatch("Anatomy Of A Fall", anatomyOfAFall)).toBe(
        false
      );
    });

    it("accepts it once the English title is supplied as an extra candidate", () => {
      expect(
        isConfidentTMDBTitleMatch("Anatomy Of A Fall", anatomyOfAFall, [
          "Anatomy of a Fall",
        ])
      ).toBe(true);
    });

    it("still rejects a genuinely different film", () => {
      expect(
        isConfidentTMDBTitleMatch("Anatomy Of A Fall", anatomyOfAFall, [
          "Barbie",
        ])
      ).toBe(false);
    });
  });

  describe("release year guard", () => {
    it("keeps a match when the year opens the title", () => {
      // "2001.A.Space.Odyssey" parses 2001 as the year, but the film is from
      // 1968; a leading four-digit number is the title, not release metadata.
      const parsed = parseFilename("2001.A.Space.Odyssey.mkv");
      expect(parsed.year).toBe(2001);
      expect(parsed.titles).toContain("A Space Odyssey");
    });

    it("still reads a trailing year as release metadata", () => {
      const parsed = parseFilename(
        "Blade.Runner.2049.2017.1080p.10bit.BluRay.8CH.x265.HEVC-PSA.mkv"
      );
      expect(parsed.year).toBe(2017);
    });
  });

  describe("getTMDBTitleMatchStrength", () => {
    // Real TMDB responses for query "All Quiet on the Western Front", year
    // 2022. Under zh-CN the film answers with its Chinese and German titles,
    // while a companion making-of carries the query inside its own title.
    const film = {
      id: 49046,
      title: "西线无战事",
      original_title: "Im Westen nichts Neues",
    };
    const makingOf = {
      id: 1086967,
      title: "Making All Quiet on the Western Front",
      original_title: "Making All Quiet on the Western Front",
    };
    const query = "All Quiet on the Western Front";

    it("ranks the companion release above nothing but below the film", () => {
      expect(getTMDBTitleMatchStrength(query, film)).toBe(TMDB_TITLE_MATCH_NONE);
      expect(getTMDBTitleMatchStrength(query, makingOf)).toBe(
        TMDB_TITLE_MATCH_LOOSE
      );
    });

    it("puts the film first once its English title is available", () => {
      // This is the pairing that matters: without the English pass the only
      // match is the making-of, and it wins by default.
      expect(getTMDBTitleMatchStrength(query, film, [query])).toBe(
        TMDB_TITLE_MATCH_EXACT
      );
      expect(
        getTMDBTitleMatchStrength(query, makingOf, [makingOf.title])
      ).toBe(TMDB_TITLE_MATCH_LOOSE);
    });
  });

  describe("TMDB client", () => {
    it("should use the API origin as baseURL so v3 endpoint paths are not duplicated", () => {
      expect(axiosMocks.getLastCreateConfig()).toMatchObject({
        baseURL: "https://api.themoviedb.org/",
      });
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

    it("should stop retrying when TMDB returns an authentication error", async () => {
      vi.mocked(axios.get).mockRejectedValue({
        name: "AxiosError",
        message: "Request failed with status code 401",
        isAxiosError: true,
        response: {
          status: 401,
          data: {
            status_message: "Invalid API key: You must be granted a valid key.",
          },
        },
      } as any);

      const result = await scrapeMetadataFromTMDB("Some.Movie.2021.mkv");

      expect(result).toBeNull();
      expect(getCallsBySegment("/search/multi")).toHaveLength(1);
      expect(getCallsBySegment("/search/movie")).toHaveLength(0);
      expect(getCallsBySegment("/search/tv")).toHaveLength(0);
    });

    it("should use bearer authorization when tmdbApiKey is a read access token", async () => {
      vi.mocked(settingsService.getSettings).mockReturnValue({
        tmdbApiKey: "Bearer token.part.signature",
        language: "en",
      } as any);

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

      const result = await scrapeMetadataFromTMDB("Inception.2010.1080p.mkv");

      expect(result?.title).toBe("Inception");
      const tmdbApiCalls = vi
        .mocked(axios.get)
        .mock.calls.filter(([url]) => String(url).startsWith("/3/"));
      expect(tmdbApiCalls.length).toBeGreaterThan(0);
      for (const [, config] of tmdbApiCalls) {
        expect(config?.headers).toMatchObject({
          Authorization: "Bearer token.part.signature",
        });
        expect((config?.params as Record<string, string> | undefined)?.api_key).toBeUndefined();
      }
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

    it("should reject sibling directory traversal that only differs by prefix", async () => {
      vi.mocked(axios.get).mockImplementation(async (url: any) => {
        const asText = String(url);
        if (asText.includes("/search/multi")) {
          return {
            data: {
              results: [
                {
                  media_type: "movie",
                  id: 103,
                  title: "Prefix Safe",
                  release_date: "2021-01-01",
                  popularity: 90,
                  vote_average: 6.8,
                  poster_path: "/prefix-safe.jpg",
                },
              ],
            },
          } as any;
        }
        if (asText.endsWith("/movie/103")) {
          return {
            data: {
              id: 103,
              title: "Prefix Safe",
              release_date: "2021-01-01",
              overview: "safe fallback",
              vote_average: 6.8,
              poster_path: "/prefix-safe.jpg",
            },
          } as any;
        }
        if (asText.endsWith("/movie/103/credits")) {
          return { data: { crew: [] } } as any;
        }
        if (asText.startsWith("https://image.tmdb.org/t/p/w500/")) {
          return { data: Buffer.from("img-data") } as any;
        }
        throw new Error(`Unexpected URL: ${asText}`);
      });

      const result = await scrapeMetadataFromTMDB(
        "Prefix.Safe.2021.mkv",
        "../images-small/unsafe.jpg"
      );

      expect(result?.title).toBe("Prefix Safe");
      expect(result?.thumbnailPath).toBe("/images/Prefix.Safe.2021.jpg");
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writePath = vi.mocked(fs.writeFile).mock.calls[0][0] as string;
      expect(path.normalize(writePath)).toBe(
        path.normalize(path.join(IMAGES_DIR, "Prefix.Safe.2021.jpg"))
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

    it("should skip TMDB lookup for generic capture filenames like IMG_0999", async () => {
      const result = await scrapeMetadataFromTMDB("IMG_0999.MOV");

      expect(result).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("testTMDBCredential", () => {
    it("should validate a TMDB API key with the v3 configuration endpoint", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: {} } as any);

      const result = await testTMDBCredential("tmdb-key");

      expect(result).toEqual({
        success: true,
        authType: "apiKey",
        messageKey: "tmdbCredentialValidApiKey",
      });
      expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
        expect.stringContaining("/configuration"),
        expect.objectContaining({
          params: expect.objectContaining({
            api_key: "tmdb-key",
          }),
        })
      );
    });

    it("should validate a read access token with bearer authorization", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: {} } as any);

      const result = await testTMDBCredential("Bearer token.part.signature");

      expect(result).toEqual({
        success: true,
        authType: "readAccessToken",
        messageKey: "tmdbCredentialValidReadAccessToken",
      });
      expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
        expect.stringContaining("/configuration"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer token.part.signature",
          }),
        })
      );
    });

    it("should treat short dotted credentials as api keys instead of bearer tokens", async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: {} } as any);

      const result = await testTMDBCredential("foo.bar.baz");

      expect(result).toEqual({
        success: true,
        authType: "apiKey",
        messageKey: "tmdbCredentialValidApiKey",
      });
      expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
        expect.stringContaining("/configuration"),
        expect.objectContaining({
          params: expect.objectContaining({
            api_key: "foo.bar.baz",
          }),
          headers: undefined,
        })
      );
    });

    it("should surface authentication errors when testing a TMDB credential", async () => {
      vi.mocked(axios.get).mockRejectedValue({
        response: {
          status: 401,
          data: {
            status_message: "Invalid API key: You must be granted a valid key.",
          },
        },
      } as any);

      const result = await testTMDBCredential("tmdb-key");

      expect(result).toEqual({
        success: false,
        authType: "apiKey",
        code: "auth-failed",
        messageKey: "tmdbCredentialInvalid",
        error: "Invalid API key: You must be granted a valid key.",
      });
    });

    it("should reject empty credentials without calling TMDB", async () => {
      const result = await testTMDBCredential("   ");

      expect(result).toEqual({
        success: false,
        authType: "apiKey",
        code: "request-failed",
        messageKey: "tmdbCredentialRequestFailed",
        error: "TMDB credential is required.",
      });
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
