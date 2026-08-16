import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs against a real in-memory SQLite database created from the checked-in
 * drizzle migrations, so the unique indexes that guarantee immutable season and
 * episode numbers are actually exercised rather than mocked away.
 */
const testDb = vi.hoisted(() => {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const { drizzle } =
    require("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  // Vitest may run with the repo root or the backend package as cwd.
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
        // Older hand-written migrations overlap with the runtime self-heal
        // migrations; the media server tables under test are unaffected.
      }
    }
  }

  return { sqlite, db: drizzle(sqlite) };
});

vi.mock("../../../db", () => ({ db: testDb.db }));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  attachCollectionToShow,
  buildExportStem,
  deleteEpisodeAssignment,
  detachCollectionFromShow,
  ensureEpisodeAssignment,
  ensureMediaServerShow,
  getEpisodeAssignmentOccurrence,
  getMediaServerShowById,
  listAssignmentsForShow,
  listAssignmentsForVideo,
  listPlaylistAssignmentsForVideo,
  MediaServerCatalogError,
  padEpisodeNumber,
  padSeasonNumber,
  updateMediaServerShowMetadata,
} from "../../../services/mediaServerExport/catalogRepository";

function createCollection(id: string, title: string): void {
  testDb.sqlite
    .prepare(
      "INSERT INTO collections (id, name, title, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(id, title, title, new Date().toISOString());
}

function createVideo(id: string, title: string): void {
  testDb.sqlite
    .prepare("INSERT INTO videos (id, title, created_at) VALUES (?, ?, ?)")
    .run(id, title, new Date().toISOString());
}

describe("mediaServerExport catalogRepository", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  describe("show identity", () => {
    it("resolves the same show for a repeated identity key", () => {
      const first = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UC123",
        sourcePlatform: "youtube",
        sourceChannelId: "UC123",
        title: "Kurzgesagt",
      });
      const second = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UC123",
        sourcePlatform: "youtube",
        sourceChannelId: "UC123",
        title: "Kurzgesagt – In a Nutshell",
      });

      expect(second.id).toBe(first.id);
      // A later display title must not move the allocated directory.
      expect(second.directoryName).toBe("Kurzgesagt");
    });

    it("gives colliding titles distinct directories", () => {
      const first = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UC1",
        sourcePlatform: "youtube",
        sourceChannelId: "UC1",
        title: "Science",
      });
      const second = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UC2",
        sourcePlatform: "youtube",
        sourceChannelId: "UC2",
        title: "Science",
      });

      expect(first.directoryName).toBe("Science");
      expect(second.directoryName).not.toBe("Science");
      expect(second.directoryName.startsWith("Science (")).toBe(true);
    });

    it("sanitizes unsafe titles without losing identity", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:author:weird",
        sourcePlatform: "youtube",
        title: '../../etc: "weird" <name>',
      });

      expect(show.directoryName).not.toContain("/");
      expect(show.directoryName).not.toContain("\\");
      expect(show.directoryName).not.toContain(":");
      expect(show.identityKey).toBe("youtube:author:weird");
    });

    it("upgrades an author-fallback show with a channel id but never overwrites one", () => {
      const fallback = ensureMediaServerShow({
        identityKey: "youtube:author:kurzgesagt",
        sourcePlatform: "youtube",
        title: "Kurzgesagt",
      });
      expect(fallback.sourceChannelId).toBeUndefined();

      updateMediaServerShowMetadata(fallback.id, { sourceChannelId: "UC999" });
      expect(getMediaServerShowById(fallback.id)?.sourceChannelId).toBe("UC999");

      updateMediaServerShowMetadata(fallback.id, { sourceChannelId: "UC000" });
      expect(getMediaServerShowById(fallback.id)?.sourceChannelId).toBe("UC999");
    });

    it("updates title and description without touching directory or numbering", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCmeta",
        sourcePlatform: "youtube",
        title: "Old Name",
      });

      updateMediaServerShowMetadata(show.id, {
        title: "New Name",
        description: "Channel description",
      });

      const updated = getMediaServerShowById(show.id);
      expect(updated?.title).toBe("New Name");
      expect(updated?.description).toBe("Channel description");
      expect(updated?.directoryName).toBe("Old Name");
      expect(updated?.nextSeasonNumber).toBe(1);
    });
  });

  describe("season allocation", () => {
    it("assigns 1, 2, 3 to the first three playlists", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCseasons",
        sourcePlatform: "youtube",
        title: "Seasons",
      });

      const numbers = ["c1", "c2", "c3"].map((id) => {
        createCollection(id, `Playlist ${id}`);
        return attachCollectionToShow(id, show.id).seasonNumber;
      });

      expect(numbers).toEqual([1, 2, 3]);
      expect(getMediaServerShowById(show.id)?.nextSeasonNumber).toBe(4);
    });

    it("is idempotent for an already-attached collection", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCidem",
        sourcePlatform: "youtube",
        title: "Idem",
      });
      createCollection("c1", "Playlist");

      expect(attachCollectionToShow("c1", show.id).seasonNumber).toBe(1);
      expect(attachCollectionToShow("c1", show.id).seasonNumber).toBe(1);
      expect(getMediaServerShowById(show.id)?.nextSeasonNumber).toBe(2);
    });

    it("never reuses a detached season number", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCreuse",
        sourcePlatform: "youtube",
        title: "Reuse",
      });
      createCollection("c1", "One");
      createCollection("c2", "Two");
      createCollection("c3", "Three");

      attachCollectionToShow("c1", show.id);
      expect(attachCollectionToShow("c2", show.id).seasonNumber).toBe(2);

      detachCollectionFromShow("c2");

      expect(attachCollectionToShow("c3", show.id).seasonNumber).toBe(3);
    });

    it("refuses to move a collection to a second show", () => {
      const showA = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCa",
        sourcePlatform: "youtube",
        title: "A",
      });
      const showB = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCb",
        sourcePlatform: "youtube",
        title: "B",
      });
      createCollection("c1", "Playlist");
      attachCollectionToShow("c1", showA.id);

      expect(() => attachCollectionToShow("c1", showB.id)).toThrowError(
        MediaServerCatalogError
      );
    });
  });

  describe("episode allocation", () => {
    function setupShowAndSeason(): { showId: string; seasonNumber: number } {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCep",
        sourcePlatform: "youtube",
        title: "Episodes",
      });
      createCollection("c1", "Playlist");
      const { seasonNumber } = attachCollectionToShow("c1", show.id);
      return { showId: show.id, seasonNumber };
    }

    it("uses the imported source position when it is free", () => {
      const { showId, seasonNumber } = setupShowAndSeason();
      createVideo("v1", "First");

      const assignment = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "First",
        sourcePosition: 7,
      });

      expect(assignment.episodeNumber).toBe(7);
      expect(assignment.exportStem).toBe("S01E007 - First");
    });

    it("falls back to MAX+1 when the source position is taken", () => {
      const { showId, seasonNumber } = setupShowAndSeason();
      createVideo("v1", "First");
      createVideo("v2", "Second");

      ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "First",
        sourcePosition: 3,
      });
      const second = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v2",
        seasonNumber,
        videoTitle: "Second",
        sourcePosition: 3,
      });

      expect(second.episodeNumber).toBe(4);
      expect(second.sourcePosition).toBe(3);
    });

    it("keeps the episode number stable when the upstream position changes", () => {
      const { showId, seasonNumber } = setupShowAndSeason();
      createVideo("v1", "First");

      const first = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "First",
        sourcePosition: 1,
      });
      const reordered = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "First",
        sourcePosition: 9,
      });

      expect(reordered.id).toBe(first.id);
      expect(reordered.episodeNumber).toBe(1);
      expect(reordered.sourcePosition).toBe(9);
      expect(reordered.exportStem).toBe("S01E001 - First");
    });

    it("keeps the persisted stem across a later title edit", () => {
      const { showId, seasonNumber } = setupShowAndSeason();
      createVideo("v1", "Original Title");

      ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "Original Title",
      });
      const again = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "Renamed Title",
      });

      expect(again.exportStem).toBe("S01E001 - Original Title");
    });

    it("gives one video two assignments across two seasons", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCdup",
        sourcePlatform: "youtube",
        title: "Dup",
      });
      createCollection("c1", "One");
      createCollection("c2", "Two");
      createVideo("v1", "Shared");

      const seasonOne = attachCollectionToShow("c1", show.id).seasonNumber;
      const seasonTwo = attachCollectionToShow("c2", show.id).seasonNumber;

      const a = ensureEpisodeAssignment({
        showId: show.id,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber: seasonOne,
        videoTitle: "Shared",
        sourcePosition: 1,
      });
      const b = ensureEpisodeAssignment({
        showId: show.id,
        collectionId: "c2",
        videoId: "v1",
        seasonNumber: seasonTwo,
        videoTitle: "Shared",
        sourcePosition: 1,
      });

      expect(a.id).not.toBe(b.id);
      expect(listAssignmentsForVideo("v1")).toHaveLength(2);
      expect(a.exportStem).toBe("S01E001 - Shared");
      expect(b.exportStem).toBe("S02E001 - Shared");
    });

    it("cannot assign the same video twice within one season", () => {
      const { showId, seasonNumber } = setupShowAndSeason();
      createVideo("v1", "Once");

      const first = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "Once",
      });
      const second = ensureEpisodeAssignment({
        showId,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "Once",
      });

      expect(second.id).toBe(first.id);
      expect(listAssignmentsForShow(showId)).toHaveLength(1);
    });

    it("separates Season 00 occurrences from playlist occurrences", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCzero",
        sourcePlatform: "youtube",
        title: "Zero",
      });
      createVideo("v1", "Loose");

      const special = ensureEpisodeAssignment({
        showId: show.id,
        videoId: "v1",
        seasonNumber: 0,
        videoTitle: "Loose",
      });

      expect(special.collectionId).toBeUndefined();
      expect(special.exportStem).toBe("S00E001 - Loose");
      expect(listPlaylistAssignmentsForVideo("v1")).toHaveLength(0);

      createCollection("c1", "Playlist");
      const seasonNumber = attachCollectionToShow("c1", show.id).seasonNumber;
      ensureEpisodeAssignment({
        showId: show.id,
        collectionId: "c1",
        videoId: "v1",
        seasonNumber,
        videoTitle: "Loose",
      });

      expect(listPlaylistAssignmentsForVideo("v1")).toHaveLength(1);

      // Only after the playlist assignment exists may the special be dropped.
      deleteEpisodeAssignment(special.id);
      expect(
        getEpisodeAssignmentOccurrence(show.id, 0, "v1")
      ).toBeUndefined();
      expect(listAssignmentsForVideo("v1")).toHaveLength(1);
    });

    it("rejects structurally invalid assignments", () => {
      const show = ensureMediaServerShow({
        identityKey: "youtube:channel-id:UCbad",
        sourcePlatform: "youtube",
        title: "Bad",
      });
      createCollection("c1", "Playlist");
      createVideo("v1", "Bad");

      expect(() =>
        ensureEpisodeAssignment({
          showId: show.id,
          collectionId: "c1",
          videoId: "v1",
          seasonNumber: 0,
          videoTitle: "Bad",
        })
      ).toThrowError(/Season 00 assignments must not reference a collection/);

      expect(() =>
        ensureEpisodeAssignment({
          showId: show.id,
          videoId: "v1",
          seasonNumber: 1,
          videoTitle: "Bad",
        })
      ).toThrowError(/require a collection/);

      expect(() =>
        ensureEpisodeAssignment({
          showId: show.id,
          collectionId: "c1",
          videoId: "v1",
          seasonNumber: -1,
          videoTitle: "Bad",
        })
      ).toThrowError(/non-negative integer/);
    });
  });

  describe("token formatting", () => {
    it("pads to a minimum width without truncating larger numbers", () => {
      expect(padSeasonNumber(0)).toBe("00");
      expect(padSeasonNumber(3)).toBe("03");
      expect(padSeasonNumber(2026)).toBe("2026");
      expect(padEpisodeNumber(1)).toBe("001");
      expect(padEpisodeNumber(1000)).toBe("1000");
      expect(buildExportStem(3, 1000, "Big")).toBe("S03E1000 - Big");
    });

    it("falls back to the bare token for an unusable title", () => {
      expect(buildExportStem(1, 1, '   ?<>|   ')).toBe("S01E001");
    });
  });
});
