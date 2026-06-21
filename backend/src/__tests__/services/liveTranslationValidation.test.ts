import { describe, expect, it } from "vitest";
import { ValidationError } from "../../errors/DownloadErrors";
import { getLiveTranslationServerConfig } from "../../services/liveTranslation/config";
import * as settingsValidationService from "../../services/settingsValidationService";
import { defaultSettings } from "../../types/settings";

describe("live translation settings validation", () => {
  describe("validateSettings (per-field)", () => {
    it("accepts valid live translation fields", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationEnabled: true,
          liveTranslationModel: "gemini-3.5-live-translate-preview",
          liveTranslationSourceLanguage: "auto",
          liveTranslationTargetLanguage: "es",
        });
      }).not.toThrow();
    });

    it("rejects a non-boolean enabled flag", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationEnabled: "yes" as unknown as boolean,
        });
      }).toThrow(ValidationError);
    });

    it("rejects an unknown model", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationModel: "gpt-4o-live" as never,
        });
      }).toThrow(ValidationError);
    });

    it("rejects a non-auto source language", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationSourceLanguage: "es",
        });
      }).toThrow(ValidationError);
    });

    it("allows auto as a source language", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationSourceLanguage: "auto",
        });
      }).not.toThrow();
    });

    it("rejects auto as a target language", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationTargetLanguage: "auto",
        });
      }).toThrow(ValidationError);
    });

    it("rejects an unsupported target language", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          liveTranslationTargetLanguage: "klingon",
        });
      }).toThrow(ValidationError);
    });

    it("trims the API key", () => {
      const settings = { liveTranslationApiKey: "  secret-key  " };
      settingsValidationService.validateSettings(settings);
      expect(settings.liveTranslationApiKey).toBe("secret-key");
    });
  });

  describe("validateLiveTranslationFinalSettings (cross-field)", () => {
    it("is a no-op when the feature is disabled", () => {
      expect(() => {
        settingsValidationService.validateLiveTranslationFinalSettings({
          liveTranslationEnabled: false,
        });
      }).not.toThrow();
    });

    it("rejects enabling without an API key", () => {
      expect(() => {
        settingsValidationService.validateLiveTranslationFinalSettings({
          liveTranslationEnabled: true,
          liveTranslationModel: "gemini-3.5-live-translate-preview",
          liveTranslationTargetLanguage: "en",
          liveTranslationApiKey: "",
        });
      }).toThrow(ValidationError);
    });

    it("accepts enabling with a stored/incoming API key, valid model and target", () => {
      expect(() => {
        settingsValidationService.validateLiveTranslationFinalSettings({
          liveTranslationEnabled: true,
          liveTranslationModel: "gemini-3.5-live-translate-preview",
          liveTranslationTargetLanguage: "en",
          liveTranslationApiKey: "stored-key",
        });
      }).not.toThrow();
    });

    it("rejects enabling without a target language", () => {
      expect(() => {
        settingsValidationService.validateLiveTranslationFinalSettings({
          liveTranslationEnabled: true,
          liveTranslationModel: "gemini-3.5-live-translate-preview",
          liveTranslationApiKey: "stored-key",
        });
      }).toThrow(ValidationError);
    });
  });

  describe("defaults", () => {
    it("ships with live translation disabled and sensible defaults", () => {
      expect(defaultSettings.liveTranslationEnabled).toBe(false);
      expect(defaultSettings.liveTranslationModel).toBe(
        "gemini-3.5-live-translate-preview"
      );
      expect(defaultSettings.liveTranslationSourceLanguage).toBe("auto");
      expect(defaultSettings.liveTranslationTargetLanguage).toBe("en");
      expect(defaultSettings.liveTranslationApiKey).toBe("");
    });

    it("clamps legacy non-auto source settings to auto in server config", () => {
      const config = getLiveTranslationServerConfig({
        ...defaultSettings,
        liveTranslationSourceLanguage: "es",
      });

      expect(config.sourceLanguage).toBe("auto");
    });
  });
});
