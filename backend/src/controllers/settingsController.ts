import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import {
    COLLECTIONS_DATA_PATH,
    STATUS_DATA_PATH,
    VIDEOS_DATA_PATH,
} from "../config/paths";
import { cloudflaredService } from "../services/cloudflaredService";
import downloadManager from "../services/downloadManager";
import * as passwordService from "../services/passwordService";
import * as settingsValidationService from "../services/settingsValidationService";
import * as storageService from "../services/storageService";
import { Settings, defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";

/**
 * Get application settings
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns data directly for backward compatibility with frontend
 */
export const getSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  const settings = storageService.getSettings();

  // If empty (first run), save defaults
  if (Object.keys(settings).length === 0) {
    storageService.saveSettings(defaultSettings);
    // Return data directly for backward compatibility
    res.json(defaultSettings);
    return;
  }

  // Merge with defaults to ensure all fields exist
  const mergedSettings = { ...defaultSettings, ...settings };

  // Do not send the hashed password to the frontend
  const { password, visitorPassword, ...safeSettings } = mergedSettings;
  // Return data directly for backward compatibility
  res.json({
    ...safeSettings,
    isPasswordSet: !!password,
    isVisitorPasswordSet: !!visitorPassword,
    authenticatedRole: req.user?.role ?? null,
  });
};

/**
 * Run data migration
 * Errors are automatically handled by asyncHandler middleware
 */
export const migrateData = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { runMigration } = await import("../services/migrationService");
  const results = await runMigration();
  // Return format expected by frontend: { results: {...} }
  res.json({ results });
};

/**
 * Delete legacy data files
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteLegacyData = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const SETTINGS_DATA_PATH = path.join(
    path.dirname(VIDEOS_DATA_PATH),
    "settings.json"
  );
  const filesToDelete = [
    VIDEOS_DATA_PATH,
    COLLECTIONS_DATA_PATH,
    STATUS_DATA_PATH,
    SETTINGS_DATA_PATH,
  ];

  const results: { deleted: string[]; failed: string[] } = {
    deleted: [],
    failed: [],
  };

  for (const file of filesToDelete) {
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    if (fs.existsSync(file)) {
      try {
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        fs.unlinkSync(file);
        results.deleted.push(path.basename(file));
      } catch (err) {
        logger.error(`Failed to delete ${file}:`, err);
        results.failed.push(path.basename(file));
      }
    }
  }

  // Return format expected by frontend: { results: { deleted: [], failed: [] } }
  res.json({ results });
};

/**
 * Format legacy filenames
 * Errors are automatically handled by asyncHandler middleware
 */
export const formatFilenames = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const results = storageService.formatLegacyFilenames();
  // Return format expected by frontend: { results: {...} }
  res.json({ results });
};

/**
 * Handle settings updates
 * Errors are automatically handled by asyncHandler middleware
 */
type SettingsUpdateMode = "replace" | "patch";

const hasOwnSetting = (
  settings: Partial<Settings>,
  key: keyof Settings
): boolean => Object.prototype.hasOwnProperty.call(settings, key);

const sanitizeIncomingSettings = (
  incomingSettings: Partial<Settings>
): Partial<Settings> => {
  const sanitized: Partial<Settings> = { ...incomingSettings };
  delete sanitized.password;
  delete sanitized.visitorPassword;
  return sanitized;
};

const removeUndefinedSettings = (settings: Partial<Settings>): void => {
  Object.keys(settings).forEach((key) => {
    const settingKey = key as keyof Settings;
    if (settings[settingKey] === undefined) {
      delete settings[settingKey];
    }
  });
};

const getDeletedTags = (oldTags: string[], newTags: string[]): string[] =>
  oldTags.filter((old) => !newTags.some((n) => n.toLowerCase() === old.toLowerCase()));

const getRenamedTagPairs = (
  oldTags: string[],
  newTags: string[]
): [string, string][] => {
  const renamedPairs: [string, string][] = [];
  for (const oldTag of oldTags) {
    const newTag = newTags.find((n) => n.toLowerCase() === oldTag.toLowerCase());
    if (newTag !== undefined && newTag !== oldTag) {
      renamedPairs.push([oldTag, newTag]);
    }
  }
  return renamedPairs;
};

const applyTagMutations = (
  renamedPairs: [string, string][],
  deletedTags: string[]
): void => {
  import("../services/tagService")
    .then(({ deleteTagsFromVideos, renameTag: renameTagFn }) => {
      for (const [oldTag, newTag] of renamedPairs) {
        renameTagFn(oldTag, newTag);
      }
      if (deletedTags.length > 0) {
        deleteTagsFromVideos(deletedTags);
      }
    })
    .catch((err) => {
      logger.error("Error processing tag deletions/renames:", err);
    });
};

