import { describe, expect, it } from "vitest";
import { ValidationError } from "../../errors/DownloadErrors";
import * as settingsValidationService from "../../services/settingsValidationService";

describe("settingsValidationService", () => {
  describe("validateSettings", () => {
    it("should correct invalid values", () => {
      const settings: any = { maxConcurrentDownloads: 0, itemsPerPage: 0 };
      settingsValidationService.validateSettings(settings);

      expect(settings.maxConcurrentDownloads).toBe(1);
      expect(settings.itemsPerPage).toBe(12);
    });

    it("should trim website name", () => {
      const settings: any = { websiteName: "a".repeat(20) };
      settingsValidationService.validateSettings(settings);

      expect(settings.websiteName.length).toBe(15);
    });

    it("should throw ValidationError when tags have case-insensitive duplicate", () => {
      expect(() => {
        settingsValidationService.validateSettings({ tags: ["aaa", "Aaa"] });
      }).toThrow(ValidationError);
      expect(() => {
        settingsValidationService.validateSettings({
          tags: ["Foo", "bar", "foo"],
        });
      }).toThrow(ValidationError);
    });

    it("should allow tags that differ only by case when not both present", () => {
      expect(() => {
        settingsValidationService.validateSettings({ tags: ["aaa"] });
      }).not.toThrow();
      expect(() => {
        settingsValidationService.validateSettings({ tags: ["Aaa"] });
      }).not.toThrow();
    });

    it("should throw ValidationError when password fields are non-string", () => {
      expect(() => {
        settingsValidationService.validateSettings({ password: true as any });
      }).toThrow(ValidationError);
      expect(() => {
        settingsValidationService.validateSettings({
          visitorPassword: 123 as any,
        });
      }).toThrow(ValidationError);
    });

    it("should trim and validate Twitch client credentials as a pair", () => {
      const settings: any = {
        twitchClientId: "  client-id  ",
        twitchClientSecret: "  client-secret  ",
      };

      settingsValidationService.validateSettings(settings);

      expect(settings.twitchClientId).toBe("client-id");
      expect(settings.twitchClientSecret).toBe("client-secret");
    });

    it("should validate tmdbApiKey without mutating the input object", () => {
      const settings: any = {
        tmdbApiKey: "  tmdb-token  ",
      };

      settingsValidationService.validateSettings(settings);

      expect(settings.tmdbApiKey).toBe("  tmdb-token  ");
    });

    it("should reject partial or invalid Twitch client credentials", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          twitchClientSecret: "client-secret",
        });
      }).toThrow(ValidationError);

      expect(() => {
        settingsValidationService.validateSettings({
          twitchClientId: "client-id",
        });
      }).toThrow(ValidationError);

      expect(() => {
        settingsValidationService.validateSettings({
          twitchClientId: "bad",
          twitchClientSecret: "client-secret",
        });
      }).toThrow(ValidationError);

      expect(() => {
        settingsValidationService.validateSettings({
          twitchClientId: "client-id",
          twitchClientSecret: "short",
        });
      }).toThrow(ValidationError);
    });
  });

  describe("mergeSettings", () => {
    it("should merge defaults, existing, and new", () => {
      const defaults = { maxConcurrentDownloads: 3 }; // partial assumption of defaults
      const existing = { maxConcurrentDownloads: 5 };
      const newSettings = { websiteName: "MyTube" };

      const merged = settingsValidationService.mergeSettings(
        existing as any,
        newSettings as any
      );

      expect(merged.websiteName).toBe("MyTube");
      expect(merged.maxConcurrentDownloads).toBe(5);
    });
  });
});
