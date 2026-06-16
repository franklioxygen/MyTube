import type { TranslationKey } from './translations';

export interface FilenameTemplateReferenceItem {
  key: string;
  token: string;
  descriptionKey: TranslationKey;
  example?: string;
  kind: 'liquid' | 'pattern';
}

export interface FilenameTemplateReferenceSection {
  id: string;
  titleKey: TranslationKey;
  descriptionKey?: TranslationKey;
  items: FilenameTemplateReferenceItem[];
}

export interface FilenameTemplateInformationNote {
  id: string;
  textKey: TranslationKey;
}

export const FILENAME_TEMPLATE_INFORMATION_NOTES: FilenameTemplateInformationNote[] = [
  { id: 'liquid', textKey: 'filenameRefInfoLiquid' },
  { id: 'ytdlp', textKey: 'filenameRefInfoYtdlp' },
  { id: 'extension', textKey: 'filenameRefInfoExtension' },
  { id: 'fallbacks', textKey: 'filenameRefInfoFallbacks' },
];

export const FILENAME_TEMPLATE_REFERENCE_SECTIONS: FilenameTemplateReferenceSection[] = [
  {
    id: 'core',
    titleKey: 'filenameRefSectionCoreTitle',
    items: [
      { key: 'title', token: '{{ title }}', descriptionKey: 'filenameRefItemTitleDesc', example: 'Sample Video', kind: 'liquid' },
      { key: 'id', token: '{{ id }}', descriptionKey: 'filenameRefItemIdDesc', example: 'dQw4w9WgXcQ', kind: 'liquid' },
      { key: 'ext', token: '{{ ext }}', descriptionKey: 'filenameRefItemExtDesc', example: 'mp4', kind: 'liquid' },
      { key: 'uploader', token: '{{ uploader }}', descriptionKey: 'filenameRefItemUploaderDesc', example: 'Sample Channel', kind: 'liquid' },
      { key: 'channel', token: '{{ channel }}', descriptionKey: 'filenameRefItemChannelDesc', example: 'Sample Channel', kind: 'liquid' },
      { key: 'duration_string', token: '{{ duration_string }}', descriptionKey: 'filenameRefItemDurationStringDesc', example: '03-32', kind: 'liquid' },
      { key: 'artist_name', token: '{{ artist_name }}', descriptionKey: 'filenameRefItemArtistNameDesc', example: 'Sample Channel', kind: 'liquid' },
    ],
  },
  {
    id: 'upload',
    titleKey: 'filenameRefSectionUploadTitle',
    items: [
      { key: 'upload_date', token: '{{ upload_date }}', descriptionKey: 'filenameRefItemUploadDateDesc', example: '20260430', kind: 'liquid' },
      { key: 'upload_yyyy_mm_dd', token: '{{ upload_yyyy_mm_dd }}', descriptionKey: 'filenameRefItemUploadYyyyMmDdDesc', example: '2026-04-30', kind: 'liquid' },
      { key: 'upload_year', token: '{{ upload_year }}', descriptionKey: 'filenameRefItemUploadYearDesc', example: '2026', kind: 'liquid' },
      { key: 'upload_month', token: '{{ upload_month }}', descriptionKey: 'filenameRefItemUploadMonthDesc', example: '04', kind: 'liquid' },
      { key: 'upload_day', token: '{{ upload_day }}', descriptionKey: 'filenameRefItemUploadDayDesc', example: '30', kind: 'liquid' },
    ],
  },
  {
    id: 'source',
    titleKey: 'filenameRefSectionSourceTitle',
    items: [
      { key: 'source_custom_name', token: '{{ source_custom_name }}', descriptionKey: 'filenameRefItemSourceCustomNameDesc', example: 'Sample Channel', kind: 'liquid' },
      { key: 'source_collection_name', token: '{{ source_collection_name }}', descriptionKey: 'filenameRefItemSourceCollectionNameDesc', example: 'Sample Channel', kind: 'liquid' },
      { key: 'source_collection_id', token: '{{ source_collection_id }}', descriptionKey: 'filenameRefItemSourceCollectionIdDesc', example: 'UC_channel_id', kind: 'liquid' },
      { key: 'source_collection_type', token: '{{ source_collection_type }}', descriptionKey: 'filenameRefItemSourceCollectionTypeDesc', example: 'channel', kind: 'liquid' },
    ],
  },
  {
    id: 'playlist',
    titleKey: 'filenameRefSectionPlaylistTitle',
    items: [
      { key: 'media_playlist_index', token: '{{ media_playlist_index }}', descriptionKey: 'filenameRefItemMediaPlaylistIndexDesc', example: '01', kind: 'liquid' },
    ],
  },
  {
    id: 'season',
    titleKey: 'filenameRefSectionSeasonTitle',
    items: [
      { key: 'season_from_date', token: '{{ season_from_date }}', descriptionKey: 'filenameRefItemSeasonFromDateDesc', example: '2026', kind: 'liquid' },
      { key: 'season_episode_from_date', token: '{{ season_episode_from_date }}', descriptionKey: 'filenameRefItemSeasonEpisodeFromDateDesc', example: 's2026e0430', kind: 'liquid' },
      { key: 'season_episode_index_from_date', token: '{{ season_episode_index_from_date }}', descriptionKey: 'filenameRefItemSeasonEpisodeIndexFromDateDesc', example: 's2026e043001', kind: 'liquid' },
      { key: 'season_by_year__episode_by_date', token: '{{ season_by_year__episode_by_date }}', descriptionKey: 'filenameRefItemSeasonByYearEpisodeByDateDesc', example: 'Season 2026/s2026e0430', kind: 'liquid' },
      { key: 'season_by_year__episode_by_date_and_index', token: '{{ season_by_year__episode_by_date_and_index }}', descriptionKey: 'filenameRefItemSeasonByYearEpisodeByDateAndIndexDesc', example: 'Season 2026/s2026e043001', kind: 'liquid' },
    ],
  },
  {
    id: 'static',
    titleKey: 'filenameRefSectionStaticTitle',
    items: [
      { key: 'static_season__episode_by_index', token: '{{ static_season__episode_by_index }}', descriptionKey: 'filenameRefItemStaticSeasonEpisodeByIndexDesc', example: 'Season 1/s01e01', kind: 'liquid' },
      { key: 'static_season__episode_by_date', token: '{{ static_season__episode_by_date }}', descriptionKey: 'filenameRefItemStaticSeasonEpisodeByDateDesc', example: 'Season 1/s01e20260430', kind: 'liquid' },
    ],
  },
  {
    id: 'raw-metadata',
    titleKey: 'filenameRefSectionRawMetadataTitle',
    descriptionKey: 'filenameRefSectionRawMetadataDescription',
    items: [
      { key: 'generic_single_word', token: '{{ extractor }}', descriptionKey: 'filenameRefItemGenericSingleWordDesc', example: 'youtube', kind: 'pattern' },
      { key: 'basic_ytdlp', token: '%(title)s', descriptionKey: 'filenameRefItemBasicYtdlpDesc', example: 'Sample Video', kind: 'pattern' },
      { key: 'formatted_upload_date', token: '%(upload_date>%Y-%m-%d)s', descriptionKey: 'filenameRefItemFormattedUploadDateDesc', example: '2026-04-30', kind: 'pattern' },
      { key: 'formatted_duration', token: '%(duration>%H-%M-%S)s', descriptionKey: 'filenameRefItemFormattedDurationDesc', example: '00-03-32', kind: 'pattern' },
      { key: 'nested_path', token: '%(subtitles.en.-1.ext)s', descriptionKey: 'filenameRefItemNestedPathDesc', example: 'vtt', kind: 'pattern' },
    ],
  },
];
