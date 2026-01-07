import { en } from "./locales/en";

export const defaultTranslations = en;

// Type-safe locale loader function
type LocaleLoader = () => Promise<{ [key: string]: any }>;

const getLocaleLoader = (lang: Language): LocaleLoader | null => {
  switch (lang) {
    case "en":
      return () => Promise.resolve({ en });
    case "zh":
      return () => import("./locales/zh");
    case "es":
      return () => import("./locales/es");
    case "de":
      return () => import("./locales/de");
    case "ja":
      return () => import("./locales/ja");
    case "fr":
      return () => import("./locales/fr");
    case "ko":
      return () => import("./locales/ko");
    case "ar":
      return () => import("./locales/ar");
    case "pt":
      return () => import("./locales/pt");
    case "ru":
      return () => import("./locales/ru");
    default:
      return null;
  }
};

const getLocaleFromModule = (
  module: { [key: string]: any },
  lang: Language
): any => {
  switch (lang) {
    case "en":
      return module.en || defaultTranslations;
    case "zh":
      return module.zh || defaultTranslations;
    case "es":
      return module.es || defaultTranslations;
    case "de":
      return module.de || defaultTranslations;
    case "ja":
      return module.ja || defaultTranslations;
    case "fr":
      return module.fr || defaultTranslations;
    case "ko":
      return module.ko || defaultTranslations;
    case "ar":
      return module.ar || defaultTranslations;
    case "pt":
      return module.pt || defaultTranslations;
    case "ru":
      return module.ru || defaultTranslations;
    default:
      return defaultTranslations;
  }
};

export const loadLocale = async (lang: Language) => {
  const loader = getLocaleLoader(lang);
  if (loader) {
    const module = await loader();
    return getLocaleFromModule(module, lang);
  }
  return defaultTranslations;
};

export const translations = {
  en,
};

export type Language =
  | "en"
  | "zh"
  | "es"
  | "de"
  | "ja"
  | "fr"
  | "ko"
  | "ar"
  | "pt"
  | "ru";
export type TranslationKey = keyof typeof translations.en;

/**
 * Maps WebAuthn error messages to translation keys
 * @param errorMessage The error message from WebAuthn API
 * @returns Translation key if a match is found, null otherwise
 */
export function getWebAuthnErrorTranslationKey(
  errorMessage: string
): TranslationKey | null {
  if (!errorMessage) return null;

  const lowerMessage = errorMessage.toLowerCase();

  // Check for permission denied error
  if (
    lowerMessage.includes("not allowed") ||
    lowerMessage.includes("denied permission") ||
    lowerMessage.includes("user denied")
  ) {
    return "passkeyErrorPermissionDenied";
  }

  // Check for already registered error
  if (
    lowerMessage.includes("previously registered") ||
    lowerMessage.includes("already registered") ||
    lowerMessage.includes("authenticator was previously")
  ) {
    return "passkeyErrorAlreadyRegistered";
  }

  return null;
}
