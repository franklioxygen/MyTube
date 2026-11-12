import { and, eq, inArray, desc, sql, or, isNull } from "drizzle-orm";
import path from "path";
import { db } from "../db";
import { authorProfiles, videos } from "../db/schema";
import { AVATARS_DIR } from "../config/paths";
import { pathExistsSafeSync, resolveSafeChildPath, unlinkSafeSync } from "../utils/security";
import { logger } from "../utils/logger";
import { bumpVideosListRevision } from "./storageService/videoListRevision";

export type AvatarOrigin = "custom" | "auto" | "none";
export interface AuthorProfile {
  author: string;
  customAvatarPath: string | null;
  effectiveAvatarPath: string | null;
  defaultAvatarPath: string | null;
  avatarOrigin: AvatarOrigin;
  videoCount: number;
  multipleSources: boolean;
}

export const isCustomAvatarPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/avatars/custom-");

export function getCustomAvatarPaths(authors: string[]): Map<string, string> {
  const unique = [...new Set(authors.filter(Boolean))];
  const result = new Map<string, string>();
  // Stay below SQLite's variable limit for large libraries.
  for (let i = 0; i < unique.length; i += 500) {
    const rows = db.select().from(authorProfiles)
      .where(inArray(authorProfiles.author, unique.slice(i, i + 500))).all();
    for (const row of rows) {
      try {
        if (isCustomAvatarPath(row.customAvatarPath) && pathExistsSafeSync(
          resolveSafeChildPath(AVATARS_DIR, row.customAvatarPath.slice("/avatars/".length)), AVATARS_DIR,
        )) result.set(row.author, row.customAvatarPath);
        else logger.warn("Author custom avatar is missing", { author: row.author });
      } catch { logger.warn("Invalid author avatar path", { author: row.author }); }
    }
  }
  return result;
}

/** Raw defaults for favorites created while a custom avatar was active. */
export function getDefaultAvatarPaths(authors: string[], role?: "admin" | "visitor"): Map<string, string> {
  const result = new Map<string, string>();
  const unique = [...new Set(authors)];
  for (let i = 0; i < unique.length; i += 500) {
    const rows = db.select({ author: videos.author, avatar: videos.authorAvatarPath }).from(videos)
      .where(and(inArray(videos.author, unique.slice(i, i + 500)),
        role === "visitor" ? or(eq(videos.visibility, 1), isNull(videos.visibility)) : undefined))
      .orderBy(desc(videos.createdAt), desc(videos.id)).all();
    for (const row of rows) if (row.author && row.avatar && !result.has(row.author)) result.set(row.author, row.avatar);
  }
  return result;
}

type AvatarVideo = { author?: string | null; authorAvatarPath?: string | null; authorAvatarFilename?: string | null };
export function projectAuthorAvatars<T extends AvatarVideo>(rows: T[]): Array<T & { authorAvatarOrigin: AvatarOrigin }> {
  const overrides = getCustomAvatarPaths(rows.map(row => row.author || ""));
  return rows.map(row => {
    const custom = overrides.get(row.author || "");
    return custom ? { ...row, authorAvatarPath: custom, authorAvatarFilename: path.basename(custom), authorAvatarOrigin: "custom" }
      : { ...row, authorAvatarOrigin: row.authorAvatarPath ? "auto" : "none" };
  });
}
export function projectAuthorAvatar<T extends AvatarVideo>(row: T): T & { authorAvatarOrigin: AvatarOrigin } {
  return projectAuthorAvatars([row])[0];
}

export function getAuthorProfile(author: string): AuthorProfile {
  const rows = db.select({ id: videos.id, avatar: videos.authorAvatarPath, source: videos.source, channel: videos.channelUrl })
    .from(videos).where(eq(videos.author, author)).orderBy(desc(videos.createdAt), desc(videos.id)).all();
  const defaultAvatarPath = rows.find(row => row.avatar)?.avatar ?? null;
  const customAvatarPath = getCustomAvatarPaths([author]).get(author) ?? null;
  return { author, customAvatarPath, defaultAvatarPath,
    effectiveAvatarPath: customAvatarPath || defaultAvatarPath,
    avatarOrigin: customAvatarPath ? "custom" : defaultAvatarPath ? "auto" : "none",
    videoCount: rows.length,
    multipleSources: new Set(rows.map(row => `${row.source || ""}:${row.channel || ""}`)).size > 1,
  };
}

function removeCustomAvatar(webPath: string | undefined): void {
  if (!isCustomAvatarPath(webPath)) return;
  try {
    // Never remove an asset that a concurrent operation still owns.
    if (db.select({ count: sql<number>`count(*)` }).from(authorProfiles)
      .where(eq(authorProfiles.customAvatarPath, webPath)).get()?.count) return;
    const absolute = resolveSafeChildPath(AVATARS_DIR, webPath.slice("/avatars/".length));
    if (pathExistsSafeSync(absolute, AVATARS_DIR)) unlinkSafeSync(absolute, AVATARS_DIR);
  } catch (error) { logger.warn("Failed to remove old custom avatar", error); }
}

/** No awaits between reading the replaced path, committing, and unlinking it. */
export function saveAuthorAvatar(author: string, customAvatarPath: string | null): void {
  const oldPath = db.transaction(tx => {
    const previous = tx.select().from(authorProfiles).where(eq(authorProfiles.author, author)).get();
    if (customAvatarPath) {
      tx.insert(authorProfiles).values({ author, customAvatarPath, updatedAt: Date.now() })
        .onConflictDoUpdate({ target: authorProfiles.author, set: { customAvatarPath, updatedAt: Date.now() } }).run();
    } else tx.delete(authorProfiles).where(eq(authorProfiles.author, author)).run();
    return previous?.customAvatarPath;
  });
  bumpVideosListRevision();
  if (oldPath !== customAvatarPath) removeCustomAvatar(oldPath);
}
