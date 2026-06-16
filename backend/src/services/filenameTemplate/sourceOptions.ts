import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { Video } from "../storageService/types";
import { resolveAuthorOrganizationMode } from "../../types/settings";
import { FilenameTemplateSourceOptions } from "./types";

type DownloadCollisionReservation = {
  persistedCount: number;
  reservedCount: number;
  updatedAt: number;
};

type CollectionSourceRow = {
  collectionId: string | null;
  subscriptionType: string | null;
  playlistId: string | null;
  author: string | null;
  authorUrl: string | null;
  playlistTitle: string | null;
};

type CollectionTypeRowsLoader = () => CollectionSourceRow[];
type DateCollisionCountsByLookupKey = Map<string, number>;
type StoredDateCollisionCountCache = {
  cacheKey: string;
  countsByLookupKey: DateCollisionCountsByLookupKey;
  expiresAt: number;
};

const DOWNLOAD_COLLISION_RESERVATION_TTL_MS = 10 * 60 * 1000;
const STORED_DATE_COLLISION_COUNT_CACHE_TTL_MS = 30 * 1000;
const downloadCollisionReservations = new Map<
  string,
  DownloadCollisionReservation
>();
let storedDateCollisionCountCache: StoredDateCollisionCountCache | null = null;

function loadCollectionTypeRowsFromDatabase(): CollectionSourceRow[] {
  // Lazy import to avoid initializing the DB layer at module import time.
  // Several tests import sourceOptions helpers without a real database setup.
  const { db } = require("../../db") as typeof import("../../db");
  const { subscriptions } = require("../../db/schema") as typeof import("../../db/schema");
  return db
    .select({
      collectionId: subscriptions.collectionId,
      subscriptionType: subscriptions.subscriptionType,
      playlistId: subscriptions.playlistId,
      author: subscriptions.author,
      authorUrl: subscriptions.authorUrl,
      playlistTitle: subscriptions.playlistTitle,
    })
    .from(subscriptions)
    .all();
}

let collectionTypeRowsLoader: CollectionTypeRowsLoader =
  loadCollectionTypeRowsFromDatabase;

