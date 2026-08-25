import fs from "fs-extra";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MediaServerEpisodeAssignment,
  MediaServerShow,
  Video,
} from "../../../services/storageService/types";

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-mirror-"));

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
        // Overlap with runtime self-heal migrations.
      }
    }
  }

  return { sqlite, db: drizzle(sqlite) };
});

vi.mock("../../../db", () => ({ db: testDb.db }));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { planMediaServerHierarchy } from "../../../services/mediaServerExport/hierarchyPlanner";
import {
  cleanupMediaServerMirror,
  cleanupMediaServerMirrorAsync,
  materializeMediaServerHierarchy,
  materializeMediaServerHierarchyAsync,
} from "../../../services/mediaServerExport/hierarchyMaterializer";
import {
  getArtifact,
  listArtifacts,
} from "../../../services/mediaServerExport/artifactLedger";
import type {
  MediaServerCatalogSnapshot,
  MediaServerSeason,
} from "../../../services/mediaServerExport/types";

function writeFile(targetPath: string, contents: string): void {
  fs.ensureDirSync(path.dirname(targetPath));
  fs.writeFileSync(targetPath, contents, "utf8");
}

function mirrorPath(...segments: string[]): string {
  return path.join(testPaths.mediaLibrary, ...segments);
}

function show(overrides: Partial<MediaServerShow> = {}): MediaServerShow {
  return {
    id: "show-1",
    identityKey: "youtube:channel-id:UC123",
    sourcePlatform: "youtube",
    title: "Kurzgesagt",
    description: "Optimistic nihilism.",
    directoryName: "Kurzgesagt",
    nextSeasonNumber: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function assignment(
  overrides: Partial<MediaServerEpisodeAssignment> = {}
): MediaServerEpisodeAssignment {
  return {
    id: "assign-1",
    showId: "show-1",
    collectionId: "c1",
    videoId: "v1",
    seasonNumber: 1,
    episodeNumber: 1,
    exportStem: "S01E001 - Ants",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "v1",
    title: "Ants",
    author: "Kurzgesagt",
    description: "A video about ants.",
    date: "20260525",
    sourceUrl: "https://example.com/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    videoPath: "/videos/ants.mp4",
    ...overrides,
  } as Video;
}

function snapshot(input: {
  shows?: MediaServerShow[];
  seasons?: MediaServerSeason[];
  assignments?: MediaServerEpisodeAssignment[];
  videos?: Video[];
}): MediaServerCatalogSnapshot {
  return {
    shows: input.shows ?? [show()],
    seasons: input.seasons ?? [
      {
        showId: "show-1",
        seasonNumber: 1,
        collectionId: "c1",
        title: "Space Time",
        plot: "Everything about spacetime.",
      },
    ],
    assignments: input.assignments ?? [assignment()],
    videosById: new Map((input.videos ?? [video()]).map((v) => [v.id, v])),
    // Read back from the ledger exactly as buildMediaServerCatalogSnapshot
    // does: the planner uses it to protect what a skipped episode already has
    // on disk, so an empty map here would hide that behavior entirely.
    artifactsByPath: new Map(
      listArtifacts().map((entry) => [entry.relativePath, entry])
    ),
  };
}

/**
 * The artifact ledger has real foreign keys to the catalog, so the fixture
 * shows/assignments must exist as rows before anything can be materialized —
 * exactly as the reconciler guarantees in production.
 */
function seedCatalog(input: Parameters<typeof snapshot>[0]): void {
  for (const entry of input.shows ?? [show()]) {
    testDb.sqlite
      .prepare(
        `INSERT OR IGNORE INTO media_server_shows
           (id, identity_key, source_platform, title, description, directory_name,
            next_season_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.identityKey,
        entry.sourcePlatform,
        entry.title,
        entry.description,
        entry.directoryName,
        entry.nextSeasonNumber,
        entry.createdAt,
        entry.updatedAt
      );
  }

  for (const entry of input.videos ?? [video()]) {
    testDb.sqlite
      .prepare("INSERT OR IGNORE INTO videos (id, title, created_at) VALUES (?, ?, ?)")
      .run(entry.id, entry.title, entry.createdAt);
  }

  for (const entry of input.assignments ?? [assignment()]) {
    testDb.sqlite
      .prepare(
        `INSERT OR IGNORE INTO media_server_episode_assignments
           (id, show_id, collection_id, video_id, season_number, episode_number,
            export_stem, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.showId,
        entry.videoId,
        entry.seasonNumber,
        entry.episodeNumber,
        entry.exportStem,
        entry.createdAt,
        entry.updatedAt
      );
  }
}

function buildAndMaterialize(
  input: Parameters<typeof snapshot>[0] = {},
  options: { copyFallbackEnabled?: boolean; mode?: "nfo" | "nfo_and_source_json" } = {}
) {
  seedCatalog(input);
  const plan = planMediaServerHierarchy(snapshot(input), {
    mode: options.mode ?? "nfo",
  });
  return {
    plan,
    result: materializeMediaServerHierarchy(plan, {
      copyFallbackEnabled: options.copyFallbackEnabled ?? true,
      sweepScopeShowIds: new Set(
        (input.shows ?? [show()]).map((entry) => entry.id)
      ),
    }),
  };
}

describe("mediaServerExport hierarchyMaterializer", () => {
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
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  it("materializes the full tree and records every artifact", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.avatars, "avatar.jpg"), "avatar-bytes");
    writeFile(path.join(testPaths.images, "thumb.jpg"), "thumb-bytes");

    const { result } = buildAndMaterialize({
      videos: [
        video({
          authorAvatarPath: "/avatars/avatar.jpg",
          thumbnailPath: "/images/thumb.jpg",
        }),
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.counts).toMatchObject({
      shows: 1,
      seasons: 1,
      episodes: 1,
      linkedMedia: 1,
      copiedMedia: 0,
    });

    expect(fs.readFileSync(mirrorPath("Kurzgesagt", "tvshow.nfo"), "utf8")).toContain(
      "<id>mytube:show:youtube:channel-id:UC123</id>"
    );
    expect(
      fs.readFileSync(mirrorPath("Kurzgesagt", "Season 01", "season.nfo"), "utf8")
    ).toContain("<seasonnumber>1</seasonnumber>");
    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo"),
        "utf8"
      )
    ).toContain("mytube:episode:show-1:1:1:v1");
    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4"),
        "utf8"
      )
    ).toBe("video-bytes");
    expect(fs.readFileSync(mirrorPath("Kurzgesagt", "poster.jpg"), "utf8")).toBe(
      "avatar-bytes"
    );

    expect(listArtifacts().map((a) => a.relativePath).sort()).toEqual([
      "Kurzgesagt/Season 01/S01E001 - Ants-thumb.jpg",
      "Kurzgesagt/Season 01/S01E001 - Ants.mp4",
      "Kurzgesagt/Season 01/S01E001 - Ants.nfo",
      "Kurzgesagt/Season 01/season.nfo",
      "Kurzgesagt/poster.jpg",
      "Kurzgesagt/tvshow.nfo",
    ]);
  });

  it("hard links media instead of duplicating the payload", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");

    buildAndMaterialize();

    const target = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
    expect(fs.statSync(target).ino).toBe(fs.statSync(source).ino);
    expect(fs.statSync(target).nlink).toBeGreaterThanOrEqual(2);
    expect(getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.mp4")?.materialization).toBe(
      "hard_link"
    );
  });

  it("copies artwork rather than linking it", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    const avatar = path.join(testPaths.avatars, "avatar.jpg");
    writeFile(avatar, "avatar-bytes");

    buildAndMaterialize({
      videos: [video({ authorAvatarPath: "/avatars/avatar.jpg" })],
    });

    const poster = mirrorPath("Kurzgesagt", "poster.jpg");
    // A hard link here would let thumbnail regeneration mutate the server asset.
    expect(fs.statSync(poster).ino).not.toBe(fs.statSync(avatar).ino);
    expect(getArtifact("Kurzgesagt/poster.jpg")?.materialization).toBe(
      "copied_image"
    );
  });

  it("is idempotent: a second unchanged run rewrites nothing", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.images, "thumb.jpg"), "thumb-bytes");

    const videos = [video({ thumbnailPath: "/images/thumb.jpg" })];
    buildAndMaterialize({ videos });

    const nfoPath = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo");
    const mediaPath = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
    const before = {
      nfo: fs.statSync(nfoPath).mtimeMs,
      media: fs.statSync(mediaPath).ino,
    };

    const { result } = buildAndMaterialize({ videos });

    expect(result.failures).toEqual([]);
    expect(result.counts.linkedMedia).toBe(0);
    expect(result.counts.copiedMedia).toBe(0);
    expect(result.counts.removedArtifacts).toBe(0);
    expect(result.counts.unchangedArtifacts).toBeGreaterThanOrEqual(5);
    expect(fs.statSync(nfoPath).mtimeMs).toBe(before.nfo);
    expect(fs.statSync(mediaPath).ino).toBe(before.media);
  });

  it("relinks after the source media is replaced", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");
    buildAndMaterialize();

    // A re-download replaces the original in place.
    fs.writeFileSync(source, "different-video-bytes", "utf8");
    fs.utimesSync(source, new Date(), new Date(Date.now() + 10_000));

    const { result } = buildAndMaterialize();

    expect(result.counts.linkedMedia).toBe(1);
    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4"),
        "utf8"
      )
    ).toBe("different-video-bytes");
  });

  it("rewrites the NFO after a title edit without touching the media path", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    buildAndMaterialize();

    const mediaPath = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
    const inodeBefore = fs.statSync(mediaPath).ino;

    buildAndMaterialize({ videos: [video({ title: "Renamed Episode" })] });

    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo"),
        "utf8"
      )
    ).toContain("<title>Renamed Episode</title>");
    expect(fs.existsSync(mediaPath)).toBe(true);
    expect(fs.statSync(mediaPath).ino).toBe(inodeBefore);
  });

  it("never touches the original when the mirror is cleaned", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");
    buildAndMaterialize();

    const result = cleanupMediaServerMirror();

    expect(result.failures).toEqual([]);
    expect(result.counts.removedArtifacts).toBe(4);
    expect(listArtifacts()).toEqual([]);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.readFileSync(source, "utf8")).toBe("video-bytes");
    expect(fs.existsSync(mirrorPath("Kurzgesagt"))).toBe(false);
    // The mirror root itself is never removed.
    expect(fs.existsSync(testPaths.mediaLibrary)).toBe(true);
  });

  it("removes a tracked stale artifact and preserves an untracked one", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.videos, "gone.mp4"), "gone-bytes");

    buildAndMaterialize({
      seasons: [
        {
          showId: "show-1",
          seasonNumber: 1,
          collectionId: "c1",
          title: "Space Time",
          plot: "",
        },
      ],
      assignments: [
        assignment(),
        assignment({
          id: "assign-2",
          videoId: "v2",
          episodeNumber: 2,
          exportStem: "S01E002 - Gone",
        }),
      ],
      videos: [video(), video({ id: "v2", title: "Gone", videoPath: "/videos/gone.mp4" })],
    });

    const stale = mirrorPath("Kurzgesagt", "Season 01", "S01E002 - Gone.mp4");
    expect(fs.existsSync(stale)).toBe(true);

    // A user drops their own file into the season directory.
    const userFile = mirrorPath("Kurzgesagt", "Season 01", "my-notes.txt");
    writeFile(userFile, "user content");

    // The second assignment disappears from the catalog.
    const { result } = buildAndMaterialize();

    expect(fs.existsSync(stale)).toBe(false);
    expect(result.counts.removedArtifacts).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.readFileSync(userFile, "utf8")).toBe("user content");
  });

  /**
   * A source that is merely unreachable right now - an unmounted drive, a NAS
   * blip, a file mid-move - must not cost the user the mirror they still have.
   * The episode drops out of the plan, and the sweep treats every path outside
   * the plan as stale, so without protection a transient outage deletes a
   * still-playable episode. In a copy-fallback deployment that is a second full
   * copy of the video.
   */
  it("preserves the artifacts of an episode whose source is temporarily missing", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");
    buildAndMaterialize();

    const mediaPath = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
    const nfoPath = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo");
    expect(fs.existsSync(mediaPath)).toBe(true);

    // The original goes away, but the assignment stays valid.
    fs.unlinkSync(source);
    const { plan, result } = buildAndMaterialize();

    expect(plan.skipped).toEqual([
      expect.objectContaining({ reason: "video_file_missing" }),
    ]);
    expect(result.counts.removedArtifacts).toBe(0);
    expect(fs.existsSync(mediaPath)).toBe(true);
    expect(fs.existsSync(nfoPath)).toBe(true);
    // The show-level artifacts go with the show when it is dropped from the
    // plan, so they need protecting too.
    expect(fs.existsSync(mirrorPath("Kurzgesagt", "tvshow.nfo"))).toBe(true);
    expect(fs.existsSync(mirrorPath("Kurzgesagt", "Season 01", "season.nfo"))).toBe(
      true
    );
    expect(listArtifacts()).toHaveLength(4);
  });

  it("still sweeps an episode once its assignment is actually gone", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    buildAndMaterialize();

    // Deleting the assignment nulls the ledger's assignment_id, which is what
    // severs the protection above - a retired episode is still reclaimed.
    testDb.sqlite.exec("DELETE FROM media_server_episode_assignments");

    const plan = planMediaServerHierarchy(
      snapshot({ assignments: [], videos: [] }),
      { mode: "nfo" }
    );
    const result = materializeMediaServerHierarchy(plan, {
      copyFallbackEnabled: true,
      sweepScopeShowIds: new Set(["show-1"]),
    });

    expect(result.counts.removedArtifacts).toBe(4);
    expect(
      fs.existsSync(mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4"))
    ).toBe(false);
  });

  it("never overwrites an untracked file sitting on a planned path", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    const target = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
    writeFile(target, "pre-existing user file");

    const { result } = buildAndMaterialize();

    expect(fs.readFileSync(target, "utf8")).toBe("pre-existing user file");
    expect(result.failures).toEqual([
      expect.objectContaining({ reason: "artifact_path_collision" }),
    ]);
    expect(getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.mp4")).toBeUndefined();
  });

  it("reports a typed failure and writes nothing when copy fallback is disabled", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");

    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation(() => {
      const error = new Error("cross-device link not permitted") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    });

    try {
      const { result } = buildAndMaterialize({}, { copyFallbackEnabled: false });

      expect(result.failures).toEqual([
        expect.objectContaining({ reason: "hard_link_failed_copy_disabled" }),
      ]);
      expect(
        fs.existsSync(mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4"))
      ).toBe(false);
      expect(
        getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.mp4")
      ).toBeUndefined();
    } finally {
      linkSpy.mockRestore();
    }
  });

  it("falls back to a copy when hard linking is not possible", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");

    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation(() => {
      const error = new Error("cross-device link not permitted") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    });

    try {
      const { result } = buildAndMaterialize({}, { copyFallbackEnabled: true });

      expect(result.failures).toEqual([]);
      expect(result.counts.copiedMedia).toBe(1);
      expect(result.counts.linkedMedia).toBe(0);

      const target = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
      expect(fs.readFileSync(target, "utf8")).toBe("video-bytes");
      expect(fs.statSync(target).ino).not.toBe(fs.statSync(source).ino);
      expect(
        getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.mp4")?.materialization
      ).toBe("copied_media");
    } finally {
      linkSpy.mockRestore();
    }
  });

  it("leaves no temporary file behind when publication fails", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename exploded");
    });

    try {
      buildAndMaterialize();
    } finally {
      renameSpy.mockRestore();
    }

    const leftovers = fs
      .readdirSync(testPaths.mediaLibrary, { recursive: true } as never)
      .filter((entry) => String(entry).includes(".mytube-mirror-tmp"));
    expect(leftovers).toEqual([]);
  });

  /**
   * On Windows and some network filesystems the first rename refuses an
   * existing destination, so publication falls back to moving the old file out
   * of the way first. If that second rename then fails, the old version has to
   * come back: the caller's `finally` drops the staged replacement, so deleting
   * the destination up front would leave the artifact missing altogether.
   */
  it("restores the previous artifact when the fallback publication fails", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    buildAndMaterialize();

    const nfoPath = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo");
    const before = fs.readFileSync(nfoPath, "utf8");

    // Refuse both renames onto the NFO path - the first to force the fallback,
    // the second to fail it - while letting the move-aside and the restore
    // through to the real implementation.
    const realRename = fs.renameSync.bind(fs);
    let refusalsLeft = 2;
    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((from, to) => {
        if (String(to) === nfoPath && refusalsLeft > 0) {
          refusalsLeft -= 1;
          const error = new Error("replace refused") as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
        return realRename(from as never, to as never);
      });

    let result;
    try {
      // A title edit changes the NFO body, so publication is actually attempted.
      ({ result } = buildAndMaterialize({
        videos: [video({ title: "Renamed Episode" })],
      }));
    } finally {
      renameSpy.mockRestore();
    }

    // The failure is reported rather than swallowed...
    expect(result.failures).toHaveLength(1);
    // ...and the previous version is still there, unchanged.
    expect(fs.existsSync(nfoPath)).toBe(true);
    expect(fs.readFileSync(nfoPath, "utf8")).toBe(before);

    const leftovers = fs
      .readdirSync(testPaths.mediaLibrary, { recursive: true } as never)
      .filter((entry) => String(entry).includes(".mytube-mirror-tmp"));
    expect(leftovers).toEqual([]);
  });

  it("aborts publication when the source changes size mid-copy", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");

    // Simulate a truncated copy: the published temp file is shorter than the
    // source stat said it would be.
    const copySpy = vi
      .spyOn(fs, "copyFileSync")
      .mockImplementation((_from, to) => {
        fs.writeFileSync(String(to), "short", "utf8");
      });
    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation(() => {
      const error = new Error("no link") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    });

    try {
      const { result } = buildAndMaterialize({}, { copyFallbackEnabled: true });

      expect(result.failures).toEqual([
        expect.objectContaining({ reason: "source_changed_during_materialization" }),
      ]);
      expect(
        fs.existsSync(mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4"))
      ).toBe(false);
    } finally {
      copySpy.mockRestore();
      linkSpy.mockRestore();
    }
  });

  it("isolates a failing show from the others", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.videos, "beta.mp4"), "beta-bytes");

    // An untracked file blocks the first show's episode; the second must still
    // materialize completely.
    writeFile(
      mirrorPath("Alpha", "Season 01", "S01E001 - Ants.mp4"),
      "user file"
    );

    const { result } = buildAndMaterialize({
      shows: [
        show({ id: "show-1", directoryName: "Alpha" }),
        show({ id: "show-2", identityKey: "k2", directoryName: "Beta" }),
      ],
      seasons: [],
      assignments: [
        assignment({ id: "a1", showId: "show-1", videoId: "v1" }),
        assignment({
          id: "a2",
          showId: "show-2",
          videoId: "v2",
          exportStem: "S01E001 - Beta",
        }),
      ],
      videos: [
        video({ id: "v1" }),
        video({ id: "v2", title: "Beta", videoPath: "/videos/beta.mp4" }),
      ],
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("artifact_path_collision");
    expect(
      fs.existsSync(mirrorPath("Beta", "Season 01", "S01E001 - Beta.mp4"))
    ).toBe(true);
    expect(result.counts.shows).toBe(2);
  });

  it("stops between episodes when cancellation is requested", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.videos, "second.mp4"), "second-bytes");

    const input = {
      assignments: [
        assignment({ id: "a1", episodeNumber: 1 }),
        assignment({
          id: "a2",
          videoId: "v2",
          episodeNumber: 2,
          exportStem: "S01E002 - Second",
        }),
      ],
      videos: [
        video(),
        video({ id: "v2", title: "Second", videoPath: "/videos/second.mp4" }),
      ],
    };
    seedCatalog(input);
    const plan = planMediaServerHierarchy(snapshot(input), { mode: "nfo" });

    let calls = 0;
    const result = materializeMediaServerHierarchy(plan, {
      copyFallbackEnabled: true,
      sweepScopeShowIds: new Set(["show-1"]),
      isCancelled: () => {
        calls += 1;
        // Allow the show and the first episode, then cancel.
        return calls > 2;
      },
    });

    expect(result.counts.episodes).toBe(1);
    // The completed episode is fully published, ledger row included.
    expect(
      getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.mp4")
    ).toBeDefined();
    // Nothing was swept while cancelled.
    expect(result.counts.removedArtifacts).toBe(0);
  });

  // A rebuild is offline and carries no raw yt-dlp info, so the envelope has to
  // be synthesized — otherwise the planner reserves a .info.json path that is
  // never written.
  it("writes a synthesized source JSON in nfo_and_source_json mode", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");

    const { result } = buildAndMaterialize({}, { mode: "nfo_and_source_json" });

    expect(result.failures).toEqual([]);
    const sourceJsonPath = mirrorPath(
      "Kurzgesagt",
      "Season 01",
      "S01E001 - Ants.info.json"
    );
    expect(fs.existsSync(sourceJsonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(sourceJsonPath, "utf8"));
    expect(parsed.id).toBe("v1");
    expect(parsed.title).toBe("Ants");
    expect(parsed._mytube.generatedBy).toBe("mytube");
    expect(parsed._mytube.rawSourcePreserved).toBe(false);

    expect(
      getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.info.json")?.artifactType
    ).toBe("source_json");
  });

  it("prefers a supplied raw source JSON over the synthesized one", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    seedCatalog({});

    const plan = planMediaServerHierarchy(snapshot({}), {
      mode: "nfo_and_source_json",
    });
    materializeMediaServerHierarchy(plan, {
      copyFallbackEnabled: true,
      sweepScopeShowIds: new Set(["show-1"]),
      sourceJsonByVideoId: new Map([["v1", '{"from":"downloader"}\n']]),
    });

    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.info.json"),
        "utf8"
      )
    ).toBe('{"from":"downloader"}\n');
  });

  /**
   * An ordinary refresh - a title edit, new tags, replaced artwork - and an
   * offline rebuild both carry no extractor output. Rewriting the published
   * `.info.json` from the stored video record would drop every extractor-only
   * field the download captured, permanently: nothing ever re-fetches them.
   */
  it("keeps a published rich source JSON when the run carries no raw envelope", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    seedCatalog({});

    const richPlan = planMediaServerHierarchy(snapshot({}), {
      mode: "nfo_and_source_json",
    });
    materializeMediaServerHierarchy(richPlan, {
      copyFallbackEnabled: true,
      sweepScopeShowIds: new Set(["show-1"]),
      sourceJsonByVideoId: new Map([
        ["v1", JSON.stringify({ id: "v1", extractor_only: "kept" })],
      ]),
    });

    const sourceJsonPath = mirrorPath(
      "Kurzgesagt",
      "Season 01",
      "S01E001 - Ants.info.json"
    );
    expect(JSON.parse(fs.readFileSync(sourceJsonPath, "utf8")).extractor_only).toBe(
      "kept"
    );

    // A later run with no envelope at all - a rebuild, or a metadata edit.
    const refreshPlan = planMediaServerHierarchy(
      snapshot({ videos: [video({ title: "Renamed Episode" })] }),
      { mode: "nfo_and_source_json" }
    );
    const result = materializeMediaServerHierarchy(refreshPlan, {
      copyFallbackEnabled: true,
      sweepScopeShowIds: new Set(["show-1"]),
    });

    expect(result.failures).toEqual([]);
    expect(JSON.parse(fs.readFileSync(sourceJsonPath, "utf8")).extractor_only).toBe(
      "kept"
    );
    // The NFO, which IS derived from the video record, still follows the edit.
    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo"),
        "utf8"
      )
    ).toContain("<title>Renamed Episode</title>");
  });

  it("still synthesizes a source JSON for an episode that has none yet", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");

    const { result } = buildAndMaterialize({}, { mode: "nfo_and_source_json" });

    expect(result.failures).toEqual([]);
    const parsed = JSON.parse(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.info.json"),
        "utf8"
      )
    );
    expect(parsed._mytube.rawSourcePreserved).toBe(false);
  });

  it("writes no source JSON in plain nfo mode", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");

    buildAndMaterialize({}, { mode: "nfo" });

    expect(
      fs.existsSync(mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.info.json"))
    ).toBe(false);
  });

  it("materializes subtitles alongside the episode", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.subtitles, "ants.en.vtt"), "WEBVTT");

    buildAndMaterialize({
      videos: [
        video({
          subtitles: [
            { language: "en", filename: "ants.en.vtt", path: "/subtitles/ants.en.vtt" },
          ],
        }),
      ],
    });

    expect(
      fs.readFileSync(
        mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.en.vtt"),
        "utf8"
      )
    ).toBe("WEBVTT");
    expect(
      getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.en.vtt")?.artifactType
    ).toBe("episode_subtitle");
  });

  it("gives a video in two playlists two playable mirror files", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");

    buildAndMaterialize({
      seasons: [
        {
          showId: "show-1",
          seasonNumber: 1,
          collectionId: "c1",
          title: "One",
          plot: "",
        },
        {
          showId: "show-1",
          seasonNumber: 2,
          collectionId: "c2",
          title: "Two",
          plot: "",
        },
      ],
      assignments: [
        assignment({ id: "a1", seasonNumber: 1, exportStem: "S01E001 - Ants" }),
        assignment({
          id: "a2",
          seasonNumber: 2,
          collectionId: "c2",
          exportStem: "S02E001 - Ants",
        }),
      ],
    });

    for (const relativePath of [
      ["Kurzgesagt", "Season 01", "S01E001 - Ants.mp4"],
      ["Kurzgesagt", "Season 02", "S02E001 - Ants.mp4"],
    ]) {
      expect(fs.readFileSync(mirrorPath(...relativePath), "utf8")).toBe(
        "video-bytes"
      );
    }

    // Distinct occurrence ids, or a media server collapses the two episodes.
    const first = fs.readFileSync(
      mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.nfo"),
      "utf8"
    );
    const second = fs.readFileSync(
      mirrorPath("Kurzgesagt", "Season 02", "S02E001 - Ants.nfo"),
      "utf8"
    );
    expect(first).toContain("mytube:episode:show-1:1:1:v1");
    expect(second).toContain("mytube:episode:show-1:2:1:v1");
  });

  it("refuses to delete a mirror path replaced by a symlink", () => {
    const source = path.join(testPaths.videos, "ants.mp4");
    writeFile(source, "video-bytes");
    buildAndMaterialize();

    const target = mirrorPath("Kurzgesagt", "Season 01", "S01E001 - Ants.mp4");
    fs.unlinkSync(target);
    fs.symlinkSync(source, target);

    const result = cleanupMediaServerMirror();

    expect(result.failures).toEqual([
      expect.objectContaining({ reason: "artifact_ownership_mismatch" }),
    ]);
    // The symlink and, crucially, its target are both untouched.
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(source)).toBe(true);
  });

  it("scopes sweeping to the requested shows", () => {
    writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
    writeFile(path.join(testPaths.videos, "beta.mp4"), "beta-bytes");

    const both = {
      shows: [
        show({ id: "show-1", directoryName: "Alpha" }),
        show({ id: "show-2", identityKey: "k2", directoryName: "Beta" }),
      ],
      seasons: [],
      assignments: [
        assignment({ id: "a1", showId: "show-1", videoId: "v1" }),
        assignment({
          id: "a2",
          showId: "show-2",
          videoId: "v2",
          exportStem: "S01E001 - Beta",
        }),
      ],
      videos: [
        video({ id: "v1" }),
        video({ id: "v2", title: "Beta", videoPath: "/videos/beta.mp4" }),
      ],
    };
    buildAndMaterialize(both);

    // Rebuild only show-1, with show-1 now empty. show-2 must survive.
    const emptyPlan = planMediaServerHierarchy(
      snapshot({ ...both, assignments: [] }),
      { mode: "nfo", showIds: new Set(["show-1"]) }
    );
    materializeMediaServerHierarchy(emptyPlan, {
      copyFallbackEnabled: true,
      sweepScopeShowIds: new Set(["show-1"]),
    });

    expect(fs.existsSync(mirrorPath("Alpha"))).toBe(false);
    expect(
      fs.existsSync(mirrorPath("Beta", "Season 01", "S01E001 - Beta.mp4"))
    ).toBe(true);
  });

  /**
   * A full rebuild used to occupy the process from start to finish, so nothing
   * else was served while it ran - not the job's status endpoint, and not the
   * cancel request, which meant cancelRequested could not become true during
   * the very run it was meant to stop. The async variant yields between
   * episodes and between swept artifacts, so even the longest single show
   * cannot block the cancel request from being served.
   */
  describe("async materialization yields between episodes", () => {
    it("lets queued work run before it finishes", async () => {
      seedCatalog({});
      const plan = planMediaServerHierarchy(snapshot({}), { mode: "nfo" });

      let ranDuringMaterialization = false;
      const queued = new Promise<void>((resolve) => {
        setImmediate(() => {
          ranDuringMaterialization = true;
          resolve();
        });
      });

      await materializeMediaServerHierarchyAsync(plan, {
        copyFallbackEnabled: true,
        sweepScopeShowIds: new Set(["show-1"]),
      });
      await queued;

      expect(ranDuringMaterialization).toBe(true);
    });

    it("produces the same counts as the synchronous version", async () => {
      // Sync pass on fresh state.
      const sync = buildAndMaterialize({});

      // Reset and repeat through the async path.
      fs.emptyDirSync(testPaths.root);
      for (const dir of [testPaths.videos, testPaths.images, testPaths.mediaLibrary]) {
        fs.ensureDirSync(dir);
      }
      testDb.sqlite.exec(`
        DELETE FROM media_server_export_artifacts;
        DELETE FROM media_server_episode_assignments;
        DELETE FROM media_server_shows;
      `);
      seedCatalog({});
      const plan = planMediaServerHierarchy(snapshot({}), { mode: "nfo" });
      const async = await materializeMediaServerHierarchyAsync(plan, {
        copyFallbackEnabled: true,
        sweepScopeShowIds: new Set(["show-1"]),
      });

      expect(async.failures).toEqual(sync.result.failures);
      expect(async.counts).toEqual(sync.result.counts);
    });

    it("stops at the next show once cancelled", async () => {
      seedCatalog({});
      const plan = planMediaServerHierarchy(snapshot({}), { mode: "nfo" });

      const result = await materializeMediaServerHierarchyAsync(plan, {
        copyFallbackEnabled: true,
        sweepScopeShowIds: new Set(["show-1"]),
        isCancelled: () => true,
      });

      expect(result.counts.episodes).toBe(0);
      expect(result.counts.removedArtifacts).toBe(0);
    });

    it("observes a cancel queued while a single show materializes", async () => {
      writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
      writeFile(path.join(testPaths.videos, "second.mp4"), "second-bytes");
      writeFile(path.join(testPaths.videos, "third.mp4"), "third-bytes");

      const input = {
        assignments: [
          assignment({ id: "a1", episodeNumber: 1 }),
          assignment({
            id: "a2",
            videoId: "v2",
            episodeNumber: 2,
            exportStem: "S01E002 - Second",
          }),
          assignment({
            id: "a3",
            videoId: "v3",
            episodeNumber: 3,
            exportStem: "S01E003 - Third",
          }),
        ],
        videos: [
          video(),
          video({ id: "v2", title: "Second", videoPath: "/videos/second.mp4" }),
          video({ id: "v3", title: "Third", videoPath: "/videos/third.mp4" }),
        ],
      };
      seedCatalog(input);
      const plan = planMediaServerHierarchy(snapshot(input), { mode: "nfo" });

      // The cancel arrives through the event loop after the show has begun,
      // exactly like a real HTTP cancel request. It can only become true if
      // materialization yields while this one show is still in progress -
      // per-show yielding alone would materialize all three episodes first.
      let cancelRequested = false;
      setImmediate(() => {
        setImmediate(() => {
          cancelRequested = true;
        });
      });

      const result = await materializeMediaServerHierarchyAsync(plan, {
        copyFallbackEnabled: true,
        sweepScopeShowIds: new Set(["show-1"]),
        isCancelled: () => cancelRequested,
      });

      expect(result.counts.episodes).toBeLessThan(3);
    });

    it("observes a cancel queued while the stale sweep runs", async () => {
      writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
      writeFile(path.join(testPaths.videos, "second.mp4"), "second-bytes");
      writeFile(path.join(testPaths.videos, "third.mp4"), "third-bytes");

      const input = {
        assignments: [
          assignment({ id: "a1", episodeNumber: 1 }),
          assignment({
            id: "a2",
            videoId: "v2",
            episodeNumber: 2,
            exportStem: "S01E002 - Second",
          }),
          assignment({
            id: "a3",
            videoId: "v3",
            episodeNumber: 3,
            exportStem: "S01E003 - Third",
          }),
        ],
        videos: [
          video(),
          video({ id: "v2", title: "Second", videoPath: "/videos/second.mp4" }),
          video({ id: "v3", title: "Third", videoPath: "/videos/third.mp4" }),
        ],
      };
      const { result: seeded } = buildAndMaterialize(input);
      expect(seeded.counts.episodes).toBe(3);

      // A plan with no shows at all, so the run goes straight to the sweep and
      // every seeded artifact (three media files, three episode NFOs, the show
      // NFO and the season NFO) is a sweep candidate.
      const emptyPlan = planMediaServerHierarchy(
        snapshot({ shows: [], seasons: [], assignments: [], videos: [] }),
        { mode: "nfo" }
      );

      let cancelRequested = false;
      setImmediate(() => {
        setImmediate(() => {
          cancelRequested = true;
        });
      });

      const result = await materializeMediaServerHierarchyAsync(emptyPlan, {
        copyFallbackEnabled: true,
        sweepScopeShowIds: new Set(["show-1"]),
        isCancelled: () => cancelRequested,
      });

      expect(result.counts.removedArtifacts).toBeLessThan(8);
    });

    /**
     * The cleanup action unlinks the whole managed library. Draining it
     * synchronously meant the event loop never ran, so the `isCancelled`
     * callback it was handed could not change and a user trying to stop a
     * destructive sweep was only heard once it had already finished.
     */
    it("observes a cancel queued while the cleanup action sweeps", async () => {
      writeFile(path.join(testPaths.videos, "ants.mp4"), "video-bytes");
      writeFile(path.join(testPaths.videos, "second.mp4"), "second-bytes");
      writeFile(path.join(testPaths.videos, "third.mp4"), "third-bytes");

      const { result: seeded } = buildAndMaterialize({
        assignments: [
          assignment({ id: "a1", episodeNumber: 1 }),
          assignment({
            id: "a2",
            videoId: "v2",
            episodeNumber: 2,
            exportStem: "S01E002 - Second",
          }),
          assignment({
            id: "a3",
            videoId: "v3",
            episodeNumber: 3,
            exportStem: "S01E003 - Third",
          }),
        ],
        videos: [
          video(),
          video({ id: "v2", title: "Second", videoPath: "/videos/second.mp4" }),
          video({ id: "v3", title: "Third", videoPath: "/videos/third.mp4" }),
        ],
      });
      expect(seeded.counts.episodes).toBe(3);
      const before = listArtifacts().length;

      let cancelRequested = false;
      setImmediate(() => {
        setImmediate(() => {
          cancelRequested = true;
        });
      });

      const result = await cleanupMediaServerMirrorAsync(
        undefined,
        () => cancelRequested
      );

      expect(result.counts.removedArtifacts).toBeLessThan(before);
      // The cancel actually stopped it, so artifacts survive.
      expect(listArtifacts().length).toBeGreaterThan(0);
    });
  });

});
