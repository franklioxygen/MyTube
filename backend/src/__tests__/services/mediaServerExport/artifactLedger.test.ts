import { beforeEach, describe, expect, it, vi } from "vitest";

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

  return { sqlite, db: drizzle(sqlite) };
});

vi.mock("../../../db", () => ({ db: testDb.db }));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  deleteArtifactRecord,
  deleteArtifactRecordsForAssignment,
  deleteArtifactRecordsForShow,
  getArtifact,
  isArtifactSourceUnchanged,
  listArtifacts,
  listArtifactsForShow,
  listArtifactsUnderPrefix,
  MediaServerArtifactLedgerError,
  normalizeLedgerRelativePath,
  recordArtifact,
} from "../../../services/mediaServerExport/artifactLedger";

function seedShow(id: string): void {
  testDb.sqlite
    .prepare(
      `INSERT INTO media_server_shows
         (id, identity_key, source_platform, title, description, directory_name,
          next_season_number, created_at, updated_at)
       VALUES (?, ?, 'youtube', ?, '', ?, 1, 1, 1)`
    )
    .run(id, `youtube:channel-id:${id}`, id, id);
}

function seedAssignment(id: string, showId: string, videoId: string): void {
  testDb.sqlite
    .prepare("INSERT INTO videos (id, title, created_at) VALUES (?, ?, '')")
    .run(videoId, videoId);
  testDb.sqlite
    .prepare(
      `INSERT INTO media_server_episode_assignments
         (id, show_id, video_id, season_number, episode_number, export_stem, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, 'S00E001', 1, 1)`
    )
    .run(id, showId, videoId);
}

