import { Request, Response } from "express";
import crypto from "crypto";
import path from "path";
import { cloudflaredService } from "../../services/cloudflaredService";
import downloadManager from "../../services/downloadManager";
import * as passwordService from "../../services/passwordService";
import * as settingsValidationService from "../../services/settingsValidationService";
import * as storageService from "../../services/storageService";
import { twitchApiService } from "../../services/twitchService";
import { Settings } from "../../types/settings";
import { logger } from "../../utils/logger";
import {
  resolveSafeChildPath,
  writeFileSafeSync,
} from "../../utils/security";
import {
  buildSafeSettingsPayload,
  PersistedSettingsResponse,
} from "./settingsResponse";
import { enforceTrustLevelForSettingsChanges } from "./trustGates";

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
  import("../../services/tagService")
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

  const { moveAllSubtitles } = await import("../../services/subtitleService");
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

  const { moveAllThumbnails } = await import("../../services/thumbnailService");
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
    const basePath = path.resolve(__dirname, "../../../../frontend");
    const envLocalPath = resolveSafeChildPath(basePath, ".env.local");

    const sanitizedHosts = (finalSettings.allowedHosts || "")
      .replace(/[\r\n]/g, "")
      .replace(/[^\w\s.,-]/g, "");

    const envContent = `# Auto-generated by MyTube settings\n# Restart dev server for changes to take effect\nVITE_ALLOWED_HOSTS=${sanitizedHosts}\n`;
    writeFileSafeSync(envLocalPath, basePath, envContent, "utf8");
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

  settingsValidationService.validateSettings(trustedIncomingSettings);

  const preparedSettings = await settingsValidationService.prepareSettingsForSave(
    existingSettings,
    trustedIncomingSettings,
    passwordService.hashPassword,
    { preserveUnsetFields: mode === "replace" }
  );

  const sanitizedIncoming = sanitizeIncomingSettings(trustedIncomingSettings);

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

  const finalSettings =
    mode === "replace"
      ? (settingsToPersist as Settings)
      : ({ ...existingSettings, ...settingsToPersist } as Settings);

  ensureApiKeyWhenEnabled(settingsToPersist, finalSettings);
  storageService.saveSettings(settingsToPersist as Record<string, unknown>);
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
  persistAllowedHostsEnv(existingSettings, settingsToPersist, finalSettings);
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
