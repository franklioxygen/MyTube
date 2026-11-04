import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { DATA_DIR } from "../../config/paths";
import { ensureDirSafeSync, pathExistsSafeSync, resolveSafeChildPath, unlinkSafeSync, writeFileSafeSync } from "../../utils/security";

export const DANMAKU_DIR = path.join(DATA_DIR, "danmaku");
export function danmakuDirectory(videoId: string): string {
  return resolveSafeChildPath(DANMAKU_DIR, createHash("sha256").update(videoId).digest("hex"));
}
export function danmakuPath(videoId: string, revision: string, extension: "xml" | "json"): string {
  if (!/^[a-f\d-]{36}$/.test(revision)) throw new Error("Invalid danmaku revision");
  return resolveSafeChildPath(danmakuDirectory(videoId), `${revision}.${extension}`);
}
export function writeDanmakuFile(videoId: string, revision: string, extension: "xml" | "json", data: string): void {
  ensureDirSafeSync(DANMAKU_DIR, DATA_DIR);
  ensureDirSafeSync(danmakuDirectory(videoId), DANMAKU_DIR);
  writeFileSafeSync(danmakuPath(videoId, revision, extension), DANMAKU_DIR, data, "utf8");
}
export function removeDanmakuRevision(videoId: string, revision: string): void {
  for (const extension of ["xml", "json"] as const) {
    const file = danmakuPath(videoId, revision, extension);
    if (pathExistsSafeSync(file, DANMAKU_DIR)) unlinkSafeSync(file, DANMAKU_DIR);
  }
}
/** Attachments use content identity, so media renames/author moves never change their paths. */
export function removeVideoDanmakuFiles(videoId: string): void {
  const directory = danmakuDirectory(videoId);
  if (!pathExistsSafeSync(directory, DANMAKU_DIR)) return;
  fs.removeSync(directory);
}
