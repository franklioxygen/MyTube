import { eq } from "drizzle-orm";
import { db } from "../db";
import { videos } from "../db/schema";
import { DatabaseError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import { getSettings, saveSettings } from "./storageService/settings";

interface RenameTagResult {
  updatedVideosCount: number;
  settingsUpdated: boolean;
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
    
    // Check if oldTag exists in settings
    const tagIndex = tags.indexOf(oldTag);
    if (tagIndex !== -1) {
      // Create new tags array
      const newTags = [...tags];
      newTags[tagIndex] = newTag;
      
      // We should also dedup if newTag already exists (though UI might prevent this, safe to handle)
      const uniqueTags = [...new Set(newTags)];
      
      saveSettings({ ...currentSettings, tags: uniqueTags });
      result.settingsUpdated = true;
    }

    // 2. Update videos
    // There is no easy "update where json contains" in standard SQL without json extensions, 
    // and we are using drizzle with sqlite which might support it but it's often safer/easier 
    // to just iterate given the likely scale (thousands of videos is fine).
    // Efficiency note: If we had millions, we'd need a better query.
    
    const allVideos = db.select().from(videos).all();
    
    db.transaction(() => {
        for (const video of allVideos) {
            if (!video.tags) continue;
            
            let videoTags: string[] = [];
            try {
                videoTags = JSON.parse(video.tags);
            } catch (e) {
                continue;
            }

            if (videoTags.includes(oldTag)) {
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
        }
    });
    
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
    const existingLower = new Set(existing.map((t) => t.toLowerCase()));

    const toAdd: string[] = [];
    for (const tag of tags) {
      const trimmed = typeof tag === "string" ? tag.trim() : "";
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (existingLower.has(lower)) continue;
      existingLower.add(lower);
      toAdd.push(trimmed);
    }

    if (toAdd.length === 0) return false;

    const updatedTags = [...existing, ...toAdd].sort((a, b) =>
      a.localeCompare(b)
    );
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
    const allVideos = db.select().from(videos).all();

    db.transaction(() => {
      for (const video of allVideos) {
        if (!video.tags) continue;

        let videoTags: string[] = [];
        try {
          videoTags = JSON.parse(video.tags);
        } catch (e) {
          continue;
        }

        // Check if video has any of the tags to delete
        const hasTagToDelete = videoTags.some(tag => tagsToDelete.includes(tag));
        
        if (hasTagToDelete) {
          // Filter out deleted tags
          const updatedTags = videoTags.filter(tag => !tagsToDelete.includes(tag));
          
          db.update(videos)
            .set({ tags: JSON.stringify(updatedTags) })
            .where(eq(videos.id, video.id))
            .run();

          updatedVideosCount++;
        }
      }
    });

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
