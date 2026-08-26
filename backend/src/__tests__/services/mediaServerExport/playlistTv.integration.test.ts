import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, Video } from "../../../services/storageService/types";

/**
 * End-to-end verification fixture for issue #411 (design §12 Phase 8).
 *
 * One author, two source-backed playlists, one video that belongs to BOTH
 * playlists, and one video in no playlist. Runs the real reconciler, planner,
 * and materializer against a real temporary filesystem and a real SQLite
 * catalog, then asserts the exact directory tree and parses every generated NFO
 * with an XML parser rather than matching strings.
 */

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-e2e-"));

  return {
    root,
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    imagesSmall: path.join(root, "images-small"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
    mediaLibrary: path.join(root, "media-library"),
  };
});

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  VIDEOS_DIR: testPaths.videos,
  SUBTITLES_DIR: testPaths.subtitles,
  MEDIA_SERVER_LIBRARY_DIR: testPaths.mediaLibrary,
}));

const testDb = vi.hoisted(() => {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const { drizzle } =
    require("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const sqlite = new Database(":memory:");
  const migrationsDir = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "backend", "drizzle"),
  ].find((candidate) =>
    fs.existsSync(path.join(candidate, "meta", "_journal.json"))
  );
  if (!migrationsDir) {
    throw new Error("Could not locate the drizzle migrations folder.");
  }

  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string }> };

  for (const entry of journal.entries) {
    const sqlText = fs.readFileSync(
      path.join(migrationsDir, `${entry.tag}.sql`),
      "utf8"
    );
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      try {
        sqlite.exec(trimmed);
      } catch {
        // Overlap with the runtime self-heal migrations.
      }
    }
  }

  for (const column of [
    "origin text",
    "source_platform text",
    "source_type text",
    "source_mid text",
    "source_id text",
  ]) {
    try {
      sqlite.exec(`ALTER TABLE collections ADD COLUMN ${column}`);
    } catch {
      // Already present.
    }
  }

  return { sqlite, db: drizzle(sqlite) };
});

vi.mock("../../../db", () => ({ db: testDb.db }));

const libraryVideos: Video[] = [];
const libraryCollections: Collection[] = [];

vi.mock("../../../services/storageService/videos", () => ({
  getVideos: () => libraryVideos,
  getVideoById: (id: string) => libraryVideos.find((v) => v.id === id),
}));

/**
 * Mirrors the real repository: the season attachment columns live in the
 * database (reconciliation writes them), so a read must hydrate them rather
 * than returning the in-memory fixture objects unchanged.
 */
vi.mock("../../../services/storageService/collectionRepository", () => ({
  getCollections: () =>
    libraryCollections.map((collection) => {
      const row = testDb.sqlite
        .prepare(
          `SELECT media_server_show_id AS showId,
                  media_server_season_number AS seasonNumber,
                  export_as_show AS exportAsShow,
                  media_server_title AS mediaServerTitle,
                  tmdb_id AS tmdbId,
                  tmdb_media_type AS tmdbMediaType,
                  tmdb_premiere_date AS tmdbPremiereDate
             FROM collections WHERE id = ?`
        )
        .get(collection.id) as
        | {
            showId: string | null;
            seasonNumber: number | null;
            exportAsShow: number | null;
            mediaServerTitle: string | null;
            tmdbId: number | null;
            tmdbMediaType: string | null;
            tmdbPremiereDate: string | null;
          }
        | undefined;

      return {
        ...collection,
        mediaServerShowId: row?.showId ?? undefined,
        mediaServerSeasonNumber: row?.seasonNumber ?? undefined,
        exportAsShow: row?.exportAsShow ?? 0,
        mediaServerTitle: row?.mediaServerTitle ?? undefined,
        tmdbId: row?.tmdbId ?? undefined,
        tmdbMediaType:
          row?.tmdbMediaType === "tv" || row?.tmdbMediaType === "movie"
            ? row.tmdbMediaType
            : undefined,
        tmdbPremiereDate: row?.tmdbPremiereDate ?? undefined,
      };
    }),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  removePlaylistTvArtifactsForVideo,
  syncPlaylistTvForShows,
  syncPlaylistTvForVideo,
  syncPlaylistTvLibrary,
} from "../../../services/mediaServerExport/playlistTvSync";
import {
  clearPendingSourceInfo,
  peekPendingSourceInfo,
  storePendingSourceInfo,
} from "../../../services/mediaServerExport/pendingSourceInfo";
import { syncMediaServerArtifactsForRelocatedRecord } from "../../../services/mediaServerExport/syncService";

const CHANNEL_ID = "UCsXVk37bltHxD1rDPwtNM8Q";
const CHANNEL_URL = "https://www.youtube.com/@kurzgesagt";

function writeFile(targetPath: string, contents: string): void {
  fs.ensureDirSync(path.dirname(targetPath));
  fs.writeFileSync(targetPath, contents, "utf8");
}

function mirror(...segments: string[]): string {
  return path.join(testPaths.mediaLibrary, ...segments);
}

function readXml(...segments: string[]): cheerio.CheerioAPI {
  return cheerio.load(fs.readFileSync(mirror(...segments), "utf8"), {
    xmlMode: true,
  });
}

/** Every file under the mirror, as sorted POSIX-relative paths. */
function listMirror(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push(
          path.relative(testPaths.mediaLibrary, full).split(path.sep).join("/")
        );
      }
    }
  };
  walk(testPaths.mediaLibrary);
  return found.sort();
}

function video(overrides: Partial<Video>): Video {
  return {
    author: "Kurzgesagt – In a Nutshell",
    source: "youtube",
    channelUrl: CHANNEL_URL,
    createdAt: "2026-01-01T00:00:00.000Z",
    // Every video from one channel carries the same avatar.
    authorAvatarPath: "/avatars/kurzgesagt.jpg",
    ...overrides,
  } as Video;
}

