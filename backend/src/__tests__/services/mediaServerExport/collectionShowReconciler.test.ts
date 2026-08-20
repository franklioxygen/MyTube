import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, Video } from "../../../services/storageService/types";

const testDb = vi.hoisted(() => {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const { drizzle } =
    require("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

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

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { reconcileMediaServerCatalog } from "../../../services/mediaServerExport/catalogReconciler";
import {
  ensureCollectionShow,
  getCollectionShow,
  listAssignmentsForShow,
  listAssignmentsForVideo,
  listMediaServerShows,
} from "../../../services/mediaServerExport/catalogRepository";

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "v1",
    title: "EP01",
    author: "tl 23",
    source: "youtube",
    sourceUrl: "https://youtube.com/watch?v=1",
    channelUrl: "https://www.youtube.com/@tl23",
    createdAt: "2026-01-01T00:00:00.000Z",
    videoPath: "/videos/a.mp4",
    ...overrides,
  } as Video;
}

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "人民的名义超高清版",
    title: "人民的名义超高清版",
    videos: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Collection;
}

function seedRows(videos: Video[], collections: Collection[]): void {
  for (const entry of videos) {
    testDb.sqlite
      .prepare("INSERT OR IGNORE INTO videos (id, title, created_at) VALUES (?, ?, ?)")
      .run(entry.id, entry.title, entry.createdAt);
  }
  for (const entry of collections) {
    testDb.sqlite
      .prepare(
        `INSERT OR IGNORE INTO collections
           (id, name, title, created_at, source_type, source_platform,
            source_channel_id, source_channel_name, export_as_show,
            media_server_title, tmdb_id, tmdb_media_type, tmdb_premiere_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        entry.exportAsShow ?? 0,
        entry.mediaServerTitle ?? null,
        entry.tmdbId ?? null,
        entry.tmdbMediaType ?? null,
        entry.tmdbPremiereDate ?? null
      );
  }
}

function reconcile(videos: Video[], collections: Collection[]) {
  seedRows(videos, collections);
  return reconcileMediaServerCatalog({
    videos,
    collections,
    subscriptions: [],
  });
}

describe("collection-as-show reconciliation", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  describe("show creation", () => {
    it("exports a marked collection as its own show", () => {
      reconcile(
        [video({ id: "v1" }), video({ id: "v2", title: "EP02" })],
        [collection({ exportAsShow: 1, videos: ["v1", "v2"] })]
      );

      const show = getCollectionShow("c1");
      expect(show).toBeDefined();
      expect(show?.title).toBe("人民的名义超高清版");
      expect(show?.directoryName).toBe("人民的名义超高清版");
      expect(show?.sourceCollectionId).toBe("c1");
      expect(show?.sourcePlatform).toBe("mytube");
      expect(show?.identityKey).toBe("collection:c1");

      const assignments = listAssignmentsForShow(show!.id);
      expect(assignments).toHaveLength(2);
      expect(assignments.map((a) => a.seasonNumber)).toEqual([1, 1]);
      expect(assignments.map((a) => a.episodeNumber).sort()).toEqual([1, 2]);
    });

    it("prefers the resolved media-server title over the collection title", () => {
      reconcile(
        [video({ id: "v1" })],
        [
          collection({
            exportAsShow: 1,
            mediaServerTitle: "人民的名义",
            videos: ["v1"],
          }),
        ]
      );

      expect(getCollectionShow("c1")?.title).toBe("人民的名义");
      expect(getCollectionShow("c1")?.directoryName).toBe("人民的名义");
    });

    it("carries the TMDB identity into the offline show projection", () => {
      reconcile(
        [video({ id: "v1" })],
        [
          collection({
            exportAsShow: 1,
            mediaServerTitle: "人民的名义",
            tmdbId: 72517,
            tmdbMediaType: "tv",
            tmdbPremiereDate: "2017-03-28",
            videos: ["v1"],
          }),
        ]
      );

      expect(getCollectionShow("c1")).toMatchObject({
        tmdbId: 72517,
        tmdbMediaType: "tv",
        premiered: "2017-03-28",
      });
    });

    it("does not create a show for an unmarked collection", () => {
      reconcile(
        [video({ id: "v1" })],
        [collection({ exportAsShow: 0, videos: ["v1"] })]
      );

      expect(getCollectionShow("c1")).toBeUndefined();
    });

    it("keeps the allocated directory when the title later changes", () => {
      const videos = [video({ id: "v1" })];
      reconcile(videos, [
        collection({ exportAsShow: 1, mediaServerTitle: "Original", videos: ["v1"] }),
      ]);

      reconcileMediaServerCatalog({
        videos,
        collections: [
          collection({ exportAsShow: 1, mediaServerTitle: "Renamed", videos: ["v1"] }),
        ],
        subscriptions: [],
      });

      const show = getCollectionShow("c1");
      expect(show?.title).toBe("Renamed");
      expect(show?.directoryName).toBe("Original");
    });
  });

  describe("identity isolation", () => {
    /**
     * The case the `collection:<id>` prefix alone does not protect against:
     * the author matcher also compares platform and normalized title.
     */
    it("keeps two same-titled collection-shows separate", () => {
      reconcile(
        [video({ id: "v1" }), video({ id: "v2" })],
        [
          collection({ id: "c1", exportAsShow: 1, videos: ["v1"] }),
          collection({
            id: "c2",
            name: "人民的名义超高清版",
            title: "人民的名义超高清版",
            exportAsShow: 1,
            createdAt: "2026-02-01T00:00:00.000Z",
            videos: ["v2"],
          }),
        ]
      );

      const shows = listMediaServerShows().filter((s) => s.sourceCollectionId);
      expect(shows).toHaveLength(2);
      expect(new Set(shows.map((s) => s.directoryName)).size).toBe(2);
    });

    it("never merges a collection-show into an author show", () => {
      // The author is "tl 23"; give the collection the same name so the author
      // matcher would merge them if it were consulted.
      reconcile(
        [video({ id: "v1", author: "tl 23" }), video({ id: "v2", author: "tl 23" })],
        [
          collection({
            id: "c1",
            name: "tl 23",
            title: "tl 23",
            exportAsShow: 1,
            videos: ["v1"],
          }),
        ]
      );

      const collectionShow = getCollectionShow("c1");
      const authorShows = listMediaServerShows().filter(
        (s) => !s.sourceCollectionId
      );

      expect(collectionShow).toBeDefined();
      expect(authorShows).toHaveLength(1);
      expect(authorShows[0].id).not.toBe(collectionShow!.id);
    });
  });

  describe("Season 00 interaction", () => {
    it("gives a video only in a marked collection no Season 00 occurrence", () => {
      reconcile(
        [video({ id: "v1" })],
        [collection({ exportAsShow: 1, videos: ["v1"] })]
      );

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0].seasonNumber).toBe(1);
      expect(assignments[0].showId).toBe(getCollectionShow("c1")!.id);
    });

    it("still exports a separate occurrence for an unmarked source playlist", () => {
      reconcile(
        [video({ id: "v1" })],
        [
          collection({ id: "c1", exportAsShow: 1, videos: ["v1"] }),
          collection({
            id: "c2",
            name: "A Playlist",
            title: "A Playlist",
            createdAt: "2026-02-01T00:00:00.000Z",
            sourceType: "playlist",
            sourcePlatform: "youtube",
            sourceChannelId: "UC1",
            sourceChannelName: "tl 23",
            videos: ["v1"],
          }),
        ]
      );

      expect(listAssignmentsForVideo("v1")).toHaveLength(2);
    });

    it("gives a video in two marked collections two occurrences", () => {
      reconcile(
        [video({ id: "v1" })],
        [
          collection({ id: "c1", exportAsShow: 1, videos: ["v1"] }),
          collection({
            id: "c2",
            name: "Second Drama",
            title: "Second Drama",
            exportAsShow: 1,
            createdAt: "2026-02-01T00:00:00.000Z",
            videos: ["v1"],
          }),
        ]
      );

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map((a) => a.showId)).size).toBe(2);
    });

    it("restores Season 00 when the marked collection loses the video", () => {
      const videos = [video({ id: "v1" })];
      reconcile(videos, [collection({ exportAsShow: 1, videos: ["v1"] })]);
      expect(listAssignmentsForVideo("v1")[0].seasonNumber).toBe(1);

      reconcileMediaServerCatalog({
        videos,
        collections: [collection({ exportAsShow: 1, videos: [] })],
        subscriptions: [],
      });

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0].seasonNumber).toBe(0);
    });
  });

  describe("stale occurrence removal", () => {
    /**
     * Regression for the membership-only key. After a collection moves between
     * shows, the obsolete assignment references the same collection and video as
     * the desired one, so a `collectionId:videoId` check cannot tell them apart.
     */
    it("removes the old author-season assignment after promotion", () => {
      const videos = [video({ id: "v1" })];
      const asPlaylist = collection({
        sourceType: "playlist",
        sourcePlatform: "youtube",
        sourceChannelId: "UC1",
        sourceChannelName: "tl 23",
        videos: ["v1"],
      });

      reconcile(videos, [asPlaylist]);
      const beforeShow = listMediaServerShows().find((s) => !s.sourceCollectionId);
      expect(listAssignmentsForShow(beforeShow!.id)).toHaveLength(1);

      // The user marks it. The collection row now says exportAsShow=1.
      testDb.sqlite
        .prepare("UPDATE collections SET export_as_show = 1 WHERE id = 'c1'")
        .run();

      reconcileMediaServerCatalog({
        videos,
        collections: [{ ...asPlaylist, exportAsShow: 1 }],
        subscriptions: [],
      });

      const collectionShow = getCollectionShow("c1");
      expect(collectionShow).toBeDefined();
      expect(listAssignmentsForShow(collectionShow!.id)).toHaveLength(1);
      // The obsolete author-season occurrence must be gone.
      expect(listAssignmentsForShow(beforeShow!.id)).toHaveLength(0);
      expect(listAssignmentsForVideo("v1")).toHaveLength(1);
    });
  });

  describe("promotion numbering", () => {
    /**
     * §6.4: reusing the number and stem keeps mirror filenames identical across
     * the move, so a media server does not see every episode vanish and reappear
     * under a new name (and lose its watch state).
     */
    it("carries episode numbers and stems across a promotion", () => {
      const videos = [
        video({ id: "v1", title: "First" }),
        video({ id: "v2", title: "Second" }),
        video({ id: "v3", title: "Third" }),
      ];
      const asPlaylist = collection({
        sourceType: "playlist",
        sourcePlatform: "youtube",
        sourceChannelId: "UC1",
        sourceChannelName: "tl 23",
        videos: ["v1", "v2", "v3"],
      });

      reconcile(videos, [asPlaylist]);
      const authorShow = listMediaServerShows().find((s) => !s.sourceCollectionId);
      const before = listAssignmentsForShow(authorShow!.id)
        .map((a) => ({
          videoId: a.videoId,
          episodeNumber: a.episodeNumber,
          exportStem: a.exportStem,
        }))
        .sort((l, r) => l.episodeNumber - r.episodeNumber);

      expect(before.map((a) => a.exportStem)).toEqual([
        "S01E001 - First",
        "S01E002 - Second",
        "S01E003 - Third",
      ]);

      testDb.sqlite
        .prepare("UPDATE collections SET export_as_show = 1 WHERE id = 'c1'")
        .run();
      reconcileMediaServerCatalog({
        videos,
        // Reordered upstream at the same time, to prove the carried numbers win
        // over the new collection order.
        collections: [{ ...asPlaylist, exportAsShow: 1, videos: ["v3", "v1", "v2"] }],
        subscriptions: [],
      });

      const after = listAssignmentsForShow(getCollectionShow("c1")!.id)
        .map((a) => ({
          videoId: a.videoId,
          episodeNumber: a.episodeNumber,
          exportStem: a.exportStem,
        }))
        .sort((l, r) => l.episodeNumber - r.episodeNumber);

      expect(after).toEqual(before);
    });

    it("allocates fresh numbers for a manual collection with no prior season", () => {
      reconcile(
        [video({ id: "v1", title: "First" }), video({ id: "v2", title: "Second" })],
        [collection({ exportAsShow: 1, videos: ["v1", "v2"] })]
      );

      const assignments = listAssignmentsForShow(getCollectionShow("c1")!.id).sort(
        (l, r) => l.episodeNumber - r.episodeNumber
      );
      expect(assignments.map((a) => a.exportStem)).toEqual([
        "S01E001 - First",
        "S01E002 - Second",
      ]);
    });
  });
});

/**
 * A collection can be re-pointed at a different TMDB entry, or dropped back to a
 * manual title. If the show row keeps the old external identity it emits the new
 * title with the old uniqueid, and the media server keeps matching the old
 * series - the exact failure the feature exists to prevent.
 */
describe("collection show external identity refresh", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  it("replaces the TMDB identity when the collection is re-pointed", () => {
    const first = ensureCollectionShow({
      collectionId: "c1",
      title: "Three Kingdoms",
      description: "",
      tmdbId: 72645,
      tmdbMediaType: "tv",
      premiered: "1994-02-10",
    });
    expect(first.tmdbId).toBe(72645);

    const second = ensureCollectionShow({
      collectionId: "c1",
      title: "Three Kingdoms 2010",
      description: "",
      tmdbId: 46298,
      tmdbMediaType: "tv",
      premiered: "2010-05-02",
    });

    expect(second.id).toBe(first.id);
    expect(second.tmdbId).toBe(46298);
    expect(second.premiered).toBe("2010-05-02");
    // The directory is allocated once and must survive the re-point.
    expect(second.directoryName).toBe(first.directoryName);
  });

  it("clears the TMDB identity when the collection falls back to a manual title", () => {
    ensureCollectionShow({
      collectionId: "c1",
      title: "Three Kingdoms",
      description: "",
      tmdbId: 72645,
      tmdbMediaType: "tv",
      premiered: "1994-02-10",
    });

    const manual = ensureCollectionShow({
      collectionId: "c1",
      title: "My Own Title",
      description: "",
    });

    expect(manual.tmdbId).toBeUndefined();
    expect(manual.tmdbMediaType).toBeUndefined();
    expect(manual.premiered).toBeUndefined();
  });
});
