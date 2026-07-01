import { Request, Response } from "express";
import crypto from "crypto";
import path from "path";
import {
  COLLECTIONS_DATA_PATH,
  STATUS_DATA_PATH,
  VIDEOS_DATA_PATH,
} from "../config/paths";
import { cloudflaredService } from "../services/cloudflaredService";
import { normalizeFilenameNamingSettings } from "../services/filenameTemplate/config";
import * as passwordService from "../services/passwordService";
import * as settingsValidationService from "../services/settingsValidationService";
import {
  clearAllStatisticsData,
  ensureFrozenTimezoneOnEnable,
  invalidateStatisticsSettingsCache,
} from "../services/statistics";
import * as storageService from "../services/storageService";
import { testTMDBCredential as testTMDBCredentialService } from "../services/tmdbService";
import { twitchApiService } from "../services/twitchService";
import { applyCloudflaredSettingChanges } from "./settingsController/cloudflaredEffects";
import {
  moveSubtitlesIfSettingChanged,
  moveThumbnailsIfSettingChanged,
  persistAllowedHostsEnv,
  applyRuntimeSettingChanges,
} from "./settingsController/fileMoveEffects";
import { isSecurePasskeySettingsRequest } from "./settingsController/requestSecurity";
import {
  buildSafeSettingsPayload,
  PersistedSettingsResponse,
} from "./settingsController/settingsResponse";
import { processTagChanges } from "./settingsController/tagMutations";
import { enforceTrustLevelForSettingsChanges } from "./settingsController/trustGating";
import {
  authorOrganizationModeToLegacySetting,
  isAuthorOrganizationMode,
  resolveAuthorOrganizationMode,
  Settings,
  defaultSettings,
} from "../types/settings";
import { logger } from "../utils/logger";
import { errorResponse, sendBadRequest } from "../utils/response";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "../utils/security";

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
 * Unlink redundant author collections from videos that already belong to
 * another collection, without moving files on disk.
 */
export const cleanupAuthorCollections = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const results = storageService.cleanupRedundantAuthorCollectionLinks();
  res.json({ results });
};

// ---- Update-flow helpers (update-path-local; not reused elsewhere) ----

type SettingsUpdateMode = "replace" | "patch";

const hasOwnSetting = (
  settings: Partial<Settings>,
  key: keyof Settings
): boolean => Object.prototype.hasOwnProperty.call(settings, key);

const sanitizeIncomingSettings = (
  incomingSettings: Partial<Settings>
): Partial<Settings> => {
  const sanitized: Partial<Settings> = { ...incomingSettings };

  if (typeof sanitized.tmdbApiKey === "string") {
    sanitized.tmdbApiKey = sanitized.tmdbApiKey.trim();
  }

  // This server-managed value is frozen on first enable and not writable through
  // the normal settings API afterward.
  delete sanitized.statisticsTimezone;
  delete sanitized.password;
  delete sanitized.visitorPassword;
  return sanitized;
};

const normalizeAuthorOrganizationSettings = (
  incomingSettings: Partial<Settings>
): Partial<Settings> => {
  const normalized: Partial<Settings> = { ...incomingSettings };

  if (
    Object.prototype.hasOwnProperty.call(normalized, "authorOrganizationMode") ||
    Object.prototype.hasOwnProperty.call(normalized, "saveAuthorFilesToCollection")
  ) {
    if (
      Object.prototype.hasOwnProperty.call(normalized, "authorOrganizationMode") &&
      !isAuthorOrganizationMode(normalized.authorOrganizationMode)
    ) {
      return normalized;
    }

    const mode = resolveAuthorOrganizationMode(normalized);
    normalized.authorOrganizationMode = mode;
    normalized.saveAuthorFilesToCollection =
      authorOrganizationModeToLegacySetting(mode);
  }

  return normalized;
};

const removeUndefinedSettings = (settings: Partial<Settings>): void => {
  Object.keys(settings).forEach((key) => {
    const settingKey = key as keyof Settings;
    if (settings[settingKey] === undefined) {
      delete settings[settingKey];
    }
  });
};

const isPasswordLoginDisableRequested = (
  existingSettings: Settings,
  incomingSettings: Partial<Settings>
): boolean =>
  hasOwnSetting(incomingSettings, "passwordLoginAllowed") &&
  incomingSettings.passwordLoginAllowed === false &&
  existingSettings.passwordLoginAllowed !== false;

const generateApiKey = (): string => crypto.randomBytes(32).toString("hex");

