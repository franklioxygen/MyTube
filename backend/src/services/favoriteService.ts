import { Request } from "express";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../db";
import {
  collectionVideos,
  collections,
  favoriteAuthors,
  favoriteCollections,
  videos,
} from "../db/schema";
import { isLoginRequired } from "./passwordService";

export const OWNER_FAVORITES_USER_ID = "__admin__";

export type FavoriteVisibilityRole = "admin" | "visitor";

export interface FavoriteCollectionItem {
  collectionId: string;
  name: string;
  title?: string;
  sourcePlatform?: string;
  videoCount: number;
  thumbnailVideoId?: string;
  favoritedAt: number;
}

export interface FavoriteAuthorItem {
  author: string;
  displayName: string;
  avatarPath?: string;
  channelUrl?: string;
  videoCount: number;
  favoritedAt: number;
}

export interface FavoriteAuthorInput {
  author: string;
  displayName?: string;
  avatarPath?: string;
  channelUrl?: string;
}

/**
 * Resolve the stable owner key used by favorites. Legacy admins and
 * login-disabled single-user deployments intentionally share the sentinel;
 * visitor accounts use their durable users.id instead of an ephemeral JWT id.
 */
export const resolveFavoriteUserId = (req: Request): string | null => {
  if (!isLoginRequired()) {
    return OWNER_FAVORITES_USER_ID;
  }

  if (typeof req.user?.userId === "string" && req.user.userId.length > 0) {
    return req.user.userId;
  }

  if (req.user?.role === "admin") {
    return OWNER_FAVORITES_USER_ID;
  }

  return null;
};

const visibleVideoPredicate = (
  conditions: SQL<unknown>[],
  role?: FavoriteVisibilityRole,
): SQL<unknown> | undefined => {
  if (role !== "visitor") {
    return and(...conditions);
  }

  return and(
    ...conditions,
    or(eq(videos.visibility, 1), isNull(videos.visibility)),
  );
};

const countVisibleVideosInCollection = (
  collectionId: string,
  role?: FavoriteVisibilityRole,
): number => {
  const where = visibleVideoPredicate(
    [eq(collectionVideos.collectionId, collectionId)],
    role,
  );
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(collectionVideos)
    .innerJoin(videos, eq(videos.id, collectionVideos.videoId))
    .where(where)
    .get();

  return row?.count ?? 0;
};

const firstVisibleVideoIdInCollection = (
  collectionId: string,
  role?: FavoriteVisibilityRole,
): string | undefined => {
  const where = visibleVideoPredicate(
    [eq(collectionVideos.collectionId, collectionId)],
    role,
  );
  const row = db
    .select({ videoId: collectionVideos.videoId })
    .from(collectionVideos)
    .innerJoin(videos, eq(videos.id, collectionVideos.videoId))
    .where(where)
    .orderBy(asc(collectionVideos.order), asc(videos.createdAt))
    .get();

  return row?.videoId ?? undefined;
};

const countVisibleVideosForAuthor = (
  author: string,
  role?: FavoriteVisibilityRole,
): number => {
  const where = visibleVideoPredicate([eq(videos.author, author)], role);
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(videos)
    .where(where)
    .get();

  return row?.count ?? 0;
};

export const listFavoriteCollections = (
  userId: string,
  role?: FavoriteVisibilityRole,
): FavoriteCollectionItem[] => {
  const rows = db
    .select({
      collectionId: favoriteCollections.collectionId,
      name: collections.name,
      title: collections.title,
      sourcePlatform: collections.sourcePlatform,
      favoritedAt: favoriteCollections.createdAt,
    })
    .from(favoriteCollections)
    .innerJoin(collections, eq(collections.id, favoriteCollections.collectionId))
    .where(eq(favoriteCollections.userId, userId))
    .orderBy(desc(favoriteCollections.createdAt))
    .all();

  return rows.map((row) => ({
    collectionId: row.collectionId,
    name: row.name,
    title: row.title ?? undefined,
    sourcePlatform: row.sourcePlatform ?? undefined,
    videoCount: countVisibleVideosInCollection(row.collectionId, role),
    thumbnailVideoId: firstVisibleVideoIdInCollection(row.collectionId, role),
    favoritedAt: row.favoritedAt,
  }));
};

export const addFavoriteCollection = (
  userId: string,
  collectionId: string,
): void => {
  db.insert(favoriteCollections)
    .values({ userId, collectionId, createdAt: Date.now() })
    .onConflictDoNothing({
      target: [favoriteCollections.userId, favoriteCollections.collectionId],
    })
    .run();
};

export const removeFavoriteCollection = (
  userId: string,
  collectionId: string,
): void => {
  db.delete(favoriteCollections)
    .where(
      and(
        eq(favoriteCollections.userId, userId),
        eq(favoriteCollections.collectionId, collectionId),
      ),
    )
    .run();
};

export const listFavoriteAuthors = (
  userId: string,
  role?: FavoriteVisibilityRole,
): FavoriteAuthorItem[] => {
  const rows = db
    .select({
      author: favoriteAuthors.author,
      displayName: favoriteAuthors.displayName,
      avatarPath: favoriteAuthors.avatarPath,
      channelUrl: favoriteAuthors.channelUrl,
      favoritedAt: favoriteAuthors.createdAt,
    })
    .from(favoriteAuthors)
    .where(eq(favoriteAuthors.userId, userId))
    .orderBy(desc(favoriteAuthors.createdAt))
    .all();

  return rows.map((row) => ({
    author: row.author,
    displayName: row.displayName || row.author,
    avatarPath: row.avatarPath ?? undefined,
    channelUrl: row.channelUrl ?? undefined,
    videoCount: countVisibleVideosForAuthor(row.author, role),
    favoritedAt: row.favoritedAt,
  }));
};

export const addFavoriteAuthor = (
  userId: string,
  input: FavoriteAuthorInput,
): void => {
  db.insert(favoriteAuthors)
    .values({
      userId,
      author: input.author,
      displayName: input.displayName ?? null,
      avatarPath: input.avatarPath ?? null,
      channelUrl: input.channelUrl ?? null,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [favoriteAuthors.userId, favoriteAuthors.author],
      set: {
        displayName: sql`excluded.display_name`,
        avatarPath: sql`excluded.avatar_path`,
        channelUrl: sql`excluded.channel_url`,
      },
    })
    .run();
};

export const removeFavoriteAuthor = (userId: string, author: string): void => {
  db.delete(favoriteAuthors)
    .where(
      and(
        eq(favoriteAuthors.userId, userId),
        eq(favoriteAuthors.author, author),
      ),
    )
    .run();
};
