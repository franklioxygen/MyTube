import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../../db", () => ({ get db() { return mocks.db; } }));
import { getVideoRetry, listVideoRetries, markVideoRetryAttempted, queueVideoRetry, removeVideoRetry, VIDEO_RETRIES_PER_CHECK } from "../../services/subscription/videoRetries";

describe("subscription video retry persistence", () => {
  let sqlite: Database.Database;
  let directory: string;
  let databasePath: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mytube-retries-"));
    databasePath = join(directory, "retries.db");
    sqlite = new Database(databasePath);
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec("CREATE TABLE subscriptions (id TEXT PRIMARY KEY, last_video_link TEXT)");
    sqlite.exec(readFileSync("drizzle/0029_subscription_video_retries.sql", "utf8"));
    sqlite.exec("INSERT INTO subscriptions VALUES ('sub', 'newer'), ('other', 'other-head')");
    mocks.db = drizzle(sqlite);
  });
  afterEach(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("retains multiple failed URLs across database reconnection without changing the cursor", () => {
    queueVideoRetry("sub", "old-one");
    queueVideoRetry("sub", "old-two");
    queueVideoRetry("sub", "old-one");
    sqlite.exec(readFileSync("drizzle/0029_subscription_video_retries.sql", "utf8"));
    sqlite.close();
    sqlite = new Database(databasePath);
    mocks.db = drizzle(sqlite);
    expect(listVideoRetries("sub").map(row => row.videoUrl).sort()).toEqual(["old-one", "old-two"]);
    expect(sqlite.prepare("SELECT last_video_link FROM subscriptions WHERE id = 'sub'").get())
      .toEqual({ last_video_link: "newer" });
  });

  it("removes only the settled target belonging to that subscription", () => {
    queueVideoRetry("sub", "one");
    queueVideoRetry("sub", "two");
    queueVideoRetry("other", "one");
    removeVideoRetry("sub", "one");
    expect(listVideoRetries("sub").map(row => row.videoUrl)).toEqual(["two"]);
    expect(listVideoRetries("other").map(row => row.videoUrl)).toEqual(["one"]);
  });

  it("caps each batch and rotates repeated failures so later targets are not starved", () => {
    for (let i = 0; i < VIDEO_RETRIES_PER_CHECK + 2; i++) {
      queueVideoRetry("sub", `video-${i}`);
    }
    const firstBatch = listVideoRetries("sub");
    expect(firstBatch).toHaveLength(VIDEO_RETRIES_PER_CHECK);
    for (const retry of firstBatch) markVideoRetryAttempted("sub", retry.videoUrl);
    const nextBatch = listVideoRetries("sub");
    expect(nextBatch).toHaveLength(VIDEO_RETRIES_PER_CHECK);
    expect(nextBatch.slice(0, 2).every(retry =>
      !firstBatch.some(first => first.videoUrl === retry.videoUrl)
    )).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM subscription_video_retries").get())
      .toEqual({ count: VIDEO_RETRIES_PER_CHECK + 2 });
  });

  it("cascades deletion and ignores failures arriving after unsubscribe", () => {
    queueVideoRetry("sub", "one");
    sqlite.prepare("DELETE FROM subscriptions WHERE id = ?").run("sub");
    queueVideoRetry("sub", "two");
    expect(listVideoRetries("sub")).toEqual([]);
  });

  it("looks up the original backfill position by subscription and exact URL", () => {
    queueVideoRetry("sub", "same-url", 7);
    queueVideoRetry("sub", "same-url");
    queueVideoRetry("other", "same-url", 2);
    expect(getVideoRetry("sub", "same-url")?.mediaPlaylistIndex).toBe(7);
    expect(getVideoRetry("other", "same-url")?.mediaPlaylistIndex).toBe(2);
    expect(getVideoRetry("sub", "missing")).toBeUndefined();
  });
});
