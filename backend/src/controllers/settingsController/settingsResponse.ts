import { Request } from "express";
import { getDeploymentSecurityModel } from "../../config/adminTrust";
import { resolveFilenameNamingConfig } from "../../services/filenameTemplate/config";
import * as storageService from "../../services/storageService";
import { Settings } from "../../types/settings";

export type PersistedSettingsResponse = Settings & { passkeys?: unknown };

const RESPONSE_HIDDEN_SETTINGS_KEYS = new Set([
  "password",
  "visitorPassword",
  // Gemini key has per-use billing cost; never round-trip it to any client,
  // not even admins. Clients learn only the derived liveTranslationApiKeyConfigured flag.
  "liveTranslationApiKey",
]);

const ADMIN_ONLY_SETTINGS_KEYS = new Set([
  // Secrets and tokens should only round-trip to admin clients.
  "apiKey",
  "apiKeyEnabled",
  "openListToken",
  "cloudflaredToken",
  "tmdbApiKey",
  "telegramBotToken",
  "twitchClientId",
  "twitchClientSecret",
  // Statistics settings: hidden from visitor-safe responses
  "statisticsEnabled",
  "statisticsRetentionDays",
  "statisticsCaptureSearchText",
  "statisticsTrackVisitorActivity",
  "statisticsKeepDataWhenDisabled",
  "statisticsTimezone",
]);

const RESPONSE_VISIBLE_SETTINGS_KEYS =
  storageService.WHITELISTED_SETTINGS.filter(
    (key) =>
      !RESPONSE_HIDDEN_SETTINGS_KEYS.has(key) &&
      !ADMIN_ONLY_SETTINGS_KEYS.has(key)
  );

export const buildSafeSettingsPayload = (
  req: Request,
  settings: PersistedSettingsResponse
): Record<string, unknown> => {
  const resolvedFilenameNaming = resolveFilenameNamingConfig(settings);
  const canExposeAdminOnlySettings =
    req.user?.role === "admin" || settings.loginEnabled !== true;
  const safeSettings = Object.fromEntries(
    RESPONSE_VISIBLE_SETTINGS_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(settings, key))
      .map((key) => [key, settings[key as keyof PersistedSettingsResponse]])
  );
  const adminOnlySettings =
    canExposeAdminOnlySettings
      ? Object.fromEntries(
          Array.from(ADMIN_ONLY_SETTINGS_KEYS)
            .filter((key) =>
              Object.prototype.hasOwnProperty.call(settings, key)
            )
            .map((key) => [key, settings[key as keyof PersistedSettingsResponse]])
        )
      : {};

  const hasLiveTranslationApiKey =
    typeof settings.liveTranslationApiKey === "string" &&
    settings.liveTranslationApiKey.trim().length > 0;

  return {
    ...safeSettings,
    ...adminOnlySettings,
    // Gate the configured flag behind the same admin/login check used for
    // adminOnlySettings so visitors do not learn whether a key is configured.
    ...(canExposeAdminOnlySettings
      ? { liveTranslationApiKeyConfigured: hasLiveTranslationApiKey }
      : {}),
    downloadFilenameMode: resolvedFilenameNaming.mode,
    downloadFilenamePresetId: resolvedFilenameNaming.matchedPresetId,
    deploymentSecurity: getDeploymentSecurityModel(),
    password: undefined,
    visitorPassword: undefined,
    liveTranslationApiKey: undefined,
    passkeys: undefined,
  };
};
