export interface Video {
  id: string;
  title: string;
  author: string;
  date: string;
  source: "youtube" | "bilibili" | "twitch" | "local" | "missav";
  sourceUrl: string;
  videoFilename?: string;
  thumbnailFilename?: string;
  thumbnailUrl?: string;
  videoPath?: string;
  thumbnailPath?: string | null;
  addedAt: string;
  partNumber?: number;
  totalParts?: number;
  seriesTitle?: string;
  rating?: number;
  tags?: string[];
  viewCount?: number;
  progress?: number;
  progressUpdatedAt?: number;
  duration?: string;
  fileSize?: string; // Size in bytes as string
  width?: number;
  height?: number;
  mediaType?: 'video' | 'audio';
  lastPlayedAt?: number;
  subtitles?: Array<{ language: string; filename: string; path: string }>;
  description?: string;
  visibility?: number; // 1 = visible, 0 = hidden
  signedUrl?: string; // Pre-signed URL for cloud video
  signedThumbnailUrl?: string; // Pre-signed URL for cloud thumbnail
  authorAvatarFilename?: string;
  authorAvatarPath?: string;
  [key: string]: any;
}

/**
 * One entry of the external (YouTube/Bilibili) search results returned by
 * GET /api/search — see backend ytdlpSearch.ts for the field mapping.
 */
export interface VideoSearchResult {
  id: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  duration?: number | string;
  viewCount?: number;
  sourceUrl: string;
  source: "youtube" | "bilibili";
}

export interface Collection {
  id: string;
  name: string;
  videos: string[];
  createdAt: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface FavoriteCollectionItem {
  collectionId: string;
  name: string;
  title?: string;
  sourcePlatform?: string;
  videoCount: number;
  thumbnailVideoId?: string;
  favoritedAt: number;
}

export interface FavoriteAuthorItem {
  author: string;
  displayName: string;
  avatarPath?: string;
  channelUrl?: string;
  videoCount: number;
  favoritedAt: number;
}

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp?: number;
  progress?: number;
  speed?: string;
  totalSize?: string;
  downloadedSize?: string;
  filename?: string;
  sourceUrl?: string;
  type?: string;
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  date: string;
  avatar?: string;
}

export type AuthorOrganizationMode =
  | 'root'
  | 'author_folder_only'
  | 'author_collection_linked';

export type AdminTrustLevel = 'application' | 'container' | 'host';

export type LiveTranslationModel = 'gemini-3.5-live-translate-preview';

export interface VisitorUser {
  id: string;
  username: string;
  role: 'visitor';
  enabled: boolean;
  isLegacyShared: boolean;
  sessionVersion?: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface DeploymentSecurityModel {
  adminTrustLevel: AdminTrustLevel;
  adminTrustedWithContainer: boolean;
  adminTrustedWithHost: boolean;
  source: 'env';
}

export interface Settings {
  loginEnabled: boolean;
  password?: string;
  apiKeyEnabled?: boolean;
  apiKey?: string;
  isPasswordSet?: boolean;
  passwordLoginAllowed?: boolean;
  isVisitorPasswordSet?: boolean;
  hasVisitorUsers?: boolean;
  defaultAutoPlay: boolean;
  defaultAutoLoop: boolean;
  maxConcurrentDownloads: number;
  autoRetryEnabled?: boolean;
  autoRetryTimes?: number;
  autoRetryIntervalMinutes?: number;
  // Days to keep completed download-history entries; 0 = keep forever.
  downloadHistoryRetentionDays?: number;
  dontSkipDeletedVideo?: boolean;
  language: string;
  tags: string[];
  cloudDriveEnabled: boolean;
  openListApiUrl: string;
  openListToken: string;
  openListPublicUrl?: string;
  cloudDrivePath: string;
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
  visitorUserEnabled?: boolean;
  infiniteScroll?: boolean;
  videoColumns?: number;
  cloudflaredTunnelEnabled?: boolean;
  cloudflaredToken?: string;
  allowedHosts?: string;
  pauseOnFocusLoss?: boolean;
  hooks?: {
    task_before_start?: string;
    task_success?: string;
    task_fail?: string;
    task_cancel?: string;
  };
  playSoundOnTaskComplete?: string;
  tmdbApiKey?: string;
  mountDirectories?: string;
  defaultSort?: string;
  showTagsOnThumbnail?: boolean;
  preferredAudioLanguage?: string;
  audioFormat?: 'm4a' | 'mp3' | 'opus';
  defaultVideoCodec?: string;
  preferredVideoContainer?: 'auto' | 'mp4' | 'webm' | 'mkv';
  preferredVideoResolution?: string;
  preferredVideoResolutionStrict?: boolean;
  authorTags?: Record<string, string[]>;
  collectionTags?: Record<string, string[]>;
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
  deploymentSecurity?: DeploymentSecurityModel;
  downloadFilenameMode?: 'legacy' | 'template';
  downloadFilenamePresetId?:
    | 'legacy'
    | 'media_center_date_index'
    | 'source_date_flat'
    | 'channel_year_date_index'
    | 'playlist_static_index'
    | 'playlist_static_date'
    | 'custom';
  downloadFilenameTemplate?: string;
  mediaServerExportMode?: 'off' | 'nfo' | 'nfo_and_source_json';
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
