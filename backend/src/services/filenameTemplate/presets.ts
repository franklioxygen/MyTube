import { LEGACY_DOWNLOAD_FILENAME_TEMPLATE } from "../../types/settings";

export interface FilenameTemplatePreset {
  id: string;
  kind: "legacy" | "template";
  labelKey: string;
  descriptionKey: string;
  template: string;
  recommendedSourceTypes: Array<"channel" | "playlist" | "single">;
}

export interface DeprecatedTemplateAlias {
  matchedPresetId: string;
  labelKey: string;
  mapsToCurrentPresetId?: string;
  onlyWhenMode?: "legacy" | "template";
}

export const FILENAME_TEMPLATE_PRESETS: FilenameTemplatePreset[] = [
  {
    id: "legacy",
    kind: "legacy",
    labelKey: "filenamePresetLegacy",
    descriptionKey: "filenamePresetLegacy",
    template: LEGACY_DOWNLOAD_FILENAME_TEMPLATE,
    recommendedSourceTypes: ["channel", "playlist", "single"],
  },
  {
    id: "media_center_date_index",
    kind: "template",
    labelKey: "filenamePresetMediaCenterDateIndex",
    descriptionKey: "filenamePresetMediaCenterDateIndex",
    template:
      "{{ source_custom_name }}/Season {{ season_from_date }}/{{ season_episode_index_from_date }} - {{ title }}.{{ ext }}",
    recommendedSourceTypes: ["channel"],
  },
  {
    id: "playlist_static_index",
    kind: "template",
    labelKey: "filenamePresetPlaylistStaticIndex",
    descriptionKey: "filenamePresetPlaylistStaticIndex",
    template:
      "{{ source_custom_name }}/{{ static_season__episode_by_index }} - {{ title }}.{{ ext }}",
    recommendedSourceTypes: ["playlist"],
  },
  {
    id: "playlist_static_date",
    kind: "template",
    labelKey: "filenamePresetPlaylistStaticDate",
    descriptionKey: "filenamePresetPlaylistStaticDate",
    template:
      "{{ source_custom_name }}/{{ static_season__episode_by_date }} - {{ title }}.{{ ext }}",
    recommendedSourceTypes: ["playlist"],
  },
  {
    id: "source_date_flat",
    kind: "template",
    labelKey: "filenamePresetSourceDateFlat",
    descriptionKey: "filenamePresetSourceDateFlat",
    template:
      "{{ source_custom_name }}/{{ upload_yyyy_mm_dd }} - {{ title }}.{{ ext }}",
    recommendedSourceTypes: ["channel", "playlist", "single"],
  },
];

export const DEPRECATED_TEMPLATE_ALIASES: Record<string, DeprecatedTemplateAlias> =
  {
    [LEGACY_DOWNLOAD_FILENAME_TEMPLATE]: {
      matchedPresetId: "legacy",
      labelKey: "filenamePresetLegacy",
      onlyWhenMode: "legacy",
    },
    [
      "{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}"
    ]: {
      matchedPresetId: "channel_year_date_index",
      labelKey: "filenamePresetChannelYearDateIndex",
      mapsToCurrentPresetId: "media_center_date_index",
      onlyWhenMode: "template",
    },
    [
      "{{ source_collection_name }}/{{ static_season__episode_by_index }} - {{ title }}.{{ ext }}"
    ]: {
      matchedPresetId: "playlist_static_index",
      labelKey: "filenamePresetPlaylistStaticIndex",
      mapsToCurrentPresetId: "playlist_static_index",
      onlyWhenMode: "template",
    },
    [
      "{{ source_collection_name }}/{{ static_season__episode_by_date }} - {{ title }}.{{ ext }}"
    ]: {
      matchedPresetId: "playlist_static_date",
      labelKey: "filenamePresetPlaylistStaticDate",
      mapsToCurrentPresetId: "playlist_static_date",
      onlyWhenMode: "template",
    },
  };

export const DEPRECATED_PRESET_ID_TO_CURRENT_PRESET_ID: Record<string, string> = {
  channel_year_date_index: "media_center_date_index",
  playlist_static_index: "playlist_static_index",
  playlist_static_date: "playlist_static_date",
};

export function getPresetById(id: string): FilenameTemplatePreset | undefined {
  return FILENAME_TEMPLATE_PRESETS.find((p) => p.id === id);
}

export function resolvePresetById(
  id: string
): FilenameTemplatePreset | undefined {
  return (
    getPresetById(id) ||
    getPresetById(DEPRECATED_PRESET_ID_TO_CURRENT_PRESET_ID[id] || "")
  );
}