const ensureApiKeyWhenEnabled = (
  settingsToPersist: Partial<Settings>,
  finalSettings: Settings
): void => {
  if (finalSettings.apiKeyEnabled !== true) {
    return;
  }

  if (
    typeof finalSettings.apiKey === "string" &&
    finalSettings.apiKey.trim().length > 0
  ) {
    return;
  }

  const newApiKey = generateApiKey();
  settingsToPersist.apiKey = newApiKey;
  finalSettings.apiKey = newApiKey;
};

const applyStatisticsToggleSideEffects = (
  existingSettings: Settings,
  finalSettings: Settings
): void => {
  // Freeze statisticsTimezone on first enable, and purge data when disabling
  // and statisticsKeepDataWhenDisabled = false (per design §5.1).
  const wasEnabled = existingSettings.statisticsEnabled === true;
  const willBeEnabled = finalSettings.statisticsEnabled === true;

  if (!wasEnabled && willBeEnabled) {
    try {
      const timezone = ensureFrozenTimezoneOnEnable();
      finalSettings.statisticsTimezone = timezone;
    } catch (error) {
      logger.warn(
        "Failed to freeze statistics timezone on enable",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  if (wasEnabled && !willBeEnabled) {
    if (finalSettings.statisticsKeepDataWhenDisabled === false) {
      try {
        clearAllStatisticsData();
      } catch (error) {
        logger.warn(
          "Failed to purge statistics data on disable",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }
};

/**
 * Core settings-update orchestrator shared by update/patch.
 */
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
  const trustedIncomingSettings = enforceTrustLevelForSettingsChanges(
    res,
    existingSettings,
    incomingSettings
  );

  if (trustedIncomingSettings === null) {
    return;
  }

  if (
    isPasswordLoginDisableRequested(existingSettings, trustedIncomingSettings) &&
    !isSecurePasskeySettingsRequest(req)
  ) {
    sendBadRequest(
      res,
      "Disabling password login requires HTTPS or localhost because passkey-only login needs a secure origin."
    );
    return;
  }

  const normalizedIncomingSettings =
    normalizeFilenameNamingSettings(
      existingSettings,
      normalizeAuthorOrganizationSettings(trustedIncomingSettings)
    );

  settingsValidationService.validateSettings(normalizedIncomingSettings);

  const preparedSettings = await settingsValidationService.prepareSettingsForSave(
    existingSettings,
    normalizedIncomingSettings,
    passwordService.hashPassword,
    { preserveUnsetFields: mode === "replace" }
  );

  const sanitizedIncoming = sanitizeIncomingSettings(normalizedIncomingSettings);

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
  delete settingsToPersist.downloadFilenamePresetId;

  const finalSettings =
    mode === "replace"
      ? (settingsToPersist as Settings)
      : ({ ...existingSettings, ...settingsToPersist } as Settings);

  // Cross-field live translation validation against merged final settings. Must
  // run before saveSettings and before any enable side effects so an invalid
  // enable request rejects without partially persisting.
  settingsValidationService.validateLiveTranslationFinalSettings(finalSettings);

  ensureApiKeyWhenEnabled(settingsToPersist, finalSettings);
  applyStatisticsToggleSideEffects(existingSettings, finalSettings);
  storageService.saveSettings(settingsToPersist as Record<string, unknown>);
  if (
    Object.prototype.hasOwnProperty.call(
      normalizedIncomingSettings,
      "downloadFilenameMode"
    ) ||
    Object.prototype.hasOwnProperty.call(
      trustedIncomingSettings,
      "downloadFilenamePresetId"
    )
  ) {
    storageService.deleteSettingsKeys(["downloadFilenamePresetId"]);
  }
  invalidateStatisticsSettingsCache();
  if (
    settingsToPersist.twitchClientId !== undefined ||
    settingsToPersist.twitchClientSecret !== undefined
  ) {
    twitchApiService.invalidateCache();
  }

  processTagChanges(existingSettings, settingsToPersist);
  await moveSubtitlesIfSettingChanged(existingSettings, settingsToPersist);
  await moveThumbnailsIfSettingChanged(existingSettings, settingsToPersist);
  applyCloudflaredSettingChanges(
    existingSettings,
    settingsToPersist,
    finalSettings
  );
  await persistAllowedHostsEnv(existingSettings, settingsToPersist, finalSettings);
  applyRuntimeSettingChanges(settingsToPersist, finalSettings);

  res.json({
    success: true,
    settings: buildSafeSettingsPayload(
      req,
      finalSettings as PersistedSettingsResponse
    ),
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
