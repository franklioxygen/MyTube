export interface Settings {
  loginEnabled: boolean;
  password?: string;
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
  password: "",
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
