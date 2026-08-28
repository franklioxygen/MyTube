import type Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCatalogTestDatabase,
  insertCollectionRow,
  insertVideoRow,
} from "./helpers/catalogTestDb";
import type { Collection, Video } from "../../../services/storageService";

const mocks = vi.hoisted(() => ({ db: undefined as any, sqlite: undefined as any }));

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

import { reconcileMediaServerCatalog } from "../../../services/mediaServerExport/catalogReconciler";
import { ensureMediaServerExportTables } from "../../../services/storageService/migrations/schemaMigrations";
import {
  getMediaServerEpisodeAssignments,
  getMediaServerShows,
} from "../../../services/mediaServerExport/catalogRepository";
import type { MediaServerEpisodeAssignment } from "../../../services/mediaServerExport/types";

const { sqlite, db } = createCatalogTestDatabase();
mocks.db = db;
mocks.sqlite = sqlite;
// The columns and indexes this feature adds to `collections` come from the
// startup self-heal, not from the 0028 SQL — run the production function so the
// tests see exactly the schema a real deployment gets.
ensureMediaServerExportTables();

function video(id: string, overrides: Partial<Video> = {}): Video {
  return {
    id,
    title: `Video ${id}`,
    author: "Kurzgesagt",
    source: "YouTube",
    channelUrl: "https://www.youtube.com/channel/UC1",
    videoPath: `/videos/${id}.mp4`,
    sourceUrl: `https://example.com/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as Video;
}

function collection(
  id: string,
  videos: string[],
  overrides: Partial<Collection> = {}
): Collection {
  return {
    id,
    name: `Playlist ${id}`,
    title: `Playlist ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    sourceType: "playlist",
    videos,
    ...overrides,
  } as Collection;
}

function seed(
  videos: Video[],
  collections: Collection[],
  options: { sourceChannelId?: string } = {}
): void {
  for (const item of videos) {
    insertVideoRow(sqlite, {
      id: item.id,
      title: item.title,
      author: item.author,
      channelUrl: item.channelUrl,
      videoPath: item.videoPath,
      mediaType: item.mediaType,
      createdAt: item.createdAt,
    });
  }
  for (const item of collections) {
    insertCollectionRow(sqlite, {
      id: item.id,
      name: item.name ?? item.title,
      createdAt: item.createdAt,
      sourceType: item.sourceType,
      sourceChannelId: options.sourceChannelId,
    });
  }
}

/**
 * Production always re-reads collections from the database, so the immutable
 * season attachment written by an earlier pass is present. Mirror that here.
 */
function withPersistedAttachment(collection: Collection): Collection {
  const row = sqlite
    .prepare(
      "SELECT media_server_show_id AS showId, media_server_season_number AS seasonNumber FROM collections WHERE id = ?"
    )
    .get(collection.id) as
    | { showId: string | null; seasonNumber: number | null }
    | undefined;
  return {
    ...collection,
    mediaServerShowId: row?.showId ?? undefined,
    mediaServerSeasonNumber: row?.seasonNumber ?? undefined,
  };
}

function reconcile(videos: Video[], collections: Collection[]) {
  return reconcileMediaServerCatalog({
    videos,
    collections: collections.map(withPersistedAttachment),
    playlistSubscriptions: [],
  });
}

/** Assignments as compact `season/episode` tuples keyed by video id. */
function assignmentSummary(): Record<string, string[]> {
  const summary: Record<string, string[]> = {};
  for (const assignment of getMediaServerEpisodeAssignments()) {
    const list = summary[assignment.videoId] ?? [];
    list.push(`S${assignment.seasonNumber}E${assignment.episodeNumber}`);
    summary[assignment.videoId] = list.sort();
  }
  return summary;
}

function assignmentFor(
  videoId: string,
  seasonNumber: number
): MediaServerEpisodeAssignment | undefined {
  return getMediaServerEpisodeAssignments().find(
    (assignment) =>
      assignment.videoId === videoId && assignment.seasonNumber === seasonNumber
  );
}

