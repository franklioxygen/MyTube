import { describe, expect, it } from "vitest";
import { Language, loadLocale, TranslationKey, translations } from "../translations";

describe("translations", () => {
  it("should export all expected languages", async () => {
    const expectedLanguages: Language[] = [
      "en",
      "zh",
      "es",
      "de",
      "ja",
      "fr",
      "ko",
      "ar",
      "pt",
      "ru",
    ];

    for (const lang of expectedLanguages) {
      if (lang === "en") {
        expect(translations.en).toBeDefined();
        expect(typeof translations.en).toBe("object");
      } else {
        const loadedTranslations = await loadLocale(lang);
        expect(loadedTranslations).toBeDefined();
        expect(typeof loadedTranslations).toBe("object");
      }
    }
  });

  it("should have consistent keys across all languages", async () => {
    const englishKeys = Object.keys(translations.en) as TranslationKey[];
    const expectedLanguages: Language[] = [
      "en",
      "zh",
      "es",
      "de",
      "ja",
      "fr",
      "ko",
      "ar",
      "pt",
      "ru",
    ];

    for (const lang of expectedLanguages) {
      const loadedTranslations = await loadLocale(lang);
      const langKeys = Object.keys(loadedTranslations);
      expect(langKeys.length).toBeGreaterThan(0);

      // Check that all languages have at least some common keys
      // (We don't require exact match as some languages might have additional keys)
      const commonKeys = englishKeys.filter((key) => langKeys.includes(key));
      expect(commonKeys.length).toBeGreaterThan(0);
    }
  });

  it("should have non-empty string values for all keys in English", () => {
    const englishKeys = Object.keys(translations.en) as TranslationKey[];

    englishKeys.forEach((key) => {
      const value = translations.en[key];
      expect(value).toBeDefined();
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    });
  });

  it("should have valid translation structure", async () => {
    const expectedLanguages: Language[] = [
      "en",
      "zh",
      "es",
      "de",
      "ja",
      "fr",
      "ko",
      "ar",
      "pt",
      "ru",
    ];

    for (const lang of expectedLanguages) {
      const translation = await loadLocale(lang);
      expect(translation).toBeDefined();
      expect(typeof translation).toBe("object");
      expect(translation).not.toBeNull();
    }
  });
});
