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
  _req: Request,
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
    if (fs.existsSync(file)) {
      try {
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

  // Never persist plaintext password fields from request body.
  const sanitizedIncoming: Partial<Settings> = { ...incomingSettings };
  delete sanitizedIncoming.password;
  delete sanitizedIncoming.visitorPassword;

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

  // Avoid writing undefined values (saveSettings skips them, but keep payload clean).
  Object.keys(settingsToPersist).forEach((key) => {
    const settingKey = key as keyof Settings;
    if (settingsToPersist[settingKey] === undefined) {
      delete settingsToPersist[settingKey];
    }
  });

  storageService.saveSettings(settingsToPersist as Record<string, unknown>);

  const finalSettings =
    mode === "replace"
      ? (settingsToPersist as Settings)
      : ({ ...existingSettings, ...settingsToPersist } as Settings);

  // Check for deleted tags and renames (casing-only changes); remove deleted from videos, rename casing in videos
  if (
    hasOwnSetting(settingsToPersist, "tags") &&
    Array.isArray(settingsToPersist.tags)
  ) {
    const oldTags = Array.isArray(existingSettings.tags)
      ? (existingSettings.tags as string[])
      : [];
    const newTags = settingsToPersist.tags as string[];

    // Deleted = in old but no case-insensitive match in new
    const deletedTags = oldTags.filter(
      (old) => !newTags.some((n) => n.toLowerCase() === old.toLowerCase())
    );
    // Renamed (casing only) = in old, has case-insensitive match in new, but different string
    const renamedPairs: [string, string][] = [];
    for (const old of oldTags) {
      const newTag = newTags.find((n) => n.toLowerCase() === old.toLowerCase());
      if (newTag !== undefined && newTag !== old) {
        renamedPairs.push([old, newTag]);
      }
    }

    if (deletedTags.length > 0 || renamedPairs.length > 0) {
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
    }
  }

  // Check for moveSubtitlesToVideoFolder change
  if (
    hasOwnSetting(settingsToPersist, "moveSubtitlesToVideoFolder") &&
    settingsToPersist.moveSubtitlesToVideoFolder !==
      existingSettings.moveSubtitlesToVideoFolder &&
    settingsToPersist.moveSubtitlesToVideoFolder !== undefined
  ) {
    // Run asynchronously
    const { moveAllSubtitles } = await import("../services/subtitleService");
    moveAllSubtitles(settingsToPersist.moveSubtitlesToVideoFolder).catch(
      (err) => logger.error("Error moving subtitles in background:", err)
    );
  }

  // Check for moveThumbnailsToVideoFolder change
  if (
    hasOwnSetting(settingsToPersist, "moveThumbnailsToVideoFolder") &&
    settingsToPersist.moveThumbnailsToVideoFolder !==
      existingSettings.moveThumbnailsToVideoFolder &&
    settingsToPersist.moveThumbnailsToVideoFolder !== undefined
  ) {
    // Run asynchronously
    const { moveAllThumbnails } = await import("../services/thumbnailService");
    moveAllThumbnails(settingsToPersist.moveThumbnailsToVideoFolder).catch(
      (err) => logger.error("Error moving thumbnails in background:", err)
    );
  }

  // Handle Cloudflare Tunnel settings changes
  const cloudflaredEnabledChanged =
    hasOwnSetting(settingsToPersist, "cloudflaredTunnelEnabled") &&
    settingsToPersist.cloudflaredTunnelEnabled !==
      existingSettings.cloudflaredTunnelEnabled;
  const cloudflaredTokenChanged =
    hasOwnSetting(settingsToPersist, "cloudflaredToken") &&
    settingsToPersist.cloudflaredToken !== existingSettings.cloudflaredToken;

  if (cloudflaredEnabledChanged || cloudflaredTokenChanged) {
    // If we are enabling it (or it was enabled and config changed)
    if (finalSettings.cloudflaredTunnelEnabled) {
      // Determine port
      const port = process.env.PORT ? parseInt(process.env.PORT) : 5551;

      const shouldRestart = existingSettings.cloudflaredTunnelEnabled;

      if (shouldRestart) {
        // If it was already enabled, restart to apply changes (token/no-token swap)
        if (finalSettings.cloudflaredToken) {
          cloudflaredService.restart(finalSettings.cloudflaredToken);
        } else {
          cloudflaredService.restart(undefined, port);
        }
      } else {
        // It was disabled, now enabling -> start
        if (finalSettings.cloudflaredToken) {
          cloudflaredService.start(finalSettings.cloudflaredToken);
        } else {
          cloudflaredService.start(undefined, port);
        }
      }
    } else if (cloudflaredEnabledChanged) {
      // Only stop if explicitly disabled
      cloudflaredService.stop();
    }
  }

  // Handle allowedHosts changes - write to .env.local for Vite
  const allowedHostsChanged =
    hasOwnSetting(settingsToPersist, "allowedHosts") &&
    settingsToPersist.allowedHosts !== existingSettings.allowedHosts;

  if (allowedHostsChanged) {
    try {
      // Write to frontend/.env.local so Vite can read it
      const basePath = path.resolve(__dirname, "../../../frontend");
      const envLocalPath = path.normalize(path.join(basePath, ".env.local"));

      // Validate path is within expected directory to prevent path traversal
      if (!envLocalPath.startsWith(path.resolve(basePath))) {
        throw new Error("Invalid path: path traversal detected");
      }

      // Sanitize allowedHosts to prevent injection (remove newlines and dangerous chars)
      const sanitizedHosts = (finalSettings.allowedHosts || "")
        .replace(/[\r\n]/g, "")
        .replace(/[^\w\s.,-]/g, "");

      const envContent = `# Auto-generated by MyTube settings\n# Restart dev server for changes to take effect\nVITE_ALLOWED_HOSTS=${sanitizedHosts}\n`;
      fs.writeFileSync(envLocalPath, envContent, "utf8");
      logger.info(
        `Updated VITE_ALLOWED_HOSTS in .env.local: ${sanitizedHosts}`
      );
    } catch (error) {
      // Non-blocking - log error but don't fail the request
      logger.warn(
        "Failed to write allowedHosts to .env.local:",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Apply settings immediately where possible
  if (
    hasOwnSetting(settingsToPersist, "maxConcurrentDownloads") &&
    finalSettings.maxConcurrentDownloads !== undefined
  ) {
    downloadManager.setMaxConcurrentDownloads(
      finalSettings.maxConcurrentDownloads
    );
  }

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
  const { oldTag, newTag } = req.body;

  if (!oldTag || !newTag) {
    res.status(400).json({ error: "oldTag and newTag are required" });
    return;
  }

  // Validate that tags are strings and not empty after trimming
  const trimmedOldTag = typeof oldTag === "string" ? oldTag.trim() : "";
  const trimmedNewTag = typeof newTag === "string" ? newTag.trim() : "";

  if (!trimmedOldTag || !trimmedNewTag) {
    res.status(400).json({ error: "oldTag and newTag cannot be empty" });
    return;
  }

  if (trimmedOldTag === trimmedNewTag) {
    res.status(400).json({ error: "oldTag and newTag cannot be the same" });
    return;
  }

  // Case-insensitive collision: newTag must not match another existing tag (other than oldTag)
  const existingSettings = storageService.getSettings();
  const existingTags = (existingSettings.tags as string[]) || [];
  const newTagLower = trimmedNewTag.toLowerCase();
  const collision = existingTags.find(
    (t) => t.toLowerCase() === newTagLower && t !== trimmedOldTag
  );
  if (collision !== undefined) {
    res.status(400).json({
      error: `Tag "${trimmedNewTag}" conflicts with existing tag "${collision}" (tags are case-insensitive).`,
    });
    return;
  }

  const { renameTag } = await import("../services/tagService");
  const result = renameTag(trimmedOldTag, trimmedNewTag);

  res.json({ success: true, result });
};
