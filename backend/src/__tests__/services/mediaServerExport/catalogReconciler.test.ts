import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, Video } from "../../../services/storageService/types";

/**
 * Runs the reconciler against a real in-memory SQLite catalog, so the immutable
 * numbering guaranteed by the unique indexes is genuinely exercised.
 */
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
        // Overlap with runtime self-heal migrations; unrelated to these tables.
      }
    }
  }

  // These collections columns predate the media-server work but were only ever
  // added by the runtime self-heal in storageService/migrations, never by a
  // drizzle migration. Apply them here so the harness matches a real database.
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

import {
  isSourceBackedPlaylistCollection,
  reconcileMediaServerCatalog,
  type CatalogReconcileSubscription,
} from "../../../services/mediaServerExport/catalogReconciler";
import {
  listAssignmentsForVideo,
  listMediaServerShows,
} from "../../../services/mediaServerExport/catalogRepository";
import { previewMediaServerExportScope } from "../../../services/mediaServerExport/scopePreview";

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "v1",
    title: "Ants",
    author: "Kurzgesagt",
    source: "youtube",
    sourceUrl: "https://youtube.com/watch?v=1",
    channelUrl: "https://www.youtube.com/@kurzgesagt",
    createdAt: "2026-01-01T00:00:00.000Z",
    videoPath: "/videos/a.mp4",
    ...overrides,
  } as Video;
}

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "Space Time",
    title: "Space Time",
    videos: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    sourceType: "playlist",
    sourcePlatform: "youtube",
    sourceChannelId: "UC123",
    sourceChannelName: "Kurzgesagt",
    ...overrides,
  } as Collection;
}

/**
 * The reconciler reads collections and videos from its input, but writes
 * catalog rows through the repository, which reads collections back from the
 * database. Both views have to exist.
 */
