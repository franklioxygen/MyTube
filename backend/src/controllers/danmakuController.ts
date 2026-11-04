import type { Request, Response } from "express";
import multer from "multer";
import { getVideoById } from "../services/storageService/videos";
import { getVisibilityScopedRole } from "./video/visibility";
import { deleteDanmaku, getDanmaku, getDanmakuEvents, importDanmaku, refreshDanmaku } from "../services/danmaku/service";
import { MAX_DANMAKU_BYTES } from "../services/danmaku/parser";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DANMAKU_BYTES, files: 1, fields: 0 } }).single("danmaku");
export function uploadDanmaku(req: Request, res: Response, next: import("express").NextFunction): void {
  upload(req, res, error => {
    if (error) { res.status(400).json({ error: "danmakuInvalidFile" }); return; }
    next();
  });
}

function visibleVideo(req: Request, res: Response) {
  res.set("Cache-Control", "private, no-store");
  const video = getVideoById(String(req.params.id), getVisibilityScopedRole(req));
  if (!video) res.status(404).json({ error: "danmakuVideoNotFound" });
  return video;
}
function failure(res: Response, error: unknown): void {
  const code = error instanceof Error && /^danmaku[A-Z]\w+$/.test(error.message) ? error.message : "danmakuFetchFailed";
  res.status(code === "danmakuBusy" ? 409 : 400).json({ error: code });
}
export async function read(req: Request, res: Response): Promise<void> {
  const video = visibleVideo(req, res);
  if (video) res.json(getDanmaku(video.id));
}
export async function events(req: Request, res: Response): Promise<void> {
  const video = visibleVideo(req, res);
  if (video) res.json({ events: getDanmakuEvents(video.id) });
}
export async function importXml(req: Request, res: Response): Promise<void> {
  const video = visibleVideo(req, res);
  if (!video) return;
  try {
    if (!req.file || !/\.xml$/i.test(req.file.originalname)) throw new Error("danmakuInvalidFile");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(req.file.buffer);
    res.json(importDanmaku(video.id, xml));
  } catch (error) { failure(res, error); }
}
export async function refresh(req: Request, res: Response): Promise<void> {
  const video = visibleVideo(req, res);
  if (!video) return;
  try { await refreshDanmaku(video); res.json(getDanmaku(video.id)); }
  catch (error) { failure(res, error); }
}
export async function remove(req: Request, res: Response): Promise<void> {
  const video = visibleVideo(req, res);
  if (!video) return;
  deleteDanmaku(video.id);
  res.json(getDanmaku(video.id));
}
