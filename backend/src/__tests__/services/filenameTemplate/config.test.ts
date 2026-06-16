import { describe, expect, it } from "vitest";
import {
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
