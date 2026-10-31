import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { collections, collectionVideos, settings, videos } from "../db/schema";
import { invalidateRecommendationSignalsCache } from "./recommendationSignalsService";
import { invalidateSettingsCache } from "./storageService/settings";
import { bumpVideosListRevision } from "./storageService/videoListRevision";

export const MAX_BULK_VIDEOS = 500;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BulkOrganizationError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BulkOrganizationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BulkOrganizationError(400, "A JSON object is required");
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new BulkOrganizationError(400, "Unexpected request fields");
  }
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string" || !value || value !== value.trim() ||
    value.length > 200 || CONTROL_CHARACTERS.test(value)
  ) {
    throw new BulkOrganizationError(400, "Invalid video or collection ID");
  }
  return value;
}

function videoIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BULK_VIDEOS) {
    throw new BulkOrganizationError(400, "Select between 1 and 500 videos");
  }
  return [...new Set(value.map(identifier))];
}

function label(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    throw new BulkOrganizationError(400, "Names and tags must be strings");
  }
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > maxLength || CONTROL_CHARACTERS.test(trimmed)) {
    throw new BulkOrganizationError(400, `Invalid name or tag (maximum ${maxLength} characters)`);
  }
  return trimmed;
}

function parseStoredTags(value: string | null, details: Record<string, unknown>): string[] {
  if (value === null || value === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string")) {
      return parsed;
    }
  } catch { /* Reject damaged data instead of replacing it. */ }
  throw new BulkOrganizationError(409, "Stored tags are invalid; repair them before retrying", details);
}

function selectedRows(tx: Transaction, ids: string[]) {
  const rows = tx.select({ id: videos.id, tags: videos.tags }).from(videos)
    .where(inArray(videos.id, ids)).all();
  const found = new Set(rows.map((row) => row.id));
  const missingVideoIds = ids.filter((id) => !found.has(id));
  if (missingVideoIds.length) {
    throw new BulkOrganizationError(404, "Some selected videos no longer exist", { missingVideoIds });
  }
  return new Map(rows.map((row) => [row.id, row]));
}

export function appendTagsToVideos(body: unknown) {
  const input = record(body);
  onlyKeys(input, ["videoIds", "tags"]);
  const ids = videoIds(input.videoIds);
  if (!Array.isArray(input.tags) || !input.tags.length || input.tags.length > 20) {
    throw new BulkOrganizationError(400, "Add between 1 and 20 tags");
  }
  const requested = new Map<string, string>();
  for (const value of input.tags) {
    const tag = label(value, 80);
    if (!requested.has(tag.toLowerCase())) requested.set(tag.toLowerCase(), tag);
  }

  const result = db.transaction((tx) => {
    const rows = selectedRows(tx, ids);
    const catalogRow = tx.select().from(settings).where(eq(settings.key, "tags")).get();
    const catalog = parseStoredTags(catalogRow?.value ?? null, { field: "settings.tags" });
    const canonical = new Map<string, string>();
    for (const tag of catalog) {
      if (!canonical.has(tag.toLowerCase())) canonical.set(tag.toLowerCase(), tag);
    }
    const newCatalogTags: string[] = [];
    for (const [key, tag] of requested) {
      if (!canonical.has(key)) {
        canonical.set(key, tag);
        newCatalogTags.push(tag);
      }
    }
    const changedVideoIds: string[] = [];
    const unchangedVideoIds: string[] = [];
    const updated = ids.map((id) => {
      const old = parseStoredTags(rows.get(id)!.tags, { invalidVideoIds: [id] });
      const existing = new Set(old.map((tag) => tag.toLowerCase()));
      const added = [...requested.keys()].filter((key) => !existing.has(key))
        .map((key) => canonical.get(key)!);
      const tags = [...old, ...added];
      if (added.length) {
        tx.update(videos).set({ tags: JSON.stringify(tags) }).where(eq(videos.id, id)).run();
        changedVideoIds.push(id);
      } else {
        unchangedVideoIds.push(id);
      }
      return { id, tags };
    });
    if (newCatalogTags.length) {
      const value = JSON.stringify([...catalog, ...newCatalogTags].sort((a, b) => a.localeCompare(b)));
      tx.insert(settings).values({ key: "tags", value })
        .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    }
    return {
      requestedCount: ids.length, changedVideoIds, unchangedVideoIds,
      catalogChanged: newCatalogTags.length > 0, videos: updated,
    };
  }, { behavior: "immediate" });

  if (result.changedVideoIds.length) {
    bumpVideosListRevision();
    invalidateRecommendationSignalsCache();
  }
  if (result.catalogChanged) invalidateSettingsCache();
  return result;
}

