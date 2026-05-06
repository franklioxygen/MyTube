import { logger } from "../../utils/logger";
import * as storageService from "../storageService";
import { Video } from "../storageService/types";
import { FilenameTemplateSourceOptions } from "./types";

type DownloadCollisionReservation = {
  persistedCount: number;
  reservedCount: number;
  updatedAt: number;
};

type CollectionTypeRow = {
  collectionId: string | null;
  subscriptionType: string | null;
  playlistId: string | null;
};

type CollectionTypeRowsLoader = () => CollectionTypeRow[];

const DOWNLOAD_COLLISION_RESERVATION_TTL_MS = 10 * 60 * 1000;
const downloadCollisionReservations = new Map<
  string,
  DownloadCollisionReservation
>();

function loadCollectionTypeRowsFromDatabase(): CollectionTypeRow[] {
  const { db } = require("../../db") as typeof import("../../db");
  const { subscriptions } = require("../../db/schema") as typeof import("../../db/schema");
  return db
    .select({
      collectionId: subscriptions.collectionId,
      subscriptionType: subscriptions.subscriptionType,
      playlistId: subscriptions.playlistId,
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

function getCollectionTypeMap(): Map<string, "channel" | "playlist"> {
  const collectionTypeMap = new Map<string, "channel" | "playlist">();
  try {
    for (const row of collectionTypeRowsLoader()) {
      if (!row.collectionId) continue;
      const isPlaylist =
        row.subscriptionType === "playlist" || Boolean(row.playlistId);
      collectionTypeMap.set(
        row.collectionId,
        isPlaylist ? "playlist" : "channel"
      );
    }
  } catch (error) {
    logger.warn("Filename template source-options lookup failed:", error);
  }
  return collectionTypeMap;
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

  const collectionTypeMap = getCollectionTypeMap();
  const sourceOptionsByVideoId = new Map<string, FilenameTemplateSourceOptions>();

  for (const video of allVideos) {
    const author = video.author || "";
    const membership = videoToCollection.get(video.id);

    if (membership) {
      sourceOptionsByVideoId.set(video.id, {
        sourceCustomName: author,
        sourceCollectionName: membership.collectionName,
        sourceCollectionId: membership.collectionId,
        sourceCollectionType:
          collectionTypeMap.get(membership.collectionId) || "channel",
        mediaPlaylistIndex: membership.indexInCollection,
      });
      continue;
    }

    sourceOptionsByVideoId.set(video.id, {
      sourceCustomName: author,
      sourceCollectionName: author,
      sourceCollectionId: "",
      sourceCollectionType: "single",
    });
  }

  return sourceOptionsByVideoId;
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
  const existingVideos =
    input.existingVideos ||
    // Callers without a snapshot still fall back to the full library. This is
    // best-effort and intentionally favors correctness over an extra query path.
    storageService.getVideos();
  const storedSourceOptions = buildStoredSourceOptionsMap(existingVideos);

  let existingCount = 0;
  for (const video of existingVideos) {
    const existingSourceOptions = storedSourceOptions.get(video.id);
    if (!existingSourceOptions) continue;

    const existingGroupKey = resolveSourceGroupKey(
      existingSourceOptions,
      video.author || ""
    );
    const existingUploadDate = sanitizeUploadDate(video.date || "");

    if (existingGroupKey === groupKey && existingUploadDate === uploadDate) {
      existingCount++;
    }
  }

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
}

export function setCollectionTypeRowsLoaderForTests(
  loader?: CollectionTypeRowsLoader
): void {
  collectionTypeRowsLoader = loader || loadCollectionTypeRowsFromDatabase;
}
