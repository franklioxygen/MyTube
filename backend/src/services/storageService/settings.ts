import { db } from "../../db";
import { settings } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";

export function getSettings(): Record<string, any> {
  try {
    const allSettings = db.select().from(settings).all();
    const settingsMap: Record<string, any> = {};

    for (const setting of allSettings) {
      try {
        settingsMap[setting.key] = JSON.parse(setting.value);
      } catch (e) {
        settingsMap[setting.key] = setting.value;
      }
    }

    return settingsMap;
  } catch (error) {
    logger.error(
      "Error getting settings",
      error instanceof Error ? error : new Error(String(error))
    );
    // Return empty object for backward compatibility
    return {};
  }
}

// Whitelist of allowed settings keys to prevent mass assignment
const WHITELISTED_SETTINGS = [
  "loginEnabled",
  "password",
  "passwordLoginAllowed",
  "allowResetPassword",
  "defaultAutoPlay",
  "defaultAutoLoop",
  "maxConcurrentDownloads",
  "dontSkipDeletedVideo",
  "language",
  "tags",
  "cloudDriveEnabled",
  "openListApiUrl",
  "openListToken",
  "openListPublicUrl",
  "cloudDrivePath",
  "cloudDriveScanPaths",
  "homeSidebarOpen",
  "subtitlesEnabled",
  "websiteName",
  "itemsPerPage",
  "ytDlpConfig",
  "showYoutubeSearch",
  "proxyOnlyYoutube",
  "moveSubtitlesToVideoFolder",
  "moveThumbnailsToVideoFolder",
  "saveAuthorFilesToCollection",
  "visitorPassword",
  "visitorUserEnabled",
  "infiniteScroll",
  "videoColumns",
  "cloudflaredTunnelEnabled",
  "cloudflaredToken",
  "allowedHosts",
  "pauseOnFocusLoss",
  "playSoundOnTaskComplete",
  "mountDirectories",
  "defaultSort",
  "preferredAudioLanguage",
  "authorTags",
  "collectionTags",
  "showTagsOnThumbnail",
  "playFromBeginning",
  "theme",
];

export function saveSettings(newSettings: Record<string, any>): void {
  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(newSettings)) {
        // Skip undefined values - they should not be saved
        if (value === undefined) {
          continue;
        }

        // Whitelist validation: only allow known settings keys
        if (!WHITELISTED_SETTINGS.includes(key)) {
          // Silently ignore unknown keys
          continue;
        }

        const stringifiedValue = JSON.stringify(value);
        db.insert(settings)
          .values({
            key,
            value: stringifiedValue,
          })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: stringifiedValue },
          })
          .run();
      }
    });
  } catch (error) {
    logger.error(
      "Error saving settings",
      error instanceof Error ? error : new Error(String(error))
    );
    throw new DatabaseError(
      "Failed to save settings",
      error instanceof Error ? error : new Error(String(error)),
      "saveSettings"
    );
  }
}