describe("mediaServerExport/catalogReconciler", () => {
  beforeEach(() => {
    sqlite.exec(
      "DELETE FROM media_server_export_artifacts; DELETE FROM media_server_episode_assignments; DELETE FROM media_server_shows; DELETE FROM collection_videos; DELETE FROM collections; DELETE FROM videos; DELETE FROM subscriptions;"
    );
  });

  afterAll(() => {
    sqlite.close();
  });

  it("backfills one show, numbered seasons, and Season 00 deterministically", () => {
    const videos = [video("v1"), video("v2"), video("v3"), video("v4")];
    const collections = [
      collection("col-b", ["v2", "v3"], {
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
      collection("col-a", ["v1", "v2"], {
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    seed(videos, collections);

    expect(reconcile(videos, collections).issues).toEqual([]);

    const shows = getMediaServerShows();
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatchObject({
      title: "Kurzgesagt",
      directoryName: "Kurzgesagt",
      nextSeasonNumber: 3,
    });

    // col-a was created first, so it owns season 1.
    expect(assignmentSummary()).toEqual({
      v1: ["S1E1"],
      v2: ["S1E2", "S2E1"],
      v3: ["S2E2"],
      v4: ["S0E1"],
    });
  });

  it("keeps episode numbers when the upstream playlist is reordered", () => {
    const videos = [video("v1"), video("v2")];
    const collections = [collection("col-a", ["v1", "v2"])];
    seed(videos, collections);
    reconcile(videos, collections);

    const reordered = [collection("col-a", ["v2", "v1"])];
    reconcile(videos, reordered);

    expect(assignmentSummary()).toEqual({ v1: ["S1E1"], v2: ["S1E2"] });
    expect(assignmentFor("v1", 1)?.sourcePosition).toBe(2);
    expect(assignmentFor("v2", 1)?.sourcePosition).toBe(1);
  });

  it("gives a video inserted at the playlist head the next unused number", () => {
    const videos = [video("v1"), video("v2")];
    const collections = [collection("col-a", ["v1"])];
    seed(videos, collections);
    reconcile(videos, collections);

    const withHead = [collection("col-a", ["v2", "v1"])];
    reconcile(videos, withHead);

    expect(assignmentFor("v1", 1)?.episodeNumber).toBe(1);
    expect(assignmentFor("v2", 1)?.episodeNumber).toBe(2);
  });

  it("never reuses the season number of a removed playlist", () => {
    const videos = [video("v1"), video("v2")];
    const collections = [
      collection("col-a", ["v1"]),
      collection("col-b", ["v2"], { createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    seed(videos, collections);
    reconcile(videos, collections);
    expect(assignmentFor("v2", 2)).toBeDefined();

    sqlite.prepare("DELETE FROM collections WHERE id = 'col-b'").run();
    const later = collection("col-c", ["v2"], {
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    insertCollectionRow(sqlite, {
      id: later.id,
      name: later.name as string,
      createdAt: later.createdAt,
    });
    reconcile(videos, [collections[0], later]);

    expect(assignmentFor("v2", 3)).toBeDefined();
    expect(assignmentFor("v2", 2)).toBeUndefined();
  });

  it("removes only the departed occurrence and restores Specials for the last one", () => {
    const videos = [video("v1")];
    const collections = [collection("col-a", ["v1"]), collection("col-b", ["v1"])];
    seed(videos, collections);
    reconcile(videos, collections);
    expect(assignmentSummary()).toEqual({ v1: ["S1E1", "S2E1"] });

    reconcile(videos, [collections[0], collection("col-b", [])]);
    expect(assignmentSummary()).toEqual({ v1: ["S1E1"] });

    reconcile(videos, [collection("col-a", []), collection("col-b", [])]);
    expect(assignmentSummary()).toEqual({ v1: ["S0E1"] });
  });

  it("drops an occurrence when its collection is reattached to another show", () => {
    const videos = [video("v1")];
    const collections = [collection("col-a", ["v1"])];
    seed(videos, collections);
    reconcile(videos, collections);

    const original = getMediaServerEpisodeAssignments()[0];
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO media_server_shows
         (id, identity_key, source_platform, title, description, directory_name,
          next_season_number, created_at, updated_at)
         VALUES ('show-reassigned', 'youtube:channel-id:UC2', 'youtube',
                 'Reassigned', '', 'Reassigned', 2, ?, ?)`
      )
      .run(now, now);
    sqlite
      .prepare(
        `UPDATE collections
         SET media_server_show_id = 'show-reassigned',
             media_server_season_number = 1
         WHERE id = 'col-a'`
      )
      .run();

    reconcile(videos, collections);

    const assignments = getMediaServerEpisodeAssignments();
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      showId: "show-reassigned",
      collectionId: "col-a",
      seasonNumber: 1,
      videoId: "v1",
    });
    expect(assignments[0].id).not.toBe(original.id);
  });

  it("drops the Season 00 occurrence once a playlist season holds the video", () => {
    const videos = [video("v1")];
    seed(videos, []);
    reconcile(videos, []);
    expect(assignmentSummary()).toEqual({ v1: ["S0E1"] });

    const collections = [collection("col-a", ["v1"])];
    insertCollectionRow(sqlite, {
      id: "col-a",
      name: "Playlist col-a",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    reconcile(videos, collections);
    expect(assignmentSummary()).toEqual({ v1: ["S1E1"] });
  });

  it("ignores audio, non-local, and manual-collection records", () => {
    const videos = [
      video("v1", { mediaType: "audio" }),
      video("v2", { videoPath: "cloud:/remote/v2.mp4" }),
      video("v3"),
    ];
    const collections = [
      collection("col-manual", ["v3"], { sourceType: undefined, origin: "manual" }),
    ];
    seed(videos, collections);
    reconcile(videos, collections);

    expect(assignmentSummary()).toEqual({ v3: ["S0E1"] });
  });

  it("keeps one show when a playlist knows the channel id and a video only the URL", () => {
    const videos = [video("v1"), video("v2")];
    const collections = [collection("col-a", ["v1"])];
    seed(videos, collections, { sourceChannelId: "UC1" });

    reconcile(videos, [
      collection("col-a", ["v1"], { sourceChannelId: "UC1" }),
    ]);

    const shows = getMediaServerShows();
    expect(shows).toHaveLength(1);
    expect(shows[0].identityKey).toBe("youtube:channel-id:UC1");
    expect(assignmentSummary()).toEqual({ v1: ["S1E1"], v2: ["S0E1"] });
  });

  it("separates different channels that share an author name", () => {
    const videos = [
      video("v1", { channelUrl: "https://www.youtube.com/channel/UC1" }),
      video("v2", { channelUrl: "https://www.youtube.com/channel/UC2" }),
    ];
    seed(videos, []);
    reconcile(videos, []);

    const shows = getMediaServerShows();
    expect(shows).toHaveLength(2);
    expect(new Set(shows.map((show) => show.directoryName)).size).toBe(2);
  });

  it("reports a collection whose members disagree about the channel", () => {
    const videos = [
      video("v1", {
        author: "A",
        channelUrl: "https://www.youtube.com/channel/UC1",
      }),
      video("v2", {
        author: "B",
        channelUrl: "https://www.youtube.com/channel/UC2",
      }),
    ];
    const collections = [collection("col-a", ["v1", "v2"])];
    seed(videos, collections);

    const { issues } = reconcile(videos, collections);
    expect(issues).toContainEqual(
      expect.objectContaining({
        collectionId: "col-a",
        reason: "ambiguous_collection_show",
      })
    );
    expect(getMediaServerEpisodeAssignments().every((a) => a.seasonNumber === 0)).toBe(
      true
    );
  });

  it("reports a video with no resolvable identity instead of inventing one", () => {
    const videos = [
      video("v1", { author: undefined, channelUrl: undefined, source: undefined }),
    ];
    seed(videos, []);

    expect(reconcile(videos, []).issues).toContainEqual(
      expect.objectContaining({ videoId: "v1", reason: "unresolved_show_identity" })
    );
    expect(getMediaServerEpisodeAssignments()).toHaveLength(0);
  });

  it("is idempotent: a second pass changes no numbering", () => {
    const videos = [video("v1"), video("v2")];
    const collections = [collection("col-a", ["v1", "v2"])];
    seed(videos, collections);
    reconcile(videos, collections);
    const before = getMediaServerEpisodeAssignments();

    reconcile(videos, collections);
    expect(getMediaServerEpisodeAssignments()).toEqual(before);
  });

  it("stores the export stem once and keeps it after a title edit", () => {
    const videos = [video("v1", { title: "Original" })];
    const collections = [collection("col-a", ["v1"])];
    seed(videos, collections);
    reconcile(videos, collections);
    expect(assignmentFor("v1", 1)?.exportStem).toBe("S01E001 - Original");

    reconcile([video("v1", { title: "Edited" })], collections);
    expect(assignmentFor("v1", 1)?.exportStem).toBe("S01E001 - Original");
  });

  it("captures the channel description from raw download metadata", () => {
    const videos = [video("v1")];
    seed(videos, []);

    reconcileMediaServerCatalog({
      videos,
      collections: [],
      playlistSubscriptions: [],
      rawInfoByVideoId: new Map([
        ["v1", { channel_id: "UC1", channel_description: "About the channel" }],
      ]),
    });

    expect(getMediaServerShows()[0]).toMatchObject({
      identityKey: "youtube:channel-id:UC1",
      description: "About the channel",
    });
  });
});
