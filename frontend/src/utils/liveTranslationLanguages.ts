/**
 * Supported language options for the live audio translation feature.
 *
 * This list is intentionally separate from PREFERRED_AUDIO_LANGUAGE_OPTIONS
 * because Gemini Live Translation supports a broader set of languages. Codes are
 * BCP-47. Labels are static English for MVP; localization can be added later.
 *
 * Keep this list in sync with the backend module
 * `backend/src/services/liveTranslation/languages.ts`.
 */
export interface LiveTranslationLanguageOption {
  code: string; // BCP-47
  label: string;
}

export const LIVE_TRANSLATION_SOURCE_AUTO = 'auto';

export const LIVE_TRANSLATION_LANGUAGE_OPTIONS: readonly LiveTranslationLanguageOption[] =
  [
    { code: 'en', label: 'English' },
    { code: 'zh-Hans', label: 'Chinese (Simplified)' },
    { code: 'zh-Hant', label: 'Chinese (Traditional)' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt-BR', label: 'Portuguese (Brazil)' },
    { code: 'pt-PT', label: 'Portuguese (Portugal)' },
    { code: 'ru', label: 'Russian' },
    { code: 'ar', label: 'Arabic' },
    { code: 'hi', label: 'Hindi' },
    { code: 'it', label: 'Italian' },
    { code: 'nl', label: 'Dutch' },
    { code: 'pl', label: 'Polish' },
    { code: 'tr', label: 'Turkish' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'id', label: 'Indonesian' },
    { code: 'th', label: 'Thai' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'he', label: 'Hebrew' },
    { code: 'fa', label: 'Persian' },
    { code: 'ms', label: 'Malay' },
    { code: 'fil', label: 'Filipino' },
  ] as const;

/** Source language options. Gemini currently supports source auto-detection only. */
export const LIVE_TRANSLATION_SOURCE_LANGUAGE_OPTIONS: readonly LiveTranslationLanguageOption[] =
  [{ code: LIVE_TRANSLATION_SOURCE_AUTO, label: 'Auto-detect' }];

/** Target language options exclude `auto`. */
export const LIVE_TRANSLATION_TARGET_LANGUAGE_OPTIONS =
  LIVE_TRANSLATION_LANGUAGE_OPTIONS;

const LANGUAGE_LABEL_BY_CODE = new Map(
  LIVE_TRANSLATION_LANGUAGE_OPTIONS.map((option) => [option.code, option.label]),
);

export function getLiveTranslationLanguageLabel(code: string): string {
  return LANGUAGE_LABEL_BY_CODE.get(code) ?? code;
}

/**
 * Short uppercase badge shown on the in-player Live Translate control when a
 * translation is active (e.g. "EN", "CN"). These are deliberately country/locale
 * flavored rather than strict ISO language codes to match common user mental
 * models (Chinese -> "CN", not "ZH").
 */
const LANGUAGE_ABBREVIATION_BY_CODE: Record<string, string> = {
  en: 'EN',
  'zh-Hans': 'CN',
  'zh-Hant': 'TW',
  ja: 'JP',
  ko: 'KR',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  'pt-BR': 'BR',
  'pt-PT': 'PT',
  ru: 'RU',
  ar: 'AR',
  hi: 'HI',
  it: 'IT',
  nl: 'NL',
  pl: 'PL',
  tr: 'TR',
  vi: 'VI',
  id: 'ID',
  th: 'TH',
  uk: 'UK',
  he: 'HE',
  fa: 'FA',
  ms: 'MS',
  fil: 'PH',
};

export function getLiveTranslationLanguageAbbreviation(code: string): string {
  const mapped = LANGUAGE_ABBREVIATION_BY_CODE[code];
  if (mapped) {
    return mapped;
  }
  // Fallback: primary subtag (before any region/script), uppercased to 2 chars.
  const primary = code.split('-')[0] ?? code;
  return primary.slice(0, 2).toUpperCase() || code.toUpperCase();
}
