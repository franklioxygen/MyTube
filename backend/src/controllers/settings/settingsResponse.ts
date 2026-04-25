import { Request } from "express";
import { getDeploymentSecurityModel } from "../../config/adminTrust";
import * as storageService from "../../services/storageService";
import { Settings } from "../../types/settings";

export type PersistedSettingsResponse = Settings & { passkeys?: unknown };

const RESPONSE_HIDDEN_SETTINGS_KEYS = new Set([
  "password",
  "visitorPassword",
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

  return {
    ...safeSettings,
    ...adminOnlySettings,
    deploymentSecurity: getDeploymentSecurityModel(),
    password: undefined,
    visitorPassword: undefined,
    passkeys: undefined,
  };
};
