import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { AvatarSourceBusyError } from "../utils/authorAvatarSources";
import { Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs-extra";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { videos } from "../db/schema";
import { AVATARS_DIR } from "../config/paths";
import { ValidationError } from "../errors/DownloadErrors";
import { getAuthorProfile, saveAuthorAvatar } from "../services/authorAvatarService";
import { resizeAvatar } from "../utils/avatarUtils";
import { execFileSafe, resolveSafeChildPath, unlinkSafeSync, pathExistsSafeSync, writeFileSafe, getClientIp } from "../utils/security";
import { validateUploadedImageContent } from "../utils/uploadedImage";
import { logger } from "../utils/logger";
import { successResponse } from "../utils/response";
import { queueBulkArtifactRefresh } from "../services/mediaServerExport/bulkArtifactRefresh";

export const avatarSourceLimiter = rateLimit({
  windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => ipKeyGenerator(getClientIp(req)), validate: { trustProxy: false },
});

const mimes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1 },
  fileFilter: (_req, file, cb) => mimes.has(file.mimetype) ? cb(null, true) : cb(new ValidationError("Only JPEG, PNG or WebP images are allowed", "avatar")),
});

function readAuthor(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new ValidationError("A valid author name is required", "author");
  // Preserve legacy exact names, including surrounding whitespace and long names.
  if (value.length > 200 && !db.select({ id: videos.id }).from(videos).where(eq(videos.author, value)).limit(1).get())
    throw new ValidationError("New author names must be at most 200 characters", "author");
  return value;
}
function refreshedProfile(author: string, res: Response): void {
  const ids = db.select({ id: videos.id }).from(videos).where(eq(videos.author, author)).all().map(row => row.id);
  queueBulkArtifactRefresh(ids);
  res.json(successResponse(getAuthorProfile(author)));
}
export async function readProfile(req: Request, res: Response): Promise<void> {
  res.set("Cache-Control", "private, no-store");
  res.json(successResponse(getAuthorProfile(readAuthor(req.query.author))));
}
export async function removeAvatar(req: Request, res: Response): Promise<void> {
  const author = readAuthor(req.body?.author);
  saveAuthorAvatar(author, null);
  refreshedProfile(author, res);
}
export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  const author = readAuthor(req.body?.author);
  if (!req.file?.buffer?.length) throw new ValidationError("No image provided", "avatar");
  const mime = await validateUploadedImageContent(req.file.buffer);
  if (!mimes.has(mime) || mime !== req.file.mimetype) throw new ValidationError("Invalid image content", "avatar");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mytube-avatar-"));
  const input = resolveSafeChildPath(tempDir, "input");
  const output = resolveSafeChildPath(tempDir, "output.jpg");
  let finalPath: string | undefined;
  let committed = false;
  try {
    await writeFileSafe(input, tempDir, req.file.buffer);
    // getVideoDimensions is restricted to VIDEOS_DIR; probe this private image explicitly.
    const { stdout } = await execFileSafe("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", input], { timeout: 5000 });
    const dimensions = JSON.parse(stdout).streams?.[0];
    if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) ||
      dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 1024 || dimensions.height > 1024)
      throw new ValidationError("Image dimensions must be between 1 and 1024 pixels", "avatar");
    if (!await resizeAvatar(input, output, 512)) throw new ValidationError("Image processing failed; please try another image", "avatar");
    const filename = `custom-${crypto.randomUUID()}.jpg`;
    await fs.ensureDir(AVATARS_DIR);
    finalPath = resolveSafeChildPath(AVATARS_DIR, filename);
    await fs.move(output, finalPath);
    saveAuthorAvatar(author, `/avatars/${filename}`);
    committed = true;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error("Author avatar processing failed", error);
    throw new ValidationError("Could not process or save the image; please try again", "avatar");
  } finally {
    if (!committed && finalPath && pathExistsSafeSync(finalPath, AVATARS_DIR)) unlinkSafeSync(finalPath, AVATARS_DIR);
    await fs.remove(tempDir).catch(error => logger.warn("Failed to clean up avatar temporary files", error));
  }
  refreshedProfile(author, res);
}

/** Return a preview only. The existing upload endpoint applies it after confirmation. */
export async function fetchSourceAvatar(req: Request, res: Response): Promise<void> {
  const author = readAuthor(req.body?.author);
  const sources = getAuthorProfile(author).avatarSources;
  const source = sources.find(item => item.channelUrl === req.body?.channelUrl);
  if (!source) throw new ValidationError("Choose a channel associated with this author", "channelUrl");
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.on("close", abort);
  try {
    const { fetchAuthorSourceAvatar } = await import("../services/authorAvatarFetchService");
    const result = await fetchAuthorSourceAvatar(source, controller.signal);
    if (controller.signal.aborted) return;
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.type(result.mime).send(result.buffer);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof AvatarSourceBusyError) {
      res.set("Retry-After", "2");
      res.status(503).json({ error: error.message, code: "AUTHOR_AVATAR_SOURCE_BUSY" });
      return;
    }
    logger.warn("Could not fetch author avatar from source", error);
    res.status(502).json({ error: "Could not fetch the channel avatar. Your saved avatar has not changed.", code: "AUTHOR_AVATAR_SOURCE_UNAVAILABLE" });
  } finally { res.removeListener("close", abort); }
}