const processTagChanges = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): void => {
  if (
    !hasOwnSetting(settingsToPersist, "tags") ||
    !Array.isArray(settingsToPersist.tags)
  ) {
    return;
  }

  const oldTags = Array.isArray(existingSettings.tags)
    ? (existingSettings.tags as string[])
    : [];
  const newTags = settingsToPersist.tags as string[];
  const deletedTags = getDeletedTags(oldTags, newTags);
  const renamedPairs = getRenamedTagPairs(oldTags, newTags);

  if (deletedTags.length === 0 && renamedPairs.length === 0) {
    return;
  }

  applyTagMutations(renamedPairs, deletedTags);
};

const moveSubtitlesIfSettingChanged = async (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): Promise<void> => {
  if (
    !hasOwnSetting(settingsToPersist, "moveSubtitlesToVideoFolder") ||
    settingsToPersist.moveSubtitlesToVideoFolder ===
      existingSettings.moveSubtitlesToVideoFolder ||
    settingsToPersist.moveSubtitlesToVideoFolder === undefined
  ) {
    return;
  }

  const { moveAllSubtitles } = await import("../services/subtitleService");
  moveAllSubtitles(settingsToPersist.moveSubtitlesToVideoFolder).catch((err) =>
    logger.error("Error moving subtitles in background:", err)
  );
};

const moveThumbnailsIfSettingChanged = async (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): Promise<void> => {
  if (
    !hasOwnSetting(settingsToPersist, "moveThumbnailsToVideoFolder") ||
    settingsToPersist.moveThumbnailsToVideoFolder ===
      existingSettings.moveThumbnailsToVideoFolder ||
    settingsToPersist.moveThumbnailsToVideoFolder === undefined
  ) {
    return;
  }

  const { moveAllThumbnails } = await import("../services/thumbnailService");
  moveAllThumbnails(settingsToPersist.moveThumbnailsToVideoFolder).catch(
    (err) => logger.error("Error moving thumbnails in background:", err)
  );
};

const didCloudflaredEnabledChange = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): boolean => {
  if (!hasOwnSetting(settingsToPersist, "cloudflaredTunnelEnabled")) {
    return false;
  }
  return (
    settingsToPersist.cloudflaredTunnelEnabled !==
    existingSettings.cloudflaredTunnelEnabled
  );
};

const didCloudflaredTokenChange = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>
): boolean => {
  if (!hasOwnSetting(settingsToPersist, "cloudflaredToken")) {
    return false;
  }
  return settingsToPersist.cloudflaredToken !== existingSettings.cloudflaredToken;
};

const getCloudflaredPort = (): number =>
  process.env.PORT ? parseInt(process.env.PORT) : 5551;

const restartCloudflared = (settings: Settings, port: number): void => {
  if (settings.cloudflaredToken) {
    cloudflaredService.restart(settings.cloudflaredToken);
    return;
  }
  cloudflaredService.restart(undefined, port);
};

const startCloudflared = (settings: Settings, port: number): void => {
  if (settings.cloudflaredToken) {
    cloudflaredService.start(settings.cloudflaredToken);
    return;
  }
  cloudflaredService.start(undefined, port);
};

const applyCloudflaredSettingChanges = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>,
  finalSettings: Settings
): void => {
  const cloudflaredEnabledChanged = didCloudflaredEnabledChange(
    existingSettings,
    settingsToPersist
  );
  const cloudflaredTokenChanged = didCloudflaredTokenChange(
    existingSettings,
    settingsToPersist
  );

  if (!cloudflaredEnabledChanged && !cloudflaredTokenChanged) {
    return;
  }

  if (!finalSettings.cloudflaredTunnelEnabled) {
    if (cloudflaredEnabledChanged) {
      cloudflaredService.stop();
    }
    return;
  }

  const port = getCloudflaredPort();
  if (existingSettings.cloudflaredTunnelEnabled) {
    restartCloudflared(finalSettings, port);
    return;
  }

  startCloudflared(finalSettings, port);
};

