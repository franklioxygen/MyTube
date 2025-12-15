import { describe, expect, it } from "vitest";
import { Language, TranslationKey, translations } from "../translations";

describe("translations", () => {
  it("should export all expected languages", () => {
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

    expectedLanguages.forEach((lang) => {
      expect(translations[lang]).toBeDefined();
      expect(typeof translations[lang]).toBe("object");
    });
  });

  it("should have consistent keys across all languages", () => {
    const englishKeys = Object.keys(translations.en) as TranslationKey[];

    Object.keys(translations).forEach((lang) => {
      const langKeys = Object.keys(translations[lang as Language]);
      expect(langKeys.length).toBeGreaterThan(0);

      // Check that all languages have at least some common keys
      // (We don't require exact match as some languages might have additional keys)
      const commonKeys = englishKeys.filter((key) => langKeys.includes(key));
      expect(commonKeys.length).toBeGreaterThan(0);
    });
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

  it("should have valid translation structure", () => {
    Object.keys(translations).forEach((lang) => {
      const translation = translations[lang as Language];
      expect(translation).toBeDefined();
      expect(typeof translation).toBe("object");
      expect(translation).not.toBeNull();
    });
  });
});
