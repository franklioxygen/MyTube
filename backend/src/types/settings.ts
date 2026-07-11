export type DownloadFilenameMode = "legacy" | "template";

export type DownloadFilenamePresetId =
  | "legacy"
  | "media_center_date_index"
  | "source_date_flat"
  | "channel_year_date_index"
  | "playlist_static_index"
  | "playlist_static_date"
  | "custom";

export const LEGACY_DOWNLOAD_FILENAME_TEMPLATE =
  "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}";

export type MediaServerExportMode = "off" | "nfo" | "nfo_and_source_json";
export type AuthorOrganizationMode =
  | "root"
  | "author_folder_only"
  | "author_collection_linked";
export const PREFERRED_VIDEO_CONTAINERS = [
  "auto",
  "mp4",
  "webm",
  "mkv",
] as const;
export type PreferredVideoContainer = (typeof PREFERRED_VIDEO_CONTAINERS)[number];
export type ExplicitPreferredVideoContainer = Exclude<
  PreferredVideoContainer,
  "auto"
>;

export type LiveTranslationModel = "gemini-3.5-live-translate-preview";
export const AUDIO_FORMATS = ["m4a", "mp3", "opus"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export function normalizeAudioFormat(value: unknown): AudioFormat {
  return typeof value === "string" && AUDIO_FORMATS.includes(value as AudioFormat)
    ? (value as AudioFormat)
    : "m4a";
}

export interface Settings {
  loginEnabled: boolean;
  password?: string;
  apiKeyEnabled?: boolean;
  apiKey?: string;
  passwordLoginAllowed?: boolean;
  defaultAutoPlay: boolean;
  defaultAutoLoop: boolean;
  maxConcurrentDownloads: number;
  autoRetryEnabled?: boolean;
  autoRetryTimes?: number;
  autoRetryIntervalMinutes?: number;
  // Days to keep completed download-history rows (success/failed/partial/
  // skipped). 0 disables pruning. Rows for deleted videos and pending retries
  // are always kept — other features read them.
  downloadHistoryRetentionDays?: number;
  dontSkipDeletedVideo?: boolean;
  language: string;
  tags?: string[];
  cloudDriveEnabled?: boolean;
  openListApiUrl?: string;
  openListToken?: string;
  openListPublicUrl?: string;
  cloudDrivePath?: string;
  cloudDriveScanPaths?: string;
  homeSidebarOpen?: boolean;
  subtitlesEnabled?: boolean;
  websiteName?: string;
  itemsPerPage?: number;
  ytDlpConfig?: string;
  showYoutubeSearch?: boolean;
  proxyOnlyYoutube?: boolean;
  moveSubtitlesToVideoFolder?: boolean;
  moveThumbnailsToVideoFolder?: boolean;
  authorOrganizationMode?: AuthorOrganizationMode;
  saveAuthorFilesToCollection?: boolean;
  visitorPassword?: string;
  visitorPasswordMigratedAt?: number;
  visitorUserEnabled?: boolean;
  infiniteScroll?: boolean;
  videoColumns?: number;
  cloudflaredTunnelEnabled?: boolean;
  cloudflaredToken?: string;
  allowedHosts?: string;
  pauseOnFocusLoss?: boolean;
  playSoundOnTaskComplete?: string;
  tmdbApiKey?: string;
  mountDirectories?: string;
  defaultSort?: string;
  preferredAudioLanguage?: string;
  audioFormat?: AudioFormat;
  defaultVideoCodec?: string;
  preferredVideoContainer?: PreferredVideoContainer;
  // Preferred maximum video resolution height (issue #295). "auto" lets the
  // downloader pick the best available; a numeric string (e.g. "1080") caps the
  // selection. When preferredVideoResolutionStrict is true, an episode that
  // cannot meet the cap fails instead of falling back to a lower resolution.
  preferredVideoResolution?: string;
  preferredVideoResolutionStrict?: boolean;
  authorTags?: Record<string, string[]>;
  collectionTags?: Record<string, string[]>;
  showTagsOnThumbnail?: boolean;
  playFromBeginning?: boolean;
  theme?: 'light' | 'dark' | 'system';
  showThemeButton?: boolean;
  showAudioDownloadButton?: boolean;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramDownloadEnabled?: boolean;
  telegramNotifyOnSuccess?: boolean;
  telegramNotifyOnFail?: boolean;
  twitchClientId?: string;
  twitchClientSecret?: string;
  downloadFilenameMode?: DownloadFilenameMode;
  downloadFilenamePresetId?: DownloadFilenamePresetId;
  downloadFilenameTemplate?: string;
  mediaServerExportMode?: MediaServerExportMode;
  // Statistics
  statisticsEnabled?: boolean;
  statisticsRetentionDays?: number | null;
  statisticsCaptureSearchText?: boolean;
  statisticsTrackVisitorActivity?: boolean;
  statisticsKeepDataWhenDisabled?: boolean;
  statisticsTimezone?: string;
  // Live audio translation
  liveTranslationEnabled?: boolean;
  liveTranslationModel?: LiveTranslationModel;
  liveTranslationApiKey?: string;
  liveTranslationSourceLanguage?: string; // currently "auto" only
  liveTranslationTargetLanguage?: string; // BCP-47
  liveTranslationApiKeyConfigured?: boolean; // response-only, not persisted
}

// nosemgrep: codacy.javascript.security.hard-coded-password
export const DEFAULT_ADMIN_PASSWORD = "123";

export const defaultSettings: Settings = {
  loginEnabled: false,
  password: "",
  apiKeyEnabled: false,
  apiKey: "",
  defaultAutoPlay: false,
  defaultAutoLoop: false,
  maxConcurrentDownloads: 3,
  autoRetryEnabled: false,
  autoRetryTimes: 3,
  autoRetryIntervalMinutes: 5,
  downloadHistoryRetentionDays: 0,
  language: "en",
  theme: "system",
  defaultSort: "dateDesc",
  cloudDriveEnabled: false,
  openListApiUrl: "",
  openListToken: "",
  openListPublicUrl: "",
  cloudDrivePath: "",
  cloudDriveScanPaths: "",
  homeSidebarOpen: true,
  subtitlesEnabled: true,
  websiteName: "MyTube",
  itemsPerPage: 12,
  showYoutubeSearch: true,
  authorOrganizationMode: "root",
  preferredVideoContainer: "auto",
  audioFormat: "m4a",
  preferredVideoResolution: "auto",
  preferredVideoResolutionStrict: false,
  infiniteScroll: false,
  videoColumns: 4,
  pauseOnFocusLoss: false,
  playSoundOnTaskComplete: "",
  tmdbApiKey: "",
  showTagsOnThumbnail: true,
  playFromBeginning: false,
  showThemeButton: true,
  showAudioDownloadButton: true,
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  telegramDownloadEnabled: false,
  telegramNotifyOnSuccess: true,
  telegramNotifyOnFail: true,
  twitchClientId: "",
  twitchClientSecret: "",
  downloadFilenameMode: "legacy",
  downloadFilenameTemplate: LEGACY_DOWNLOAD_FILENAME_TEMPLATE,
  mediaServerExportMode: "off",
  statisticsEnabled: false,
  statisticsRetentionDays: 365,
  statisticsCaptureSearchText: false,
  statisticsTrackVisitorActivity: false,
  statisticsKeepDataWhenDisabled: true,
  liveTranslationEnabled: false,
  liveTranslationModel: "gemini-3.5-live-translate-preview",
  liveTranslationApiKey: "",
  liveTranslationSourceLanguage: "auto",
  liveTranslationTargetLanguage: "en",
};

export function isAuthorOrganizationMode(
  value: unknown
): value is AuthorOrganizationMode {
  return (
    value === "root" ||
    value === "author_folder_only" ||
    value === "author_collection_linked"
  );
}

export function resolveAuthorOrganizationMode(settings: {
  authorOrganizationMode?: unknown;
  saveAuthorFilesToCollection?: unknown;
}): AuthorOrganizationMode {
  if (isAuthorOrganizationMode(settings.authorOrganizationMode)) {
    return settings.authorOrganizationMode;
  }

  return settings.saveAuthorFilesToCollection === true
    ? "author_collection_linked"
    : "root";
}

export function authorOrganizationModeToLegacySetting(
  mode: AuthorOrganizationMode
): boolean {
  return mode === "author_collection_linked";
}

export function usesAuthorCollectionLinking(
  mode: AuthorOrganizationMode
): boolean {
  return mode === "author_collection_linked";
}

export function usesAuthorFolderOrganization(
  mode: AuthorOrganizationMode
): boolean {
  return mode !== "root";
}

export function isPreferredVideoContainer(
  value: unknown
): value is PreferredVideoContainer {
  return (
    typeof value === "string" &&
    PREFERRED_VIDEO_CONTAINERS.includes(value as PreferredVideoContainer)
  );
}

export function normalizePreferredVideoContainer(
  value: unknown
): PreferredVideoContainer {
  if (typeof value !== "string") {
    return "auto";
  }

  const normalized = value.trim().toLowerCase();
  return isPreferredVideoContainer(normalized) ? normalized : "auto";
}

export function resolveExplicitPreferredVideoContainer(settings: {
  preferredVideoContainer?: unknown;
}): ExplicitPreferredVideoContainer | null {
  const normalized = normalizePreferredVideoContainer(
    settings.preferredVideoContainer
  );
  return normalized === "auto" ? null : normalized;
}
