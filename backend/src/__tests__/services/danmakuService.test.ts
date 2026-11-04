import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { db, sqlite } from "../../db";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { initializeStorage } from "../../services/storageService/initialization";
import { danmakuTracks, videos } from "../../db/schema";
import { deleteDanmaku, downloadAutomaticDanmaku, getDanmaku, getDanmakuEvents, importDanmaku, refreshDanmaku } from "../../services/danmaku/service";
import { DANMAKU_DIR, danmakuDirectory, danmakuPath, removeDanmakuRevision, removeVideoDanmakuFiles } from "../../services/danmaku/files";
import { deleteVideo } from "../../services/storageService/videoDeletion";
import { fetchBilibiliDanmaku } from "../../services/danmaku/bilibili";
import type { Video } from "../../services/storageService/types";

vi.mock("../../services/danmaku/bilibili", () => ({ fetchBilibiliDanmaku: vi.fn() }));
const xml = '<i><chatid>123</chatid><d p="1,1,25,16777215">Saved</d></i>';
let serial = 0;
const video = (): Video => ({ id: `danmaku-${++serial}`, title: "Test", createdAt: "now", sourceUrl: "https://www.bilibili.com/video/BV1test?p=2", partNumber: 2 });
beforeAll(() => { migrate(db, { migrationsFolder: "drizzle" }); initializeStorage(); });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchBilibiliDanmaku).mockResolvedValue({ xml, cid: "123" }); });
function create() {
  const item = video();
  db.insert(videos).values({ id: item.id, title: item.title, createdAt: item.createdAt, sourceUrl: item.sourceUrl }).run();
  return item;
}

describe("danmaku publication and lifecycle", () => {
  it("fetches automatically only when opted in, excluding audio and preserving manual imports", async () => {
    const off = create();
    await downloadAutomaticDanmaku(off, false);
    await downloadAutomaticDanmaku({ ...off, mediaType: "audio" }, true);
    expect(fetchBilibiliDanmaku).not.toHaveBeenCalled();
    const manual = create(); importDanmaku(manual.id, xml);
    await downloadAutomaticDanmaku(manual, true);
    expect(fetchBilibiliDanmaku).not.toHaveBeenCalled();
    const on = create(); await downloadAutomaticDanmaku(on, true, { cid: "123" });
    expect(getDanmaku(on.id)).toMatchObject({ status: "ready", cid: "123", source: "bilibili" });
  });
  it("does not reject a successfully published video when automatic retrieval fails", async () => {
    const item = create(); vi.mocked(fetchBilibiliDanmaku).mockRejectedValueOnce(new Error("HTTP 429"));
    await expect(downloadAutomaticDanmaku(item, true)).resolves.toBeUndefined();
    expect(getDanmaku(item.id).status).toBe("error");
  });
  it("publishes raw XML and normalized events, replacing the old revision only after validation", () => {
    const item = create();
    const first = importDanmaku(item.id, xml);
    expect(getDanmakuEvents(item.id)[0].text).toBe("Saved");
    expect(fs.existsSync(danmakuPath(item.id, first.revision!, "xml"))).toBe(true);
    expect(() => importDanmaku(item.id, "<html>bad</html>")).toThrow();
    expect(getDanmaku(item.id).revision).toBe(first.revision);
    const next = importDanmaku(item.id, xml.replace("Saved", "Replacement"));
    expect(next.revision).not.toBe(first.revision);
    expect(fs.existsSync(danmakuPath(item.id, first.revision!, "xml"))).toBe(false);
  });
  it("retains a usable previous track after an HTTP failure and distinguishes empty results", async () => {
    const item = create(); importDanmaku(item.id, xml);
    vi.mocked(fetchBilibiliDanmaku).mockRejectedValueOnce(new Error("HTTP 412"));
    await expect(refreshDanmaku(item)).rejects.toThrow();
    expect(getDanmaku(item.id)).toMatchObject({ status: "ready", lastError: "danmakuFetchFailed" });
    expect(getDanmakuEvents(item.id)).toHaveLength(1);
    const empty = create();
    vi.mocked(fetchBilibiliDanmaku).mockResolvedValueOnce({ xml: "<i><chatid>123</chatid></i>", cid: "123" });
    await refreshDanmaku(empty);
    expect(getDanmaku(empty.id)).toMatchObject({ status: "empty", eventCount: 0 });
  });
  it("rejects an XML response for a different CID without publishing it", async () => {
    const item = create();
    vi.mocked(fetchBilibiliDanmaku).mockResolvedValueOnce({ xml, cid: "999" });
    await expect(refreshDanmaku(item)).rejects.toThrow();
    expect(getDanmaku(item.id)).toMatchObject({ status: "error", revision: undefined });
  });
  it("serializes writers and does not publish a cancelled refresh", async () => {
    const item = create(); let finish!: (value: { xml: string; cid: string }) => void;
    vi.mocked(fetchBilibiliDanmaku).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let cancel!: () => void;
    const operation = refreshDanmaku(item, { onCancel: callback => { cancel = callback; } });
    expect(getDanmaku(item.id).loading).toBe(true);
    expect(() => importDanmaku(item.id, xml)).toThrow("danmakuBusy");
    cancel(); finish({ xml, cid: "123" });
    await expect(operation).rejects.toThrow("danmakuCancelled");
    expect(getDanmaku(item.id).revision).toBeUndefined();
  });
  it("deletes managed attachments with the video and keeps them independent of media path changes", () => {
    const item = create(); importDanmaku(item.id, xml);
    sqlite.prepare('UPDATE videos SET video_path = ? WHERE id = ?').run('/videos/moved/file.mp4', item.id);
    expect(getDanmakuEvents(item.id)).toHaveLength(1);
    expect(deleteVideo(item.id)).toBe(true);
    expect(fs.existsSync(danmakuDirectory(item.id))).toBe(false);
    expect(db.select().from(danmakuTracks).all().find(track => track.videoId === item.id)).toBeUndefined();
  });
  it("removes a track explicitly without removing its video", () => {
    const item = create(); importDanmaku(item.id, xml); deleteDanmaku(item.id);
    expect(getDanmaku(item.id).status).toBe("none");
    expect(sqlite.prepare('SELECT id FROM videos WHERE id = ?').get(item.id)).toBeTruthy();
  });
  it("treats missing attachments as nothing to clean up, even before any track was stored", () => {
    fs.rmSync(DANMAKU_DIR, { recursive: true, force: true });
    expect(() => removeVideoDanmakuFiles("never-had-danmaku")).not.toThrow();
    expect(() => removeDanmakuRevision("never-had-danmaku", "00000000-0000-4000-8000-000000000000")).not.toThrow();
    expect(fs.existsSync(DANMAKU_DIR)).toBe(false);
  });
  it("removes only the requested revision's files", () => {
    const item = create(); const { revision } = importDanmaku(item.id, xml);
    removeDanmakuRevision(item.id, revision!);
    expect(fs.existsSync(danmakuPath(item.id, revision!, "xml"))).toBe(false);
    expect(fs.existsSync(danmakuPath(item.id, revision!, "json"))).toBe(false);
    expect(fs.existsSync(danmakuDirectory(item.id))).toBe(true);
  });
});
