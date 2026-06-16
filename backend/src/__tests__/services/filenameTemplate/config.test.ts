import { describe, expect, it } from "vitest";
import {
  normalizeFilenameNamingSettings,
  resolveFilenameNamingConfig,
} from "../../../services/filenameTemplate/config";
import { getPresetById } from "../../../services/filenameTemplate/presets";

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
        downloadFilenamePresetId: "playlist_static_index",
      })
    ).toEqual({
      mode: "template",
      template: getPresetById("playlist_static_index")?.template ?? null,
      matchedPresetId: "playlist_static_index",
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
