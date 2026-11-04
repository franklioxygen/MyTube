import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { danmakuTracks } from "../../db/schema";
import { getVideoById } from "../storageService/videos";
import type { Video } from "../storageService/types";
import { logger } from "../../utils/logger";
import { readFileSafeSync } from "../../utils/security";
import { fetchBilibiliDanmaku } from "./bilibili";
import { DANMAKU_DIR, danmakuPath, removeDanmakuRevision, writeDanmakuFile } from "./files";
import { parseDanmakuXml, type ParsedDanmaku } from "./parser";

const pending = new Map<string, AbortController>();
const cooldown = new Map<string, number>();
const rowFor = (videoId: string) => db.select().from(danmakuTracks).where(eq(danmakuTracks.videoId, videoId)).get();

export function getDanmaku(videoId: string) {
  const row = rowFor(videoId);
  return {
    status: row?.revision ? row.eventCount > 0 ? "ready" : "empty" : row?.lastError ? "error" : "none",
    loading: pending.has(videoId), source: row?.source, cid: row?.cid ?? undefined,
    revision: row?.revision ?? undefined, eventCount: row?.eventCount ?? 0, ignoredCount: row?.ignoredCount ?? 0,
    updatedAt: row?.updatedAt, lastError: row?.lastError ?? undefined,
  };
}

export function getDanmakuEvents(videoId: string): ParsedDanmaku["events"] {
  const row = rowFor(videoId);
  if (!row?.revision) return [];
  return JSON.parse(readFileSafeSync(danmakuPath(videoId, row.revision, "json"), DANMAKU_DIR, "utf8"));
}

function publish(videoId: string, xml: string, source: "bilibili" | "upload", expectedCid?: string) {
  const parsed = parseDanmakuXml(xml, expectedCid);
  const previous = rowFor(videoId);
  const revision = randomUUID();
  try {
    if (!getVideoById(videoId)) throw new Error("danmakuVideoNotFound");
    writeDanmakuFile(videoId, revision, "xml", xml);
    writeDanmakuFile(videoId, revision, "json", JSON.stringify(parsed.events));
    const values = { videoId, source, cid: parsed.cid ?? null, revision, eventCount: parsed.events.length,
      ignoredCount: parsed.ignoredCount, updatedAt: Date.now(), lastError: null };
    // No await between the existence check and publication: deletes cannot interleave here.
    db.insert(danmakuTracks).values(values).onConflictDoUpdate({ target: danmakuTracks.videoId, set: values }).run();
  } catch (error) {
    removeDanmakuRevision(videoId, revision);
    throw error;
  }
  if (previous?.revision) {
    try { removeDanmakuRevision(videoId, previous.revision); } catch { logger.warn("Could not clean old danmaku revision", { videoId }); }
  }
  return getDanmaku(videoId);
}

export function importDanmaku(videoId: string, xml: string) {
  if (pending.has(videoId)) throw new Error("danmakuBusy");
  return publish(videoId, xml, "upload");
}

/** Refresh only this attachment. A failed refresh retains any previously published track. */
export async function refreshDanmaku(video: Video, options: { cid?: string; subscriptionConfig?: string | null; onCancel?: (cancel: () => void) => void } = {}) {
  if (pending.has(video.id)) throw new Error("danmakuBusy");
  if (Date.now() - (cooldown.get(video.id) ?? 0) < 10_000) throw new Error("danmakuBusy");
  cooldown.set(video.id, Date.now());
  const controller = new AbortController();
  pending.set(video.id, controller);
  try {
    options.onCancel?.(() => controller.abort());
    const { xml, cid } = await fetchBilibiliDanmaku(video, controller.signal, options);
    if (controller.signal.aborted) throw new Error("danmakuCancelled");
    return publish(video.id, xml, "bilibili", cid);
  } catch (error) {
    if (!controller.signal.aborted && getVideoById(video.id)) {
      const code = error instanceof Error && /^danmaku[A-Z]\w+$/.test(error.message) ? error.message : "danmakuFetchFailed";
      const values = { videoId: video.id, source: "bilibili", updatedAt: Date.now(), lastError: code };
      db.insert(danmakuTracks).values(values).onConflictDoUpdate({ target: danmakuTracks.videoId, set: { lastError: code } }).run();
      logger.warn("Danmaku refresh failed", { videoId: video.id, code });
    }
    throw error;
  } finally {
    pending.delete(video.id);
    // Bound the in-memory throttle even when visiting many different old videos.
    for (const [id, timestamp] of cooldown) if (Date.now() - timestamp > 60_000) cooldown.delete(id);
  }
}

export function deleteDanmaku(videoId: string): void {
  pending.get(videoId)?.abort();
  const row = rowFor(videoId);
  db.delete(danmakuTracks).where(eq(danmakuTracks.videoId, videoId)).run();
  if (row?.revision) removeDanmakuRevision(videoId, row.revision);
}

export function cancelDanmakuRefresh(videoId: string): void {
  pending.get(videoId)?.abort();
}

/** Automatic downloads respect the opt-in and never replace a manually imported track. */
export async function downloadAutomaticDanmaku(video: Video, enabled: boolean, options: Parameters<typeof refreshDanmaku>[1] = {}): Promise<void> {
  if (!enabled || video.mediaType === "audio") return;
  try {
    const existing = rowFor(video.id);
    if (existing?.source === "upload" && existing.revision) return;
    await refreshDanmaku(video, options);
  }
  catch { /* The media is already published; attachment errors remain independently retryable. */ }
}