function seedCollectionRow(entry: Collection): void {
  testDb.sqlite
    .prepare(
      `INSERT INTO collections (id, name, title, created_at, source_type, source_platform, source_channel_id, source_channel_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.id,
      entry.name ?? entry.title,
      entry.title,
      entry.createdAt ?? "",
      entry.sourceType ?? null,
      entry.sourcePlatform ?? null,
      entry.sourceChannelId ?? null,
      entry.sourceChannelName ?? null
    );
}

function seedVideoRow(entry: Video): void {
  testDb.sqlite
    .prepare("INSERT INTO videos (id, title, created_at) VALUES (?, ?, ?)")
    .run(entry.id, entry.title, entry.createdAt);
}

function reconcile(input: {
  videos?: Video[];
  collections?: Collection[];
  subscriptions?: CatalogReconcileSubscription[];
  affectedVideoIds?: Set<string>;
  affectedCollectionIds?: Set<string>;
  rawMetadataByVideoId?: Map<string, unknown>;
}) {
  for (const entry of input.videos ?? []) {
    seedVideoRow(entry);
  }
  for (const entry of input.collections ?? []) {
    seedCollectionRow(entry);
  }

  return reconcileMediaServerCatalog({
    videos: input.videos ?? [],
    collections: input.collections ?? [],
    subscriptions: input.subscriptions ?? [],
    affectedVideoIds: input.affectedVideoIds,
    affectedCollectionIds: input.affectedCollectionIds,
    rawMetadataByVideoId: input.rawMetadataByVideoId,
  });
}

describe("mediaServerExport catalogReconciler", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  describe("source-backed collection detection", () => {
    const subscriptions = new Map<string, CatalogReconcileSubscription>();

    it("accepts playlist, Bilibili collection and series source types", () => {
      for (const sourceType of ["playlist", "collection", "series"]) {
        expect(
          isSourceBackedPlaylistCollection(
            collection({ sourceType }),
            subscriptions
          )
        ).toBe(true);
      }
    });

    it("rejects manual and author_auto collections", () => {
      for (const origin of ["manual", "author_auto"] as const) {
        expect(
          isSourceBackedPlaylistCollection(
            collection({ origin, sourceType: undefined }),
            subscriptions
          )
        ).toBe(false);
      }
    });

    it("accepts a collection owned by a playlist subscription", () => {
      const linked = new Map<string, CatalogReconcileSubscription>([
        ["c1", { id: "s1", collectionId: "c1", subscriptionType: "playlist" }],
      ]);

      expect(
        isSourceBackedPlaylistCollection(
          collection({ sourceType: undefined }),
          linked
        )
      ).toBe(true);
      expect(
        isSourceBackedPlaylistCollection(
          collection({ origin: "manual", sourceType: undefined }),
          linked
        )
      ).toBe(true);
    });
  });

  describe("backfill", () => {
    it("allocates seasons deterministically by createdAt, source id, then id", () => {
      const result = reconcile({
        videos: [video({ id: "v1" }), video({ id: "v2" }), video({ id: "v3" })],
        collections: [
          collection({
            id: "c-third",
            title: "Third",
            createdAt: "2026-03-01T00:00:00.000Z",
            videos: ["v3"],
          }),
          collection({
            id: "c-first",
            title: "First",
            createdAt: "2026-01-01T00:00:00.000Z",
            videos: ["v1"],
          }),
          collection({
            id: "c-second",
            title: "Second",
            createdAt: "2026-02-01T00:00:00.000Z",
            videos: ["v2"],
          }),
        ],
      });

      expect(result.issues).toEqual([]);
      const seasons = testDb.sqlite
        .prepare(
          "SELECT id, media_server_season_number AS season FROM collections ORDER BY media_server_season_number"
        )
        .all() as Array<{ id: string; season: number }>;

      expect(seasons).toEqual([
        { id: "c-first", season: 1 },
        { id: "c-second", season: 2 },
        { id: "c-third", season: 3 },
      ]);
    });

    it("collapses one channel into one show across several playlists", () => {
      reconcile({
        videos: [video({ id: "v1" }), video({ id: "v2" })],
        collections: [
          collection({ id: "c1", videos: ["v1"] }),
          collection({
            id: "c2",
            title: "Other Playlist",
            createdAt: "2026-02-01T00:00:00.000Z",
            videos: ["v2"],
          }),
        ],
      });

      const shows = listMediaServerShows();
      expect(shows).toHaveLength(1);
      expect(shows[0].directoryName).toBe("Kurzgesagt");
      expect(shows[0].nextSeasonNumber).toBe(3);
    });

    /**
     * Frozen for the collection-as-show work. `findCompatibleExistingShow()`
     * treats "same platform + same normalized title" as the same channel, which
     * is what makes the author-fallback upgrade work.
     *
     * It is also why a collection-show needs an *explicit* exclusion rather than
     * relying on its `collection:<id>` identity prefix: two dramas that happen to
     * share a title would otherwise be merged into one show. When that exclusion
     * lands, this test must keep passing — it covers author shows only.
     */
    it("merges two author identities that share a platform and normalized title", () => {
      reconcile({
        videos: [
          video({
            id: "v1",
            author: "Same Name",
            channelUrl: undefined,
            source: "youtube",
          }),
          video({
            id: "v2",
            author: "same  name",
            channelUrl: undefined,
            source: "youtube",
          }),
        ],
      });

      expect(listMediaServerShows()).toHaveLength(1);
    });

    it("uses the hydrated collection order as the initial episode number", () => {
      reconcile({
        videos: [
          video({ id: "v1", title: "First" }),
          video({ id: "v2", title: "Second" }),
          video({ id: "v3", title: "Third" }),
        ],
        collections: [collection({ videos: ["v3", "v1", "v2"] })],
      });

      const assignments = testDb.sqlite
        .prepare(
          "SELECT video_id AS videoId, episode_number AS episode, export_stem AS stem FROM media_server_episode_assignments ORDER BY episode_number"
        )
        .all() as Array<{ videoId: string; episode: number; stem: string }>;

      expect(assignments).toEqual([
        { videoId: "v3", episode: 1, stem: "S01E001 - Third" },
        { videoId: "v1", episode: 2, stem: "S01E002 - First" },
        { videoId: "v2", episode: 3, stem: "S01E003 - Second" },
      ]);
    });

    it("is idempotent", () => {
      const args = {
        videos: [video({ id: "v1" }), video({ id: "v2" })],
        collections: [collection({ videos: ["v1", "v2"] })],
      };

      reconcile(args);
      const before = testDb.sqlite
        .prepare(
          "SELECT id, episode_number, export_stem FROM media_server_episode_assignments ORDER BY id"
        )
        .all();

      reconcileMediaServerCatalog({
        videos: args.videos,
        collections: args.collections,
        subscriptions: [],
      });
      const after = testDb.sqlite
        .prepare(
          "SELECT id, episode_number, export_stem FROM media_server_episode_assignments ORDER BY id"
        )
        .all();

      expect(after).toEqual(before);
      expect(listMediaServerShows()).toHaveLength(1);
    });
  });

  describe("upstream reordering", () => {
    it("updates sourcePosition without renumbering episodes", () => {
      const videos = [video({ id: "v1" }), video({ id: "v2" })];
      reconcile({ videos, collections: [collection({ videos: ["v1", "v2"] })] });

      // The upstream playlist reorders; MyTube re-imports it head-first.
      reconcileMediaServerCatalog({
        videos,
        collections: [collection({ videos: ["v2", "v1"] })],
        subscriptions: [],
      });

      const rows = testDb.sqlite
        .prepare(
          "SELECT video_id AS videoId, episode_number AS episode, source_position AS position FROM media_server_episode_assignments ORDER BY episode_number"
        )
        .all() as Array<{ videoId: string; episode: number; position: number }>;

      expect(rows).toEqual([
        { videoId: "v1", episode: 1, position: 2 },
        { videoId: "v2", episode: 2, position: 1 },
      ]);
    });

    it("gives an item inserted at the head the next unused number", () => {
      const first = [video({ id: "v1" }), video({ id: "v2" })];
      reconcile({ videos: first, collections: [collection({ videos: ["v1", "v2"] })] });

      const withNew = [...first, video({ id: "v-new", title: "Newest" })];
      seedVideoRow(video({ id: "v-new", title: "Newest" }));
      reconcileMediaServerCatalog({
        videos: withNew,
        collections: [collection({ videos: ["v-new", "v1", "v2"] })],
        subscriptions: [],
      });

      const row = testDb.sqlite
        .prepare(
          "SELECT episode_number AS episode, export_stem AS stem FROM media_server_episode_assignments WHERE video_id = 'v-new'"
        )
        .get() as { episode: number; stem: string };

      expect(row).toEqual({ episode: 3, stem: "S01E003 - Newest" });
    });
  });

  describe("duplicate membership", () => {
    it("creates one assignment per playlist for the same video", () => {
      reconcile({
        videos: [video({ id: "v1" })],
        collections: [
          collection({ id: "c1", videos: ["v1"] }),
          collection({
            id: "c2",
            title: "Second Playlist",
            createdAt: "2026-02-01T00:00:00.000Z",
            videos: ["v1"],
          }),
        ],
      });

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(2);
      expect(assignments.map((a) => a.seasonNumber).sort()).toEqual([1, 2]);
      expect(assignments.map((a) => a.exportStem).sort()).toEqual([
        "S01E001 - Ants",
        "S02E001 - Ants",
      ]);
    });

    it("removes only the departed occurrence when a video leaves one playlist", () => {
      const videos = [video({ id: "v1" })];
      const both = [
        collection({ id: "c1", videos: ["v1"] }),
        collection({
          id: "c2",
          title: "Second Playlist",
          createdAt: "2026-02-01T00:00:00.000Z",
          videos: ["v1"],
        }),
      ];
      reconcile({ videos, collections: both });

      reconcileMediaServerCatalog({
        videos,
        collections: [both[0], { ...both[1], videos: [] }],
        subscriptions: [],
      });

      const remaining = listAssignmentsForVideo("v1");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].seasonNumber).toBe(1);
    });
  });

  describe("Season 00", () => {
    it("assigns an unlinked video to Season 00 under its author show", () => {
      reconcile({ videos: [video({ id: "v1" })] });

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0].seasonNumber).toBe(0);
      expect(assignments[0].collectionId).toBeUndefined();
      expect(assignments[0].exportStem).toBe("S00E001 - Ants");
      // Positive seasons stay reserved for playlists.
      expect(listMediaServerShows()[0].nextSeasonNumber).toBe(1);
    });

    it("does not create a Season 00 occurrence for a playlist video", () => {
      reconcile({
        videos: [video({ id: "v1" })],
        collections: [collection({ videos: ["v1"] })],
      });

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0].seasonNumber).toBe(1);
    });

    it("drops Season 00 only once the playlist assignment exists", () => {
      const videos = [video({ id: "v1" })];
      reconcile({ videos });
      expect(listAssignmentsForVideo("v1")[0].seasonNumber).toBe(0);

      const playlist = collection({ videos: ["v1"] });
      seedCollectionRow(playlist);
      reconcileMediaServerCatalog({
        videos,
        collections: [playlist],
        subscriptions: [],
      });

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0].seasonNumber).toBe(1);
    });

    it("restores a Season 00 occurrence in the same pass when the last playlist link goes", () => {
      const videos = [video({ id: "v1" })];
      const playlist = collection({ videos: ["v1"] });
      reconcile({ videos, collections: [playlist] });

      reconcileMediaServerCatalog({
        videos,
        collections: [{ ...playlist, videos: [] }],
        subscriptions: [],
      });

      const assignments = listAssignmentsForVideo("v1");
      expect(assignments).toHaveLength(1);
      expect(assignments[0].seasonNumber).toBe(0);
    });

    it("skips audio-only media", () => {
      const result = reconcile({
        videos: [video({ id: "v1", mediaType: "audio" })],
      });

      expect(listAssignmentsForVideo("v1")).toHaveLength(0);
      expect(result.issues).toEqual([]);
    });
  });

  describe("identity failures", () => {
    it("reports a video with no resolvable channel identity", () => {
      const result = reconcile({
        videos: [
          video({
            id: "v1",
            author: undefined,
            channelUrl: undefined,
            source: "youtube",
          }),
        ],
      });

      expect(result.issues).toEqual([
        expect.objectContaining({
          reason: "unresolved_show_identity",
          videoId: "v1",
        }),
      ]);
      expect(listMediaServerShows()).toHaveLength(0);
    });

    it("leaves a collection unassigned when its members disagree", () => {
      const result = reconcile({
        videos: [
          video({ id: "v1", author: "Channel A", channelUrl: undefined }),
          video({ id: "v2", author: "Channel B", channelUrl: undefined }),
        ],
        collections: [
          collection({
            videos: ["v1", "v2"],
            sourceChannelId: undefined,
            sourceChannelName: undefined,
            sourcePlatform: "youtube",
          }),
        ],
      });

      expect(result.issues).toEqual([
        expect.objectContaining({
          reason: "ambiguous_collection_show",
          collectionId: "c1",
        }),
      ]);

      const seasonRow = testDb.sqlite
        .prepare(
          "SELECT media_server_season_number AS season FROM collections WHERE id = 'c1'"
        )
        .get() as { season: number | null };
      expect(seasonRow.season).toBeNull();

      // The videos still reach the mirror, under their own author shows.
      expect(listAssignmentsForVideo("v1")[0].seasonNumber).toBe(0);
      expect(listAssignmentsForVideo("v2")[0].seasonNumber).toBe(0);
    });
  });

  it("reports the shows a run touched so materialization can be scoped", () => {
    const result = reconcile({
      videos: [video({ id: "v1" })],
      collections: [collection({ videos: ["v1"] })],
    });

    expect(result.affectedShowIds.size).toBe(1);
    expect([...result.affectedShowIds][0]).toBe(listMediaServerShows()[0].id);
  });

  it("honors an incremental video scope", () => {
    const videos = [video({ id: "v1" }), video({ id: "v2" })];
    reconcile({
      videos,
      collections: [],
      affectedVideoIds: new Set(["v1"]),
    });

    expect(listAssignmentsForVideo("v1")).toHaveLength(1);
    expect(listAssignmentsForVideo("v2")).toHaveLength(0);
  });
});

/**
 * findCompatibleExistingShow lets an author-fallback identity join a show that
 * already has a stronger identity. That is right when the evidence agrees, and
 * dangerous when it does not: display names are not unique, and a merge is
 * permanent because show identity is allocated once and never revised.
 */
describe("compatible show matching rejects conflicting evidence", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  /**
   * A show created from an author fallback keeps its author-based identity key
   * even after being enriched with a channel id. The exact key lookup therefore
   * misses when a later candidate arrives with that same id, so the compatible
   * matcher is the only thing standing between a renamed channel and a split
   * durable library.
   */
  it("matches an enriched author-fallback show by channel id after a rename", () => {
    reconcile({
      videos: [
        // No channel id or URL: creates an author-fallback show.
        video({ id: "v1", author: "Old Name", channelUrl: undefined }),
      ],
    });
    const [show] = listMediaServerShows();
    // Enrichment: the id arrives later, the identity key stays author-based.
    testDb.sqlite
      .prepare("UPDATE media_server_shows SET source_channel_id=? WHERE id=?")
      .run("UC-durable", show.id);

    reconcile({
      videos: [
        video({
          id: "v2",
          author: "Brand New Name",
          channelUrl: "https://www.youtube.com/@brand-new",
        }),
      ],
      // The durable id reaches reconciliation through the downloader envelope.
      rawMetadataByVideoId: new Map([["v2", { channel_id: "UC-durable" }]]),
    });

    expect(listMediaServerShows()).toHaveLength(1);
  });

  it("still splits when the channel ids disagree", () => {
    reconcile({
      videos: [video({ id: "v1", author: "News", channelUrl: undefined })],
    });
    const [show] = listMediaServerShows();
    testDb.sqlite
      .prepare("UPDATE media_server_shows SET source_channel_id=? WHERE id=?")
      .run("UC-one", show.id);

    reconcile({
      videos: [video({ id: "v2", author: "News", channelUrl: undefined })],
      rawMetadataByVideoId: new Map([["v2", { channel_id: "UC-two" }]]),
    });

    expect(listMediaServerShows()).toHaveLength(2);
  });

  it("keeps two channels apart when their durable URLs differ", () => {
    reconcile({
      videos: [
        video({ id: "v1", author: "News", channelUrl: "https://www.youtube.com/@news-one" }),
        video({ id: "v2", author: "News", channelUrl: "https://www.youtube.com/@news-two" }),
      ],
    });

    // Same platform, same display name, different durable URLs: two shows.
    expect(listMediaServerShows()).toHaveLength(2);
  });

  it("still merges an author-only video into the channel show of the same name", () => {
    reconcile({
      videos: [
        video({ id: "v1", author: "News", channelUrl: "https://www.youtube.com/@news-one" }),
        // No channel URL at all: the author fallback should find the show above.
        video({ id: "v2", author: "News", channelUrl: undefined }),
      ],
    });

    expect(listMediaServerShows()).toHaveLength(1);
  });
});

/**
 * The rebuild confirmation quotes a folder count from previewMediaServerExportScope.
 * If that number and the allocator ever disagree, the dialog misinforms the user
 * about an action that can add dozens of shows to their media server - so the
 * two are compared directly here, on the same input, rather than trusting that
 * they share a helper.
 */
describe("scope preview agrees with the allocator", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  function assertAgreement(videos: Video[], collections: Collection[] = []): void {
    const predicted = previewMediaServerExportScope({ videos, collections });
    reconcile({ videos, collections });
    const actual = listMediaServerShows().length;

    expect(predicted.showCount).toBe(actual);
  }

  it("agrees for one channel with several videos", () => {
    assertAgreement([
      video({ id: "v1", channelUrl: "https://www.youtube.com/@a" }),
      video({ id: "v2", channelUrl: "https://www.youtube.com/@a" }),
    ]);
  });

  it("agrees when an author-only video joins a channel show", () => {
    assertAgreement([
      video({ id: "v1", author: "News", channelUrl: "https://www.youtube.com/@news" }),
      video({ id: "v2", author: "News", channelUrl: undefined }),
    ]);
  });

  it("agrees when two channels share a display name", () => {
    assertAgreement([
      video({ id: "v1", author: "News", channelUrl: "https://www.youtube.com/@news-one" }),
      video({ id: "v2", author: "News", channelUrl: "https://www.youtube.com/@news-two" }),
    ]);
  });

  it("agrees when an ambiguous title blocks the merge", () => {
    assertAgreement([
      video({ id: "v1", author: "News", channelUrl: "https://www.youtube.com/@news-one" }),
      video({ id: "v2", author: "News", channelUrl: "https://www.youtube.com/@news-two" }),
      video({ id: "v3", author: "News", channelUrl: undefined }),
    ]);
  });

  it("agrees for unrelated channels", () => {
    assertAgreement([
      video({ id: "v1", author: "A", channelUrl: "https://www.youtube.com/@a" }),
      video({ id: "v2", author: "B", channelUrl: "https://www.youtube.com/@b" }),
      video({ id: "v3", author: "C", channelUrl: undefined }),
    ]);
  });
});

/**
 * A collection whose members resolve at different identity strengths is not
 * ambiguous - show allocation would merge them. Declaring ambiguity there stops
 * the collection ever becoming a season, and removes the season assignment it
 * already had.
 */
describe("collection member identities are merged before declaring ambiguity", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM collections;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  it("becomes a season when members differ only in identity strength", () => {
    const result = reconcile({
      videos: [
        video({ id: "v1", author: "News", channelUrl: "https://www.youtube.com/@news" }),
        // Same channel, weaker evidence: no URL, same display name.
        video({ id: "v2", author: "News", channelUrl: undefined }),
      ],
      collections: [
        collection({
          id: "c1",
          // Source-backed, but carrying no channel metadata of its own, so the
          // decision falls through to the member videos.
          sourceType: "playlist",
          sourceChannelId: undefined,
          sourceChannelUrl: undefined,
          sourceChannelName: undefined,
          videos: ["v1", "v2"],
        }),
      ],
    });

    expect(
      result.issues.some((issue) => issue.reason === "ambiguous_collection_show")
    ).toBe(false);
    // One show, and the collection attached to it as a season.
    expect(listMediaServerShows()).toHaveLength(1);
    expect(listAssignmentsForVideo("v1")[0].seasonNumber).toBe(1);
  });

  it("still reports ambiguity when two channels genuinely disagree", () => {
    const result = reconcile({
      videos: [
        video({ id: "v1", author: "A", channelUrl: "https://www.youtube.com/@a" }),
        video({ id: "v2", author: "B", channelUrl: "https://www.youtube.com/@b" }),
      ],
      collections: [
        collection({
          id: "c1",
          sourceType: "playlist",
          sourceChannelId: undefined,
          sourceChannelUrl: undefined,
          sourceChannelName: undefined,
          videos: ["v1", "v2"],
        }),
      ],
    });

    expect(
      result.issues.some((issue) => issue.reason === "ambiguous_collection_show")
    ).toBe(true);
  });
});