export function addVideosToCollection(body: unknown) {
  const input = record(body);
  onlyKeys(input, ["videoIds", "collectionId", "newCollection"]);
  const ids = videoIds(input.videoIds);
  const hasExisting = Object.prototype.hasOwnProperty.call(input, "collectionId");
  const hasNew = Object.prototype.hasOwnProperty.call(input, "newCollection");
  if (hasExisting === hasNew) {
    throw new BulkOrganizationError(400, "Provide exactly one collection target");
  }
  let collectionId: string;
  let newName: string | undefined;
  if (hasExisting) {
    collectionId = identifier(input.collectionId);
  } else {
    const target = record(input.newCollection);
    onlyKeys(target, ["id", "name"]);
    collectionId = identifier(target.id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(collectionId)) {
      throw new BulkOrganizationError(400, "New collection ID must be a UUID v4");
    }
    newName = label(target.name, 200);
    if (/[<>:"/\\|?*]/u.test(newName) || newName.endsWith(".")) {
      throw new BulkOrganizationError(400, "Invalid collection name");
    }
  }

  return db.transaction((tx) => {
    selectedRows(tx, ids);
    let collection = tx.select().from(collections).where(eq(collections.id, collectionId)).get();
    let created = false;
    if (newName !== undefined) {
      if (collection) {
        if (collection.origin !== "manual" || collection.name !== newName || collection.title !== newName) {
          throw new BulkOrganizationError(409, "Collection ID is already in use");
        }
      } else {
        const duplicate = tx.select({ id: collections.id }).from(collections)
          .where(or(eq(collections.name, newName), eq(collections.title, newName))).get();
        if (duplicate) {
          throw new BulkOrganizationError(409, "A collection with this name already exists", {
            existingCollectionId: duplicate.id,
          });
        }
        collection = tx.insert(collections).values({
          id: collectionId, name: newName, title: newName, origin: "manual",
          createdAt: new Date().toISOString(),
        }).returning().get();
        created = true;
      }
    }
    if (!collection) {
      throw new BulkOrganizationError(404, "Collection no longer exists", { collectionId });
    }
    const existing = new Set(tx.select({ videoId: collectionVideos.videoId }).from(collectionVideos)
      .where(and(eq(collectionVideos.collectionId, collectionId), inArray(collectionVideos.videoId, ids)))
      .all().map((row) => row.videoId));
    const changedVideoIds = ids.filter((id) => !existing.has(id));
    const unchangedVideoIds = ids.filter((id) => existing.has(id));
    let order = tx.select({ value: sql<number>`coalesce(max(${collectionVideos.order}), 0)` })
      .from(collectionVideos).where(eq(collectionVideos.collectionId, collectionId)).get()?.value ?? 0;
    for (const id of changedVideoIds) {
      tx.insert(collectionVideos).values({ collectionId, videoId: id, order: ++order })
        .onConflictDoNothing().run();
    }
    if (changedVideoIds.length) {
      tx.update(collections).set({ updatedAt: new Date().toISOString() })
        .where(eq(collections.id, collectionId)).run();
    }
    return {
      requestedCount: ids.length, changedVideoIds, unchangedVideoIds,
      collection: { id: collectionId, name: collection.name, created },
    };
  }, { behavior: "immediate" });
}
