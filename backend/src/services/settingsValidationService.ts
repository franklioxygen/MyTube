import { Settings, defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";

/**
 * Validate and normalize settings values
 */
export function validateSettings(newSettings: Partial<Settings>): void {
  // Validate maxConcurrentDownloads
  if (
    newSettings.maxConcurrentDownloads !== undefined &&
    newSettings.maxConcurrentDownloads < 1
  ) {
    newSettings.maxConcurrentDownloads = 1;
  }

  // Validate websiteName length
  if (newSettings.websiteName && newSettings.websiteName.length > 15) {
    newSettings.websiteName = newSettings.websiteName.substring(0, 15);
  }

  // Validate itemsPerPage
  if (newSettings.itemsPerPage !== undefined && newSettings.itemsPerPage < 1) {
    newSettings.itemsPerPage = 12; // Default fallback if invalid
  }

  // Validate defaultSort
  const validSorts = [
    "dateDesc",
    "dateAsc",
    "viewsDesc",
    "viewsAsc",
    "nameAsc",
    "videoDateDesc",
    "videoDateAsc",
    "random",
  ];
  if (
    newSettings.defaultSort !== undefined &&
    !validSorts.includes(newSettings.defaultSort)
  ) {
    newSettings.defaultSort = "dateDesc";
  }
}

/**
 * Process tag deletions and update videos accordingly
 */
export function processTagDeletions(
  oldTags: string[],
  newTags: string[] | undefined
): void {
  if (newTags === undefined) {
    // Preserve existing tags by not processing deletions
    return;
  }

  if (Array.isArray(newTags) && newTags.length === 0 && oldTags.length > 0) {
    // Empty array sent but existing tags exist - likely a bug where frontend sent empty array
    // Preserve existing tags to prevent accidental deletion
    logger.warn(
      "Received empty tags array but existing tags exist. Preserving existing tags to prevent data loss."
    );
    return;
  }

  // Tags are explicitly provided (non-empty or intentionally clearing), process deletions
  const newTagsList: string[] = Array.isArray(newTags) ? newTags : [];
  const deletedTags = oldTags.filter((tag) => !newTagsList.includes(tag));

  if (deletedTags.length > 0) {
    logger.info("Tags deleted:", deletedTags);
    const allVideos = storageService.getVideos();
    let videosUpdatedCount = 0;

    for (const video of allVideos) {
      if (video.tags && video.tags.some((tag) => deletedTags.includes(tag))) {
        const updatedTags = video.tags.filter(
          (tag) => !deletedTags.includes(tag)
        );
        storageService.updateVideo(video.id, { tags: updatedTags });
        videosUpdatedCount++;
      }
    }
    logger.info(`Removed deleted tags from ${videosUpdatedCount} videos`);
  }
}

/**
 * Merge settings with defaults and existing settings
 */
export function mergeSettings(
  existingSettings: Partial<Settings>,
  newSettings: Partial<Settings>
): Settings {
  return { ...defaultSettings, ...existingSettings, ...newSettings };
}

/**
 * Prepare settings for saving (handle password, tags, CloudFlare settings)
 */
export async function prepareSettingsForSave(
  existingSettings: Settings,
  newSettings: Partial<Settings>,
  hashPassword: (password: string) => Promise<string>
): Promise<Partial<Settings>> {
  const prepared = { ...newSettings };

  // Handle password hashing
  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed = existingSettings.passwordLoginAllowed !== false;
  
  if (prepared.password) {
    // If password login is not allowed, reject password updates
    if (!passwordLoginAllowed) {
      // Remove password from prepared settings to prevent update
      delete prepared.password;
      logger.warn("Password update rejected: password login is not allowed");
    } else {
      // If password is provided and allowed, hash it
      prepared.password = await hashPassword(prepared.password);
    }
  } else {
    // If password is empty/not provided, keep existing password
    prepared.password = existingSettings.password;
  }

  // Handle visitor password hashing
  if (prepared.visitorPassword) {
    prepared.visitorPassword = await hashPassword(prepared.visitorPassword);
  } else {
    prepared.visitorPassword = existingSettings.visitorPassword;
  }

  // Handle tags
  const oldTags: string[] = existingSettings.tags || [];
  if (prepared.tags === undefined) {
    // Preserve existing tags by not including tags in the save
    delete prepared.tags;
  } else if (
    Array.isArray(prepared.tags) &&
    prepared.tags.length === 0 &&
    oldTags.length > 0
  ) {
    // Empty array sent but existing tags exist - preserve them
    delete prepared.tags;
  } else {
    // Process tag deletions
    processTagDeletions(oldTags, prepared.tags);
  }

  // Preserve CloudFlare settings if not explicitly provided
  if (prepared.cloudflaredTunnelEnabled === undefined) {
    prepared.cloudflaredTunnelEnabled =
      existingSettings.cloudflaredTunnelEnabled;
  }
  if (prepared.cloudflaredToken === undefined) {
    prepared.cloudflaredToken = existingSettings.cloudflaredToken;
  }
  if (prepared.allowedHosts === undefined) {
    prepared.allowedHosts = existingSettings.allowedHosts;
  }

  return prepared;
}


