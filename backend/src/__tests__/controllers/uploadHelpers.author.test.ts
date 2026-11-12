import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs-extra";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadedVideoFile } from "../../utils/videoUpload";

const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined, dir: "" }));
vi.mock("../../db", () => ({ get db() { return state.db; } }));
vi.mock("../../config/paths", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-author-test-"));
  return { VIDEOS_DIR: state.dir, IMAGES_DIR: state.dir, CLOUD_THUMBNAIL_CACHE_DIR: state.dir };
});
vi.mock("../../services/storageService", () => ({}));
vi.mock("../../services/thumbnailMirrorService", () => ({}));
vi.mock("../../controllers/video/mediaProbe", () => ({}));
vi.mock("../../controllers/video/uploadNaming", () => ({}));
import { readUploadAuthor } from "../../controllers/video/uploadHelpers";

let sqlite: Database.Database;
beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE videos (id TEXT PRIMARY KEY, author TEXT)");
  state.db = drizzle(sqlite);
});
beforeEach(() => {
  sqlite.exec("DELETE FROM videos");
  fs.emptyDirSync(state.dir);
});
afterAll(() => { sqlite.close(); fs.removeSync(state.dir); });

describe("upload author identity", () => {
  it("preserves exact existing selections without merging case or whitespace variants", () => {
    const insert = sqlite.prepare("INSERT INTO videos VALUES (?, ?)");
    [" Alice ", "Alice", "alice", "作者 / 🎬"].forEach((name, index) => insert.run(String(index), name));
    for (const name of [" Alice ", "Alice", "alice", "作者 / 🎬"]) {
      expect(readUploadAuthor({ author: "ignored", authorKey: name }, [])).toBe(name);
    }
  });

  it("retains trimming and the Admin default for new names and older API clients", () => {
    expect(readUploadAuthor({ author: " Alice " }, [])).toBe("Alice");
    expect(readUploadAuthor({ author: "   " }, [])).toBe("Admin");
    expect(readUploadAuthor(undefined, [])).toBe("Admin");
  });

  it.each(["missing", " ALICE ", "", ["Alice"], null, 1])(
    "rejects an invalid or stale selection (%j) and cleans every staged upload",
    authorKey => {
      sqlite.prepare("INSERT INTO videos VALUES (?, ?)").run("v", "Alice");
      const files = ["one.mp4", "two.mp4"].map(filename => {
        fs.writeFileSync(path.join(state.dir, filename), "uploaded bytes");
        return { filename } as UploadedVideoFile;
      });
      expect(() => readUploadAuthor({ author: "Alice", authorKey }, files)).toThrow("Selected author no longer exists");
      expect(fs.readdirSync(state.dir)).toEqual([]);
    }
  );
});
