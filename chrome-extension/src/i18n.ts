// Internationalization utility for Chrome Extension
// Detects browser language and provides translation function

import type { Translations } from "./types";

const DEFAULT_LANG = "en";
const SUPPORTED_LANGUAGE_CODES = new Set([
  "en",
  "zh",
  "de",
  "es",
  "fr",
  "ja",
  "ko",
  "pt",
  "ru",
  "ar",
]);

function normalizeLanguageAlias(lang: string): string {
  switch (lang.trim().toLowerCase()) {
    case "zh-cn":
    case "zh-tw":
      return "zh";
    case "pt-br":
      return "pt";
    default:
      return lang.trim().toLowerCase();
  }
}

function getSupportedLanguageCode(lang: string): string {
  const normalizedLang = normalizeLanguageAlias(lang);
  const [baseCode = DEFAULT_LANG] = normalizedLang.split("-");
  return SUPPORTED_LANGUAGE_CODES.has(baseCode) ? baseCode : DEFAULT_LANG;
}

function getTranslationValue(
  translations: Translations,
  key: keyof Translations
): string | undefined {
  for (const [translationKey, translationValue] of Object.entries(translations)) {
    if (translationKey === key) {
      return translationValue;
    }
  }

  return undefined;
}

// Get browser language
export function getBrowserLanguage(): string {
  // Chrome extensions have chrome.i18n API
  if (typeof chrome !== "undefined" && chrome.i18n) {
    try {
      return chrome.i18n.getUILanguage();
    } catch (e) {
      // Fallback
    }
  }

  // Fallback for web context
  return (
    navigator.language ||
    (navigator as { userLanguage?: string }).userLanguage ||
    DEFAULT_LANG
  );
}

// Normalize language code
export function normalizeLanguage(lang: string): string {
  if (!lang) return DEFAULT_LANG;
  return getSupportedLanguageCode(lang);
}

// Translation function (translations should be loaded before use)
export function t(
  key: keyof Translations,
  params: Record<string, string> = {}
): string {
  if (typeof window === "undefined" || !window.currentTranslations) {
    return key;
  }

  let text = getTranslationValue(window.currentTranslations, key) || key;
  for (const [paramName, paramValue] of Object.entries(params)) {
    const placeholder = `{${paramName}}`;
    text = text.split(placeholder).join(paramValue);
  }

  return text;
}

// Load translations based on browser language
export function loadTranslations(callback?: () => void): void {
  const lang = normalizeLanguage(getBrowserLanguage());

  // Create script element to load translation file
  const script = document.createElement("script");
  script.src = `locales/${lang}.js`;
  script.onload = () => {
    // The loaded script will define window.currentTranslations
    if (
      typeof window !== "undefined" &&
      typeof window.currentTranslations !== "undefined"
    ) {
      if (callback) callback();
    }
  };
  script.onerror = () => {
    // Fallback to English if language file not found
    if (lang !== DEFAULT_LANG) {
      const fallbackScript = document.createElement("script");
      fallbackScript.src = `locales/${DEFAULT_LANG}.js`;
      fallbackScript.onload = () => {
        if (
          typeof window !== "undefined" &&
          typeof window.currentTranslations !== "undefined"
        ) {
          if (callback) callback();
        }
      };
      document.head.appendChild(fallbackScript);
    } else if (callback) {
      callback();
    }
  };
  document.head.appendChild(script);
}

// Make functions available globally
if (typeof window !== "undefined") {
  window.getBrowserLanguage = getBrowserLanguage;
  window.normalizeLanguage = normalizeLanguage;
  window.t = t;
  window.loadTranslations = loadTranslations;
}
