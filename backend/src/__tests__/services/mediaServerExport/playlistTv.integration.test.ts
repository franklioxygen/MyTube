import * as cheerio from "cheerio";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogTestDatabase } from "./helpers/catalogTestDb";

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-playlist-tv-"));
  return {
    root,
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
    imagesSmall: path.join(root, "images-small"),
    cloudThumbnailCache: path.join(root, "cloud-thumbnail-cache"),
    mediaLibrary: path.join(root, "media-library"),
  };
});

const mocks = vi.hoisted(() => ({ db: undefined as any, sqlite: undefined as any }));

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  CLOUD_THUMBNAIL_CACHE_DIR: testPaths.cloudThumbnailCache,
  SUBTITLES_DIR: testPaths.subtitles,
  VIDEOS_DIR: testPaths.videos,
  MEDIA_SERVER_LIBRARY_DIR: testPaths.mediaLibrary,
}));

vi.mock("../../../db", () => ({
  get db() {
    return mocks.db;
  },
  get sqlite() {
    return mocks.sqlite;
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  cleanupPlaylistTvLibrary,
  removePlaylistTvArtifactsForVideo,
  runPlaylistTvExport,
} from "../../../services/mediaServerExport/playlistTvSync";
import { ensureMediaServerExportTables } from "../../../services/storageService/migrations/schemaMigrations";

const { sqlite, db } = createCatalogTestDatabase();
mocks.db = db;
mocks.sqlite = sqlite;
// The columns and indexes this feature adds to `collections` come from the
// startup self-heal, not from the 0028 SQL — run the production function so the
// tests see exactly the schema a real deployment gets.
ensureMediaServerExportTables();

const CHANNEL_URL = "https://www.youtube.com/channel/UC1";

function writeFile(absolutePath: string, contents: string): void {
  fs.ensureDirSync(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function seedVideo(
  id: string,
  title: string,
  options: { subtitle?: boolean } = {}
): void {
  writeFile(path.join(testPaths.videos, "Kurzgesagt", `${id}.mp4`), `media-${id}`);
  writeFile(path.join(testPaths.images, "Kurzgesagt", `${id}.jpg`), `thumb-${id}`);
  if (options.subtitle) {
    writeFile(
      path.join(testPaths.subtitles, "Kurzgesagt", `${id}.en.vtt`),
      "WEBVTT"
    );
  }

  sqlite
    .prepare(
      `INSERT INTO videos (id, title, author, source, channel_url, video_path, thumbnail_path, author_avatar_path, subtitles, date, duration, media_type, created_at)
       VALUES (?, ?, 'Kurzgesagt', 'YouTube', ?, ?, ?, '/avatars/kurzgesagt.jpg', ?, '20260115', '600', 'video', ?)`
    )
    .run(
      id,
      title,
      CHANNEL_URL,
      `/videos/Kurzgesagt/${id}.mp4`,
      `/images/Kurzgesagt/${id}.jpg`,
      options.subtitle
        ? JSON.stringify([
            {
              language: "en",
              filename: `${id}.en.vtt`,
              path: `/subtitles/Kurzgesagt/${id}.en.vtt`,
            },
          ])
        : null,
      `2026-01-0${id.slice(-1)}T00:00:00.000Z`
    );
}

function seedCollection(
  id: string,
  title: string,
  description: string,
  createdAt: string,
  videoIds: string[]
): void {
  sqlite
    .prepare(
      `INSERT INTO collections (id, name, title, created_at, source_type, description, source_channel_url)
       VALUES (?, ?, ?, ?, 'playlist', ?, ?)`
    )
    .run(id, title, title, createdAt, description, CHANNEL_URL);
  videoIds.forEach((videoId, index) => {
    sqlite
      .prepare(
        'INSERT INTO collection_videos (collection_id, video_id, "order") VALUES (?, ?, ?)'
      )
      .run(id, videoId, index + 1);
  });
}

/** The fixture from the design: one author, two playlists, one duplicate, one unassigned. */
function seedFixture(): void {
  writeFile(path.join(testPaths.avatars, "kurzgesagt.jpg"), "avatar-bytes");
  seedVideo("v1", "Human Origins", { subtitle: true });
  seedVideo("v2", "Ants");
  seedVideo("v3", "The Egg");
  seedVideo("v4", "Unlisted Short");
  seedCollection(
    "col-a",
    "Space Time",
    "Everything about space.",
    "2026-01-01T00:00:00.000Z",
    ["v1", "v2"]
  );
  seedCollection(
    "col-b",
    "Best Of",
    "",
    "2026-02-01T00:00:00.000Z",
    ["v2", "v3"]
  );
}

function listMirror(): string[] {
  const results: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (fs.statSync(absolutePath).isDirectory()) {
        walk(absolutePath, relativePath);
      } else {
        results.push(relativePath);
      }
    }
  };
  if (fs.existsSync(testPaths.mediaLibrary)) {
    walk(testPaths.mediaLibrary, "");
  }
  return results.sort();
}

function mirrorPath(...segments: string[]): string {
  return path.join(testPaths.mediaLibrary, ...segments);
}

function parseNfo(...segments: string[]): cheerio.CheerioAPI {
  return cheerio.load(fs.readFileSync(mirrorPath(...segments), "utf8"), {
    xmlMode: true,
  });
}

function build(mode: "nfo" | "nfo_and_source_json" = "nfo") {
  return runPlaylistTvExport({ mode, copyFallback: true });
}

describe("mediaServerExport playlist_tv end to end", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fs.emptyDirSync(testPaths.root);
    sqlite.exec(
      "DELETE FROM media_server_export_artifacts; DELETE FROM media_server_episode_assignments; DELETE FROM media_server_shows; DELETE FROM collection_videos; DELETE FROM collections; DELETE FROM videos; DELETE FROM subscriptions;"
    );
    seedFixture();
  });

  afterAll(() => {
    sqlite.close();
    fs.removeSync(testPaths.root);
  });

  it("materializes the exact show/season/episode tree", () => {
    const result = build();

    expect(result.issues).toEqual([]);
    expect(result.plan.skips).toEqual([]);
    expect(listMirror()).toEqual([
      "Kurzgesagt/Season 00/S00E001 - Unlisted Short-thumb.jpg",
      "Kurzgesagt/Season 00/S00E001 - Unlisted Short.mp4",
      "Kurzgesagt/Season 00/S00E001 - Unlisted Short.nfo",
      "Kurzgesagt/Season 00/season.nfo",
      "Kurzgesagt/Season 01/S01E001 - Human Origins-thumb.jpg",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.en.vtt",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.mp4",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.nfo",
      "Kurzgesagt/Season 01/S01E002 - Ants-thumb.jpg",
      "Kurzgesagt/Season 01/S01E002 - Ants.mp4",
      "Kurzgesagt/Season 01/S01E002 - Ants.nfo",
      "Kurzgesagt/Season 01/season.nfo",
      "Kurzgesagt/Season 02/S02E001 - Ants-thumb.jpg",
      "Kurzgesagt/Season 02/S02E001 - Ants.mp4",
      "Kurzgesagt/Season 02/S02E001 - Ants.nfo",
      "Kurzgesagt/Season 02/S02E002 - The Egg-thumb.jpg",
      "Kurzgesagt/Season 02/S02E002 - The Egg.mp4",
      "Kurzgesagt/Season 02/S02E002 - The Egg.nfo",
      "Kurzgesagt/Season 02/season.nfo",
      "Kurzgesagt/poster.jpg",
      "Kurzgesagt/tvshow.nfo",
    ]);
    expect(result.counts).toMatchObject({
      shows: 1,
      seasons: 3,
      episodes: 5,
      linkedMedia: 5,
      copiedMedia: 0,
      removedArtifacts: 0,
    });
  });

  it("writes parseable show, season, and episode metadata", () => {
    build();

    const show = parseNfo("Kurzgesagt", "tvshow.nfo");
    expect(show("tvshow > title").text()).toBe("Kurzgesagt");
    expect(show("tvshow > premiered").text()).toBe("2026-01-15");

    const season = parseNfo("Kurzgesagt", "Season 01", "season.nfo");
    expect(season("season > title").text()).toBe("Space Time");
    expect(season("season > seasonnumber").text()).toBe("1");
    expect(season("season > plot").text()).toBe("Everything about space.");

    const specials = parseNfo("Kurzgesagt", "Season 00", "season.nfo");
    expect(specials("season > title").text()).toBe("Specials / Unassigned");
    expect(specials("season > seasonnumber").text()).toBe("0");

    const episode = parseNfo(
      "Kurzgesagt",
      "Season 02",
      "S02E002 - The Egg.nfo"
    );
    expect(episode("episodedetails > season").text()).toBe("2");
    expect(episode("episodedetails > episode").text()).toBe("2");
    expect(episode("episodedetails > thumb").text()).toBe(
      "S02E002 - The Egg-thumb.jpg"
    );
  });

  it("hard links duplicate occurrences and gives each its own unique id", () => {
    build();

    const source = fs.statSync(path.join(testPaths.videos, "Kurzgesagt", "v2.mp4"));
    const first = fs.statSync(mirrorPath("Kurzgesagt", "Season 01", "S01E002 - Ants.mp4"));
    const second = fs.statSync(mirrorPath("Kurzgesagt", "Season 02", "S02E001 - Ants.mp4"));
    expect(first.ino).toBe(source.ino);
    expect(second.ino).toBe(source.ino);

    const firstId = parseNfo("Kurzgesagt", "Season 01", "S01E002 - Ants.nfo")(
      "episodedetails > uniqueid"
    ).text();
    const secondId = parseNfo("Kurzgesagt", "Season 02", "S02E001 - Ants.nfo")(
      "episodedetails > uniqueid"
    ).text();
    expect(firstId).not.toBe(secondId);
    expect(firstId).toMatch(/^mytube:episode:.+:1:2:v2$/);
    expect(secondId).toMatch(/^mytube:episode:.+:2:1:v2$/);
  });

  it("copies artwork rather than linking it", () => {
    build();
    const avatar = fs.statSync(path.join(testPaths.avatars, "kurzgesagt.jpg"));
    const poster = fs.statSync(mirrorPath("Kurzgesagt", "poster.jpg"));
    expect(poster.ino).not.toBe(avatar.ino);
    expect(fs.readFileSync(mirrorPath("Kurzgesagt", "poster.jpg"), "utf8")).toBe(
      "avatar-bytes"
    );
  });

  it("is idempotent: a second run rewrites and relinks nothing", () => {
    build();
    const before = listMirror().map((relativePath) => {
      const stats = fs.statSync(mirrorPath(...relativePath.split("/")));
      return `${relativePath}:${stats.ino}:${stats.mtimeMs}`;
    });

    const second = build();
    expect(second.counts.linkedMedia).toBe(0);
    expect(second.counts.copiedMedia).toBe(0);
    expect(second.counts.removedArtifacts).toBe(0);
    expect(second.counts.unchangedArtifacts).toBeGreaterThan(0);
    expect(
      listMirror().map((relativePath) => {
        const stats = fs.statSync(mirrorPath(...relativePath.split("/")));
        return `${relativePath}:${stats.ino}:${stats.mtimeMs}`;
      })
    ).toEqual(before);
  });

  it("relinks after the source media is replaced", () => {
    build();
    const target = mirrorPath("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.mp4");
    const originalInode = fs.statSync(target).ino;

    const source = path.join(testPaths.videos, "Kurzgesagt", "v4.mp4");
    fs.removeSync(source);
    writeFile(source, "replaced-media");

    expect(build().counts.linkedMedia).toBe(1);
    expect(fs.readFileSync(target, "utf8")).toBe("replaced-media");
    expect(fs.statSync(target).ino).not.toBe(originalInode);
  });

  it("rewrites the NFO after a title edit without moving the media", () => {
    build();
    const mediaPath = mirrorPath("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.mp4");
    const mediaInode = fs.statSync(mediaPath).ino;

    sqlite.prepare("UPDATE videos SET title = 'Renamed Short' WHERE id = 'v4'").run();
    build();

    expect(fs.existsSync(mediaPath)).toBe(true);
    expect(fs.statSync(mediaPath).ino).toBe(mediaInode);
    expect(
      parseNfo("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.nfo")(
        "episodedetails > title"
      ).text()
    ).toBe("Renamed Short");
  });

  it("sweeps the occurrence a video left and republishes it under Specials", () => {
    build();
    sqlite
      .prepare("DELETE FROM collection_videos WHERE collection_id = 'col-b' AND video_id = 'v3'")
      .run();

    build();

    expect(fs.existsSync(mirrorPath("Kurzgesagt", "Season 02", "S02E002 - The Egg.mp4"))).toBe(
      false
    );
    expect(fs.existsSync(mirrorPath("Kurzgesagt", "Season 00", "S00E002 - The Egg.mp4"))).toBe(
      true
    );
  });

  it("never overwrites an untracked destination", () => {
    writeFile(
      mirrorPath("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.mp4"),
      "user-owned"
    );

    const result = build();

    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.mp4"),
        "utf8"
      )
    ).toBe("user-owned");
    expect(result.failures).toContainEqual(
      expect.objectContaining({ videoId: "v4", reason: "artifact_path_collision" })
    );
  });

  it("falls back to copying when hard links are unavailable", () => {
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      const error = new Error("cross-device link") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    });

    const result = runPlaylistTvExport({ mode: "nfo", copyFallback: true });

    expect(result.counts.copiedMedia).toBe(5);
    expect(result.counts.linkedMedia).toBe(0);
    expect(
      fs.readFileSync(mirrorPath("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.mp4"), "utf8")
    ).toBe("media-v4");
  });

  it("reports a typed failure and writes nothing when copy fallback is disabled", () => {
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      const error = new Error("cross-device link") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    });

    const result = runPlaylistTvExport({ mode: "nfo", copyFallback: false });

    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].reason).toBe("hard_link_failed_copy_disabled");
    expect(listMirror().some((entry) => entry.endsWith(".mp4"))).toBe(false);
    expect(listMirror().some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("writes source JSON only in nfo_and_source_json mode", () => {
    build("nfo_and_source_json");
    const jsonPath = mirrorPath(
      "Kurzgesagt",
      "Season 00",
      "S00E001 - Unlisted Short.info.json"
    );
    expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toMatchObject({
      id: "v4",
      title: "Unlisted Short",
      _mytube: { generatedBy: "mytube" },
    });

    build("nfo");
    expect(fs.existsSync(jsonPath)).toBe(false);
  });

  it("cleanup removes only tracked mirror files and preserves originals", () => {
    build();
    writeFile(mirrorPath("Kurzgesagt", "user-notes.txt"), "keep me");

    const { removedPaths, failures } = cleanupPlaylistTvLibrary();

    expect(failures).toEqual([]);
    expect(removedPaths.length).toBeGreaterThan(0);
    expect(listMirror()).toEqual(["Kurzgesagt/user-notes.txt"]);
    expect(
      fs.existsSync(path.join(testPaths.videos, "Kurzgesagt", "v1.mp4"))
    ).toBe(true);

    // Numbering survives so a later rebuild reproduces the same tree.
    const rebuilt = build();
    expect(rebuilt.counts.episodes).toBe(5);
    expect(
      fs.existsSync(mirrorPath("Kurzgesagt", "Season 02", "S02E002 - The Egg.mp4"))
    ).toBe(true);
  });

  it("removes every occurrence of a deleted video and the seasons it empties", () => {
    build();

    // v2 is in both playlists; v3 is the only other member of Season 02.
    removePlaylistTvArtifactsForVideo("v2");

    expect(listMirror()).toEqual([
      "Kurzgesagt/Season 00/S00E001 - Unlisted Short-thumb.jpg",
      "Kurzgesagt/Season 00/S00E001 - Unlisted Short.mp4",
      "Kurzgesagt/Season 00/S00E001 - Unlisted Short.nfo",
      "Kurzgesagt/Season 00/season.nfo",
      "Kurzgesagt/Season 01/S01E001 - Human Origins-thumb.jpg",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.en.vtt",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.mp4",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.nfo",
      "Kurzgesagt/Season 01/season.nfo",
      "Kurzgesagt/Season 02/S02E002 - The Egg-thumb.jpg",
      "Kurzgesagt/Season 02/S02E002 - The Egg.mp4",
      "Kurzgesagt/Season 02/S02E002 - The Egg.nfo",
      "Kurzgesagt/Season 02/season.nfo",
      "Kurzgesagt/poster.jpg",
      "Kurzgesagt/tvshow.nfo",
    ]);
    expect(
      fs.existsSync(path.join(testPaths.videos, "Kurzgesagt", "v2.mp4"))
    ).toBe(true);
  });

  it("removes the whole show tree once its last video is gone", () => {
    build();

    for (const videoId of ["v1", "v2", "v3", "v4"]) {
      removePlaylistTvArtifactsForVideo(videoId);
    }

    expect(listMirror()).toEqual([]);
  });

  it("refuses to replace or delete a symlink inside the mirror", () => {
    build();
    const target = mirrorPath("Kurzgesagt", "Season 00", "S00E001 - Unlisted Short.mp4");
    fs.removeSync(target);
    fs.symlinkSync(path.join(testPaths.videos, "Kurzgesagt", "v4.mp4"), target);

    const result = build();

    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ reason: "artifact_ownership_mismatch" })
    );
  });
});
