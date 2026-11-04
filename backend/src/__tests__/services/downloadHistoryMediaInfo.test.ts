import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db, sqlite } from "../../db";
import { runMigrations } from "../../db/migrate";
import { initializeStorage } from "../../services/storageService/initialization";
import { addDownloadHistoryItem, getDownloadHistory, markDownloadHistoryDeletedByVideoId } from "../../services/storageService/downloadHistory";
import type { DownloadMediaInfo } from "../../services/storageService/types";

const oldMigrations = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-old-schema-"));
beforeAll(async () => {
  fs.mkdirSync(path.join(oldMigrations, "meta"));
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 29);
  for (const entry of journal.entries) fs.copyFileSync(`drizzle/${entry.tag}.sql`, path.join(oldMigrations, `${entry.tag}.sql`));
  fs.writeFileSync(path.join(oldMigrations, "meta/_journal.json"), JSON.stringify(journal));
  migrate(db, { migrationsFolder: oldMigrations });
  sqlite.prepare("INSERT INTO download_history (id,title,status,finished_at,author,total_size) VALUES ('legacy','Old result','success',1,'Old author','1048576')").run();
  await runMigrations({ skipLegacyDataMigration: true });
  initializeStorage();
});
afterAll(() => fs.rmSync(oldMigrations, { recursive: true, force: true }));

it("upgrades an existing history without fabricating technical metadata", () => {
  expect(getDownloadHistory().find(item => item.id === "legacy")).toMatchObject({ title: "Old result", author: "Old author", totalSize: "1048576", mediaInfo: undefined });
});
it("preserves separate final snapshots across replacement and deletion", () => {
  const info: DownloadMediaInfo = { version: 1, state: "measured", capturedAt: 10, sizeBytes: "100", width: 1920, height: 1080, videoCodec: "h264", sourceCollectionName: "Download source" };
  addDownloadHistoryItem({ id: "first", title: "Original", status: "success", finishedAt: 10, videoId: "same-video", mediaInfo: info });
  addDownloadHistoryItem({ id: "second", title: "Replacement", status: "success", finishedAt: 20, videoId: "same-video", mediaInfo: { ...info, sizeBytes: "200", width: 3840, height: 2160, videoCodec: "hevc" } });
  markDownloadHistoryDeletedByVideoId("same-video", 30);
  expect(getDownloadHistory().find(item => item.id === "first")).toMatchObject({ status: "deleted", mediaInfo: { sizeBytes: "100", videoCodec: "h264", sourceCollectionName: "Download source" } });
  expect(getDownloadHistory().find(item => item.id === "second")?.mediaInfo).toMatchObject({ sizeBytes: "200", videoCodec: "hevc" });
});
it("discards final media facts on failed or aggregate partial rows, retaining their known source", () => {
  for (const status of ["failed", "partial", "pending_retry"] as const) {
    addDownloadHistoryItem({ id: status, title: "No complete output", status, finishedAt: 40, mediaInfo: { version: 1, state: "measured", capturedAt: 1, sizeBytes: "100", videoCodec: "h264", sourceCollectionName: "Known playlist" } });
    const info = getDownloadHistory().find(item => item.id === status)?.mediaInfo;
    expect(info?.sourceCollectionName).toBe("Known playlist");
    expect(info?.sizeBytes).toBeUndefined();
    expect(info?.videoCodec).toBeUndefined();
  }
});
it("does not let a damaged snapshot hide the history list", () => {
  sqlite.prepare("UPDATE download_history SET media_info = '{broken' WHERE id='legacy'").run();
  expect(getDownloadHistory().find(item => item.id === "legacy")?.mediaInfo).toBeUndefined();
});
