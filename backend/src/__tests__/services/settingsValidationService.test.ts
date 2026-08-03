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

    it("should reject invalid media server export modes", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          mediaServerExportMode: "bogus" as any,
        });
      }).toThrow(ValidationError);

      expect(() => {
        settingsValidationService.validateSettings({
          mediaServerExportMode: "nfo_and_source_json",
        });
      }).not.toThrow();
    });

    it("should validate preferred video container values", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          preferredVideoContainer: "mkv",
        });
      }).not.toThrow();

      expect(() => {
        settingsValidationService.validateSettings({
          preferredVideoContainer: "avi" as any,
        });
      }).toThrow(ValidationError);
    });

    it.each([
      ["playerSeekShortSeconds", 1],
      ["playerSeekMediumSeconds", 60],
      ["playerSeekLongSeconds", 3600],
    ] as const)("accepts valid %s values", (key, value) => {
      expect(() => {
        settingsValidationService.validateSettings({ [key]: value });
      }).not.toThrow();
    });

    it.each([
      0,
      -1,
      3601,
      10.5,
      "10",
      null,
      true,
    ])("rejects invalid player seek seconds value %j", (value) => {
      expect(() => {
        settingsValidationService.validateSettings({
          playerSeekShortSeconds: value as any,
        });
      }).toThrow(ValidationError);
    });

    it("accepts strictly increasing final player seek intervals", () => {
      expect(() => {
        settingsValidationService.validatePlayerSeekIntervalsFinalSettings({
          playerSeekShortSeconds: 15,
          playerSeekMediumSeconds: 120,
          playerSeekLongSeconds: 900,
        });
      }).not.toThrow();
    });

    it.each([
      [10, 10, 600],
      [60, 10, 600],
      [10, 600, 60],
    ])(
      "rejects non-increasing final player seek intervals (%i, %i, %i)",
      (shortSeconds, mediumSeconds, longSeconds) => {
        expect(() => {
          settingsValidationService.validatePlayerSeekIntervalsFinalSettings({
            playerSeekShortSeconds: shortSeconds,
            playerSeekMediumSeconds: mediumSeconds,
            playerSeekLongSeconds: longSeconds,
          });
        }).toThrow(ValidationError);
      }
    );

    it("should accept deprecated custom preset input during the transition", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          downloadFilenamePresetId: "custom",
          downloadFilenameTemplate: "{{ title }}.{{ ext }}",
        });
      }).not.toThrow();
    });

    it("should accept valid author organization modes", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          authorOrganizationMode: "root",
        });
      }).not.toThrow();

      expect(() => {
        settingsValidationService.validateSettings({
          authorOrganizationMode: "author_folder_only",
        });
      }).not.toThrow();
    });

    it("should reject invalid author organization modes", () => {
      expect(() => {
        settingsValidationService.validateSettings({
          authorOrganizationMode: "bogus" as any,
        });
      }).toThrow(ValidationError);
    });

    it.each([["true"], [1], [0], [null]])(
      "rejects a non-boolean autoDeleteEnabled (%p)",
      (value) => {
        expect(() => {
          settingsValidationService.validateSettings({
            autoDeleteEnabled: value as any,
          });
        }).toThrow(ValidationError);
      }
    );

    it("accepts a boolean autoDeleteEnabled", () => {
      expect(() => {
        settingsValidationService.validateSettings({ autoDeleteEnabled: true });
      }).not.toThrow();
      expect(() => {
        settingsValidationService.validateSettings({ autoDeleteEnabled: false });
      }).not.toThrow();
    });

    it("ignores the auto-delete interval while disabled", () => {
      expect(() => {
        settingsValidationService.validateAutoDeleteFinalSettings({
          autoDeleteEnabled: false,
          autoDeleteIntervalDays: 0,
        });
      }).not.toThrow();
      expect(() => {
        settingsValidationService.validateAutoDeleteFinalSettings({
          autoDeleteEnabled: false,
        });
      }).not.toThrow();
    });

    it("accepts a valid interval when auto-delete is enabled", () => {
      expect(() => {
        settingsValidationService.validateAutoDeleteFinalSettings({
          autoDeleteEnabled: true,
          autoDeleteIntervalDays: 30,
        });
      }).not.toThrow();
      expect(() => {
        settingsValidationService.validateAutoDeleteFinalSettings({
          autoDeleteEnabled: true,
          autoDeleteIntervalDays: 1,
        });
      }).not.toThrow();
      expect(() => {
        settingsValidationService.validateAutoDeleteFinalSettings({
          autoDeleteEnabled: true,
          autoDeleteIntervalDays: 3650,
        });
      }).not.toThrow();
    });

    it.each([
      [undefined],
      [0],
      [-5],
      [1.5],
      [3651],
      ["30" as any],
    ])(
      "rejects an invalid interval (%p) when auto-delete is enabled",
      (days) => {
        expect(() => {
          settingsValidationService.validateAutoDeleteFinalSettings({
            autoDeleteEnabled: true,
            autoDeleteIntervalDays: days as any,
          });
        }).toThrow(ValidationError);
      }
    );
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
