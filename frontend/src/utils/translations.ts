import { ar } from "./locales/ar";
import { de } from "./locales/de";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { zh } from "./locales/zh";

export const translations = {
  en,
  zh,
  es,
  de,
  ja,
  fr,
  ko,
  ar,
  pt,
  ru,
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
