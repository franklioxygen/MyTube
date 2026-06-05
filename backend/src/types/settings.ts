export type DownloadFilenamePresetId =
  | "legacy"
  | "channel_year_date_index"
  | "playlist_static_index"
  | "playlist_static_date"
  | "custom";

export type MediaServerExportMode = "off" | "nfo" | "nfo_and_source_json";

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
  saveAuthorFilesToCollection?: boolean;
  visitorPassword?: string;
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
  defaultVideoCodec?: string;
  authorTags?: Record<string, string[]>;
  collectionTags?: Record<string, string[]>;
  showTagsOnThumbnail?: boolean;
  playFromBeginning?: boolean;
  theme?: 'light' | 'dark' | 'system';
  showThemeButton?: boolean;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramDownloadEnabled?: boolean;
  telegramNotifyOnSuccess?: boolean;
  telegramNotifyOnFail?: boolean;
  twitchClientId?: string;
  twitchClientSecret?: string;
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
  infiniteScroll: false,
  videoColumns: 4,
  pauseOnFocusLoss: false,
  playSoundOnTaskComplete: "",
  tmdbApiKey: "",
  showTagsOnThumbnail: true,
  playFromBeginning: false,
  showThemeButton: true,
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  telegramDownloadEnabled: false,
  telegramNotifyOnSuccess: true,
  telegramNotifyOnFail: true,
  twitchClientId: "",
  twitchClientSecret: "",
  downloadFilenamePresetId: "legacy",
  downloadFilenameTemplate: "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}",
  mediaServerExportMode: "off",
  statisticsEnabled: false,
  statisticsRetentionDays: 365,
  statisticsCaptureSearchText: false,
  statisticsTrackVisitorActivity: false,
  statisticsKeepDataWhenDisabled: true,
};