function seedRows(): void {
  for (const entry of libraryVideos) {
    testDb.sqlite
      .prepare("INSERT OR IGNORE INTO videos (id, title, created_at) VALUES (?, ?, ?)")
      .run(entry.id, entry.title, entry.createdAt);
  }
  for (const entry of libraryCollections) {
    testDb.sqlite
      .prepare(
        `INSERT OR IGNORE INTO collections
           (id, name, title, created_at, source_type, source_platform, source_channel_id,
            source_channel_name, description, export_as_show, media_server_title,
            tmdb_id, tmdb_media_type, tmdb_premiere_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.name ?? entry.title,
        entry.title,
        entry.createdAt ?? "",
        entry.sourceType ?? null,
        entry.sourcePlatform ?? null,
        entry.sourceChannelId ?? null,
        entry.sourceChannelName ?? null,
        entry.description ?? null,
        entry.exportAsShow ?? 0,
        entry.mediaServerTitle ?? null,
        entry.tmdbId ?? null,
        entry.tmdbMediaType ?? null,
        entry.tmdbPremiereDate ?? null
      );
  }
}

function buildFixture(): void {
  libraryVideos.length = 0;
  libraryCollections.length = 0;

  libraryVideos.push(
    video({
      id: "v-origins",
      title: "Human Origins",
      description: "Where we came from.",
      date: "20260103",
      videoPath: "/videos/Kurzgesagt/human-origins.mp4",
      thumbnailPath: "/images/origins.jpg",
      authorAvatarPath: "/avatars/kurzgesagt.jpg",
      duration: "541",
      tags: ["science"],
      subtitles: [
        { language: "en", filename: "origins.en.vtt", path: "/subtitles/origins.en.vtt" },
      ],
    }),
    video({
      id: "v-shared",
      title: "The Egg",
      description: "A short story.",
      date: "20260214",
      // Belongs to BOTH playlists.
      videoPath: "/videos/Kurzgesagt/the-egg.mp4",
      thumbnailPath: "/images/egg.jpg",
      duration: "372",
    }),
    video({
      id: "v-ants",
      title: "How Many Ants Live On Earth?",
      description: "A lot.",
      date: "20260525",
      videoPath: "/videos/Kurzgesagt/ants.mp4",
      duration: "620",
    }),
    video({
      id: "v-loose",
      title: "Unlisted Extra",
      description: "Belongs to no playlist.",
      date: "20260601",
      videoPath: "/videos/Kurzgesagt/extra.mp4",
      duration: "120",
    })
  );

  libraryCollections.push(
    {
      id: "c-existential",
      name: "Existential Crisis",
      title: "Existential Crisis",
      createdAt: "2026-01-01T00:00:00.000Z",
      sourceType: "playlist",
      sourcePlatform: "youtube",
      sourceChannelId: CHANNEL_ID,
      sourceChannelName: "Kurzgesagt – In a Nutshell",
      description: "Videos about <everything> & nothing.",
      videos: ["v-origins", "v-shared"],
    } as Collection,
    {
      id: "c-space",
      name: "Space Time",
      title: "Space Time",
      createdAt: "2026-02-01T00:00:00.000Z",
      sourceType: "playlist",
      sourcePlatform: "youtube",
      sourceChannelId: CHANNEL_ID,
      sourceChannelName: "Kurzgesagt – In a Nutshell",
      description: "Everything about spacetime.",
      videos: ["v-shared", "v-ants"],
    } as Collection
  );

  writeFile(path.join(testPaths.videos, "Kurzgesagt/human-origins.mp4"), "origins-bytes");
  writeFile(path.join(testPaths.videos, "Kurzgesagt/the-egg.mp4"), "egg-bytes");
  writeFile(path.join(testPaths.videos, "Kurzgesagt/ants.mp4"), "ants-bytes");
  writeFile(path.join(testPaths.videos, "Kurzgesagt/extra.mp4"), "extra-bytes");
  writeFile(path.join(testPaths.images, "origins.jpg"), "origins-thumb");
  writeFile(path.join(testPaths.images, "egg.jpg"), "egg-thumb");
  writeFile(path.join(testPaths.avatars, "kurzgesagt.jpg"), "avatar-bytes");
  writeFile(path.join(testPaths.subtitles, "origins.en.vtt"), "WEBVTT");

  seedRows();
}

async function rebuild() {
  return syncPlaylistTvLibrary({ mode: "nfo", copyFallbackEnabled: true });
}

describe("playlist_tv end-to-end fixture (issue #411)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    for (const dir of [
      testPaths.videos,
      testPaths.images,
      testPaths.imagesSmall,
      testPaths.avatars,
      testPaths.subtitles,
      testPaths.mediaLibrary,
    ]) {
      fs.ensureDirSync(dir);
    }
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
    buildFixture();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  it("produces exactly the documented tree", async () => {
    const result = await rebuild();

    expect(result.failures).toEqual([]);
    expect(result.reconcileIssues).toEqual([]);

    expect(listMirror()).toEqual([
      // One show for the one author.
      "Kurzgesagt – In a Nutshell/Season 00/S00E001 - Unlisted Extra.mp4",
      "Kurzgesagt – In a Nutshell/Season 00/S00E001 - Unlisted Extra.nfo",
      "Kurzgesagt – In a Nutshell/Season 00/season.nfo",
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins-thumb.jpg",
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.en.vtt",
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4",
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.nfo",
      "Kurzgesagt – In a Nutshell/Season 01/S01E002 - The Egg-thumb.jpg",
      "Kurzgesagt – In a Nutshell/Season 01/S01E002 - The Egg.mp4",
      "Kurzgesagt – In a Nutshell/Season 01/S01E002 - The Egg.nfo",
      "Kurzgesagt – In a Nutshell/Season 01/season.nfo",
      "Kurzgesagt – In a Nutshell/Season 02/S02E001 - The Egg-thumb.jpg",
      "Kurzgesagt – In a Nutshell/Season 02/S02E001 - The Egg.mp4",
      "Kurzgesagt – In a Nutshell/Season 02/S02E001 - The Egg.nfo",
      "Kurzgesagt – In a Nutshell/Season 02/S02E002 - How Many Ants Live On Earth.mp4",
      "Kurzgesagt – In a Nutshell/Season 02/S02E002 - How Many Ants Live On Earth.nfo",
      "Kurzgesagt – In a Nutshell/Season 02/season.nfo",
      "Kurzgesagt – In a Nutshell/poster.jpg",
      "Kurzgesagt – In a Nutshell/tvshow.nfo",
    ]);

    expect(result.counts).toMatchObject({
      shows: 1,
      seasons: 3,
      episodes: 5,
      copiedMedia: 0,
    });
  });

  it("writes a valid tvshow.nfo with a stable identity-derived id", async () => {
    await rebuild();
    const $ = readXml("Kurzgesagt – In a Nutshell", "tvshow.nfo");

    expect($("tvshow").length).toBe(1);
    expect($("tvshow > title").text()).toBe("Kurzgesagt – In a Nutshell");
    expect($("tvshow > id").text()).toBe(
      `mytube:show:youtube:channel-id:${CHANNEL_ID}`
    );
    expect($('tvshow > uniqueid[type="mytube"]').attr("default")).toBe("true");
    // Earliest exported episode date.
    expect($("tvshow > premiered").text()).toBe("2026-01-03");
    // A show plot is never borrowed from a video description.
    expect($("tvshow > plot").text()).toBe("");
    for (const description of ["Where we came from.", "A short story.", "A lot."]) {
      expect(fs.readFileSync(mirror("Kurzgesagt – In a Nutshell", "tvshow.nfo"), "utf8"))
        .not.toContain(description);
    }
  });

  it("writes one valid season.nfo per season, including Season 00", async () => {
    await rebuild();

    const seasonOne = readXml("Kurzgesagt – In a Nutshell", "Season 01", "season.nfo");
    expect(seasonOne("season").length).toBe(1);
    expect(seasonOne("season > title").text()).toBe("Existential Crisis");
    expect(seasonOne("season > seasonnumber").text()).toBe("1");
    // XML metacharacters in the playlist description survive a real parse.
    expect(seasonOne("season > plot").text()).toBe(
      "Videos about <everything> & nothing."
    );
    expect(seasonOne("season > id").text()).toBe("mytube:season:c-existential");

    const seasonTwo = readXml("Kurzgesagt – In a Nutshell", "Season 02", "season.nfo");
    expect(seasonTwo("season > title").text()).toBe("Space Time");
    expect(seasonTwo("season > seasonnumber").text()).toBe("2");

    const seasonZero = readXml("Kurzgesagt – In a Nutshell", "Season 00", "season.nfo");
    expect(seasonZero("season > title").text()).toBe("Specials / Unassigned");
    expect(seasonZero("season > seasonnumber").text()).toBe("0");
    expect(seasonZero("season > plot").text()).toBe("");
    // Season 00 has no collection, so its id is show-derived.
    expect(seasonZero("season > id").text()).toMatch(/^mytube:season:mss_[0-9a-f]+:0$/);
  });

  it("writes episode NFOs whose numbers agree with the filename token", async () => {
    await rebuild();

    const $ = readXml(
      "Kurzgesagt – In a Nutshell",
      "Season 01",
      "S01E001 - Human Origins.nfo"
    );

    expect($("episodedetails").length).toBe(1);
    expect($("episodedetails > title").text()).toBe("Human Origins");
    expect($("episodedetails > showtitle").text()).toBe("Kurzgesagt – In a Nutshell");
    expect($("episodedetails > season").text()).toBe("1");
    expect($("episodedetails > episode").text()).toBe("1");
    expect($("episodedetails > aired").text()).toBe("2026-01-03");
    expect($("episodedetails > runtime").text()).toBe("10");
    expect($("episodedetails > thumb").text()).toBe(
      "S01E001 - Human Origins-thumb.jpg"
    );
  });

  it("exports the duplicate video into both seasons with distinct unique ids", async () => {
    await rebuild();

    const inSeasonOne = readXml(
      "Kurzgesagt – In a Nutshell",
      "Season 01",
      "S01E002 - The Egg.nfo"
    );
    const inSeasonTwo = readXml(
      "Kurzgesagt – In a Nutshell",
      "Season 02",
      "S02E001 - The Egg.nfo"
    );

    expect(inSeasonOne("episodedetails > season").text()).toBe("1");
    expect(inSeasonOne("episodedetails > episode").text()).toBe("2");
    expect(inSeasonTwo("episodedetails > season").text()).toBe("2");
    expect(inSeasonTwo("episodedetails > episode").text()).toBe("1");

    const idOne = inSeasonOne('episodedetails > uniqueid[type="mytube"]').text();
    const idTwo = inSeasonTwo('episodedetails > uniqueid[type="mytube"]').text();
    expect(idOne).not.toBe(idTwo);
    // A media server keying on the bare video id would collapse these.
    expect(idOne).not.toBe("mytube:video:v-shared");

    // Both play: same bytes, same inode, one payload on disk.
    const first = mirror("Kurzgesagt – In a Nutshell", "Season 01", "S01E002 - The Egg.mp4");
    const second = mirror("Kurzgesagt – In a Nutshell", "Season 02", "S02E001 - The Egg.mp4");
    expect(fs.readFileSync(first, "utf8")).toBe("egg-bytes");
    expect(fs.readFileSync(second, "utf8")).toBe("egg-bytes");
    expect(fs.statSync(first).ino).toBe(fs.statSync(second).ino);
    expect(fs.statSync(first).ino).toBe(
      fs.statSync(path.join(testPaths.videos, "Kurzgesagt/the-egg.mp4")).ino
    );
  });

  it("places the unassigned video in Season 00, not in its own show", async () => {
    await rebuild();

    const $ = readXml(
      "Kurzgesagt – In a Nutshell",
      "Season 00",
      "S00E001 - Unlisted Extra.nfo"
    );
    expect($("episodedetails > season").text()).toBe("0");
    expect($("episodedetails > showtitle").text()).toBe(
      "Kurzgesagt – In a Nutshell"
    );

    // Exactly one show directory exists.
    expect(
      fs
        .readdirSync(testPaths.mediaLibrary, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    ).toEqual(["Kurzgesagt – In a Nutshell"]);
  });

  it("uses the author avatar as the show poster", async () => {
    await rebuild();

    expect(
      fs.readFileSync(mirror("Kurzgesagt – In a Nutshell", "poster.jpg"), "utf8")
    ).toBe("avatar-bytes");
  });

  it("is idempotent and leaves originals untouched", async () => {
    await rebuild();
    const firstTree = listMirror();
    const stats = new Map(
      firstTree.map((relativePath) => [
        relativePath,
        fs.statSync(mirror(...relativePath.split("/"))).mtimeMs,
      ])
    );

    const second = await rebuild();

    expect(second.failures).toEqual([]);
    expect(listMirror()).toEqual(firstTree);
    expect(second.counts.linkedMedia).toBe(0);
    expect(second.counts.copiedMedia).toBe(0);
    expect(second.counts.removedArtifacts).toBe(0);
    for (const [relativePath, mtime] of stats) {
      expect(fs.statSync(mirror(...relativePath.split("/"))).mtimeMs).toBe(mtime);
    }

    for (const [name, contents] of [
      ["human-origins.mp4", "origins-bytes"],
      ["the-egg.mp4", "egg-bytes"],
      ["ants.mp4", "ants-bytes"],
      ["extra.mp4", "extra-bytes"],
    ] as const) {
      expect(
        fs.readFileSync(path.join(testPaths.videos, "Kurzgesagt", name), "utf8")
      ).toBe(contents);
    }
  });

  it("keeps numbering stable when an upstream playlist is reordered", async () => {
    await rebuild();

    // The upstream playlist flips order; MyTube re-imports it.
    libraryCollections[0].videos = ["v-shared", "v-origins"];
    const result = await rebuild();

    expect(result.failures).toEqual([]);
    // Same paths as before: no season-wide renumbering.
    expect(listMirror()).toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4"
    );
    expect(listMirror()).toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E002 - The Egg.mp4"
    );
  });

  it("gives a newly discovered playlist the next season number", async () => {
    await rebuild();

    libraryVideos.push(
      video({
        id: "v-new",
        title: "Brand New",
        date: "20260701",
        videoPath: "/videos/Kurzgesagt/new.mp4",
        duration: "60",
      })
    );
    libraryCollections.push({
      id: "c-new",
      name: "Newest Playlist",
      title: "Newest Playlist",
      createdAt: "2026-06-01T00:00:00.000Z",
      sourceType: "playlist",
      sourcePlatform: "youtube",
      sourceChannelId: CHANNEL_ID,
      sourceChannelName: "Kurzgesagt – In a Nutshell",
      videos: ["v-new"],
    } as Collection);
    writeFile(path.join(testPaths.videos, "Kurzgesagt/new.mp4"), "new-bytes");
    seedRows();

    await rebuild();

    expect(listMirror()).toContain(
      "Kurzgesagt – In a Nutshell/Season 03/S03E001 - Brand New.mp4"
    );
  });

  it("moves a video to Season 00 and sweeps its old season file when it leaves every playlist", async () => {
    await rebuild();

    // v-ants leaves Space Time and belongs to nothing.
    libraryCollections[1].videos = ["v-shared"];
    const result = await rebuild();

    expect(result.failures).toEqual([]);
    const tree = listMirror();
    expect(tree).not.toContain(
      "Kurzgesagt – In a Nutshell/Season 02/S02E002 - How Many Ants Live On Earth.mp4"
    );
    expect(tree).toContain(
      "Kurzgesagt – In a Nutshell/Season 00/S00E002 - How Many Ants Live On Earth.mp4"
    );
    // The original is untouched.
    expect(
      fs.readFileSync(path.join(testPaths.videos, "Kurzgesagt/ants.mp4"), "utf8")
    ).toBe("ants-bytes");
  });

  /**
   * Collection-as-show, exercised in the same fixture so author-show behavior is
   * proven unchanged in the same run.
   */
  describe("collection-as-show", () => {
    function markExistentialAsShow(
      overrides: {
        mediaServerTitle?: string;
        tmdbId?: number;
        tmdbMediaType?: "tv" | "movie";
        tmdbPremiereDate?: string;
      } = {}
    ): void {
      testDb.sqlite
        .prepare(
          `UPDATE collections
              SET export_as_show = 1,
                  media_server_title = ?,
                  tmdb_id = ?,
                  tmdb_media_type = ?,
                  tmdb_premiere_date = ?
            WHERE id = 'c-existential'`
        )
        .run(
          overrides.mediaServerTitle ?? null,
          overrides.tmdbId ?? null,
          overrides.tmdbMediaType ?? null,
          overrides.tmdbPremiereDate ?? null
        );
      libraryCollections[0].exportAsShow = 1;
    }

    it("coexists with the author show in one mirror", async () => {
      await rebuild();
      markExistentialAsShow({ mediaServerTitle: "人民的名义" });
      const result = await rebuild();

      expect(result.failures).toEqual([]);

      const showDirs = fs
        .readdirSync(testPaths.mediaLibrary, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      // The author show survives with its remaining playlist; the promoted
      // collection is now its own show.
      expect(showDirs).toEqual(["Kurzgesagt – In a Nutshell", "人民的名义"]);

      const tree = listMirror();
      expect(tree).toContain("人民的名义/tvshow.nfo");
      expect(tree).toContain("人民的名义/Season 01/season.nfo");
      // Its episodes left the author show's Season 01.
      expect(
        tree.filter((p) =>
          p.startsWith("Kurzgesagt – In a Nutshell/Season 01/")
        )
      ).toEqual([]);
    });

    it("keeps episode numbers and filenames across the promotion", async () => {
      await rebuild();
      const before = listMirror()
        .filter((p) => p.startsWith("Kurzgesagt – In a Nutshell/Season 01/"))
        .map((p) => p.split("/").pop() as string)
        .filter((name) => name.endsWith(".mp4"))
        .sort();

      markExistentialAsShow({ mediaServerTitle: "人民的名义" });
      await rebuild();

      const after = listMirror()
        .filter((p) => p.startsWith("人民的名义/Season 01/"))
        .map((p) => p.split("/").pop() as string)
        .filter((name) => name.endsWith(".mp4"))
        .sort();

      // Same SxxExxx tokens and titles — only the show directory changed.
      expect(after).toEqual(before);
    });

    it("writes the TMDB identity and premiere date into tvshow.nfo", async () => {
      await rebuild();
      markExistentialAsShow({
        mediaServerTitle: "人民的名义",
        tmdbId: 72517,
        tmdbMediaType: "tv",
        tmdbPremiereDate: "2017-03-28",
      });
      await rebuild();

      const $ = readXml("人民的名义", "tvshow.nfo");
      expect($("tvshow > title").text()).toBe("人民的名义");
      expect($('tvshow > uniqueid[type="tmdb"]').text()).toBe("72517");
      expect($('tvshow > uniqueid[type="mytube"]').attr("default")).toBe("true");
      // The real air date, not the earliest episode upload.
      expect($("tvshow > premiered").text()).toBe("2017-03-28");
    });

    it("posters a collection show from an episode, never the author avatar", async () => {
      await rebuild();
      // The author show uses the avatar.
      expect(
        fs.readFileSync(
          mirror("Kurzgesagt – In a Nutshell", "poster.jpg"),
          "utf8"
        )
      ).toBe("avatar-bytes");

      markExistentialAsShow({ mediaServerTitle: "人民的名义" });
      await rebuild();

      // The collection show uses its first episode's thumbnail instead.
      expect(fs.readFileSync(mirror("人民的名义", "poster.jpg"), "utf8")).toBe(
        "origins-thumb"
      );
      // The author show keeps its avatar.
      expect(
        fs.readFileSync(
          mirror("Kurzgesagt – In a Nutshell", "poster.jpg"),
          "utf8"
        )
      ).toBe("avatar-bytes");
    });

    it("keeps the duplicate video in both the collection show and the other playlist", async () => {
      await rebuild();
      markExistentialAsShow({ mediaServerTitle: "人民的名义" });
      await rebuild();

      const inCollectionShow = mirror(
        "人民的名义",
        "Season 01",
        "S01E002 - The Egg.mp4"
      );
      const inAuthorSeason = mirror(
        "Kurzgesagt – In a Nutshell",
        "Season 02",
        "S02E001 - The Egg.mp4"
      );

      expect(fs.readFileSync(inCollectionShow, "utf8")).toBe("egg-bytes");
      expect(fs.readFileSync(inAuthorSeason, "utf8")).toBe("egg-bytes");
      // One payload on disk, shared with the original.
      expect(fs.statSync(inCollectionShow).ino).toBe(
        fs.statSync(inAuthorSeason).ino
      );
      expect(fs.statSync(inCollectionShow).ino).toBe(
        fs.statSync(path.join(testPaths.videos, "Kurzgesagt/the-egg.mp4")).ino
      );
    });

    it("is idempotent after promotion and leaves originals untouched", async () => {
      await rebuild();
      markExistentialAsShow({ mediaServerTitle: "人民的名义" });
      await rebuild();

      const tree = listMirror();
      const mtimes = new Map(
        tree.map((p) => [p, fs.statSync(mirror(...p.split("/"))).mtimeMs])
      );

      const second = await rebuild();

      expect(second.failures).toEqual([]);
      expect(listMirror()).toEqual(tree);
      expect(second.counts.linkedMedia).toBe(0);
      expect(second.counts.copiedMedia).toBe(0);
      expect(second.counts.removedArtifacts).toBe(0);
      for (const [p, mtime] of mtimes) {
        expect(fs.statSync(mirror(...p.split("/"))).mtimeMs).toBe(mtime);
      }

      for (const [name, contents] of [
        ["human-origins.mp4", "origins-bytes"],
        ["the-egg.mp4", "egg-bytes"],
        ["ants.mp4", "ants-bytes"],
        ["extra.mp4", "extra-bytes"],
      ] as const) {
        expect(
          fs.readFileSync(path.join(testPaths.videos, "Kurzgesagt", name), "utf8")
        ).toBe(contents);
      }
    });

    it("falls back to the collection title when no resolved title exists", async () => {
      await rebuild();
      markExistentialAsShow();
      await rebuild();

      expect(listMirror()).toContain("Existential Crisis/tvshow.nfo");
    });
  });

  it("every generated NFO parses as well-formed XML", async () => {
    await rebuild();

    const nfoFiles = listMirror().filter((entry) => entry.endsWith(".nfo"));
    expect(nfoFiles.length).toBe(9);

    for (const relativePath of nfoFiles) {
      const raw = fs.readFileSync(mirror(...relativePath.split("/")), "utf8");
      expect(raw.startsWith("<!-- Generated by MyTube.")).toBe(true);
      expect(raw.endsWith("\n")).toBe(true);

      const $ = cheerio.load(raw, { xmlMode: true });
      // Inspect the document's own root elements rather than searching by tag
      // name: an episode NFO legitimately contains a <season> CHILD tag, so a
      // tag-name search would report two "roots" for a perfectly valid file.
      const rootTags = $.root()
        .children()
        .toArray()
        .map((node) => (node as { tagName?: string }).tagName)
        .filter((tag): tag is string => Boolean(tag));

      expect(rootTags).toHaveLength(1);
      expect(["tvshow", "season", "episodedetails"]).toContain(rootTags[0]);

      // The root matches what the filename implies.
      const filename = relativePath.split("/").pop() as string;
      if (filename === "tvshow.nfo") {
        expect(rootTags[0]).toBe("tvshow");
      } else if (filename === "season.nfo") {
        expect(rootTags[0]).toBe("season");
      } else {
        expect(rootTags[0]).toBe("episodedetails");
      }
    }
  });

  /**
   * The yielding materializer exists so a large rebuild does not hold the event
   * loop, but the whole point is lost unless the rebuild actually calls it: the
   * regression this pins is a full library sync that materializes synchronously
   * and only looks asynchronous to its caller, leaving the job's status and
   * cancel endpoints unanswerable for the length of the run.
   */
  it("yields to the event loop while rebuilding the whole library", async () => {
    let rebuildSettled = false;
    let queuedWorkRanWhileRebuilding = false;

    const rebuilding = rebuild().then((value) => {
      rebuildSettled = true;
      return value;
    });
    const queued = new Promise<void>((resolve) => {
      setImmediate(() => {
        queuedWorkRanWhileRebuilding = !rebuildSettled;
        resolve();
      });
    });

    await queued;
    const result = await rebuilding;

    // The queued callback got its turn while the rebuild was still in flight. A
    // synchronous materialization behind an async signature settles the promise
    // before ever returning to the loop, so the callback would find the rebuild
    // already finished.
    expect(queuedWorkRanWhileRebuilding).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.counts.episodes).toBeGreaterThan(0);
  });

  it("stops the rebuild when cancellation arrives while it runs", async () => {
    let cancelled = false;
    setImmediate(() => {
      cancelled = true;
    });

    const result = await syncPlaylistTvLibrary({
      mode: "nfo",
      copyFallbackEnabled: true,
      isCancelled: () => cancelled,
    });

    // The cancel flag can only flip if the rebuild gives the event loop a turn,
    // so a mirror short of the full fixture is the proof that it did.
    expect(listMirror().filter((entry) => entry.endsWith(".nfo")).length).toBeLessThan(9);
    expect(result.failures).toEqual([]);
  });
});

/**
 * Regression: a batch rename (author-folder or filename-template change) moves
 * the ORIGINAL file. The mirror derives its paths from the show/season/episode
 * allocation, never from the original filename, so nothing in the mirror may
 * move — only the hard link's source changes.
 *
 * The dangerous combination is a rename AFTER an upstream playlist reorder.
 * The reorder legitimately updates sourcePosition while leaving the episode
 * number alone; if the rename then dropped and reallocated the assignment, the
 * now-taken sourcePosition would push the video onto a fresh number, renaming a
 * file the media server already scanned and destroying its watch state.
 */
describe("playlist_tv survives a batch rename (issue #411)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    for (const dir of [
      testPaths.videos,
      testPaths.images,
      testPaths.imagesSmall,
      testPaths.avatars,
      testPaths.subtitles,
      testPaths.mediaLibrary,
    ]) {
      fs.ensureDirSync(dir);
    }
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
    buildFixture();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  /** Moves the original file and updates the row, as the rename job does. */
  function renameOriginal(videoId: string, newRelativePath: string): void {
    const target = libraryVideos.find((entry) => entry.id === videoId);
    if (!target) throw new Error(`No fixture video ${videoId}`);
    const previous = { ...target } as Video;

    fs.moveSync(
      path.join(testPaths.videos, (target.videoPath as string).replace("/videos/", "")),
      path.join(testPaths.videos, newRelativePath),
      { overwrite: false }
    );
    target.videoPath = `/videos/${newRelativePath}`;

    syncMediaServerArtifactsForRelocatedRecord(previous, target, {
      modeOverride: "nfo",
      layoutOverride: "playlist_tv",
    });
  }

  it("leaves the mirror byte-identical when an original is renamed", async () => {
    await rebuild();
    const before = listMirror();
    const originsStat = fs.statSync(
      mirror("Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4")
    );

    renameOriginal("v-origins", "Kurzgesagt/2026-01-03 - Human Origins [xyz].mp4");

    expect(listMirror()).toEqual(before);

    // Still one inode shared with the original at its NEW path.
    const after = fs.statSync(
      mirror("Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4")
    );
    expect(after.nlink).toBeGreaterThan(1);
    expect(after.ino).not.toBe(0);
    expect(originsStat.size).toBe(after.size);
  });

  it("keeps episode numbers when a rename follows an upstream reorder", async () => {
    await rebuild();

    // Upstream flips the playlist. Numbering must not move.
    const playlist = libraryCollections.find((c) => c.id === "c-existential");
    if (!playlist) throw new Error("fixture playlist missing");
    playlist.videos = ["v-shared", "v-origins"];
    await rebuild();

    const afterReorder = listMirror();
    expect(afterReorder).toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4"
    );

    renameOriginal("v-origins", "Kurzgesagt/renamed-origins.mp4");

    // The whole point: no renumber, no new file, no lost file.
    expect(listMirror()).toEqual(afterReorder);
  });

  it("does not renumber when every video is renamed, as a batch rename does", async () => {
    await rebuild();
    const before = listMirror();

    renameOriginal("v-origins", "Kurzgesagt/a-origins.mp4");
    renameOriginal("v-shared", "Kurzgesagt/b-egg.mp4");
    renameOriginal("v-ants", "Kurzgesagt/c-ants.mp4");
    renameOriginal("v-loose", "Kurzgesagt/d-extra.mp4");

    expect(listMirror()).toEqual(before);
  });
});

/**
 * Regression coverage for the review findings on PR #412. Each of these
 * describes a state the incremental paths could previously reach and not
 * recover from without a full rebuild.
 */
describe("incremental reconcile edge cases (PR #412 review)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    for (const dir of [
      testPaths.videos,
      testPaths.images,
      testPaths.imagesSmall,
      testPaths.avatars,
      testPaths.subtitles,
      testPaths.mediaLibrary,
    ]) {
      fs.ensureDirSync(dir);
    }
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
    buildFixture();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  /**
   * The unlink hook runs after the membership row is gone, so the departed
   * collection is exactly the one missing from any scope derived from current
   * memberships - and the stale sweep only looks at in-scope collections.
   */
  it("removes the episode a video was unlinked from", async () => {
    await rebuild();
    expect(listMirror()).toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4"
    );

    // Commit the unlink, then reconcile through the incremental video path.
    const playlist = libraryCollections.find((c) => c.id === "c-existential");
    if (!playlist) throw new Error("fixture playlist missing");
    playlist.videos = playlist.videos.filter((id) => id !== "v-origins");
    testDb.sqlite
      .prepare("DELETE FROM collection_videos WHERE collection_id=? AND video_id=?")
      .run("c-existential", "v-origins");

    syncPlaylistTvForVideo("v-origins", { mode: "nfo", copyFallbackEnabled: true });

    const after = listMirror();
    expect(after).not.toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4"
    );
    // Its last playlist membership is gone, so it belongs in Season 00 now.
    expect(after.some((p) => p.includes("Season 00") && p.includes("Human Origins"))).toBe(
      true
    );
  });

  it("keeps other seasons intact when one membership is removed", async () => {
    await rebuild();
    const playlist = libraryCollections.find((c) => c.id === "c-existential");
    if (!playlist) throw new Error("fixture playlist missing");
    playlist.videos = playlist.videos.filter((id) => id !== "v-shared");
    testDb.sqlite
      .prepare("DELETE FROM collection_videos WHERE collection_id=? AND video_id=?")
      .run("c-existential", "v-shared");

    syncPlaylistTvForVideo("v-shared", { mode: "nfo", copyFallbackEnabled: true });

    const after = listMirror();
    // Season 02 membership survives, so no Season 00 special appears.
    expect(after).toContain(
      "Kurzgesagt – In a Nutshell/Season 02/S02E001 - The Egg.mp4"
    );
    expect(after).not.toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E002 - The Egg.mp4"
    );
    expect(after.some((p) => p.includes("Season 00") && p.includes("The Egg"))).toBe(false);
  });

  /**
   * Promotion must release the author-season attachment, or a later toggle-off
   * reuses the retired season number instead of allocating a new one.
   */
  it("releases the author season attachment on promotion", async () => {
    await rebuild();

    const before = testDb.sqlite
      .prepare("SELECT media_server_show_id AS showId, media_server_season_number AS season FROM collections WHERE id=?")
      .get("c-existential") as { showId: string | null; season: number | null };
    expect(before.showId).toBeTruthy();
    expect(before.season).toBe(1);

    testDb.sqlite
      .prepare("UPDATE collections SET export_as_show=1 WHERE id=?")
      .run("c-existential");
    await rebuild();

    const after = testDb.sqlite
      .prepare("SELECT media_server_show_id AS showId, media_server_season_number AS season FROM collections WHERE id=?")
      .get("c-existential") as { showId: string | null; season: number | null };
    expect(after.showId).toBeNull();
    expect(after.season).toBeNull();
  });

  it("gives a demoted collection a new season number, never the retired one", async () => {
    await rebuild();
    testDb.sqlite.prepare("UPDATE collections SET export_as_show=1 WHERE id=?").run("c-existential");
    await rebuild();

    // Toggle back off: it returns to the author show as a NEW season.
    testDb.sqlite.prepare("UPDATE collections SET export_as_show=0 WHERE id=?").run("c-existential");
    await rebuild();

    const after = testDb.sqlite
      .prepare("SELECT media_server_season_number AS season FROM collections WHERE id=?")
      .get("c-existential") as { season: number | null };
    expect(after.season).not.toBe(1);
    expect(after.season).toBeGreaterThan(2);
  });
});

/**
 * Second review round on PR #412.
 *
 * tvshow.nfo, season.nfo and poster.jpg belong to the show, not to any episode,
 * so per-assignment cleanup cannot reach them - and a directory still holding
 * them is not empty, so pruning leaves it behind too.
 */
describe("deletion leaves no empty show (PR #412 review round 2)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    for (const dir of [
      testPaths.videos,
      testPaths.images,
      testPaths.imagesSmall,
      testPaths.avatars,
      testPaths.subtitles,
      testPaths.mediaLibrary,
    ]) {
      fs.ensureDirSync(dir);
    }
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
    buildFixture();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  /** Mirrors videoDeletion: clean, drop the row, then reconcile the shows. */
  function deleteVideo(videoId: string): void {
    const showIds = removePlaylistTvArtifactsForVideo(videoId).affectedShowIds;
    const index = libraryVideos.findIndex((v) => v.id === videoId);
    if (index >= 0) libraryVideos.splice(index, 1);
    testDb.sqlite.prepare("DELETE FROM videos WHERE id=?").run(videoId);
    syncPlaylistTvForShows(showIds, { mode: "nfo", copyFallbackEnabled: true });
  }

  it("removes the whole show when its last video is deleted", async () => {
    await rebuild();
    expect(listMirror().some((p) => p.endsWith("tvshow.nfo"))).toBe(true);

    for (const id of libraryVideos.map((v) => v.id)) {
      deleteVideo(id);
    }

    expect(listMirror()).toEqual([]);
  });

  it("keeps the show when only one of its videos is deleted", async () => {
    await rebuild();

    deleteVideo("v-loose");

    const after = listMirror();
    expect(after).toContain("Kurzgesagt – In a Nutshell/tvshow.nfo");
    expect(after).toContain(
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4"
    );
    // Season 00 held only that video, so the season goes with it.
    expect(after.some((p) => p.includes("Season 00"))).toBe(false);
  });
});

/**
 * The ledger row is the only proof MyTube owns a mirror path. If an unlink fails
 * and the row is dropped anyway, the file survives untracked: cleanup can never
 * retry it, and the next rebuild treats the path as an unmanaged collision and
 * refuses to write there.
 */
describe("failed artifact removal keeps its ledger row (PR #412 review round 5)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    for (const dir of [
      testPaths.videos,
      testPaths.images,
      testPaths.imagesSmall,
      testPaths.avatars,
      testPaths.subtitles,
      testPaths.mediaLibrary,
    ]) {
      fs.ensureDirSync(dir);
    }
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
    buildFixture();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  it("retains the row when the path is no longer the file the ledger recorded", async () => {
    await rebuild();

    const episode =
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4";
    const absolute = mirror(episode);

    // Ownership mismatch: removal throws rather than deleting something it does
    // not recognise. A permission error would take the same path.
    fs.removeSync(absolute);
    fs.mkdirSync(absolute);

    const result = removePlaylistTvArtifactsForVideo("v-origins");
    expect(result.failures.length).toBeGreaterThan(0);

    // The row survives with its show reference intact, so a later sweep can retry.
    const row = testDb.sqlite
      .prepare(
        "SELECT relative_path AS relativePath, show_id AS showId, assignment_id AS assignmentId FROM media_server_export_artifacts WHERE relative_path = ?"
      )
      .get(episode) as
      | { relativePath: string; showId: string | null; assignmentId: string | null }
      | undefined;

    expect(row).toBeTruthy();
    expect(row?.showId).toBeTruthy();
    // The assignment is gone, so the FK cleared only that reference.
    expect(row?.assignmentId).toBeNull();
  });

  it("still drops rows for artifacts it did remove", async () => {
    await rebuild();

    const result = removePlaylistTvArtifactsForVideo("v-loose");
    expect(result.failures).toEqual([]);

    const remaining = testDb.sqlite
      .prepare(
        "SELECT count(*) AS c FROM media_server_export_artifacts WHERE relative_path LIKE ?"
      )
      .get("%Unlisted Extra%") as { c: number };

    expect(remaining.c).toBe(0);
  });
});


/**
 * The parked envelope is the ONLY copy of the downloader's extractor output:
 * nothing ever re-fetches it, and a later rebuild can only synthesize a reduced
 * `.info.json`. Consuming it before the sync has actually published means one
 * materialization failure loses those fields permanently.
 */
describe("parked source metadata survives a failed sync (PR #412 review)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    for (const dir of [
      testPaths.videos,
      testPaths.images,
      testPaths.imagesSmall,
      testPaths.avatars,
      testPaths.subtitles,
      testPaths.mediaLibrary,
    ]) {
      fs.ensureDirSync(dir);
    }
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
    buildFixture();
    clearPendingSourceInfo();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
    clearPendingSourceInfo();
  });

  const envelope = { channel_id: "UC-parked", extractor_only: "kept" };

  /** An untracked file on a planned path is the materializer's failure case. */
  function blockPlannedEpisodePath(): void {
    const blocked = path.join(
      testPaths.mediaLibrary,
      "Kurzgesagt – In a Nutshell/Season 01/S01E001 - Human Origins.mp4"
    );
    fs.ensureDirSync(path.dirname(blocked));
    fs.writeFileSync(blocked, "a user file", "utf8");
  }

  it("keeps the envelope when materialization reports a failure", () => {
    storePendingSourceInfo("v-origins", envelope);
    blockPlannedEpisodePath();

    const result = syncPlaylistTvForVideo("v-origins", {
      mode: "nfo_and_source_json",
      copyFallbackEnabled: true,
    });

    expect(result?.failures.length).toBeGreaterThan(0);
    // Still available, so the next attempt can publish the rich source JSON.
    expect(peekPendingSourceInfo("v-origins")).toEqual(envelope);
  });

  it("consumes the envelope once the sync publishes cleanly", () => {
    storePendingSourceInfo("v-origins", envelope);

    const result = syncPlaylistTvForVideo("v-origins", {
      mode: "nfo_and_source_json",
      copyFallbackEnabled: true,
    });

    expect(result?.failures).toEqual([]);
    expect(peekPendingSourceInfo("v-origins")).toBeUndefined();
  });

  it("leaves the envelope for the final hook on an intermediate sync", () => {
    storePendingSourceInfo("v-origins", envelope);

    syncPlaylistTvForVideo("v-origins", {
      mode: "nfo_and_source_json",
      copyFallbackEnabled: true,
      preservePendingSourceInfo: true,
    });

    expect(peekPendingSourceInfo("v-origins")).toEqual(envelope);
  });
});