describe("mediaServerExport artifactLedger", () => {
  beforeEach(() => {
    testDb.sqlite.exec(`
      DELETE FROM media_server_export_artifacts;
      DELETE FROM media_server_episode_assignments;
      DELETE FROM videos;
      DELETE FROM media_server_shows;
    `);
  });

  describe("path normalization", () => {
    it("normalizes to relative POSIX form", () => {
      expect(normalizeLedgerRelativePath("Show\\Season 01\\a.nfo")).toBe(
        "Show/Season 01/a.nfo"
      );
      expect(normalizeLedgerRelativePath("/Show/tvshow.nfo")).toBe(
        "Show/tvshow.nfo"
      );
    });

    it("rejects traversal, empty segments, and empty input", () => {
      for (const bad of ["", "..", "Show/../etc/passwd", "Show//a.nfo", "Show/./a"]) {
        expect(() => normalizeLedgerRelativePath(bad)).toThrowError(
          MediaServerArtifactLedgerError
        );
      }
    });
  });

  describe("records", () => {
    it("records and reads back an episode media artifact", () => {
      seedShow("show-1");
      seedAssignment("assign-1", "show-1", "v1");

      const artifact = recordArtifact({
        relativePath: "Kurzgesagt/Season 01/S01E001 - Ants.mp4",
        artifactType: "episode_media",
        materialization: "hard_link",
        showId: "show-1",
        assignmentId: "assign-1",
        sourceAbsolutePath: "/uploads/videos/a.mp4",
        sourceSize: 1234,
        sourceMtimeMs: 99,
      });

      expect(artifact.materialization).toBe("hard_link");
      expect(getArtifact("Kurzgesagt/Season 01/S01E001 - Ants.mp4")).toMatchObject(
        {
          artifactType: "episode_media",
          showId: "show-1",
          assignmentId: "assign-1",
          sourceSize: 1234,
        }
      );
    });

    it("upserts the same path instead of duplicating it", () => {
      recordArtifact({
        relativePath: "Show/Season 01/a.mp4",
        artifactType: "episode_media",
        materialization: "hard_link",
        sourceSize: 1,
      });
      recordArtifact({
        relativePath: "Show/Season 01/a.mp4",
        artifactType: "episode_media",
        materialization: "copied_media",
        sourceSize: 2,
      });

      expect(listArtifacts()).toHaveLength(1);
      expect(getArtifact("Show/Season 01/a.mp4")).toMatchObject({
        materialization: "copied_media",
        sourceSize: 2,
      });
    });

    it("rejects unknown artifact types and materializations", () => {
      expect(() =>
        recordArtifact({
          relativePath: "Show/a.nfo",
          artifactType: "made_up" as never,
          materialization: "generated_text",
        })
      ).toThrowError(MediaServerArtifactLedgerError);

      expect(() =>
        recordArtifact({
          relativePath: "Show/a.nfo",
          artifactType: "episode_nfo",
          materialization: "symlink" as never,
        })
      ).toThrowError(MediaServerArtifactLedgerError);
    });

    it("never accepts a traversal path", () => {
      expect(() =>
        recordArtifact({
          relativePath: "Show/../../escape.mp4",
          artifactType: "episode_media",
          materialization: "hard_link",
        })
      ).toThrowError(MediaServerArtifactLedgerError);
      expect(listArtifacts()).toHaveLength(0);
    });
  });

  describe("scoped queries and deletion", () => {
    beforeEach(() => {
      seedShow("show-a");
      seedShow("show-b");
      seedAssignment("assign-1", "show-a", "v1");

      recordArtifact({
        relativePath: "ShowA/tvshow.nfo",
        artifactType: "show_nfo",
        materialization: "generated_text",
        showId: "show-a",
      });
      recordArtifact({
        relativePath: "ShowA/Season 01/S01E001 - One.mp4",
        artifactType: "episode_media",
        materialization: "hard_link",
        showId: "show-a",
        assignmentId: "assign-1",
      });
      recordArtifact({
        relativePath: "ShowA/Season 01/S01E001 - One.nfo",
        artifactType: "episode_nfo",
        materialization: "generated_text",
        showId: "show-a",
        assignmentId: "assign-1",
      });
      recordArtifact({
        relativePath: "ShowB/tvshow.nfo",
        artifactType: "show_nfo",
        materialization: "generated_text",
        showId: "show-b",
      });
    });

    it("scopes by show and by directory prefix", () => {
      expect(listArtifactsForShow("show-a")).toHaveLength(3);
      expect(
        listArtifactsUnderPrefix("ShowA").map((a) => a.relativePath).sort()
      ).toEqual([
        "ShowA/Season 01/S01E001 - One.mp4",
        "ShowA/Season 01/S01E001 - One.nfo",
        "ShowA/tvshow.nfo",
      ]);
      // A prefix must not leak into a sibling directory with a shared name start.
      expect(listArtifactsUnderPrefix("Show")).toHaveLength(0);
    });

    it("deletes by path, by assignment, and by show", () => {
      expect(deleteArtifactRecord("ShowB/tvshow.nfo")).toBe(true);
      expect(deleteArtifactRecord("ShowB/tvshow.nfo")).toBe(false);

      expect(deleteArtifactRecordsForAssignment("assign-1")).toBe(2);
      expect(listArtifactsForShow("show-a")).toHaveLength(1);

      expect(deleteArtifactRecordsForShow("show-a")).toBe(1);
      expect(listArtifacts()).toHaveLength(0);
    });
  });

  describe("source fingerprints", () => {
    it("matches only when path, size, and mtime all agree", () => {
      const artifact = recordArtifact({
        relativePath: "Show/Season 01/a.mp4",
        artifactType: "episode_media",
        materialization: "hard_link",
        sourceAbsolutePath: "/uploads/videos/a.mp4",
        sourceSize: 10,
        sourceMtimeMs: 100,
      });

      expect(
        isArtifactSourceUnchanged(artifact, "/uploads/videos/a.mp4", 10, 100)
      ).toBe(true);
      expect(
        isArtifactSourceUnchanged(artifact, "/uploads/videos/a.mp4", 11, 100)
      ).toBe(false);
      expect(
        isArtifactSourceUnchanged(artifact, "/uploads/videos/a.mp4", 10, 101)
      ).toBe(false);
      expect(
        isArtifactSourceUnchanged(artifact, "/uploads/videos/b.mp4", 10, 100)
      ).toBe(false);
      expect(isArtifactSourceUnchanged(undefined, "/a", 1, 1)).toBe(false);
    });
  });
});
