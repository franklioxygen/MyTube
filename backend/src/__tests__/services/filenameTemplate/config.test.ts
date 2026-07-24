import { describe, expect, it } from "vitest";
import {
  applySubscriptionFilenameTemplateOverride,
  normalizeFilenameNamingSettings,
  resolveFilenameNamingConfig,
} from "../../../services/filenameTemplate/config";
import { resolvePresetById } from "../../../services/filenameTemplate/presets";

describe("filenameTemplate config resolver", () => {
  it("treats explicit legacy mode as authoritative over stale deprecated presets", () => {
    expect(
      resolveFilenameNamingConfig({
        downloadFilenameMode: "legacy",
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "{{ title }}.{{ ext }}",
      })
    ).toEqual({
      mode: "legacy",
      template: null,
      matchedPresetId: "legacy",
    });
  });

  it("keeps old built-in preset payloads compatible when template mode is explicit", () => {
    expect(
      resolveFilenameNamingConfig({
        downloadFilenameMode: "template",
        downloadFilenamePresetId: "channel_year_date_index",
      })
    ).toEqual({
      mode: "template",
      template: resolvePresetById("channel_year_date_index")?.template ?? null,
      matchedPresetId: "media_center_date_index",
    });
  });

  it("matches deprecated built-in templates without collapsing them to custom", () => {
    expect(
      resolveFilenameNamingConfig({
        downloadFilenameMode: "template",
        downloadFilenameTemplate:
          "{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}",
      })
    ).toEqual({
      mode: "template",
      template:
        "{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}",
      matchedPresetId: "channel_year_date_index",
    });
  });

  it("normalizes a legacy-mode patch without being pulled back into stale custom mode", () => {
    expect(
      normalizeFilenameNamingSettings(
        {
          downloadFilenamePresetId: "custom",
          downloadFilenameTemplate: "{{ title }}.{{ ext }}",
        },
        {
          downloadFilenameMode: "legacy",
        }
      )
    ).toEqual({
      downloadFilenameMode: "legacy",
    });
  });
});

describe("applySubscriptionFilenameTemplateOverride", () => {
  const globalSettings = {
    downloadFilenameMode: "legacy" as const,
    downloadFilenamePresetId: "legacy",
    downloadFilenameTemplate: "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}",
    moveThumbnailsToVideoFolder: true,
    moveSubtitlesToVideoFolder: false,
    authorOrganizationMode: "flat" as const,
  };

  it("returns the original object unchanged when no override is present", () => {
    expect(applySubscriptionFilenameTemplateOverride(globalSettings, null)).toBe(
      globalSettings
    );
    expect(
      applySubscriptionFilenameTemplateOverride(globalSettings, undefined)
    ).toBe(globalSettings);
    expect(applySubscriptionFilenameTemplateOverride(globalSettings, "")).toBe(
      globalSettings
    );
    expect(applySubscriptionFilenameTemplateOverride(globalSettings, "  \t\n")).toBe(
      globalSettings
    );
  });

  it("forces template mode with the subscription template when an override is set", () => {
    const result = applySubscriptionFilenameTemplateOverride(
      globalSettings,
      "{{ source_custom_name }}/{{ title }}.{{ ext }}"
    );
    expect(result).not.toBe(globalSettings);
    expect(result.downloadFilenameMode).toBe("template");
    expect(result.downloadFilenameTemplate).toBe(
      "{{ source_custom_name }}/{{ title }}.{{ ext }}"
    );
    expect(result.downloadFilenamePresetId).not.toBe("legacy");
  });

  it("preserves unrelated settings such as thumbnail/subtitle placement", () => {
    const result = applySubscriptionFilenameTemplateOverride(
      globalSettings,
      "{{ title }}.{{ ext }}"
    );
    expect(result.moveThumbnailsToVideoFolder).toBe(true);
    expect(result.moveSubtitlesToVideoFolder).toBe(false);
    expect(result.authorOrganizationMode).toBe("flat");
  });

  it("replaces a global template with a different subscription template", () => {
    const templateGlobal = {
      ...globalSettings,
      downloadFilenameMode: "template" as const,
      downloadFilenamePresetId: "media_center_date_index",
      downloadFilenameTemplate:
        "{{ source_custom_name }}/{{ upload_year }}/{{ upload_date }} - {{ title }}.{{ ext }}",
    };
    const result = applySubscriptionFilenameTemplateOverride(
      templateGlobal,
      "{{ source_custom_name }}/{{ title }}.{{ ext }}"
    );
    expect(result.downloadFilenameMode).toBe("template");
    expect(result.downloadFilenameTemplate).toBe(
      "{{ source_custom_name }}/{{ title }}.{{ ext }}"
    );
  });

  it("derives a coherent preset id (or custom) for a preset-matching template", () => {
    const result = applySubscriptionFilenameTemplateOverride(
      globalSettings,
      "{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}"
    );
    expect(result.downloadFilenamePresetId).toBe("channel_year_date_index");
  });
});