function sanitizeUploadDate(value: string | undefined): string {
  if (!value) return "";
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function resolveSourceGroupKey(
  sourceOptions: FilenameTemplateSourceOptions,
  author: string | undefined
): string {
  return (
    sourceOptions.sourceCollectionId ||
    sourceOptions.sourceCollectionName ||
    author ||
    ""
  );
}

function reserveDateCollisionIndex(
  lookupKey: string,
  persistedCount: number
): number {
  const now = Date.now();

  for (const [key, reservation] of downloadCollisionReservations.entries()) {
    if (now - reservation.updatedAt > DOWNLOAD_COLLISION_RESERVATION_TTL_MS) {
      downloadCollisionReservations.delete(key);
    }
  }

  const existingReservation = downloadCollisionReservations.get(lookupKey);
  const reservation =
    !existingReservation ||
    existingReservation.persistedCount !== persistedCount
      ? {
          persistedCount,
          reservedCount: 0,
          updatedAt: now,
        }
      : existingReservation;

  const nextIndex = persistedCount + reservation.reservedCount + 1;
  reservation.reservedCount += 1;
  reservation.updatedAt = now;
  downloadCollisionReservations.set(lookupKey, reservation);

  return nextIndex;
}

function getSourceCollectionType(
  row: Pick<CollectionSourceRow, "subscriptionType" | "playlistId">
): "channel" | "playlist" {
  return row.subscriptionType === "playlist" || Boolean(row.playlistId)
    ? "playlist"
    : "channel";
}

function getCollectionSourceMaps(): {
  collectionTypeMap: Map<string, "channel" | "playlist">;
  collectionSourceById: Map<string, CollectionSourceRow>;
  collectionSourceByAuthorUrl: Map<string, CollectionSourceRow>;
} {
  const collectionTypeMap = new Map<string, "channel" | "playlist">();
  const collectionSourceById = new Map<string, CollectionSourceRow>();
  const collectionSourceByAuthorUrl = new Map<string, CollectionSourceRow>();
  try {
    for (const row of collectionTypeRowsLoader()) {
      if (row.collectionId) {
        collectionTypeMap.set(row.collectionId, getSourceCollectionType(row));
        if (!collectionSourceById.has(row.collectionId)) {
          collectionSourceById.set(row.collectionId, row);
        }
      }
      if (row.authorUrl && !collectionSourceByAuthorUrl.has(row.authorUrl)) {
        collectionSourceByAuthorUrl.set(row.authorUrl, row);
      }
    }
  } catch (error) {
    logger.warn("Filename template source-options lookup failed:", error);
  }
  return {
    collectionTypeMap,
    collectionSourceById,
    collectionSourceByAuthorUrl,
  };
}

function resolveStoredSourceCustomName(
  subscriptionRow: CollectionSourceRow | undefined,
  author: string
): string {
  return subscriptionRow?.author || author;
}

function resolveStoredSourceCollectionName(input: {
  authorFolderOnly: boolean;
  membershipCollectionName: string;
  sourceCustomName: string;
  subscriptionRow?: CollectionSourceRow;
  fallbackAuthor: string;
}): string {
  if (input.authorFolderOnly) {
    return input.sourceCustomName || input.fallbackAuthor;
  }

  return (
    input.subscriptionRow?.playlistTitle ||
    input.subscriptionRow?.author ||
    input.membershipCollectionName ||
    input.sourceCustomName ||
    input.fallbackAuthor
  );
}

function buildDateCollisionCountKey(
  sourceOptions: FilenameTemplateSourceOptions,
  author: string | undefined,
  uploadDate: string | undefined
): string | null {
  const groupKey = resolveSourceGroupKey(sourceOptions, author);
  const dateKey = sanitizeUploadDate(uploadDate);
  if (!groupKey || !dateKey) {
    return null;
  }
  return JSON.stringify([groupKey, dateKey]);
}

export function buildStoredSourceOptionsMap(
  allVideos: Video[]
): Map<string, FilenameTemplateSourceOptions> {
  const videoToCollection = new Map<
    string,
    {
      collectionId: string;
      collectionName: string;
      indexInCollection: number;
    }
  >();

  let collections = [] as ReturnType<typeof storageService.getCollections>;
  try {
    collections = storageService.getCollections();
  } catch (error) {
    logger.warn("Filename template collection lookup failed:", error);
  }

  for (const collection of collections) {
    for (let i = 0; i < collection.videos.length; i++) {
      const videoId = collection.videos[i];
      if (!videoToCollection.has(videoId)) {
        videoToCollection.set(videoId, {
          collectionId: collection.id,
          collectionName: collection.name || collection.title || "",
          indexInCollection: i + 1,
        });
      }
    }
  }

  const {
    collectionTypeMap,
    collectionSourceById,
    collectionSourceByAuthorUrl,
  } = getCollectionSourceMaps();
  const sourceOptionsByVideoId = new Map<string, FilenameTemplateSourceOptions>();

  // Under author_folder_only, collection members live in the author folder, not
  // a collection-named folder. Group the planned path by author so the batch
  // rename keeps files in the author folder instead of relocating them into a
  // collection folder (issue #295 1-A). Episode numbering (mediaPlaylistIndex)
  // and collection type are preserved so season/episode templates still work.
  let authorFolderOnly = false;
  try {
    authorFolderOnly =
      resolveAuthorOrganizationMode(storageService.getSettings()) ===
      "author_folder_only";
  } catch (error) {
    logger.warn("Filename template author-mode lookup failed:", error);
  }

  for (const video of allVideos) {
    const author = video.author || "";
    const membership = videoToCollection.get(video.id);

    if (membership) {
      const subscriptionRow = collectionSourceById.get(membership.collectionId);
      const sourceCustomName = resolveStoredSourceCustomName(
        subscriptionRow,
        author
      );
      sourceOptionsByVideoId.set(video.id, {
        sourceCustomName,
        sourceCollectionName: resolveStoredSourceCollectionName({
          authorFolderOnly,
          membershipCollectionName: membership.collectionName,
          sourceCustomName,
          subscriptionRow,
          fallbackAuthor: author,
        }),
        sourceCollectionId: membership.collectionId,
        sourceCollectionType:
          collectionTypeMap.get(membership.collectionId) || "channel",
        mediaPlaylistIndex: membership.indexInCollection,
      });
      continue;
    }

    const subscriptionRow = video.channelUrl
      ? collectionSourceByAuthorUrl.get(video.channelUrl)
      : undefined;
    const sourceCustomName = resolveStoredSourceCustomName(
      subscriptionRow,
      author
    );
    sourceOptionsByVideoId.set(video.id, {
      sourceCustomName,
      sourceCollectionName:
        subscriptionRow?.author || sourceCustomName || author,
      sourceCollectionId: "",
      sourceCollectionType: subscriptionRow
        ? getSourceCollectionType(subscriptionRow)
        : "single",
    });
  }

  return sourceOptionsByVideoId;
}

function buildDateCollisionCountsByLookupKey(
  allVideos: Video[],
  sourceOptionsByVideoId: Map<string, FilenameTemplateSourceOptions>
): DateCollisionCountsByLookupKey {
  const countsByLookupKey = new Map<string, number>();

  for (const video of allVideos) {
    const sourceOptions = sourceOptionsByVideoId.get(video.id);
    if (!sourceOptions) continue;

    const lookupKey = buildDateCollisionCountKey(
      sourceOptions,
      video.author || "",
      video.date || ""
    );
    if (!lookupKey) continue;

    countsByLookupKey.set(lookupKey, (countsByLookupKey.get(lookupKey) || 0) + 1);
  }

  return countsByLookupKey;
}

function buildStoredDateCollisionCounts(
  allVideos: Video[]
): DateCollisionCountsByLookupKey {
  return buildDateCollisionCountsByLookupKey(
    allVideos,
    buildStoredSourceOptionsMap(allVideos)
  );
}

function getStoredDateCollisionCountCacheKey(allVideos: Video[]): string {
  const newestVideo = allVideos[0];
  const oldestVideo = allVideos[allVideos.length - 1];
  return JSON.stringify([
    allVideos.length,
    newestVideo?.id || "",
    newestVideo?.createdAt || "",
    oldestVideo?.id || "",
    oldestVideo?.createdAt || "",
  ]);
}

function getCachedStoredDateCollisionCounts(): DateCollisionCountsByLookupKey {
  const allVideos = storageService.getVideos();
  const cacheKey = getStoredDateCollisionCountCacheKey(allVideos);
  const now = Date.now();

  if (
    storedDateCollisionCountCache &&
    storedDateCollisionCountCache.cacheKey === cacheKey &&
    storedDateCollisionCountCache.expiresAt > now
  ) {
    return storedDateCollisionCountCache.countsByLookupKey;
  }

  const countsByLookupKey = buildStoredDateCollisionCounts(allVideos);
  storedDateCollisionCountCache = {
    cacheKey,
    countsByLookupKey,
    expiresAt: now + STORED_DATE_COLLISION_COUNT_CACHE_TTL_MS,
  };
  return countsByLookupKey;
}

export function assignDateCollisionIndexes(
  allVideos: Video[],
  sourceOptionsByVideoId: Map<string, FilenameTemplateSourceOptions>
): void {
  type GroupItem = { id: string; sortKey: string };
  const groups = new Map<string, GroupItem[]>();

  for (const video of allVideos) {
    const sourceOptions = sourceOptionsByVideoId.get(video.id);
    if (!sourceOptions) continue;

    const groupKey = resolveSourceGroupKey(sourceOptions, video.author || "");
    const dateKey = sanitizeUploadDate(video.date || "");
    if (!groupKey || !dateKey) continue;

    const lookupKey = JSON.stringify([groupKey, dateKey]);
    const sortKey = [
      String(sourceOptions.mediaPlaylistIndex ?? 9999).padStart(6, "0"),
      video.date || "",
      video.addedAt || "",
      video.createdAt || "",
      video.id || "",
    ].join("|");

    const group = groups.get(lookupKey) || [];
    group.push({ id: video.id, sortKey });
    groups.set(lookupKey, group);
  }

  for (const group of groups.values()) {
    group.sort((left, right) =>
      left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0
    );

    for (let i = 0; i < group.length; i++) {
      const sourceOptions = sourceOptionsByVideoId.get(group[i].id);
      if (sourceOptions) {
        sourceOptions.mediaPlaylistIndexWithinDate = i + 1;
      }
    }
  }
}

export function enrichSourceOptionsForDownload(
  sourceOptions: FilenameTemplateSourceOptions,
  input: {
    author?: string;
    uploadDate?: string;
    existingVideos?: Video[];
    existingDateCollisionCountsByLookupKey?: DateCollisionCountsByLookupKey;
    existingSourceOptionsByVideoId?: Map<string, FilenameTemplateSourceOptions>;
  }
): FilenameTemplateSourceOptions {
  if (sourceOptions.mediaPlaylistIndexWithinDate !== undefined) {
    return sourceOptions;
  }

  const sourceCollectionType = sourceOptions.sourceCollectionType || "single";
  if (sourceCollectionType === "playlist") {
    if (sourceOptions.mediaPlaylistIndex === undefined) {
      return sourceOptions;
    }
    return {
      ...sourceOptions,
      mediaPlaylistIndexWithinDate: sourceOptions.mediaPlaylistIndex,
    };
  }

  const uploadDate = sanitizeUploadDate(input.uploadDate);
  const groupKey = resolveSourceGroupKey(sourceOptions, input.author);
  if (!uploadDate || !groupKey) {
    return sourceOptions;
  }

  const lookupKey = JSON.stringify([groupKey, uploadDate]);
  const explicitExistingCount =
    input.existingDateCollisionCountsByLookupKey?.get(lookupKey);
  const existingCount =
    explicitExistingCount ??
    (input.existingVideos
      ? buildDateCollisionCountsByLookupKey(
          input.existingVideos,
          input.existingSourceOptionsByVideoId ||
            buildStoredSourceOptionsMap(input.existingVideos)
        ).get(lookupKey) ?? 0
      : // Callers without a snapshot still fall back to the persisted library,
        // but we reuse a short-lived count index so active channels do not
        // rebuild collection membership maps on every download.
        getCachedStoredDateCollisionCounts().get(lookupKey) ?? 0);

  return {
    ...sourceOptions,
    // Reserve the next slot inside this process so parallel downloads for the
    // same group/date do not hand out the same index before either is persisted.
    mediaPlaylistIndexWithinDate: reserveDateCollisionIndex(
      lookupKey,
      existingCount
    ),
  };
}

/**
 * @internal Test helper to reset process-local reservations between test cases.
 */
export function resetDownloadCollisionReservationsForTests(): void {
  downloadCollisionReservations.clear();
  storedDateCollisionCountCache = null;
}

export function setCollectionTypeRowsLoaderForTests(
  loader?: CollectionTypeRowsLoader
): void {
  collectionTypeRowsLoader = loader || loadCollectionTypeRowsFromDatabase;
}
