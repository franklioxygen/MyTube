import { db } from "../../db";
import { settings } from "../../db/schema";
import { DatabaseError } from "../../errors/DownloadErrors";
import { logger } from "../../utils/logger";

const SETTINGS_CACHE_TTL_MS = 30 * 1000;
const SHOULD_USE_SETTINGS_CACHE =
  process.env.NODE_ENV !== "test" && process.env.VITEST !== "true";

let settingsCache: Record<string, any> | null = null;
let settingsCacheUpdatedAt = 0;

function cloneSettingsMap(source: Record<string, any>): Record<string, any> {
  try {
    return structuredClone(source);
  } catch {
    return { ...source };
  }
}

function isSettingsCacheFresh(now: number): boolean {
  return (
    SHOULD_USE_SETTINGS_CACHE &&
    settingsCache !== null &&
    now - settingsCacheUpdatedAt < SETTINGS_CACHE_TTL_MS
  );
}

export function invalidateSettingsCache(): void {
  settingsCache = null;
  settingsCacheUpdatedAt = 0;
}

export function getSettings(): Record<string, any> {
  const now = Date.now();
  if (isSettingsCacheFresh(now) && settingsCache) {
    return cloneSettingsMap(settingsCache);
  }

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

    if (SHOULD_USE_SETTINGS_CACHE) {
      settingsCache = settingsMap;
      settingsCacheUpdatedAt = now;
    }

    return cloneSettingsMap(settingsMap);
  } catch (error) {
    logger.error(
      "Error getting settings",
      error instanceof Error ? error : new Error(String(error))
    );
    // Return stale cache as a fallback if available
    if (settingsCache) {
      return cloneSettingsMap(settingsCache);
    }
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
  "showThemeButton",
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
    invalidateSettingsCache();
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
