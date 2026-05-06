export type DownloadFilenamePresetId =
  | "legacy"
  | "channel_year_date_index"
  | "playlist_static_index"
  | "playlist_static_date"
  | "custom";

export interface FilenameTemplateContext {
  title: string;
  id: string;
  ext: string;
  uploader: string;
  channel: string;
  uploadDate: string; // YYYYMMDD
  uploadYear: string;
  uploadMonth: string;
  uploadDay: string;
  durationSeconds?: number;
  durationString: string;
  artistName: string;
  sourceCustomName: string;
  sourceCollectionName: string;
  sourceCollectionId: string;
  sourceCollectionType: "channel" | "playlist" | "single" | "unknown";
  mediaPlaylistIndex?: number;
  mediaPlaylistIndexWithinDate?: number;
  platform: "youtube" | "bilibili" | "twitch" | "missav" | "local" | "unknown";
  sourceUrl?: string;
  rawInfo?: Record<string, unknown>;
}

export interface FilenameTemplateSourceOptions {
  sourceCustomName?: string;
  sourceCollectionName?: string;
  sourceCollectionId?: string;
  sourceCollectionType?: "channel" | "playlist" | "single" | "unknown";
  mediaPlaylistIndex?: number;
  // Per-day collision counter used by `season_episode_index_from_date` and
  // `season_by_year__episode_by_date_and_index` aliases. Populated by the
  // batch rename job (and downloaders that scan local records on the day);
  // defaults to mediaPlaylistIndex when omitted.
  mediaPlaylistIndexWithinDate?: number;
}

export interface RenderFilenameTemplateInput {
  template: string;
  context: FilenameTemplateContext;
  mode: "video" | "thumbnail" | "subtitle";
  extension: string;
  subtitleLanguage?: string;
}

export interface TemplateWarning {
  code: string;
  message: string;
}

export interface RenderedMediaPath {
  relativePath: string;
  directory: string;
  basename: string;
  basenameWithoutExt: string;
  extension: string;
  warnings: TemplateWarning[];
}

export interface PlannedMediaOutput {
  video: {
    relativePath: string;
    absolutePath: string;
    webPath: string;
    filename: string;
    basenameWithoutExt: string;
  };
  thumbnail: {
    relativePath: string;
    absolutePath: string;
    webPath: string;
    filename: string;
  };
  subtitle: {
    relativeDirectory: string;
    absoluteDirectory: string;
    webDirectory: string;
    baseNameWithoutLanguageOrExt: string;
  };
  warnings: TemplateWarning[];
}
