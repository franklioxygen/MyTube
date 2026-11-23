import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  settings: {} as Record<string, unknown>,
}));
vi.mock("../../db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("../../services/storageService/settings", () => ({
  getSettings: () => state.settings,
  saveSettings: (next: Record<string, unknown>) => {
    state.settings = { ...next };
  },
}));
vi.mock("../../services/storageService/videoListRevision", () => ({
  bumpVideosListRevision: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { bumpVideosListRevision } from "../../services/storageService/videoListRevision";
import { renameTag, rewriteAutoTagsForAliases } from "../../services/tagService";

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE videos (id TEXT PRIMARY KEY NOT NULL, tags TEXT, auto_tags TEXT)");
  state.db = drizzle(sqlite, { schema });
  state.settings = {};
  vi.mocked(bumpVideosListRevision).mockClear();
});
afterEach(() => {
  sqlite.close();
});

const addVideo = (id: string, tags: string[] | null, autoTags: string[] | null) =>
  sqlite
    .prepare("INSERT INTO videos (id, tags, auto_tags) VALUES (?, ?, ?)")
    .run(id, tags && JSON.stringify(tags), autoTags && JSON.stringify(autoTags));

const autoTagsOf = (id: string) => {
  const row = sqlite.prepare("SELECT auto_tags FROM videos WHERE id = ?").get(id) as {
    auto_tags: string | null;
  };
  return row.auto_tags === null ? null : JSON.parse(row.auto_tags);
};

describe("renameTag and tag aliases", () => {
  it("makes the old name an alias and folds stored suggestions into the new one", () => {
    state.settings = { tags: ["music", "other"], tagAliases: { song: "music" } };
    addVideo("plain", ["other"], ["Music", "live"]);
    addVideo("has-new", ["音乐"], ["music", "x"]);
    addVideo("untouched", null, ["live"]);

    renameTag("music", "音乐");

    expect(state.settings.tags).toEqual(["音乐", "other"]);
    expect(state.settings.tagAliases).toEqual({ song: "音乐", music: "音乐" });
    expect(autoTagsOf("plain")).toEqual(["音乐", "live"]);
    expect(autoTagsOf("has-new")).toEqual(["x"]);
    expect(autoTagsOf("untouched")).toEqual(["live"]);
  });

  it("never leaves the new name as an alias, so renaming back does not chain", () => {
    state.settings = { tags: ["音乐"], tagAliases: { music: "音乐" } };

    renameTag("音乐", "music");

    expect(state.settings.tagAliases).toEqual({ 音乐: "music" });
  });

  it("registers an old name of __proto__ as an ordinary alias", () => {
    state.settings = { tags: ["__proto__"], tagAliases: JSON.parse('{"__proto__":"x"}') };

    renameTag("__proto__", "music");

    expect(JSON.stringify(state.settings.tagAliases)).toBe('{"__proto__":"music"}');
  });

  it("folds suggestions into the exact renamed spelling", () => {
    state.settings = { tags: ["music"] };
    addVideo("v", null, ["Music", "live"]);

    renameTag("music", "#Music");

    expect(state.settings.tagAliases).toEqual({ music: "#Music" });
    expect(autoTagsOf("v")).toEqual(["#Music", "live"]);
  });

  it("adds no alias for a case-only rename", () => {
    state.settings = { tags: ["music"] };

    renameTag("music", "Music");

    expect(state.settings.tags).toEqual(["Music"]);
    expect(state.settings.tagAliases).toBeUndefined();
  });
});

describe("rewriteAutoTagsForAliases", () => {
  it("rewrites only suggestions that hold a changed alias, matching beyond ASCII", () => {
    state.settings = { tagAliases: { привет: "hello", song: "music" } };
    addVideo("cyrillic", null, ["ПРИВЕТ", "world"]);
    addVideo("other-alias", null, ["song"]);
    addVideo("none", null, null);

    expect(rewriteAutoTagsForAliases(["привет"])).toBe(1);
    expect(bumpVideosListRevision).toHaveBeenCalledTimes(1);

    expect(autoTagsOf("cyrillic")).toEqual(["hello", "world"]);
    expect(autoTagsOf("other-alias")).toEqual(["song"]);
    expect(autoTagsOf("none")).toBeNull();
  });

  it("leaves the list revision alone when no suggestion changes", () => {
    state.settings = { tagAliases: { song: "music" } };
    addVideo("plain", null, ["live"]);

    expect(rewriteAutoTagsForAliases(["song"])).toBe(0);
    expect(bumpVideosListRevision).not.toHaveBeenCalled();
  });
});