const persistAllowedHostsEnv = (
  existingSettings: Settings,
  settingsToPersist: Partial<Settings>,
  finalSettings: Settings
): void => {
  const allowedHostsChanged =
    hasOwnSetting(settingsToPersist, "allowedHosts") &&
    settingsToPersist.allowedHosts !== existingSettings.allowedHosts;

  if (!allowedHostsChanged) {
    return;
  }

  try {
    const basePath = path.resolve(__dirname, "../../../frontend");
    const envLocalPath = path.normalize(path.join(basePath, ".env.local"));

    if (!envLocalPath.startsWith(path.resolve(basePath))) {
      throw new Error("Invalid path: path traversal detected");
    }

    const sanitizedHosts = (finalSettings.allowedHosts || "")
      .replace(/[\r\n]/g, "")
      .replace(/[^\w\s.,-]/g, "");

    const envContent = `# Auto-generated by MyTube settings\n# Restart dev server for changes to take effect\nVITE_ALLOWED_HOSTS=${sanitizedHosts}\n`;
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    fs.writeFileSync(envLocalPath, envContent, "utf8");
    logger.info(`Updated VITE_ALLOWED_HOSTS in .env.local: ${sanitizedHosts}`);
  } catch (error) {
    logger.warn(
      "Failed to write allowedHosts to .env.local:",
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

const applyRuntimeSettingChanges = (
  settingsToPersist: Partial<Settings>,
  finalSettings: Settings
): void => {
  if (
    hasOwnSetting(settingsToPersist, "maxConcurrentDownloads") &&
    finalSettings.maxConcurrentDownloads !== undefined
  ) {
    downloadManager.setMaxConcurrentDownloads(
      finalSettings.maxConcurrentDownloads
    );
  }
};

const persistSettingsUpdate = async (
  req: Request,
  res: Response,
  mode: SettingsUpdateMode
): Promise<void> => {
  const incomingSettings: Partial<Settings> = { ...(req.body || {}) };
  const existingSettingsRaw = storageService.getSettings();
  const existingSettings = settingsValidationService.mergeSettings(
    existingSettingsRaw,
    {}
  );

  // Permission control is handled by roleBasedSettingsMiddleware
  settingsValidationService.validateSettings(incomingSettings);

  const preparedSettings = await settingsValidationService.prepareSettingsForSave(
    existingSettings,
    incomingSettings,
    passwordService.hashPassword,
    { preserveUnsetFields: mode === "replace" }
  );

  const sanitizedIncoming = sanitizeIncomingSettings(incomingSettings);

  const settingsToPersist: Partial<Settings> =
    mode === "replace"
      ? ({
          ...existingSettings,
          ...sanitizedIncoming,
          ...preparedSettings,
        } as Settings)
      : {
          ...sanitizedIncoming,
          ...preparedSettings,
        };

  removeUndefinedSettings(settingsToPersist);

  storageService.saveSettings(settingsToPersist as Record<string, unknown>);

  const finalSettings =
    mode === "replace"
      ? (settingsToPersist as Settings)
      : ({ ...existingSettings, ...settingsToPersist } as Settings);

  processTagChanges(existingSettings, settingsToPersist);
  await moveSubtitlesIfSettingChanged(existingSettings, settingsToPersist);
  await moveThumbnailsIfSettingChanged(existingSettings, settingsToPersist);
  applyCloudflaredSettingChanges(
    existingSettings,
    settingsToPersist,
    finalSettings
  );
  persistAllowedHostsEnv(existingSettings, settingsToPersist, finalSettings);
  applyRuntimeSettingChanges(settingsToPersist, finalSettings);

  res.json({
    success: true,
    settings: {
      ...finalSettings,
      password: undefined,
      visitorPassword: undefined,
    },
  });
};

/**
 * Update application settings (legacy full-update semantics)
 */
export const updateSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  await persistSettingsUpdate(req, res, "replace");
};

/**
 * Patch application settings (field-level update semantics)
 */
export const patchSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  await persistSettingsUpdate(req, res, "patch");
};

/**
 * Get Cloudflare Tunnel status
 * Errors are automatically handled by asyncHandler middleware
 */
export const getCloudflaredStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const status = cloudflaredService.getStatus();
  res.json(status);
};

/**
 * Rename a tag
 * Errors are automatically handled by asyncHandler middleware
 */
export const renameTag = async (req: Request, res: Response): Promise<void> => {
  const oldTag = typeof req.body?.oldTag === "string" ? req.body.oldTag.trim() : "";
  const newTag = typeof req.body?.newTag === "string" ? req.body.newTag.trim() : "";

  if (!oldTag || !newTag) {
    res.status(400).json({ error: "oldTag and newTag are required" });
    return;
  }

  if (oldTag === newTag) {
    res.status(400).json({ error: "oldTag and newTag cannot be the same" });
    return;
  }

  // Case-insensitive collision: newTag must not match another existing tag (other than oldTag)
  const existingSettings = storageService.getSettings();
  const existingTags = (existingSettings.tags as string[]) || [];
  const newTagLower = newTag.toLowerCase();
  const collision = existingTags.find(
    (t) => t.toLowerCase() === newTagLower && t !== oldTag
  );
  if (collision !== undefined) {
    res.status(400).json({
      error: `Tag "${newTag}" conflicts with existing tag "${collision}" (tags are case-insensitive).`,
    });
    return;
  }

  const { renameTag } = await import("../services/tagService");
  const result = renameTag(oldTag, newTag);

  res.json({ success: true, result });
};

export const testTelegramNotification = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { botToken, chatId } = req.body;
  if (!botToken || !chatId) {
    res.status(400).json({ error: "botToken and chatId are required" });
    return;
  }

  const { TelegramService } = await import("../services/telegramService");
  const result = await TelegramService.sendTestMessage(botToken, chatId);
  if (result.ok) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
};
