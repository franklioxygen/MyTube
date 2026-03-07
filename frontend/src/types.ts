export interface Video {
  id: string;
  title: string;
  author: string;
  date: string;
  source: "youtube" | "bilibili" | "local" | "missav";
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
  duration?: string;
  fileSize?: string; // Size in bytes as string
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

export interface Collection {
  id: string;
  name: string;
  videos: string[];
  createdAt: string;
  updatedAt?: string;
  [key: string]: any;
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

export interface Settings {
  platformMountDirectories?: PlatformMountDirectoryDescriptor[];
  mountDirectories?: string;
  ytDlpSafeConfig?: YtDlpSafeConfig;
  securityModel?: "strict" | "legacy";
  highRiskFeaturesDisabled?: {
    hooks?: boolean;
    ytDlpConfig?: boolean;
    mountDirectories?: boolean;
    cloudflaredControl?: boolean;
  };
  loginEnabled: boolean;
  fastRetryMode?: boolean;
  password?: string;
  apiKeyEnabled?: boolean;
  apiKey?: string;
  isPasswordSet?: boolean;
  passwordLoginAllowed?: boolean;
  allowResetPassword?: boolean;
  isVisitorPasswordSet?: boolean;
  defaultAutoPlay: boolean;
  defaultAutoLoop: boolean;
  maxConcurrentDownloads: number;
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
  defaultSort?: string;
  showTagsOnThumbnail?: boolean;
  preferredAudioLanguage?: string;
  defaultVideoCodec?: string;
  authorTags?: Record<string, string[]>;
  collectionTags?: Record<string, string[]>;
  playFromBeginning?: boolean;
  theme?: 'light' | 'dark' | 'system';
  showThemeButton?: boolean;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramNotifyOnSuccess?: boolean;
  telegramNotifyOnFail?: boolean;
}

export interface YtDlpSafeConfig {
  maxResolution?: 360 | 480 | 720 | 1080 | 1440 | 2160 | 4320;
  mergeOutputFormat?: "mp4" | "webm" | "mkv";
  proxy?: string;
  limitRate?: string;
  retries?: number;
  concurrentFragments?: number;
  socketTimeout?: number;
  forceIpVersion?: "ipv4" | "ipv6";
  xff?: string;
  sleepRequests?: number;
  sleepInterval?: number;
  maxSleepInterval?: number;
}

export interface PlatformMountDirectoryDescriptor {
  id: string;
  label: string;
}
