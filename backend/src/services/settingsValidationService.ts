import { ValidationError } from "../errors/DownloadErrors";
import {
  DEFAULT_ADMIN_PASSWORD,
  Settings,
  defaultSettings,
} from "../types/settings";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import {
  getTwitchCredentialValidationCode,
  normalizeTwitchCredential,
} from "../utils/twitch";

/**
 * Check if a tags array has any case-insensitive duplicates.
 * Returns the first conflicting pair [a, b] where a !== b but a.toLowerCase() === b.toLowerCase(), or null.
 */
function findCaseInsensitiveTagCollision(
  tags: string[]
): [string, string] | null {
  const seen = new Map<string, string>(); // lower -> first occurrence
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    const first = seen.get(lower);
    if (first !== undefined && first !== tag) {
      return [first, tag];
    }
    if (!seen.has(lower)) {
      seen.set(lower, tag);
    }
  }
  return null;
}

/**
 * Validate and normalize settings values
 */
export function validateSettings(newSettings: Partial<Settings>): void {
  if (typeof newSettings.twitchClientId === "string") {
    newSettings.twitchClientId = normalizeTwitchCredential(
      newSettings.twitchClientId
    );
  }

  if (typeof newSettings.twitchClientSecret === "string") {
    newSettings.twitchClientSecret = normalizeTwitchCredential(
      newSettings.twitchClientSecret
    );
  }

  if (
    newSettings.password !== undefined &&
    typeof newSettings.password !== "string"
  ) {
    throw new ValidationError("Password must be a string.", "password");
  }

  if (
    newSettings.apiKeyEnabled !== undefined &&
    typeof newSettings.apiKeyEnabled !== "boolean"
  ) {
    throw new ValidationError("API key enabled flag must be a boolean.", "apiKeyEnabled");
  }

  if (
    newSettings.apiKey !== undefined &&
    typeof newSettings.apiKey !== "string"
  ) {
    throw new ValidationError("API key must be a string.", "apiKey");
  }

  if (
    newSettings.tmdbApiKey !== undefined &&
    typeof newSettings.tmdbApiKey !== "string"
  ) {
    throw new ValidationError("TMDB API key must be a string.", "tmdbApiKey");
  }

  if (
    newSettings.twitchClientId !== undefined &&
    typeof newSettings.twitchClientId !== "string"
  ) {
    throw new ValidationError(
      "Twitch client ID must be a string.",
      "twitchClientId"
    );
  }

  if (
    newSettings.twitchClientSecret !== undefined &&
    typeof newSettings.twitchClientSecret !== "string"
  ) {
    throw new ValidationError(
      "Twitch client secret must be a string.",
      "twitchClientSecret"
    );
  }

  const twitchCredentialValidationCode = getTwitchCredentialValidationCode(
    newSettings.twitchClientId,
    newSettings.twitchClientSecret
  );
  if (twitchCredentialValidationCode === "missing_client_id") {
    throw new ValidationError(
      "Twitch client ID is required when a Twitch client secret is provided.",
      "twitchClientId"
    );
  }
  if (twitchCredentialValidationCode === "missing_client_secret") {
    throw new ValidationError(
      "Twitch client secret is required when a Twitch client ID is provided.",
      "twitchClientSecret"
    );
  }
  if (twitchCredentialValidationCode === "invalid_client_id") {
    throw new ValidationError(
      "Twitch client ID format is invalid.",
      "twitchClientId"
    );
  }
  if (twitchCredentialValidationCode === "invalid_client_secret") {
    throw new ValidationError(
      "Twitch client secret format is invalid.",
      "twitchClientSecret"
    );
  }

  if (
    newSettings.visitorPassword !== undefined &&
    typeof newSettings.visitorPassword !== "string"
  ) {
    throw new ValidationError(
      "Visitor password must be a string.",
      "visitorPassword"
    );
  }

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

  // Validate tags: no case-insensitive duplicates (e.g. "aaa" and "Aaa" cannot both exist)
  if (newSettings.tags !== undefined && Array.isArray(newSettings.tags)) {
    const collision = findCaseInsensitiveTagCollision(newSettings.tags);
    if (collision) {
      const [a, b] = collision;
      throw new ValidationError(
        `Tags must be unique (case-insensitive). "${a}" and "${b}" conflict.`,
        "tags"
      );
    }
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

interface PrepareSettingsOptions {
  // For legacy full-save semantics, preserve unspecified values.
  // For PATCH semantics, only include explicitly changed fields.
  preserveUnsetFields?: boolean;
}

/**
 * Prepare settings for saving (handle password, tags, CloudFlare settings)
 */
export async function prepareSettingsForSave(
  existingSettings: Settings,
  newSettings: Partial<Settings>,
  hashPassword: (password: string) => Promise<string>,
  options: PrepareSettingsOptions = {}
): Promise<Partial<Settings>> {
  const prepared: Partial<Settings> = {};
  const preserveUnsetFields = options.preserveUnsetFields ?? true;
  const hasField = <K extends keyof Settings>(field: K): boolean =>
    Object.prototype.hasOwnProperty.call(newSettings, field);

  // Handle password hashing
  // Check if password login is allowed (defaults to true for backward compatibility)
  const passwordLoginAllowed =
    hasField("passwordLoginAllowed")
      ? newSettings.passwordLoginAllowed !== false
      : existingSettings.passwordLoginAllowed !== false;
  const loginEnabled =
    hasField("loginEnabled")
      ? newSettings.loginEnabled === true
      : existingSettings.loginEnabled === true;
  const shouldSeedDefaultAdminPassword =
    loginEnabled &&
    passwordLoginAllowed &&
    !existingSettings.password &&
    (!hasField("password") || !newSettings.password);

  if (hasField("password")) {
    if (newSettings.password) {
      // If password login is not allowed, reject password updates
      if (!passwordLoginAllowed) {
        logger.warn("Password update rejected: password login is not allowed");
      } else {
        prepared.password = await hashPassword(newSettings.password);
      }
    } else if (shouldSeedDefaultAdminPassword) {
      prepared.password = await hashPassword(DEFAULT_ADMIN_PASSWORD);
    } else {
      // Empty password means "unchanged" for current UI flows.
      if (preserveUnsetFields) {
        prepared.password = existingSettings.password;
      }
    }
  } else if (shouldSeedDefaultAdminPassword) {
    prepared.password = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  } else if (preserveUnsetFields) {
    prepared.password = existingSettings.password;
  }

  // Handle visitor password hashing
  if (hasField("visitorPassword")) {
    if (newSettings.visitorPassword) {
      prepared.visitorPassword = await hashPassword(newSettings.visitorPassword);
    } else if (preserveUnsetFields) {
      prepared.visitorPassword = existingSettings.visitorPassword;
    }
  } else if (preserveUnsetFields) {
    prepared.visitorPassword = existingSettings.visitorPassword;
  }

  // Handle tags
  const oldTags: string[] = existingSettings.tags || [];
  if (!hasField("tags")) {
    if (preserveUnsetFields) {
      prepared.tags = existingSettings.tags;
    }
  } else if (
    Array.isArray(newSettings.tags) &&
    newSettings.tags.length === 0 &&
    oldTags.length > 0
  ) {
    // Empty array sent but existing tags exist - preserve them for legacy full-save mode.
    // For PATCH mode, keep it omitted to avoid accidental mass deletion.
    if (preserveUnsetFields) {
      prepared.tags = existingSettings.tags;
    }
  } else {
    // Process tag deletions
    processTagDeletions(oldTags, newSettings.tags);
    prepared.tags = newSettings.tags;
  }

  // Preserve CloudFlare settings if not explicitly provided
  if (preserveUnsetFields && !hasField("cloudflaredTunnelEnabled")) {
    prepared.cloudflaredTunnelEnabled =
      existingSettings.cloudflaredTunnelEnabled;
  }
  if (preserveUnsetFields && !hasField("cloudflaredToken")) {
    prepared.cloudflaredToken = existingSettings.cloudflaredToken;
  }
  if (preserveUnsetFields && !hasField("allowedHosts")) {
    prepared.allowedHosts = existingSettings.allowedHosts;
  }

  return prepared;
}
