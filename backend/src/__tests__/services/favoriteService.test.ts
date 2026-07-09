import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: undefined as any,
  isLoginRequired: vi.fn(),
}));

vi.mock("../../db", () => ({
  get db() {
    return mocks.db;
  },
}));
vi.mock("../../services/passwordService", () => ({
  isLoginRequired: mocks.isLoginRequired,
}));

describe("favoriteService", () => {
  let sqlite: Database.Database;
  let favoriteService: typeof import("../../services/favoriteService");

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE collections (id text PRIMARY KEY, name text NOT NULL, title text, source_platform text);
      CREATE TABLE videos (id text PRIMARY KEY, author text, visibility integer, created_at text NOT NULL);
      CREATE TABLE collection_videos (
        collection_id text NOT NULL,
        video_id text NOT NULL,
        "order" integer,
        PRIMARY KEY (collection_id, video_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
        FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
      );
      CREATE TABLE favorite_collections (
        user_id text NOT NULL,
        collection_id text NOT NULL,
        created_at integer NOT NULL,
        PRIMARY KEY (user_id, collection_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );
      CREATE TABLE favorite_authors (
        user_id text NOT NULL,
        author text NOT NULL,
        display_name text,
        avatar_path text,
        channel_url text,
        created_at integer NOT NULL,
        PRIMARY KEY (user_id, author)
      );
    `);
    mocks.db = drizzle(sqlite);
    mocks.isLoginRequired.mockReturnValue(true);
    favoriteService = await import("../../services/favoriteService");
  });

  beforeEach(() => {
    sqlite.exec("DELETE FROM favorite_authors; DELETE FROM favorite_collections; DELETE FROM collection_videos; DELETE FROM videos; DELETE FROM collections;");
    sqlite.exec(`
      INSERT INTO collections (id, name, title, source_platform) VALUES ('c1', 'Collection 1', 'Collection 1', 'youtube');
      INSERT INTO videos (id, author, visibility, created_at) VALUES
        ('v1', 'AC/DC', 1, '2026-01-01'),
        ('v2', 'AC/DC', 0, '2026-01-02'),
        ('v3', 'Other', 1, '2026-01-03');
      INSERT INTO collection_videos (collection_id, video_id, "order") VALUES ('c1', 'v1', 1), ('c1', 'v2', 2);
    `);
  });

  afterAll(() => sqlite.close());

  it("is idempotent and scopes collection counts/covers by visibility", () => {
    favoriteService.addFavoriteCollection("visitor-1", "c1");
    favoriteService.addFavoriteCollection("visitor-1", "c1");

    expect(favoriteService.listFavoriteCollections("visitor-1", "visitor")).toEqual([
      expect.objectContaining({ collectionId: "c1", videoCount: 1, thumbnailVideoId: "v1" }),
    ]);
    expect(favoriteService.listFavoriteCollections("visitor-1", "admin")).toEqual([
      expect.objectContaining({ collectionId: "c1", videoCount: 2, thumbnailVideoId: "v1" }),
    ]);
  });

  it("upserts author metadata without crossing owner boundaries", () => {
    favoriteService.addFavoriteAuthor("visitor-1", {
      author: "AC/DC",
      displayName: "Old name",
      avatarPath: "/avatars/old.jpg",
    });
    favoriteService.addFavoriteAuthor("visitor-1", {
      author: "AC/DC",
      displayName: "New name",
      avatarPath: "/avatars/new.jpg",
    });
    favoriteService.addFavoriteAuthor("visitor-2", {
      author: "AC/DC",
      displayName: "Other owner",
    });

    expect(favoriteService.listFavoriteAuthors("visitor-1", "visitor")).toEqual([
      expect.objectContaining({ author: "AC/DC", displayName: "New name", videoCount: 1 }),
    ]);
    favoriteService.removeFavoriteAuthor("visitor-1", "AC/DC");
    expect(favoriteService.listFavoriteAuthors("visitor-2", "visitor")).toEqual([
      expect.objectContaining({ displayName: "Other owner" }),
    ]);
  });

  it("cascades collection favorites when the collection is deleted", () => {
    favoriteService.addFavoriteCollection("owner-1", "c1");
    sqlite.prepare("DELETE FROM collections WHERE id = 'c1'").run();
    expect(favoriteService.listFavoriteCollections("owner-1")).toEqual([]);
  });
});
