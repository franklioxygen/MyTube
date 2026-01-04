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
  res.json({ ...safeSettings, isPasswordSet: !!password, isVisitorPasswordSet: !!visitorPassword });
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
 * Update application settings
 * Errors are automatically handled by asyncHandler middleware
 */
export const updateSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  const newSettings: Partial<Settings> = req.body;
  const existingSettings = storageService.getSettings();
  const mergedSettings = settingsValidationService.mergeSettings(
    existingSettings,
    {}
  );

  // Check visitor mode restrictions (if not admin)
  // If user is admin (jwt authenticated), they bypass visitor mode restrictions
  const isAdmin = req.user?.role === "admin";
  
  if (!isAdmin) {
    const visitorModeCheck =
      settingsValidationService.checkVisitorModeRestrictions(
        mergedSettings,
        newSettings
      );

    if (!visitorModeCheck.allowed) {
      res.status(403).json({
        success: false,
        error: visitorModeCheck.error,
      });
      return;
    }
    
    // Handle special case: visitorMode being set to true (already enabled)
    // Only applies if NOT admin (admins can update settings while in visitor mode)
    if (mergedSettings.visitorMode === true && newSettings.visitorMode === true) {
      // Only update visitorMode, ignore other changes
      const allowedSettings: Settings = {
        ...mergedSettings,
        visitorMode: true,
      };
      storageService.saveSettings(allowedSettings);
      res.json({
        success: true,
        settings: { ...allowedSettings, password: undefined, visitorPassword: undefined },
      });
      return;
    }
  }



  // Validate settings
  settingsValidationService.validateSettings(newSettings);

  // Prepare settings for saving (password hashing, tags, etc.)
  const preparedSettings =
    await settingsValidationService.prepareSettingsForSave(
      mergedSettings,
      newSettings,
      passwordService.hashPassword
    );

  // Merge prepared settings with new settings
  const finalSettings = {
    ...mergedSettings,
    ...newSettings,
    ...preparedSettings,
  };

  storageService.saveSettings(finalSettings);

  // Check for moveSubtitlesToVideoFolder change
  if (
    newSettings.moveSubtitlesToVideoFolder !==
    existingSettings.moveSubtitlesToVideoFolder
  ) {
    if (newSettings.moveSubtitlesToVideoFolder !== undefined) {
      // Run asynchronously
      const { moveAllSubtitles } = await import("../services/subtitleService");
      moveAllSubtitles(newSettings.moveSubtitlesToVideoFolder).catch((err) =>
        logger.error("Error moving subtitles in background:", err)
      );
    }
  }

  // Check for moveThumbnailsToVideoFolder change
  if (
    newSettings.moveThumbnailsToVideoFolder !==
    existingSettings.moveThumbnailsToVideoFolder
  ) {
    if (newSettings.moveThumbnailsToVideoFolder !== undefined) {
      // Run asynchronously
      const { moveAllThumbnails } = await import(
        "../services/thumbnailService"
      );
      moveAllThumbnails(newSettings.moveThumbnailsToVideoFolder).catch((err) =>
        logger.error("Error moving thumbnails in background:", err)
      );
    }
  }

  // Handle Cloudflare Tunnel settings changes
  // Only process changes if the values were explicitly provided (not undefined)
  const cloudflaredEnabledChanged =
    newSettings.cloudflaredTunnelEnabled !== undefined &&
    newSettings.cloudflaredTunnelEnabled !==
      existingSettings.cloudflaredTunnelEnabled;
  const cloudflaredTokenChanged =
    newSettings.cloudflaredToken !== undefined &&
    newSettings.cloudflaredToken !== existingSettings.cloudflaredToken;

  if (cloudflaredEnabledChanged || cloudflaredTokenChanged) {
    // If we are enabling it (or it was enabled and config changed)
    if (newSettings.cloudflaredTunnelEnabled) {
      // Determine port
      const port = process.env.PORT ? parseInt(process.env.PORT) : 5551;

      const shouldRestart = existingSettings.cloudflaredTunnelEnabled;

      if (shouldRestart) {
        // If it was already enabled, we need to restart to apply changes (Token -> No Token, or vice versa)
        if (newSettings.cloudflaredToken) {
          cloudflaredService.restart(newSettings.cloudflaredToken);
        } else {
          cloudflaredService.restart(undefined, port);
        }
      } else {
        // It was disabled, now enabling -> just start
        if (newSettings.cloudflaredToken) {
          cloudflaredService.start(newSettings.cloudflaredToken);
        } else {
          cloudflaredService.start(undefined, port);
        }
      }
    } else if (cloudflaredEnabledChanged) {
      // Only stop if explicitly disabled (not if it was undefined)
      cloudflaredService.stop();
    }
  }

  // Apply settings immediately where possible
  if (finalSettings.maxConcurrentDownloads !== undefined) {
    downloadManager.setMaxConcurrentDownloads(
      finalSettings.maxConcurrentDownloads
    );
  }

  // Return format expected by frontend: { success: true, settings: {...} }
  res.json({
    success: true,
    settings: { ...finalSettings, password: undefined, visitorPassword: undefined },
  });
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
