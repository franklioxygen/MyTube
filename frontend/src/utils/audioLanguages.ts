import type { TranslationKey } from "./translations";

/**
 * Preferred audio language options for download settings.
 * Labels are translated via locale keys (e.g. preferredAudioLanguage_en) in frontend/src/utils/locales/.
 */
export const PREFERRED_AUDIO_LANGUAGE_OPTIONS: {
  value: string;
  labelKey: TranslationKey;
}[] = [
  { value: "en", labelKey: "preferredAudioLanguage_en" },
  { value: "zh", labelKey: "preferredAudioLanguage_zh" },
  { value: "ja", labelKey: "preferredAudioLanguage_ja" },
  { value: "ko", labelKey: "preferredAudioLanguage_ko" },
  { value: "es", labelKey: "preferredAudioLanguage_es" },
  { value: "fr", labelKey: "preferredAudioLanguage_fr" },
  { value: "de", labelKey: "preferredAudioLanguage_de" },
  { value: "pt", labelKey: "preferredAudioLanguage_pt" },
  { value: "ru", labelKey: "preferredAudioLanguage_ru" },
  { value: "ar", labelKey: "preferredAudioLanguage_ar" },
  { value: "hi", labelKey: "preferredAudioLanguage_hi" },
  { value: "it", labelKey: "preferredAudioLanguage_it" },
  { value: "nl", labelKey: "preferredAudioLanguage_nl" },
  { value: "pl", labelKey: "preferredAudioLanguage_pl" },
  { value: "tr", labelKey: "preferredAudioLanguage_tr" },
  { value: "vi", labelKey: "preferredAudioLanguage_vi" },
];
