import { mergeTagCatalog } from "../utils/tagCatalog";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { videos } from "../db/schema";
import { DatabaseError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import {
  MAX_AUTO_TAG_LENGTH,
  MAX_TAG_ALIASES,
  normalizeSourceTags,
  tagAliasKey,
} from "../utils/sourceTags";
import { getSettings, saveSettings } from "./storageService/settings";
import { bumpVideosListRevision } from "./storageService/videoListRevision";

interface RenameTagResult {
  updatedVideosCount: number;
  settingsUpdated: boolean;
}

/**
 * Return the {id, tags} rows for every video whose tags JSON array contains
 * `tagName`. Uses SQLite's json_each so we only hydrate matching rows instead
 * of loading and parsing the entire videos table (the previous implementation
 * scanned every video in JS).
 */
function getVideosWithTag(tagName: string): Array<{ id: string; tags: string | null }> {
  return db
    .select({ id: videos.id, tags: videos.tags })
    .from(videos)
    .where(
      sql`EXISTS (SELECT 1 FROM json_each(${videos.tags}) WHERE json_valid(${videos.tags}) AND json_each.value = ${tagName})`
    )
    .all();
}

/**
 * Return the {id, tags} rows for every video whose tags JSON array contains any
 * of `tagNames`.
 */
function getVideosWithAnyTag(
  tagNames: string[]
): Array<{ id: string; tags: string | null }> {
  if (tagNames.length === 0) return [];
  // Build a parameterized IN-list over json_each values. Each entry in the
  // sql.join is bound as a separate parameter.
  const inList = sql.join(
    tagNames.map((name) => sql`${name}`),
    sql`, `
  );
  return db
    .select({ id: videos.id, tags: videos.tags })
    .from(videos)
    .where(
      sql`EXISTS (SELECT 1 FROM json_each(${videos.tags}) WHERE json_valid(${videos.tags}) AND json_each.value IN (${inList}))`
    )
    .all();
}

/**
 * The tag aliases after renaming `oldTag` to `newTag`: the old name becomes an
 * alias of the new one, so source tags spelled the old way fold into it
 * (issue #546). Aliases of the old name follow the rename, and the new name
 * stops being an alias, so the map never chains. Returns null when nothing
 * changes, e.g. for a case-only rename.
 */
function aliasesAfterRename(
  current: unknown,
  oldTag: string,
  newTag: string
): Record<string, string> | null {
  const oldKey = tagAliasKey(oldTag);
  const newKey = tagAliasKey(newTag);
  // A case-only rename needs no alias: the catalog spelling already applies.
  // "music" -> "#Music" does, since source tags are cleaned to "music".
  if (!oldKey || !newKey || oldTag.toLowerCase() === newTag.toLowerCase()) return null;
  if (oldKey.length > MAX_AUTO_TAG_LENGTH || newTag.length > MAX_AUTO_TAG_LENGTH) {
    return null;
  }

  // No prototype, so an alias like "__proto__" stays an ordinary key.
  const aliases: Record<string, string> = Object.create(null);
  if (current && typeof current === "object" && !Array.isArray(current)) {
    for (const [alias, target] of Object.entries(current)) {
      if (typeof target !== "string") continue;
      const nextTarget = tagAliasKey(target) === oldKey ? newTag : target;
      // Drop no-op aliases, and the new name's own alias to some other tag.
      if (alias === nextTarget.toLowerCase()) continue;
      if (alias === newKey && alias !== oldKey) continue;
      aliases[alias] = nextTarget;
    }
  }
  if (
    !Object.prototype.hasOwnProperty.call(aliases, oldKey) &&
    Object.keys(aliases).length >= MAX_TAG_ALIASES
  ) {
    logger.warn(`Tag alias limit reached; not adding "${oldKey}" -> "${newTag}".`);
  } else {
    aliases[oldKey] = newTag;
  }
  return aliases;
}

const parseTagArray = (value: string | null): unknown[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Re-apply the current tag aliases to stored suggestions (videos.auto_tags)
 * that contain any of `aliasKeys`, so a new alias also covers videos that
 * were already downloaded. Failures are logged, not thrown: the alias itself
 * is already saved and applies to future downloads.
 *
 * @returns Number of videos whose suggestions changed
 */
export function rewriteAutoTagsForAliases(aliasKeys: readonly string[]): number {
  if (aliasKeys.length === 0) return 0;
  try {
    const keys = new Set(aliasKeys);
    const settings = getSettings();
    // Matched in JS: SQLite's lower() folds ASCII only, unlike the
    // toLowerCase() that produced the alias keys.
    const rows = db
      .select({ id: videos.id, tags: videos.tags, autoTags: videos.autoTags })
      .from(videos)
      .where(isNotNull(videos.autoTags))
      .all();

    let updatedVideosCount = 0;
    db.transaction(() => {
      for (const row of rows) {
        const current = parseTagArray(row.autoTags);
        if (!current.some((tag) => keys.has(tagAliasKey(tag)))) continue;
        const next = normalizeSourceTags(current, {
          catalog: settings.tags,
          aliases: settings.tagAliases,
          manualTags: parseTagArray(row.tags),
        });
        db.update(videos)
          .set({ autoTags: JSON.stringify(next) })
          .where(eq(videos.id, row.id))
          .run();
        updatedVideosCount++;
      }
    });
    if (updatedVideosCount > 0) {
      bumpVideosListRevision();
      logger.info(`Applied tag aliases to suggestions on ${updatedVideosCount} videos.`);
    }
    return updatedVideosCount;
  } catch (error) {
    logger.error(
      "Error applying tag aliases to stored suggestions",
      error instanceof Error ? error : new Error(String(error))
    );
    return 0;
  }
}

/**
 * Rename a tag globally across all videos and settings
 * @param oldTag The existing tag name
 * @param newTag The new tag name
 */
export function renameTag(oldTag: string, newTag: string): RenameTagResult {
  try {
    const result: RenameTagResult = {
      updatedVideosCount: 0,
      settingsUpdated: false,
    };

    // 1. Update settings
    // We need to fetch the existing settings
    const currentSettings = getSettings();
    const tags = currentSettings.tags ? (currentSettings.tags as string[]) : [];
    
    const settingsUpdate: Record<string, unknown> = {};

    // Check if oldTag exists in settings
    const tagIndex = tags.indexOf(oldTag);
    if (tagIndex !== -1) {
      // Create new tags array
      const newTags = [...tags];
      newTags[tagIndex] = newTag;
      
      // We should also dedup if newTag already exists (though UI might prevent this, safe to handle)
      settingsUpdate.tags = [...new Set(newTags)];
      result.settingsUpdated = true;
    }

    // 2. Videos to update. Only load rows whose tags JSON array actually
    // contains oldTag (filtered in SQL via json_each).
    const matchingVideos = getVideosWithTag(oldTag);

    // Register an alias only for a real rename: a stale request for a tag
    // that no longer exists must not change how source tags are folded.
    const tagAliases =
      tagIndex !== -1 || matchingVideos.length > 0
        ? aliasesAfterRename(currentSettings.tagAliases, oldTag, newTag)
        : null;
    if (tagAliases) settingsUpdate.tagAliases = tagAliases;

    if (Object.keys(settingsUpdate).length > 0) {
      saveSettings({ ...currentSettings, ...settingsUpdate });
    }

    db.transaction(() => {
        for (const video of matchingVideos) {
            if (!video.tags) continue;

            let videoTags: string[] = [];
            try {
                videoTags = JSON.parse(video.tags);
            } catch {
                continue;
            }

            // Replace oldTag with newTag
            const updatedTags = videoTags.map(t => t === oldTag ? newTag : t);
            // Dedup
            const uniqueUpdatedTags = [...new Set(updatedTags)];

            db.update(videos)
              .set({ tags: JSON.stringify(uniqueUpdatedTags) })
              .where(eq(videos.id, video.id))
              .run();

            result.updatedVideosCount++;
        }
    });
    if (result.updatedVideosCount > 0) {
      bumpVideosListRevision();
    }
    if (tagAliases) rewriteAutoTagsForAliases([tagAliasKey(oldTag)]);

    logger.info(`Renamed tag "${oldTag}" to "${newTag}". Updated ${result.updatedVideosCount} videos.`);
    return result;

  } catch (error) {
    logger.error(
      `Error renaming tag from ${oldTag} to ${newTag}`,
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      `Failed to rename tag: ${oldTag} -> ${newTag}`,
      error instanceof Error ? error : new Error(String(error)),
      "renameTag"
    );
  }
}

/**
 * Merge tags into the global settings tag catalog (settings.tags).
 *
 * Used to keep the global tag list in sync whenever a video is tagged, so tags
 * created from the player (or any API caller) show up in Tags Management.
 * Only genuinely new tags are added; existing tags are matched
 * case-insensitively so we never create "music"/"Music" duplicates, which the
 * settings validator rejects.
 *
 * @param tags Tags applied to a video
 * @returns true if the global catalog was changed and saved
 */
export function addTagsToGlobalSettings(tags: string[]): boolean {
  if (!tags || tags.length === 0) return false;

  try {
    const currentSettings = getSettings();
    const existing: string[] = Array.isArray(currentSettings.tags)
      ? (currentSettings.tags as string[])
      : [];
    const { added: toAdd, tags: updatedTags } = mergeTagCatalog(existing, tags);
    if (toAdd.length === 0) return false;

    saveSettings({ ...currentSettings, tags: updatedTags });
    logger.info(`Added new tags to global catalog: [${toAdd.join(", ")}]`);
    return true;
  } catch (error) {
    // Don't fail the video update if catalog sync fails; just log it.
    logger.error(
      `Error adding tags to global settings: [${tags.join(", ")}]`,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}

/**
 * Remove specific tags from all videos in the database
 * @param tagsToDelete Array of tag names to remove
 * @returns Number of videos updated
 */
export function deleteTagsFromVideos(tagsToDelete: string[]): number {
  if (!tagsToDelete || tagsToDelete.length === 0) return 0;

  try {
    let updatedVideosCount = 0;
    // Only load rows whose tags JSON array contains at least one of the tags
    // being deleted (filtered in SQL via json_each).
    const matchingVideos = getVideosWithAnyTag(tagsToDelete);

    db.transaction(() => {
      for (const video of matchingVideos) {
        if (!video.tags) continue;

        let videoTags: string[] = [];
        try {
          videoTags = JSON.parse(video.tags);
        } catch {
          continue;
        }

        // Filter out deleted tags
        const updatedTags = videoTags.filter(tag => !tagsToDelete.includes(tag));

        db.update(videos)
          .set({ tags: JSON.stringify(updatedTags) })
          .where(eq(videos.id, video.id))
          .run();

        updatedVideosCount++;
      }
    });
    if (updatedVideosCount > 0) {
      bumpVideosListRevision();
    }

    logger.info(`Deleted tags [${tagsToDelete.join(", ")}] from ${updatedVideosCount} videos.`);
    return updatedVideosCount;
  } catch (error) {
    logger.error(
      `Error deleting tags [${tagsToDelete.join(", ")}] from videos`,
      error instanceof Error ? error : new Error(String(error))
    );
    // We don't throw here to avoid failing the entire settings update if this cleanup fails,
    // but we log the error.
    return 0;
  }
}
