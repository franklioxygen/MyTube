import { getDatabaseGeneration } from "../../db";
import { logger } from "../../utils/logger";
import { getSettings } from "../storageService/settings";
import { getVideosListETag } from "../storageService/videoListRevision";
import { getVideosStrict } from "../storageService/videos";
import type { Video } from "../storageService/types";
import { syncMediaServerArtifactsForRecord } from "./syncService";

const pending = new Set<string>();
const MAX_PENDING = 5_000;
const CHUNK_SIZE = 10;
let scheduled = false;
let generation = -1;
let snapshotRevision = "";
let snapshot: Video[] = [];
let snapshotById = new Map<string, Video>();

function clearSnapshot(): void {
  snapshotRevision = "";
  snapshot = [];
  snapshotById.clear();
}

function drain(): void {
  scheduled = false;
  try {
    if (generation !== getDatabaseGeneration() || getSettings().mediaServerExportMode === "off" ||
        !getSettings().mediaServerExportMode) {
      pending.clear();
      return;
    }
    const revision = getVideosListETag("all");
    if (snapshotRevision !== revision) {
      snapshot = getVideosStrict();
      snapshotById = new Map(snapshot.map((video) => [video.id, video]));
      snapshotRevision = revision;
    }
    for (const id of [...pending].slice(0, CHUNK_SIZE)) {
      pending.delete(id);
      const video = snapshotById.get(id);
      if (video) {
        try {
          syncMediaServerArtifactsForRecord(video, { libraryVideos: snapshot });
        } catch (error) {
          // One failed export must not discard unrelated queued videos.
          logger.error("Bulk media artifact refresh failed for video", error, { videoId: id });
        }
      }
    }
  } catch (error) {
    // Derived files can be repaired by the existing export rebuild operation.
    logger.error("Bulk media artifact refresh failed", error);
    pending.clear();
  } finally {
    if (pending.size) schedule();
    else clearSnapshot();
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setImmediate(drain);
}

/** Best-effort post-commit work; never changes a successful database result. */
export function queueBulkArtifactRefresh(ids: readonly string[]): void {
  if (!ids.length) return;
  try {
    const mode = getSettings().mediaServerExportMode;
    if (mode !== "nfo" && mode !== "nfo_and_source_json") return;
    const currentGeneration = getDatabaseGeneration();
    if (generation !== currentGeneration) {
      pending.clear();
      clearSnapshot();
      generation = currentGeneration;
    }
    let dropped = 0;
    for (const id of ids) {
      if (pending.has(id) || pending.size < MAX_PENDING) pending.add(id);
      else dropped++;
    }
    if (dropped) logger.warn(`Bulk media refresh capacity reached; rebuild exports to repair ${dropped} skipped items`);
    if (pending.size) schedule();
  } catch (error) {
    logger.error("Could not schedule bulk media artifact refresh", error);
  }
}
