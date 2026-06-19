/**
 * Supported language options for the live audio translation feature.
 *
 * This list is intentionally separate from the preferred-download-audio list
 * because Gemini Live Translation supports a broader set of languages. Codes are
 * BCP-47. Labels are static English for MVP; localization can be added later.
 *
 * Keep this list in sync with the frontend module
 * `frontend/src/utils/liveTranslationLanguages.ts`.
 */
export interface LiveTranslationLanguageOption {
  code: string; // BCP-47
  label: string;
}

export const LIVE_TRANSLATION_SOURCE_AUTO = "auto";

/**
 * Models supported for live translation. Confirmed against the Gemini ListModels
 * API on 2026-06-18 (the model is exposed as `models/gemini-3.5-live-translate-preview`).
 */
export const LIVE_TRANSLATION_MODELS = new Set([
  "gemini-3.5-live-translate-preview",
]);

export function isSupportedLiveTranslationModel(model: string): boolean {
  return LIVE_TRANSLATION_MODELS.has(model);
}

export const LIVE_TRANSLATION_LANGUAGE_OPTIONS: readonly LiveTranslationLanguageOption[] =
  [
    { code: "en", label: "English" },
    { code: "zh-Hans", label: "Chinese (Simplified)" },
    { code: "zh-Hant", label: "Chinese (Traditional)" },
    { code: "ja", label: "Japanese" },
    { code: "ko", label: "Korean" },
    { code: "es", label: "Spanish" },
    { code: "fr", label: "French" },
    { code: "de", label: "German" },
    { code: "pt-BR", label: "Portuguese (Brazil)" },
    { code: "pt-PT", label: "Portuguese (Portugal)" },
    { code: "ru", label: "Russian" },
    { code: "ar", label: "Arabic" },
    { code: "hi", label: "Hindi" },
    { code: "it", label: "Italian" },
    { code: "nl", label: "Dutch" },
    { code: "pl", label: "Polish" },
    { code: "tr", label: "Turkish" },
    { code: "vi", label: "Vietnamese" },
    { code: "id", label: "Indonesian" },
    { code: "th", label: "Thai" },
    { code: "uk", label: "Ukrainian" },
    { code: "he", label: "Hebrew" },
    { code: "fa", label: "Persian" },
    { code: "ms", label: "Malay" },
    { code: "fil", label: "Filipino" },
  ] as const;

const SUPPORTED_LANGUAGE_CODES = new Set(
  LIVE_TRANSLATION_LANGUAGE_OPTIONS.map((option) => option.code)
);

/**
 * Whether a BCP-47 code is in the supported target-language list. `auto` is not
 * a valid target language.
 */
export function isSupportedTargetLanguage(code: string): boolean {
  return SUPPORTED_LANGUAGE_CODES.has(code);
}

/**
 * Whether a value is a valid source-language selection. `auto` is allowed (and
 * is the default) because the source language is auto-detected by the model.
 */
export function isSupportedSourceLanguage(code: string): boolean {
  return code === LIVE_TRANSLATION_SOURCE_AUTO || SUPPORTED_LANGUAGE_CODES.has(code);
}
