import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sqlite: undefined as any }));

vi.mock("../../../db", () => ({
  get sqlite() {
    return mocks.sqlite;
  },
  db: {},
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("download history data backfills", () => {
  let sqlite: Database.Database;
  let backfillDownloadHistoryMediaTypes: typeof import("../migrations/dataBackfill").backfillDownloadHistoryMediaTypes;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE videos (
        id TEXT PRIMARY KEY,
        media_type TEXT
      );
      CREATE TABLE download_history (
        id TEXT PRIMARY KEY,
        video_id TEXT,
        media_type TEXT,
        status TEXT NOT NULL
      );
    `);
    mocks.sqlite = sqlite;
    ({ backfillDownloadHistoryMediaTypes } = await import(
      "../migrations/dataBackfill"
    ));
  });

  afterAll(() => {
    sqlite.close();
  });

  it("copies audio/video type from the referenced video and leaves unknown rows untyped", () => {
    sqlite
      .prepare("INSERT INTO videos (id, media_type) VALUES (?, ?), (?, ?)")
      .run("audio-video", "audio", "video-video", "video");
    sqlite
      .prepare(
        "INSERT INTO download_history (id, video_id, media_type, status) VALUES (?, ?, NULL, ?), (?, ?, NULL, ?), (?, NULL, NULL, ?)"
      )
      .run(
        "audio-history",
        "audio-video",
        "deleted",
        "video-history",
        "video-video",
        "deleted",
        "unknown-history",
        "deleted",
      );

    backfillDownloadHistoryMediaTypes();

    expect(
      sqlite
        .prepare(
          "SELECT id, media_type AS mediaType FROM download_history ORDER BY id"
        )
        .all()
    ).toEqual([
      { id: "audio-history", mediaType: "audio" },
      { id: "unknown-history", mediaType: null },
      { id: "video-history", mediaType: "video" },
    ]);
  });
});
