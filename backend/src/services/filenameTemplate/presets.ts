import { LEGACY_DOWNLOAD_FILENAME_TEMPLATE } from "../../types/settings";

export interface FilenameTemplatePreset {
  id: string;
  labelKey: string;
  template: string;
}

export const FILENAME_TEMPLATE_PRESETS: FilenameTemplatePreset[] = [
  {
    id: "legacy",
    labelKey: "filenamePresetLegacy",
    template: LEGACY_DOWNLOAD_FILENAME_TEMPLATE,
  },
  {
    id: "channel_year_date_index",
    labelKey: "filenamePresetChannelYearDateIndex",
    template:
      "{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}",
  },
  {
    id: "playlist_static_index",
    labelKey: "filenamePresetPlaylistStaticIndex",
    template:
      "{{ source_collection_name }}/{{ static_season__episode_by_index }} - {{ title }}.{{ ext }}",
  },
  {
    id: "playlist_static_date",
    labelKey: "filenamePresetPlaylistStaticDate",
    template:
      "{{ source_collection_name }}/{{ static_season__episode_by_date }} - {{ title }}.{{ ext }}",
  },
];

export function getPresetById(id: string): FilenameTemplatePreset | undefined {
  return FILENAME_TEMPLATE_PRESETS.find((p) => p.id === id);
}
