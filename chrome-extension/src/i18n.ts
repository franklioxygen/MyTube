// Internationalization utility for Chrome Extension
// Detects browser language and provides translation function

import type { Translations } from "./types";

// Language code mapping (browser language -> translation file)
const languageMap: Record<string, string> = {
  en: "en",
  zh: "zh",
  "zh-CN": "zh",
  "zh-TW": "zh",
  de: "de",
  es: "es",
  fr: "fr",
  ja: "ja",
  ko: "ko",
  pt: "pt",
  "pt-BR": "pt",
  ru: "ru",
  ar: "ar",
};

const DEFAULT_LANG = "en";

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
    navigator?.language ||
    (navigator as { userLanguage?: string })?.userLanguage ||
    DEFAULT_LANG
  );
}

// Normalize language code
export function normalizeLanguage(lang: string): string {
  if (!lang) return DEFAULT_LANG;
  const code = lang.split("-")[0].toLowerCase();
  return languageMap[code] || languageMap[lang] || DEFAULT_LANG;
}

// Translation function (translations should be loaded before use)
export function t(
  key: keyof Translations,
  params: Record<string, string> = {}
): string {
  if (typeof window === "undefined" || !window.currentTranslations) {
    return key;
  }

  let text = window.currentTranslations[key] || key;
  Object.keys(params).forEach((param) => {
    text = text.replace(new RegExp(`\\{${param}\\}`, "g"), params[param]);
  });
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
