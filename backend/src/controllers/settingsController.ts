import { Request, Response } from "express";
import path from "path";
import {
    COLLECTIONS_DATA_PATH,
    STATUS_DATA_PATH,
    VIDEOS_DATA_PATH,
} from "../config/paths";
import { cloudflaredService } from "../services/cloudflaredService";
import * as storageService from "../services/storageService";
import { testTMDBCredential as testTMDBCredentialService } from "../services/tmdbService";
import { defaultSettings } from "../types/settings";
import { logger } from "../utils/logger";
import { errorResponse, sendBadRequest } from "../utils/response";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "../utils/security";
import {
  buildSafeSettingsPayload,
  PersistedSettingsResponse,
} from "./settings/settingsResponse";

export { updateSettings, patchSettings } from "./settings/updateController";

/**
 * Get application settings
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns data directly for backward compatibility with frontend
 */
export const getSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  let settings = storageService.getSettings();

  if (Object.keys(settings).length === 0) {
    storageService.saveSettings(defaultSettings);
    settings = defaultSettings;
  }

  // Merge with defaults to ensure all fields exist
  const mergedSettings = { ...defaultSettings, ...settings };

  // Return data directly for backward compatibility
  res.json({
    ...buildSafeSettingsPayload(req, mergedSettings as PersistedSettingsResponse),
    isPasswordSet: !!mergedSettings.password,
    isVisitorPasswordSet: !!mergedSettings.visitorPassword,
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
  const legacyDataDir = path.dirname(VIDEOS_DATA_PATH);
  const SETTINGS_DATA_PATH = resolveSafeChildPath(legacyDataDir, "settings.json");
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
    if (pathExistsSafeSync(file, legacyDataDir)) {
      try {
        unlinkSafeSync(file, legacyDataDir);
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
    sendBadRequest(res, "oldTag and newTag are required");
    return;
  }

  if (oldTag === newTag) {
    sendBadRequest(res, "oldTag and newTag cannot be the same");
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
    res.status(400).json(
      errorResponse(
        `Tag "${newTag}" conflicts with existing tag "${collision}" (tags are case-insensitive).`
      )
    );
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
    sendBadRequest(res, "botToken and chatId are required");
    return;
  }

  const { TelegramService } = await import("../services/telegramService");
  const result = await TelegramService.sendTestMessage(botToken, chatId);
  if (result.ok) {
    res.json({ success: true });
  } else {
    sendBadRequest(res, result.error || "Failed to send Telegram test notification");
  }
};

export const testTMDBCredential = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tmdbApiKey =
    typeof req.body?.tmdbApiKey === "string" ? req.body.tmdbApiKey.trim() : "";

  if (!tmdbApiKey) {
    res.status(400).json(
      errorResponse("tmdbApiKey is required", {
        errorKey: "tmdbCredentialMissing",
      })
    );
    return;
  }

  const result = await testTMDBCredentialService(tmdbApiKey);

  if (!result.success) {
    if (result.code === "auth-failed") {
      res.status(400).json(
        errorResponse(result.error, {
          errorKey: result.messageKey,
        })
      );
      return;
    }

    res.status(502).json(
      errorResponse(result.error, {
        errorKey: result.messageKey,
      })
    );
    return;
  }

  res.json(result);
};
