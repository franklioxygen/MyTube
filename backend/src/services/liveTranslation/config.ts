import * as storageService from "../storageService";
import { defaultSettings, Settings } from "../../types/settings";
import {
  isSupportedLiveTranslationModel,
  isSupportedTargetLanguage,
  LIVE_TRANSLATION_SOURCE_AUTO,
} from "./languages";

export type LiveTranslationReason =
  | "feature_disabled"
  | "api_key_missing"
  | "target_language_missing"
  | "unsupported_model"
  | "admin_required"
  | null;

/**
 * Public, secret-free availability snapshot returned to clients by
 * GET /api/live-translation/config and embedded (minus role bits) in session
 * ticket responses.
 */
export interface LiveTranslationPublicConfig {
  enabled: boolean;
  available: boolean;
  canUse: boolean;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKeyConfigured: boolean;
  requiresAdmin: boolean;
  reason: LiveTranslationReason;
}

/**
 * Server-only resolved config, including the Gemini API key. Never serialize
 * this to a client. Used by the gateway when opening a Gemini session and stored
 * (by value) in a session ticket so a later settings change cannot retroactively
 * alter an in-flight session.
 */
export interface LiveTranslationServerConfig {
  enabled: boolean;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  apiKeyConfigured: boolean;
}

interface AvailabilityContext {
  isAdmin: boolean;
  loginRequired: boolean;
}

function getMergedSettings(): Settings {
  const settings = storageService.getSettings();
  return { ...defaultSettings, ...settings } as Settings;
}

function resolveApiKey(settings: Settings): string {
  return typeof settings.liveTranslationApiKey === "string"
    ? settings.liveTranslationApiKey.trim()
    : "";
}

/**
 * Resolve the full server-side config (including the API key). Used only on the
 * backend; callers must not leak the key.
 */
export function getLiveTranslationServerConfig(
  settings: Settings = getMergedSettings()
): LiveTranslationServerConfig {
  const apiKey = resolveApiKey(settings);
  return {
    enabled: settings.liveTranslationEnabled === true,
    model:
      settings.liveTranslationModel || "gemini-3.5-live-translate-preview",
    // Gemini Live Translation auto-detects the source language and does not
    // expose a source-language setup field. Clamp legacy stored values to auto.
    sourceLanguage: LIVE_TRANSLATION_SOURCE_AUTO,
    targetLanguage: settings.liveTranslationTargetLanguage || "en",
    apiKey,
    apiKeyConfigured: apiKey.length > 0,
  };
}

/**
 * Compute the public availability snapshot for a requester. `available` means
 * the feature is fully configured server-side; `canUse` additionally accounts
 * for the MVP rule that an admin session is required when login is enabled.
 */
export function getLiveTranslationPublicConfig(
  context: AvailabilityContext,
  settings: Settings = getMergedSettings()
): LiveTranslationPublicConfig {
  const server = getLiveTranslationServerConfig(settings);
  const modelSupported = isSupportedLiveTranslationModel(server.model);
  const targetValid =
    server.targetLanguage !== LIVE_TRANSLATION_SOURCE_AUTO &&
    isSupportedTargetLanguage(server.targetLanguage);

  // requiresAdmin reflects the MVP policy: when login is enabled, only admins
  // may spend Gemini quota.
  const requiresAdmin = context.loginRequired;
  const canSeeApiKeyState = context.isAdmin || !context.loginRequired;

  let reason: LiveTranslationReason = null;
  if (!server.enabled) {
    reason = "feature_disabled";
  } else if (!modelSupported) {
    reason = "unsupported_model";
  } else if (!canSeeApiKeyState) {
    reason = "admin_required";
  } else if (!server.apiKeyConfigured) {
    reason = "api_key_missing";
  } else if (!targetValid) {
    reason = "target_language_missing";
  }

  const available =
    server.enabled && modelSupported && server.apiKeyConfigured && targetValid;
  const canUse = available && (context.isAdmin || !context.loginRequired);

  return {
    enabled: server.enabled,
    available: canSeeApiKeyState ? available : false,
    canUse,
    model: server.model,
    sourceLanguage: server.sourceLanguage,
    targetLanguage: server.targetLanguage,
    apiKeyConfigured: canSeeApiKeyState ? server.apiKeyConfigured : false,
    requiresAdmin,
    reason,
  };
}
