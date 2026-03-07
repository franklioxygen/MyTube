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

export interface Settings {
  loginEnabled: boolean;
  bootstrapCompleted?: boolean;
  strictSecurityMigrationVersion?: number;
  ytDlpSafeConfigMigrationVersion?: number;
  passwordRecoveryTokenHash?: string;
  passwordRecoveryTokenExpiresAt?: number;
  passwordRecoveryTokenIssuedAt?: number;
  password?: string;
  apiKeyEnabled?: boolean;
  apiKey?: string;
  passwordLoginAllowed?: boolean;
  allowResetPassword?: boolean;
  defaultAutoPlay: boolean;
  defaultAutoLoop: boolean;
  maxConcurrentDownloads: number;
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
  ytDlpSafeConfig?: YtDlpSafeConfig;
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
  fastRetryMode?: boolean;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramNotifyOnSuccess?: boolean;
  telegramNotifyOnFail?: boolean;
}

export const defaultSettings: Settings = {
  loginEnabled: false,
  bootstrapCompleted: false,
  strictSecurityMigrationVersion: 0,
  ytDlpSafeConfigMigrationVersion: 0,
  passwordRecoveryTokenHash: "",
  passwordRecoveryTokenExpiresAt: 0,
  passwordRecoveryTokenIssuedAt: 0,
  ytDlpSafeConfig: {},
  password: "",
  apiKeyEnabled: false,
  apiKey: "",
  defaultAutoPlay: false,
  defaultAutoLoop: false,
  maxConcurrentDownloads: 3,
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
  showTagsOnThumbnail: true,
  playFromBeginning: false,
  showThemeButton: true,
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  telegramNotifyOnSuccess: true,
  telegramNotifyOnFail: true,
};
