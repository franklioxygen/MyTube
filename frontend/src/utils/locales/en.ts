export const en = {
  // Header
  myTube: "MyTube",
  manage: "Manage",
  settings: "Settings",
  logout: "Logout",
  pleaseEnterUrlOrSearchTerm: "Please enter a video URL or search term",
  unexpectedErrorOccurred: "An unexpected error occurred. Please try again.",
  uploadVideo: "Upload Video",
  enterUrlOrSearchTerm: "Enter video URL or search term",
  enterSearchTerm: "Enter search term",

  manageVideos: "Manage Videos",
  instruction: "Instruction",

  // Home
  pasteUrl: "Paste video or collection URL",
  download: "Download",
  search: "Search",
  recentDownloads: "Recent Downloads",
  noDownloads: "No downloads yet",
  downloadStarted: "Download started",
  downloadFailed: "Download failed",
  downloadSuccess: "Download started successfully",
  downloadAudioOnly: "Download audio only",
  downloadAudioOnlyHint: "Stores only the audio track (no video).",
  audioFormat: "Audio format",
  audioFormatM4a: "M4A",
  audioFormatMp3: "MP3",
  audioFormatOpus: "Opus",
  confirmDownloadAllPlaylists:
    "Download all playlists from this channel? This will create a collection for each playlist.",
  downloadAll: "Download All",
  loadingVideos: "Loading videos...",
  searchResultsFor: "Search Results for",
  fromYourLibrary: "From Your Library",
  noMatchingVideos: "No matching videos in your library.",
  fromYouTube: "From YouTube",
  loadingYouTubeResults: "Loading YouTube results...",
  noYouTubeResults: "No YouTube results found",
  noVideosYet: "No videos yet. Submit a video URL to download your first one!",
  views: "views",

  // Settings
  general: "General",
  security: "Security",
  videoDefaults: "Video Player Defaults",
  downloadSettings: "Download Settings",
  // Settings Categories
  basicSettings: "Basic Settings",
  interfaceDisplay: "Interface & Display",
  securityAccess: "Security & Access",
  videoPlayback: "Video Playback",
  downloadStorage: "Download & Storage",
  contentManagement: "Content Management",
  dataManagement: "Data Management",
  advanced: "Advanced",
  language: "Language",
  websiteName: "Website Name",
  websiteNameHelper: "{current}/{max} characters (Default: {default})",
  theme: "Theme",
  themeLight: "Always Light",
  themeDark: "Always Dark",
  themeSystem: "Match System",
  showThemeButtonInHeader: "Show theme button in header",
  showAudioDownloadButton: "Show audio download button",
  tmdbApiKey: "TMDB API Key",
  tmdbApiKeyHelper:
    "TheMovieDB API key for scraping movie/TV show metadata and posters. Get your key at https://www.themoviedb.org/settings/api",
  testTmdbCredential: "Test Credential",
  tmdbCredentialMissing: "Please enter a TMDB credential first.",
  tmdbCredentialValid: "TMDB credential is valid.",
  tmdbCredentialTestFailed: "Failed to test TMDB credential.",
  tmdbCredentialValidApiKey: "TMDB API key is valid.",
  tmdbCredentialValidReadAccessToken: "TMDB Read Access Token is valid.",
  tmdbCredentialInvalid:
    "TMDB credential is invalid. Check whether it is a valid API key or Read Access Token.",
  tmdbCredentialRequestFailed: "Failed to reach TMDB. Please try again.",
  mountDirectories: "Mount Directories",
  mountDirectoriesPlaceholder:
    "Enter mount directories (one per line)\nExample:\n/mnt/media1\n/mnt/media2",
  mountDirectoriesHelper:
    "Enter mount directories where video files are stored, one directory per line",
  mountDirectoriesEmptyError: "Please enter at least one mount directory",
  infiniteScroll: "Infinite Scroll",
  infiniteScrollDisabled: "Disabled when Infinite Scroll is enabled",
  maxVideoColumns: "Maximum Video Columns (Homepage)",
  videoColumns: "Video Columns (Homepage)",
  columnsCount: "{count} Columns",
  enableLogin: "Enable Login Protection",
  allowPasswordLogin: "Allow Password Login",
  allowPasswordLoginHelper:
    "When disabled, password login is not available. You must have at least one passkey to disable password login.",
  allowPasswordLoginHttpsOnlyHelper:
    "To disable password login, open this page over HTTPS or localhost. Passkey-only login requires a secure origin.",
  allowResetPassword: "Allow Reset Password",
  allowResetPasswordHelper:
    "When disabled, the reset password button will not be shown on the login page and the reset password API will be blocked.",
  enableApiKeyAuth: "Enable API Key Authentication",
  apiKeyAuthHelper:
    "When enabled, API requests can be authorized with X-API-Key without a login session.",
  apiKey: "API Key",
  refreshApiKey: "Refresh",
  refreshApiKeyTitle: "Refresh API Key",
  refreshApiKeyConfirm: "Regenerating the API key will invalidate the existing one. All clients using the old key will need to be updated after saving.",
  copyApiKey: "Copy",
  apiKeySaveHint: "Save settings to activate changes to the API key.",
  apiKeyCopied: "API key copied to clipboard",
  apiKeyCopyFailed: "Failed to copy API key. Please copy it manually.",
  password: "Password",
  enterPassword: "Enter Password",
  togglePasswordVisibility: "Toggle password visibility",
  passwordHelper: "Leave empty to keep current password, or type to change",
  passwordSetHelper: "Set a password for accessing the application",
  autoPlay: "Auto-play videos on load",
  autoLoop: "Auto-loop Videos",
  maxConcurrent: "Max Concurrent Downloads",
  maxConcurrentDescription:
    "Limits the number of simultaneous downloads, including regular downloads and continuous subscription tasks.",
  autoRetry: "Auto Retry",
  autoRetryDescription:
    "Automatically reschedule failed downloads after a fixed delay.",
  retryTimes: "Retry Times",
  retryTimesDescription:
    "Select how many times the system retries a failed task.",
  retryInterval: "Retry Interval",
  retryIntervalDescription:
    "Select how long the system waits before retrying a failed task.",
  dontSkipDeletedVideo: "Don't skip deleted video",
  dontSkipDeletedVideoDescription:
    "When enabled, videos with deleted status will be re-downloaded automatically instead of being skipped.",
  mediaServerExportMode: "Media server sidecar export",
  mediaServerExportModeDescription:
    "Write Kodi-style NFO sidecars and artwork aliases beside videos for Emby, Jellyfin, and Plex. Best results use a show/season filename preset.",
  mediaServerExportModeOff: "Off",
  mediaServerExportModeNfo: "Write NFO sidecars",
  mediaServerExportModeNfoAndSourceJson:
    "Write NFO and additionally generate .info.json",
  mediaServerExportModeOffDescription:
    "Do not generate new sidecars for future downloads. You can still clean up files that MyTube generated earlier.",
  mediaServerExportCleanupHint:
    "Current mode only cleans up previously generated sidecar files and will not generate new ones.",
  mediaServerExportRecommendedLayoutWarning:
    "The current filename layout preview is not TV-library friendly yet. Emby, Jellyfin, and Plex work best with show folders and Season XX subfolders.",
  mediaServerExportRebuild: "Rebuild Media Server Sidecars",
  mediaServerExportRebuildConfirmTitle: "Rebuild media server sidecars?",
  mediaServerExportRebuildConfirmBody:
    "This rewrites MyTube-owned NFO, source JSON, and artwork sidecar files for existing local videos. Manual edits to generated sidecars may be overwritten.",
  mediaServerExportRebuildError: "Failed to rebuild media server sidecars.",
  mediaServerExportRebuildRunning: "Rebuilding media server sidecars",
  mediaServerExportRebuildComplete: "Media server sidecar rebuild complete",
  mediaServerExportRebuildSummary:
    "{succeeded} updated, {skipped} skipped, {failed} failed.",
  mediaServerExportRebuildDisabledOff:
    "Choose an NFO export mode before rebuilding sidecars.",
  mediaServerExportRebuildDisabledRunning:
    "A media server sidecar rebuild is already running.",
  mediaServerExportCleanup: "Clean Up Media Server Sidecars",
  mediaServerExportCleanupConfirmTitle: "Clean up media server sidecars?",
  mediaServerExportCleanupConfirmBody:
    "This removes MyTube-generated NFO, source JSON, and artwork sidecar files for existing local videos. Video files and thumbnails are not deleted.",
  mediaServerExportCleanupError: "Failed to clean up media server sidecars.",
  mediaServerExportCleanupRunning: "Cleaning up media server sidecars",
  mediaServerExportCleanupComplete: "Media server sidecar cleanup complete",
  mediaServerExportCleanupSummary:
    "{succeeded} cleaned, {skipped} skipped, {failed} failed.",
  mediaServerExportSweptSummary:
    "Also removed {count} orphaned sidecar files.",
  mediaServerExportActiveDownloadsError:
    "Cannot run media server sidecar maintenance while downloads are active.",
  mediaServerExportQueuedDownloadsError:
    "Cannot run media server sidecar maintenance while downloads are queued.",
  mediaServerExportUnsupportedModeError:
    "The selected media server export mode is not supported.",
  mediaServerExportCleanupUnsupportedModeError:
    "This server version does not support cleanup while media server sidecar export is off.",
  liveTranslation: "Live audio translation",
  liveTranslationDescription:
    "Stream the current video's audio to Gemini Live Translation and show live subtitles, with optional translated speech playback. While active, the video's audio is sent to Google's Gemini API.",
  enableLiveTranslation: "Enable live audio translation",
  liveTranslationOriginalAudioWithSubtitles: "Original audio and translated subtitle",
  liveTranslationOriginalAudioWithSubtitlesDescription:
    "Keep the video's original audio and show translated subtitles without playing translated speech.",
  liveTranslationApiKey: "Gemini API key",
  liveTranslationApiKeyConfigured: "API key is configured",
  liveTranslationApiKeyReplaceHelper:
    "An API key is configured. Enter a new key to replace it, or leave blank to keep the current key.",
  liveTranslationClearApiKey: "Clear key",
  liveTranslationModel: "Live translation model",
  liveTranslationSourceLanguage: "Source language",
  liveTranslationTargetLanguage: "Target language",
  liveTranslationSourceAuto: "Auto-detect",
  liveTranslationTargetRequired: "A target language is required.",
  liveTranslationSettingsSaved: "Live translation settings saved.",
  liveTranslationDocumentation: "Gemini Live Translation documentation",
  liveTranslate: "Live Translate",
  stopLiveTranslation: "Stop Live Translation",
  liveTranslationConnecting: "Connecting…",
  liveTranslationTranslatingTo: "Translating to {language}",
  liveTranslationPaused: "Paused",
  liveTranslationRetry: "Retry",
  liveTranslationUnavailable: "Live translation is currently unavailable.",
  liveTranslationUnsupportedBrowser:
    "Live translation is not supported in this browser.",
  liveTranslationInsecureContext:
    "Live translation requires a secure connection (HTTPS or localhost).",
  liveTranslationAudioCaptureBlocked:
    "Live translation is unavailable for this video's audio source.",
  liveTranslationAdminRequiredPlayer:
    "Live translation requires an admin account.",
  liveTranslationApiKeyMissingPlayer:
    "Live translation is not configured. Add a Gemini API key in Settings.",
  liveTranslationErrorGeneric: "Live translation error. Please try again.",
  liveTranslationErrorRequiresNormalSpeed:
    "Live translation requires 1x playback speed.",
  liveTranslationErrorTicket:
    "Your live translation session could not start. Please try again.",
  liveTranslationErrorCaptureFailed: "Could not capture this video's audio.",
  liveTranslationErrorConnection:
    "Could not connect to the translation service. Please try again.",
  liveTranslationErrorWebSocket:
    "Couldn't open the live translation connection. If this site is behind a reverse proxy, make sure it forwards WebSocket (Upgrade) requests for /api/live-translation/ws.",
  liveTranslationErrorRateLimited:
    "The translation service is busy. Please try again shortly.",
  liveTranslationErrorSessionTimeout:
    "The live translation session reached its time limit. You can restart it.",
  liveTranslationErrorTooManySessions:
    "Too many active live translation sessions. Please try again shortly.",
  preferredAudioLanguage: "Preferred audio language",
  preferredAudioLanguageDescription:
    "When available, YouTube multistream audio in this language will be preferred for downloads.",
  preferredAudioLanguageDefault: "Default",
  preferredAudioLanguage_en: "English",
  preferredAudioLanguage_zh: "Chinese",
  preferredAudioLanguage_ja: "Japanese",
  preferredAudioLanguage_ko: "Korean",
  preferredAudioLanguage_es: "Spanish",
  preferredAudioLanguage_fr: "French",
  preferredAudioLanguage_de: "German",
  preferredAudioLanguage_pt: "Portuguese",
  preferredAudioLanguage_ru: "Russian",
  preferredAudioLanguage_ar: "Arabic",
  preferredAudioLanguage_hi: "Hindi",
  preferredAudioLanguage_it: "Italian",
  preferredAudioLanguage_nl: "Dutch",
  preferredAudioLanguage_pl: "Polish",
  preferredAudioLanguage_tr: "Turkish",
  preferredAudioLanguage_vi: "Vietnamese",
  preferredVideoResolution: "Preferred video resolution",
  preferredVideoResolutionDescription:
    "Prefer a maximum resolution when downloading. yt-dlp picks the best stream at or below this height, which keeps collection episodes from inconsistently falling back to a low resolution. Overridden by custom yt-dlp config.",
  preferredVideoResolutionAuto: "Auto (best available)",
  preferredVideoResolutionStrict: "Strictly enforce the resolution cap",
  preferredVideoResolutionStrictDescription:
    "When on, an episode that has no stream at or below the cap fails instead of downloading a higher resolution. Leave off to treat the resolution as a soft preference.",
  defaultVideoCodec: "Download format preset",
  defaultVideoCodecDescription:
    "Choose the default format behavior for new downloads. Auto follows MyTube's high-quality defaults. Best compatibility prefers H.264 video with MP4/M4A output. Best quality prefers VP9/WebM. This is a preference with fallbacks, and custom yt-dlp format settings override it.",
  defaultVideoCodecDefault: "Auto (MyTube default)",
  defaultVideoCodec_h264: "Best compatibility (H.264 / MP4)",
  defaultVideoCodec_h265: "Advanced: H.265 (HEVC / MP4)",
  defaultVideoCodec_av1: "Advanced: AV1 (MP4)",
  defaultVideoCodec_vp9: "Best quality (VP9 / WebM)",
  preferredVideoContainer: "Final container",
  preferredVideoContainerDescription:
    "Choose the container used for the saved file after yt-dlp merges the streams. Auto keeps the preset behavior and is safest. MP4/WebM should match the selected codec preset; MKV is best for mixed codecs and media servers, but may not play directly in browsers. Custom yt-dlp merge-output-format overrides this setting.",
  preferredVideoContainer_auto: "Auto (match preset)",
  preferredVideoContainer_mp4: "MP4",
  preferredVideoContainer_webm: "WebM",
  preferredVideoContainer_mkv: "MKV",
  saveSettings: "Save Settings",
  saving: "Saving...",
  backToManage: "Back to Manage",
  settingsSaved: "Settings saved successfully",
  settingsFailed: "Failed to save settings",
  debugMode: "Debug Mode",
  debugModeDescription: "Show or hide console messages (requires refresh)",
  telegramNotifications: "Telegram Features",
  telegramNotificationsDescription:
    "Use a Telegram Bot to add links to the download queue or receive download completion notifications.",
  telegramEnabled: "Enable Telegram Features",
  telegramBotToken: "Bot Token",
  telegramBotTokenHelper: "Create a bot via @BotFather on Telegram to get your token.",
  telegramChatId: "Chat ID",
  telegramChatIdHelper: "Message @RawDataBot on Telegram to get your chat ID.",
  telegramDownloadEnabled: "Allow Telegram link downloads",
  telegramNotifyOnSuccess: "Notify on Success",
  telegramNotifyOnFail: "Notify on Failure",
  twitchSubscriptions: "Twitch Subscriptions",
  twitchClientId: "Twitch Client ID",
  twitchClientSecret: "Twitch Client Secret",
  twitchSubscriptionCredentialsHelper:
    "Twitch client credentials are optional. Without them, MyTube falls back to yt-dlp polling in best-effort mode. Adding credentials makes channel detection more reliable.",
  twitchSubscriptionDescription:
    "MyTube will check this Twitch channel for new VODs and download them after Twitch publishes them.",
  twitchSubscriptionCredentialsMissing:
    "Twitch subscription failed. Client credentials are optional, but recommended for more reliable channel subscriptions.",
  twitchSubscriptionVodsOnly:
    "MyTube downloads Twitch VODs after they are published. Live stream capture is not included in this version.",
  twitchClientHelpLink: "How to get Twitch Client ID and Secret",
  twitchClientHelpTitle: "Get Twitch Client ID and Secret",
  twitchClientHelpIntro:
    "You need to create a Twitch application in the Twitch Developer Console first.",
  twitchClientHelpStep1:
    "Open the Twitch Developer Console and sign in with your Twitch account.",
  twitchClientHelpStep2: "Create a new application for MyTube.",
  twitchClientHelpStep3:
    "Set an OAuth Redirect URL. If you only use server-side subscriptions, a placeholder such as http://localhost is sufficient.",
  twitchClientHelpStep4:
    "After the app is created, copy the Client ID from the application details page.",
  twitchClientHelpStep5:
    "Generate or reveal a Client Secret, then paste both values into MyTube settings.",
  twitchClientHelpSecurity:
    "Keep the Client Secret private and do not share it in screenshots or public pages.",
  twitchDeveloperConsole: "Twitch Developer Console",
  twitchDeveloperDocs: "Twitch Developer Docs",
  telegramTestButton: "Send Test Message",
  telegramTestSuccess: "Test message sent successfully!",
  telegramTestFailed: "Test failed: {error}",
  telegramTestMissingFields: "Please enter both Bot Token and Chat ID first.",
  pauseOnFocusLoss: "Pause video when window loses focus",
  playFromBeginning: "Always restart videos from beginning",
  tagsManagement: "Tags Management",
  newTag: "New Tag",
  selectTags: "Select Tags",
  tags: "Tags",
  noTagsAvailable: "No tags available",
  addTag: "Add Tag",
  addTags: "Add Tags",
  failedToSaveTags: "Failed to save tags",
  renameTag: "Rename Tag",
  confirmRenameTag: "Rename",
  tagRenamedSuccess: "Tag renamed successfully",
  tagRenameFailed: "Failed to rename tag",
  tagConflictCaseInsensitive:
    "A tag with the same name already exists (tags are case-insensitive).",
  renameTagDescription:
    "Renaming a tag will verify and update all videos that currently use this tag.",
  enterNewTagName: "Enter new name for tag '{tag}'",
  // Database
  database: "Database",
  migrateDataDescription:
    "Migrate data from legacy JSON files to the new SQLite database. This action is safe to run multiple times (duplicates will be skipped).",
  migrateDataButton: "Migrate Data from JSON",
  scanFiles: "Scan Files",
  scanFilesSuccess: "Scan complete. Added {count} new videos.",
  scanFilesDeleted: " {count} missing files removed.",
  scanFilesFailed: "Scan failed",
  scanMountDirectoriesSuccess:
    "Mount directories scan complete. Added {addedCount} new videos. Deleted {deletedCount} missing videos.",
  subscribePlaylistsSuccess:
    "Successfully subscribed to {count} playlist{plural}.",
  subscribePlaylistsSkipped:
    "{count} playlist{plural} {wasWere} already subscribed.",
  subscribePlaylistsErrors: "{count} error{plural} occurred.",
  subscribePlaylistsNoNew: "No new playlists subscribed.",
  playlistsWatcher: "Playlists Watcher",
  scanFilesConfirmMessage:
    "The system will scan the root folder of the video path. New files will be added, and missing video files will be removed from the system.",
  scanning: "Scanning...",
  migrateConfirmation:
    "Are you sure you want to migrate data? This may take a few moments.",
  migrationResults: "Migration Results",
  migrationReport: "Migration Report",
  migrationSuccess: "Migration completed. See details in alert.",
  migrationNoData: "Migration finished but no data found.",
  migrationFailed: "Migration failed",
  migrationWarnings: "WARNINGS",
  migrationErrors: "ERRORS",
  itemsMigrated: "items migrated",
  fileNotFound: "File not found at",
  noDataFilesFound:
    "No data files were found to migrate. Please check your volume mappings.",
  removeLegacyData: "Remove Legacy Data",
  removeLegacyDataDescription:
    "Delete the old JSON files (videos.json, collections.json, etc.) to clean up disk space. Only do this after verifying your data has been successfully migrated.",
  removeLegacyDataConfirmTitle: "Delete Legacy Data?",
  removeLegacyDataConfirmMessage:
    "Are you sure you want to delete the legacy JSON data files? This action cannot be undone.",
  legacyDataDeleted: "Legacy data deleted successfully.",
  legacyDataDeleteFailed: "Failed to delete legacy data",
  formatLegacyFilenames: "Format Legacy Filenames",
  formatLegacyFilenamesDescription:
    "Batch rename all video files, thumbnails, and subtitles to the new standard format: Title-Author-YYYY. This operation will modify filenames on the disk and update the database logic.",
  formatLegacyFilenamesButton: "Format Filenames",
  deleteLegacyDataButton: "Delete Legacy Data",
  cleanupTempFiles: "Clean Up Temp Files",
  cleanupTempFilesDescription:
    "Remove all temporary download files (.ytdl, .part) from the uploads directory. This helps free up disk space from incomplete or cancelled downloads.",
  cleanupTempFilesConfirmTitle: "Clean Up Temporary Files?",
  cleanupTempFilesConfirmMessage:
    "This will permanently delete all .ytdl and .part files in the uploads directory. Make sure there are no active downloads before proceeding.",

  // Task Hooks
  taskHooks: "Task Hooks",
  taskHooksDescription:
    "Execute custom shell commands at specific points in the task lifecycle. Available environment variables: MYTUBE_TASK_ID, MYTUBE_TASK_TITLE, MYTUBE_SOURCE_URL, MYTUBE_VIDEO_PATH.",
  taskHooksWarning:
    "Warning: Commands run with the server's permissions. Use with caution.",
  deploymentSecurityTitle: "Deployment Security Model",
  deploymentSecurityLoading:
    "Deployment security policy is loading. Restricted features remain hidden until the policy is available.",
  deploymentSecurityDetails: "Details",
  deploymentSecurityDetailsTitle: "Deployment Security Details",
  deploymentSecurityCapabilityFeature: "Capability / Feature",
  deploymentSecurityClose: "Close",
  adminTrustLevelLabel: "Admin Trust Level",
  adminTrustLevelApplication: "Application",
  adminTrustLevelContainer: "Container",
  adminTrustLevelHost: "Host",
  adminTrustLevelApplicationDescription:
    "Admin is trusted at the application layer only.",
  adminTrustLevelContainerDescription:
    "Admin is trusted with backend/container-process-level actions.",
  adminTrustLevelHostDescription:
    "Admin is trusted with host-scoped administrative actions.",
  deploymentSecurityStandardAppManagement:
    "Standard app management (videos, collections, tags, login, backups)",
  deploymentSecurityTaskHooksCapability:
    "Task hooks upload/delete/execute",
  deploymentSecurityRawYtDlpConfigTextArea:
    "Raw yt-dlp config text area",
  deploymentSecurityFullRawYtDlpFlagPassthrough:
    "Full raw yt-dlp flag passthrough",
  deploymentSecurityMountDirectorySettingsPersistence:
    "Mount directory settings persistence",
  deploymentSecurityScanMountDirectories:
    "Scan files from configured mount directories",
  deploymentSecurityFutureHostPathMaintenanceFeatures:
    "Future host-path maintenance features",
  deploymentSecurityConfigurationTitle: "How to configure",
  deploymentSecurityConfigurationValuesNote:
    "Use MYTUBE_ADMIN_TRUST_LEVEL with application, container, or host. Missing or invalid values fall back to container.",
  deploymentSecurityDockerConfigTitle: "Docker / Docker Compose",
  deploymentSecurityDockerConfigDescription:
    "Set MYTUBE_ADMIN_TRUST_LEVEL in the service environment. Replace application with container or host as needed.",
  deploymentSecurityDockerPermissionsNote:
    "If you are upgrading a bind-mounted installation created before v1.9.0, make sure the host-side uploads and data folders are writable by uid/gid 1000 (`node`). This also fixes root-owned uploads/images-small directories that can cause thumbnail generation or scans to fail with EACCES.",
  deploymentSecurityLocalConfigTitle: "Local source run",
  deploymentSecurityLocalConfigDescription:
    "Export MYTUBE_ADMIN_TRUST_LEVEL before starting MyTube, or pass it inline when running npm run dev.",
  deploymentSecurityLocalEnvFileNote:
    "You can also put the same line in backend/.env.",
  taskHooksPolicyNotice:
    "Task hooks are disabled by deployment security policy in application trust mode.",
  hookTaskBeforeStart: "Before Task Start",
  hookTaskBeforeStartHelper: "Executes before the download begins.",
  hookTaskSuccess: "Task Success",
  hookTaskSuccessHelper:
    "Executes after successful download, before cloud upload/deletion (awaits completion).",
  hookTaskFail: "Task Failed",
  hookTaskFailHelper: "Executes when a task fails.",
  hookTaskCancel: "Task Cancelled",
  hookTaskCancelHelper: "Executes when a task is manually cancelled.",
  found: "Found",
  notFound: "Not Set",
  deleteHook: "Delete Hook Script",
  confirmDeleteHook: "Are you sure you want to delete this hook script?",
  uploadHook: "Upload .sh",
  enterPasswordToUploadHook:
    "Please enter your password to upload this hook script.",
  riskCommandDetected: "Risk command detected: {command}. Upload rejected.",
  cleanupTempFilesActiveDownloads:
    "Cannot clean up temporary files while downloads are active. Please wait for all downloads to complete or cancel them first.",
  formatFilenamesSuccess:
    "Processed: {processed}\nRenamed: {renamed}\nErrors: {errors}",
  formatFilenamesDetails: "Details:",
  formatFilenamesMore: "...and {count} more",
  formatFilenamesError: "Failed to format filenames: {error}",
  itemsPerPage: "Items Per Page",
  itemsPerPageHelper: "Number of videos to show per page (Default: 12)",
  showYoutubeSearch: "Show YouTube Search Results",
  defaultSort: "Default Video Sort Method",
  showTagsOnThumbnail: "Show Tags on Thumbnail",
  playSoundOnTaskComplete: "Play Sound on Task Complete",
  soundSuccess: "Success Chime",
  visitorModeReadOnly: "Visitor mode: Read-only",
  visitorModeUrlRestricted: "Visitors cannot process URLs",
  visitorUser: "Visitor User",
  enableVisitorUser: "Enable Visitor User",
  visitorUserHelper:
    "Enable a separate visitor account with read-only access. Visitors can view content but cannot make changes.",
  visitorPassword: "Visitor Password",
  visitorPasswordHelper: "Set the password for the visitor account.",
  visitorPasswordSetHelper: "Password is set. Leave empty to keep it.",
  visitorAccounts: "Visitor Accounts",
  addVisitorUser: "Add Visitor User",
  editVisitorUser: "Edit Visitor User",
  username: "Username",
  userStatus: "Status",
  userEnabled: "Enabled",
  userDisabled: "Disabled",
  userLastLogin: "Last login",
  userNeverLoggedIn: "Never",
  userActions: "Actions",
  enableUser: "Enable",
  disableUser: "Disable",
  deleteUser: "Delete",
  setNewPassword: "Set new password",
  generatePassword: "Generate",
  copyPassword: "Copy",
  passwordCopied: "Password copied to clipboard",
  userCreated: "Visitor user created",
  userUpdated: "Visitor user updated",
  userDeleted: "Visitor user deleted",
  userDeleteConfirm: "This removes the account and signs the user out immediately. This cannot be undone.",
  userDisableConfirm: "Disabling signs this user out everywhere. You can re-enable later.",
  userPasswordChangeWarning: "Changing the password signs this user out everywhere.",
  userUsernameInvalid: "Username must be 3-32 characters using letters, numbers, dots, dashes or underscores.",
  userUsernameReserved: "This username is reserved.",
  userUsernameTaken: "Username is already taken.",
  userPasswordInvalid: "Password must be 6-128 characters.",
  userEnabledInvalid: "Invalid enabled value.",
  userNotFound: "User not found.",
  userEmptyPatch: "Nothing to update.",
  noVisitorUsers: "No visitor accounts yet.",
  legacySharedUserTooltip: "Migrated from the shared visitor password",
  visitorUsersImmediateHint: "Account changes apply immediately and do not require saving settings.",
  visitorLoginHint: 'If you used the old shared password, your username is "visitor".',
  incorrectUsernameOrPassword: "Incorrect username or password",
  cleanupTempFilesSuccess: "Successfully deleted {count} temporary file(s).",
  cleanupTempFilesFailed: "Failed to clean up temporary files",

  // Cookie Settings
  cookieSettings: "Cookie Settings",
  cookieUploadDescription:
    'Upload cookies.txt to pass YouTube bot checks and enable Bilibili subtitle downloads. The file will be renamed to cookies.txt automatically. (Example: use "Get cookies.txt LOCALLY" extension to export cookies)',
  uploadCookies: "Upload Cookies",
  onlyTxtFilesAllowed: "Only .txt files are allowed",
  cookiesUploadedSuccess: "Cookies uploaded successfully",
  cookiesUploadFailed: "Failed to upload cookies",
  cookiesFound: "cookies.txt found",
  cookiesNotFound: "cookies.txt not found",
  deleteCookies: "Delete Cookies",
  confirmDeleteCookies:
    "Are you sure you want to delete the cookies file? This will affect your ability to download age-restricted or member-only videos.",
  cookiesDeletedSuccess: "Cookies deleted successfully",
  cookiesDeleteFailed: "Failed to delete cookies",

  // Cloud Drive
  cloudDriveSettings: "Cloud Drive (OpenList)",
  cloudDriveDescription:
    "Automatically upload videos to cloud storage (Alist) and scan for new files in the cloud. Local files will be deleted after successful upload.",
  enableAutoSave: "Enable Cloud Sync",
  apiUrl: "API URL",
  apiUrlHelper: "e.g. https://your-alist-instance.com/api/fs/put",
  token: "Token",
  publicUrl: "Public URL",
  publicUrlHelper:
    "Public domain for accessing files (e.g., https://your-cloudflare-tunnel-domain.com). If set, this will be used instead of the API URL for file access.",
  uploadPath: "Upload Path",
  cloudDrivePathHelper: "Directory path in cloud drive, e.g. /mytube-uploads",
  scanPaths: "Scan Paths",
  scanPathsHelper:
    "One path per line. Videos will be scanned from these paths. If empty, will use upload path. Example:\n/a/Movies\n/b/Documentaries",
  cloudDriveNote:
    "After enabling this feature, newly downloaded videos will be automatically uploaded to cloud storage and local files will be deleted. Videos will be played from cloud storage via proxy.",
  cloudScanAdded: "Added from cloud",
  testing: "Testing...",
  testConnection: "Test Connection",
  sync: "Sync",
  syncToCloud: "Two-way Sync",
  syncWarning:
    "This operation will upload local videos to cloud and scan cloud storage for new files. Local files will be deleted after upload.",
  syncing: "Syncing...",
  syncCompleted: "Sync Completed",
  syncFailed: "Sync failed",
  syncReport: "Total: {total} | Uploaded: {uploaded} | Failed: {failed}",
  syncErrors: "Errors:",
  fillApiUrlToken: "Please fill in API URL and Token first",
  connectionTestSuccess: "Connection test successful! Settings are valid.",
  connectionFailedStatus: "Connection failed: Server returned status {status}",
  connectionFailedUrl: "Cannot connect to server. Please check the API URL.",
  authFailed: "Authentication failed. Please check your token.",
  connectionTestFailed: "Connection test failed: {error}",
  syncFailedMessage: "Sync failed. Please try again.",
  foundVideosToSync: "Found {count} videos with local files to sync",
  uploadingVideo: "Uploading: {title}",
  clearThumbnailCache: "Clear Thumbnail Local Cache",
  clearing: "Clearing...",
  clearThumbnailCacheSuccess:
    "Thumbnail cache cleared successfully. Thumbnails will be regenerated when accessed next time.",
  clearThumbnailCacheError: "Failed to clear thumbnail cache",
  clearThumbnailCacheConfirmMessage:
    "This will clear all locally cached thumbnails for cloud videos. Thumbnails will be regenerated from cloud storage when accessed next time. Continue?",

  // Manage
  manageContent: "Manage Content",
  videos: "Videos",
  collections: "Collections",
  allVideos: "All Videos",
  delete: "Delete",
  backToHome: "Back to Home",
  confirmDelete: "Are you sure you want to delete this?",
  deleteSuccess: "Deleted successfully",
  deleteFailed: "Failed to delete",
  noVideos: "No videos found",
  noCollectionsFound: "No collections found",
  noCollections: "No collections found",
  searchVideos: "Search videos...",
  thumbnail: "Thumbnail",
  title: "Title",
  author: "Author",
  authors: "Authors",
  all: "All",
  showAll: "Show all",
  allAuthors: "All Authors",
  allTags: "All Tags",
  showMoreTags: "Show more tags",
  showLessTags: "Show fewer tags",
  filteredByTags: "Filtered by {count} tags",

  created: "Created",
  name: "Name",
  size: "Size",
  actions: "Actions",
  deleteCollection: "Delete Collection",
  deleteVideo: "Delete Video",
  redownloadVideo: "Re-download Video",
  redownloadThumbnail: "Re-download Thumbnail",
  noSourceUrlAvailable: "No source URL available",
  downloadAlreadyInProgress: "Download already in progress",
  refreshFileSizesSuccess: "File sizes refreshed. Updated {count} videos.",
  refreshFileSizesFailed: " {count} failed.",
  refreshFileSizesSkipped: " {count} unchanged or unavailable.",
  refreshFileSizesError: "Failed to refresh file sizes: {error}",
  noVideosFoundMatching: "No videos found matching your search.",
  refreshThumbnail: "Refresh Thumbnail",
  selected: "Selected",
  moveCollection: "Move to Collection",
  confirmBulkDelete:
    "Are you sure you want to delete these videos? This action cannot be undone.",

  // Video Player
  playing: "Play",
  paused: "Pause",
  next: "Next",
  previous: "Previous",
  loop: "Loop",
  autoPlayOn: "Auto-play On",
  autoPlayOff: "Auto-play Off",
  autoPlayNext: "Auto-play Next",
  videoNotFound: "Video not found",
  videoNotFoundOrLoaded: "Video not found or could not be loaded.",
  deleting: "Deleting...",
  addToCollection: "Add to Collection",
  originalLink: "Original Link",
  source: "Source:",
  addedDate: "Added Date:",
  hideComments: "Hide Comments",
  showComments: "Show Comments",
  latestComments: "Latest Comments",
  noComments: "No comments available.",
  upNext: "Up Next",
  noOtherVideos: "No other videos available",
  currentlyIn: "Currently in:",
  collectionWarning:
    "Videos can belong to multiple collections. Removing one link keeps the others.",
  addToExistingCollection: "Add to existing collection:",
  selectCollection: "Select a collection",
  add: "Add",
  createNewCollection: "Create new collection:",
  collectionName: "Collection name",
  selectOrCreateCollection: "Select or create a collection",
  createNewCollectionLabel: 'Create "{name}"',
  create: "Create",
  removeFromCollection: "Remove from Collection",
  confirmRemoveFromCollection:
    "Are you sure you want to remove this video from the collection?",
  remove: "Remove",
  loadingVideo: "Loading video...",
  current: "(Current)",
  rateThisVideo: "Rate this video",
  enterFullscreen: "Enter Fullscreen",
  exitFullscreen: "Exit Fullscreen",
  enterCinemaMode: "Enter Cinema Mode",
  exitCinemaMode: "Exit Cinema Mode",
  share: "Share",
  editTitle: "Edit Title",
  hideVideo: "Make Video Hidden for Visitor Mode",
  showVideo: "Make Video Visible for Visitor Mode",
  toggleVisibility: "Toggle Visibility",
  titleUpdated: "Title updated successfully",
  titleUpdateFailed: "Failed to update title",
  thumbnailRefreshed: "Thumbnail refreshed successfully",
  thumbnailRefreshFailed: "Failed to refresh thumbnail",
  videoUpdated: "Video updated successfully",
  videoUpdateFailed: "Failed to update video",
  failedToLoadVideos: "Failed to load videos. Please try again later.",
  videoRemovedSuccessfully: "Video removed successfully",
  failedToDeleteVideo: "Failed to delete video",
  pleaseEnterSearchTerm: "Please enter a search term",
  failedToSearch: "Failed to search. Please try again.",
  searchCancelled: "Search was cancelled",
  openInExternalPlayer: "Open in external player",
  playWith: "Play with...",
  deleteAllFilteredVideos: "Delete All Filtered Videos",
  confirmDeleteFilteredVideos:
    "Are you sure you want to delete {count} videos filtered by the selected tags?",
  deleteFilteredVideosSuccess: "Successfully deleted {count} videos.",
  deletingVideos: "Deleting videos...",

  // Login
  signIn: "Sign in",
  admin: "Admin",
  visitorSignIn: "Visitor Sign In",
  orVisitor: "OR VISITOR",
  verifying: "Verifying...",
  incorrectPassword: "Incorrect password",
  loginFailed: "Failed to verify password",
  defaultPasswordHint: "Use the admin password configured in Settings.",
  checkingConnection: "Checking connection...",
  connectionError: "Connection Error",
  backendConnectionFailed:
    "Unable to connect to the server. Please check if the backend is running and port is open, then try again.",
  retry: "Retry",
  resetPassword: "Reset Password",
  resetPasswordTitle: "Reset Password",
  resetPasswordMessage:
    "Password recovery must be performed from the backend environment. Use a backend command to set a new password explicitly.",
  resetPasswordConfirm: "Reset",
  resetPasswordSuccess:
    "Password recovery instructions are shown below. Use a backend command to set the new password.",
  resetPasswordRecoveryMessage:
    "Password recovery must be performed from the backend environment. Set a new password explicitly instead of relying on generated credentials in logs.",
  resetPasswordRecoveryGuide:
    "Choose the command that matches your environment:\n\nBackend shell\n  node dist/scripts/reset-password.js <new-password>\n\nDocker host\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nUse the backend directory/container that has access to the persistent app data.",
  resetPasswordDisabledInfo:
    "Password reset is disabled in the web UI. To reset your password, run one of the following commands from the backend environment:\n\nBackend shell\n  node dist/scripts/reset-password.js <new-password>\n\nDocker host\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nUse the backend directory/container that has access to the persistent app data.",
  resetPasswordScriptGuide:
    "To reset the password manually, run one of the following commands and provide the new password explicitly:\n\nBackend shell\n  node dist/scripts/reset-password.js <new-password>\n\nDocker host\n  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>\n\nThe script does not generate or display random passwords.",
  waitTimeMessage: "Please wait {time} before trying again.",
  tooManyAttempts: "Too many failed attempts.",
  // Passkeys
  createPasskey: "Create Passkey",
  creatingPasskey: "Creating...",
  passkeyCreated: "Passkey created successfully",
  passkeyCreationFailed: "Failed to create passkey. Please try again.",
  passkeyWebAuthnNotSupported:
    "WebAuthn is not supported in this browser. Please use a modern browser that supports WebAuthn.",
  passkeyRequiresHttps:
    "WebAuthn requires HTTPS or localhost. Please access the application via HTTPS or use localhost instead of an IP address.",
  removePasskeys: "Remove All Passkeys",
  removePasskeysTitle: "Remove All Passkeys",
  removePasskeysMessage:
    "Are you sure you want to remove all passkeys? This action cannot be undone.",
  passkeysRemoved: "All passkeys have been removed",
  passkeysRemoveFailed: "Failed to remove passkeys. Please try again.",
  loginWithPasskey: "Login with Passkey",
  authenticating: "Authenticating...",
  passkeyLoginFailed: "Passkey authentication failed. Please try again.",
  passkeyErrorPermissionDenied:
    "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
  passkeyErrorAlreadyRegistered: "The authenticator was previously registered.",
  linkCopied: "Link copied to clipboard",
  copyFailed: "Failed to copy link",
  copyUrl: "Copy URL",

  // Collection Page
  loadingCollection: "Loading collection...",
  collectionNotFound: "Collection not found",
  noVideosInCollection: "No videos in this collection.",
  back: "Back",

  // Author Videos
  loadVideosError: "Failed to load videos. Please try again later.",
  unknownAuthor: "Unknown",
  noVideosForAuthor: "No videos found for this author.",
  deleteAuthor: "Delete Author",
  deleteAuthorConfirmation:
    "Are you sure you want to delete author {author}? This will delete all videos associated with this author.",
  authorDeletedSuccessfully: "Author deleted successfully",
  failedToDeleteAuthor: "Failed to delete author",
  createCollectionFromAuthor: "Create Collection from Author",
  createCollectionFromAuthorTooltip:
    "Move all videos from this author to a collection",
  creatingCollection: "Creating collection...",
  collectionCreatedFromAuthor:
    "Collection created and all videos moved successfully",
  failedToCreateCollectionFromAuthor: "Failed to create collection from author",
  collectionAlreadyExists: "A collection with this name already exists",
  createCollectionFromAuthorConfirmation:
    'A collection named "{author}" will be created and all videos from this author will be moved to it. Continue?',
  createCollectionFromAuthorConfirmationWithMove:
    'A collection named "{author}" will be created and all videos from this author will be moved to it. {count} video(s) that are currently in other collections will be moved to this new collection. Continue?',
  addVideosToCollection: "Add Videos to Collection",
  addVideosToExistingCollectionConfirmation:
    'Add {count} video(s) from author "{author}" to the existing collection "{author}". Continue?',
  addVideosToExistingCollectionConfirmationWithMove:
    'Add {count} video(s) from author "{author}" to the existing collection "{author}". {moveCount} video(s) that are currently in other collections will be moved to this collection. Continue?',

  // Delete Collection Modal
  deleteCollectionTitle: "Delete Collection",
  deleteCollectionConfirmation:
    "Are you sure you want to delete the collection",
  collectionContains: "This collection contains",
  deleteCollectionOnly: "Delete Collection Only",
  deleteCollectionAndVideos: "Delete Collection & All Videos",

  // Common
  loading: "Loading...",
  error: "Error",
  success: "Success",
  info: "Info",
  cancel: "Cancel",
  close: "Close",
  ok: "OK",
  confirm: "Confirm",
  save: "Save",
  note: "Note",
  on: "On",
  off: "Off",
  continue: "Continue",
  expand: "Expand",
  collapse: "Collapse",

  // Video Card
  unknownDate: "Unknown date",
  part: "Part",
  collection: "Collection",
  new: "NEW",
  justNow: "Just now",
  hoursAgo: "{hours}h ago",
  today: "Today",
  thisWeek: "This week",
  weeksAgo: "{weeks}w ago",

  // Upload Modal
  selectVideoFile: "Select Video File",
  selectVideoFolder: "Select Folder",
  uploadFileLimitHint:
    "Upload up to {count} files and {size} GB total at a time. Folder uploads count each video and file size toward these limits.",
  pleaseSelectVideo: "Please select a video file",
  noSupportedVideosFound: "No supported video files were found in your selection",
  tooManyFilesSelected:
    "You can upload up to {count} files at a time. Please reduce your selection and try again.",
  totalUploadSizeExceeded:
    "Selected files exceed the {size} GB total upload limit. Please reduce your selection and try again.",
  uploadFailed: "Upload failed",
  failedToUpload: "Failed to upload video",
  uploading: "Uploading...",
  upload: "Upload",
  uploadSummary: "Uploaded {uploaded}, duplicates {duplicates}, failed {failed}",
  unsupportedFilesSkipped: "Skipped {count} unsupported files",
  multipleUploadUsesFilename: "Multiple uploads use each filename as the title",
  uploadThumbnail: "Upload Thumbnail",
  clickToSelectImage: "Click to select an image",
  changeImage: "Change Image",
  selectImage: "Select Image",
  thumbnailUploaded: "Thumbnail uploaded",

  // Bilibili Modal
  bilibiliCollectionDetected: "Bilibili Collection Detected",
  bilibiliSeriesDetected: "Bilibili Series Detected",
  multiPartVideoDetected: "Multi-part Video Detected",
  authorOrPlaylist: "Author / Playlist",
  playlistDetected: "Playlist Detected",
  playlistHasVideos: "This playlist has {count} videos.",
  downloadPlaylistAndCreateCollection:
    "Download playlist videos and create a Collection for it?",
  playlistDownloadStarted: "Playlist download started",
  collectionHasVideos: "This Bilibili collection has {count} videos.",
  seriesHasVideos: "This Bilibili series has {count} videos.",
  videoHasParts: "This Bilibili video has {count} parts.",
  downloadAllVideos: "Download All {count} Videos",
  downloadAllParts: "Download All {count} Parts",
  downloadThisVideoOnly: "Download This Video Only",
  downloadCurrentPartOnly: "Download Current Part Only",
  processing: "Processing...",
  wouldYouLikeToDownloadAllParts: "Would you like to download all parts?",
  wouldYouLikeToDownloadAllVideos: "Would you like to download all videos?",
  allPartsAddedToCollection: "All parts will be added to this collection",
  allVideosAddedToCollection: "All videos will be added to this collection",
  queued: "Queued",
  waitingInQueue: "Waiting in queue",

  // Downloads
  downloads: "Downloads",
  openMenu: "Open menu",
  activeDownloads: "Active Downloads",
  manageDownloads: "Manage Downloads",
  queuedDownloads: "Queued Downloads",
  downloadHistory: "Download History",
  clearQueue: "Clear Queue",
  clearHistory: "Clear History",
  noActiveDownloads: "No active downloads",
  noQueuedDownloads: "No queued downloads",
  noDownloadHistory: "No download history",
  downloadCancelled: "Download cancelled",
  queueCleared: "Queue cleared",
  historyCleared: "History cleared",
  removedFromQueue: "Removed from queue",
  removedFromHistory: "Removed from history",
  status: "Status",
  progress: "Progress",
  speed: "Speed",
  finishedAt: "Finished At",
  failed: "Failed",
  partialDownload: "Incomplete",
  pendingRetry: "Pending Retry",
  cancelRetry: "Cancel Retry",
  retryScheduledFor: "Retry scheduled for",
  retryAttemptProgress: "Retry {current} of {total}",
  missingEpisodes: "Missing episodes",
  missingVideos: "Missing videos",

  // Snackbar Messages
  videoDownloading: "Video downloading",
  retryCancelled: "Retry cancelled",
  downloadStartedSuccessfully: "Download started successfully",
  collectionCreatedSuccessfully: "Collection created successfully",
  videoAddedToCollection: "Video added to collection",
  videosAddedToCollection: "Videos added to collection",
  videoRemovedFromCollection: "Video removed from collection",
  collectionDeletedSuccessfully: "Collection deleted successfully",
  failedToDeleteCollection: "Failed to delete collection",
  collectionUpdatedSuccessfully: "Collection updated successfully",
  failedToUpdateCollection: "Failed to update collection, use different name",
  collectionNameRequired: "Collection name is required",
  collectionNameTooLong: "Collection name must be 200 characters or less",
  collectionNameInvalidChars: "Collection name contains invalid characters",
  collectionNameReserved: "Collection name is reserved",
  updateCollectionFailed: "Failed to update collection",
  createCollectionFailed: "Failed to create collection",
  collectionExistsVideoAdded:
    "Collection already exists — video added to it instead",
  uploadSubtitle: "Upload Subtitle",
  subtitleUploaded: "Subtitle uploaded successfully",
  confirmDeleteSubtitle: "Delete this subtitle?",
  subtitleDeleted: "Subtitle deleted",

  // Batch Download
  batchDownload: "Batch Download",
  batchDownloadDescription: "Paste multiple URLs below, one per line.",
  urls: "URLs",
  addToQueue: "Add to Queue",
  batchTasksAdded: "{count} tasks added",
  addBatchTasks: "Add batch tasks",

  // Subscriptions
  subscribeToAuthor: "Subscribe to Author",
  subscribeToChannel: "Subscribe to Channel",
  subscribeConfirmationMessage: "Do you want to subscribe to {author}?",
  subscribeChannelChoiceMessage:
    "How would you like to subscribe to this channel?",
  subscribeChannelChoiceDescription:
    "Choose to subscribe to all videos or all playlists from this channel. Subscribing to all playlists will also subscribe to future playlists created by the author.",
  subscribeAllVideos: "Subscribe All Videos",
  subscribeAllPlaylists: "Subscribe All Playlists",
  subscribeAllPlaylistsDescription:
    "This will subscribe to all playlists in this channel.",
  subscribeDescription:
    "The system will automatically check for new videos from this author and download them.",
  checkIntervalMinutes: "Check Interval (minutes)",
  subscribe: "Subscribe",
  subscriptions: "Subscriptions",
  interval: "Interval",
  lastCheck: "Last Check",
  nextCheck: "Next Check",
  editInterval: "Edit Interval",
  platform: "Platform",
  unsubscribe: "Unsubscribe",
  confirmUnsubscribe: "Are you sure you want to unsubscribe from {author}?",
  subscribedSuccessfully: "Subscribed successfully",
  unsubscribedSuccessfully: "Unsubscribed successfully",
  subscriptionUpdated: "Subscription updated successfully",
  subscriptionUpdateFailed: "Failed to update subscription",
  subscriptionAlreadyExists: "You are already subscribed to this author.",
  minuteShort: "min",
  minutes: "minutes",
  never: "Never",
  downloadAllPreviousVideos: "Download all previous videos from this author",
  downloadShorts: "Download Shorts",
  downloadOrder: "Download Order",
  downloadOrderDateDesc: "Date (Newest First)",
  downloadOrderDateAsc: "Date (Oldest First)",
  downloadOrderViewsDesc: "Views (Most First)",
  downloadOrderViewsAsc: "Views (Least First)",
  downloadOrderLargeChannelHint:
    "Large channels may take longer to fetch metadata before downloading begins.",
  downloadOrderShortsHint:
    "Two download tasks will be created: one for main videos and one for Shorts.",
  downloadAllPreviousWarning:
    "Warning: This will download all previous videos from this author. This may consume significant storage space and could trigger bot detection mechanisms that may result in temporary or permanent bans from the platform. Use at your own risk.",
  downloadAllPreviousVideosInPlaylists: "Download previous videos in playlists",
  downloadAllPlaylistsWarning:
    "Warning: This will download all videos from all playlists on this channel. This may be a large number of videos and consume significant storage space.",
  continuousDownloadTasks: "Continuous Download Tasks",
  taskStatusActive: "Active",
  taskStatusPaused: "Paused",
  taskStatusCompleted: "Completed",
  taskStatusCancelled: "Cancelled",
  downloaded: "Downloaded",
  cancelTask: "Cancel Task",
  confirmCancelTask:
    "Are you sure you want to cancel the download task for {author}?",
  taskCancelled: "Task cancelled successfully",
  deleteTask: "Delete Task",
  confirmDeleteTask:
    "Are you sure you want to delete the task record for {author}? This action cannot be undone.",
  taskDeleted: "Task deleted successfully",
  clearFinishedTasks: "Clear Finished Tasks",
  tasksCleared: "Finished tasks cleared successfully",
  confirmClearFinishedTasks:
    "Are you sure you want to clear all finished tasks (completed, cancelled)? This will remove them from the list but will not delete any downloaded files.",
  clear: "Clear",

  // Subscription Retention
  retentionDays: "Auto-Delete After",
  retentionDaysUnit: "days",
  downloadHistoryRetention: "Download History Retention",
  downloadHistoryRetentionDescription:
    "Automatically delete completed download history entries (success, failed, skipped) older than this. Entries for deleted videos and scheduled retries are always kept, and entries a subscription's auto-delete window still needs are never removed.",
  downloadHistoryRetentionKeepForever: "Keep forever",
  retentionDaysDisabled: "Off",
  editRetention: "Edit Auto-Delete",
  retentionDaysHelpTitle: "About Auto-Delete",
  retentionDaysHelpMessage:
    "When set, MyTube automatically deletes videos downloaded by this subscription after the configured number of days. Leave it Off to keep videos. Videos still referenced by another subscription or manual download are skipped.",
  retentionDaysUpdated: "Retention policy updated",
  retentionDaysUpdateFailed: "Failed to update retention policy",

  // Per-subscription yt-dlp config override (issue #345)
  editYtdlpConfigOverride: "Edit yt-dlp config override",
  ytdlpConfigOverrideHelp:
    "Free-text yt-dlp options applied only to this subscription (e.g. --format bestaudio for an audio-only channel). Leave empty to use the global yt-dlp configuration. Options you set here override the global config; anything you omit (proxy, rate limits) is inherited from it.",
  ytdlpConfigOverridePlaceholder: "--format bestaudio",
  ytdlpConfigOverrideUpdated: "yt-dlp override updated",
  ytdlpConfigOverrideUpdateFailed: "Failed to update yt-dlp override",

  // Per-subscription filename-template override (issue #368)
  subscriptionFilenameTemplate: "Filename template override",
  subscriptionFilenameTemplateHelp:
    "Filename template applied only to downloads from this subscription. Uses the same syntax and variables as Settings → File Naming. Leave empty to use the global filename naming setting.",
  subscriptionFilenameTemplateInherit:
    "Leave empty to inherit the global filename naming setting.",
  subscriptionFilenameTemplatePlaceholder:
    "{{ source_custom_name }}/{{ title }}.{{ ext }}",
  subscriptionFilenameTemplatePreview: "Preview",
  subscriptionFilenameTemplateFutureOnly:
    "Changes affect future downloads. Existing files are not renamed.",
  editSubscriptionFilenameTemplate: "Edit filename template override",
  subscriptionFilenameTemplateCustom: "Custom filename template",
  subscriptionFilenameTemplateUpdated: "Filename template override updated",
  subscriptionFilenameTemplateUpdateFailed:
    "Failed to update filename template override",

  // Subscription Pause/Resume
  pause: "Pause",
  resume: "Resume",
  pauseSubscription: "Pause Subscription",
  resumeSubscription: "Resume Subscription",
  pauseTask: "Pause Task",
  resumeTask: "Resume Task",
  subscriptionPaused: "Subscription paused",
  subscriptionResumed: "Subscription resumed",
  taskPaused: "Task paused",
  taskResumed: "Task resumed",
  viaSubscription: "via Subscription",
  viaContinuousDownload: "via Continuous Download",

  // Playlist Subscription
  subscribeToPlaylist: "Subscribe to this playlist",
  subscribePlaylistDescription:
    "Automatically check for new videos added to this playlist",
  playlistSubscribedSuccessfully: "Subscribed to playlist successfully",
  downloadAndSubscribe: "Download All & Subscribe",
  playlistSubscription: "Playlist",
  // Issue #368.2 — subscribe-only / history choice
  subscribeOnlyNewPlaylistVideos:
    "Subscribe only to new videos",
  subscribeOnlyNewPlaylistVideosHelp:
    "Existing playlist videos will not be queued. MyTube will download newly detected videos after this subscription is created.",
  downloadExistingPlaylistVideos:
    "Download existing videos now",
  playlistSubscribedNewOnly:
    "Subscribed to new videos only. Existing videos were not queued.",
  playlistDownloadAndSubscriptionStarted:
    "Download started and playlist subscribed.",
  playlistBaselineFailed:
    "Playlist subscribed, but downloading existing videos failed to start. New videos will still be downloaded automatically.",

  // Instruction Page
  instructionSection1Title: "1. Download & Task Management",
  instructionSection1Desc:
    "This module includes video acquisition, batch tasks, and file import functions.",
  instructionSection1Sub1: "Link Download:",
  instructionSection1Item1Label: "Basic Download:",
  instructionSection1Item1Text:
    "Paste links from various video sites into the input box to download directly.",
  instructionSection1Item2Label: "Permissions:",
  instructionSection1Item2Text:
    "For sites requiring membership or login, please log in to the corresponding account in a new browser tab first to acquire download permissions.",
  instructionSection1Sub2: "Smart Recognition:",
  instructionSection1Item3Label: "YouTube Author Subscription:",
  instructionSection1Item3Text:
    "When the pasted link is an author's channel, the system will ask if you want to subscribe. After subscribing, the system can automatically scan and download the author's updates at set intervals.",
  instructionSection1Item4Label: "Bilibili Collection Download:",
  instructionSection1Item4Text:
    "When the pasted link is a Bilibili favorite/collection, the system will ask if you want to download the entire collection content.",
  instructionSection1Sub3: "Advanced Tools (Download Management Page):",
  instructionSection1Item5Label: "Batch Add Tasks:",
  instructionSection1Item5Text:
    "Supports pasting multiple download links at once (one per line) for batch addition.",
  instructionSection1Item6Label: "Scan Files:",
  instructionSection1Item6Text:
    "Automatically searches for all files in the video storage root directory and first-level folders. This function is suitable for syncing files to the system after administrators manually deposit them in the server backend.",
  instructionSection1Item7Label: "Upload Video:",
  instructionSection1Item7Text:
    "Supports uploading local video files directly from the client to the server.",

  instructionSection2Title: "2. Video Library Management",
  instructionSection2Desc:
    "Maintain and edit downloaded or imported video resources.",
  instructionSection2Sub1: "Collection/Video Deletion:",
  instructionSection2Text1:
    "When deleting a collection on the management page, the system offers two options: delete only the collection list item (keep files), or completely delete the physical files within the collection.",
  instructionSection2Sub2: "Thumbnail Repair:",
  instructionSection2Text2:
    "If a video has no cover after downloading, click the refresh button on the video thumbnail, and the system will re-capture the first frame of the video as the new thumbnail.",

  instructionSection3Title: "3. System Settings",
  instructionSection3Desc:
    "Configure system parameters, maintain data, and extend functions.",
  instructionSection3Sub1: "Security Settings:",
  instructionSection3Text1:
    "Set the system login password before enabling sign-in. If you lose access, reset it with the backend reset-password script.",
  instructionSection3Sub2: "Tag Management:",
  instructionSection3Text2:
    'Supports adding or deleting video classification tags. Note: You must click the "Save" button at the bottom of the page for changes to take effect.',
  instructionSection3Sub3: "System Maintenance:",
  instructionSection3Item1Label: "Clean Up Temp Files:",
  instructionSection3Item1Text:
    "Used to clear residual temporary download files caused by occasional backend failures to free up space.",
  instructionSection3Item2Label: "Database Migration:",
  instructionSection3Item2Text:
    "Designed for early version users. Use this function to migrate data from JSON to the new SQLite database. After successful migration, click the delete button to clean up old history data.",
  instructionSection3Sub4: "Extended Services:",
  instructionSection3Item3Label: "OpenList Cloud Drive:",
  instructionSection3Item3Text:
    "(In Development) Supports connecting to user-deployed OpenList services. Add configuration here to enable cloud drive integration.",

  // Disclaimer
  disclaimerTitle: "Disclaimer",
  disclaimerText:
    "1. Purpose and Restrictions\nThis software (including code and documentation) is intended solely for personal learning, research, and technical exchange. It is strictly prohibited to use this software for any commercial purposes or for any illegal activities that violate local laws and regulations.\n\n2. Liability\nThe developer is unaware of and has no control over how users utilize this software. Any legal liabilities, disputes, or damages arising from the illegal or improper use of this software (including but not limited to copyright infringement) shall be borne solely by the user. The developer assumes no direct, indirect, or joint liability.\n\n3. Modifications and Distribution\nThis project is open-source. Any individual or organization modifying or forking this code must comply with the open-source license. Important: If a third party modifies the code to bypass or remove the original user authentication/security mechanisms and distributes such versions, the modifier/distributor bears full responsibility for any consequences. We strongly discourage bypassing or tampering with any security verification mechanisms.\n\n4. Non-Profit Statement\nThis is a completely free open-source project. The developer does not accept donations and has never published any donation pages. The software itself allows no charges and offers no paid services. Please be vigilant and beware of any scams or misleading information claiming to collect fees on behalf of this project.",
  history: "History",

  // Existing Video Detection
  existingVideoDetected: "Existing Video Detected",
  videoAlreadyDownloaded: "This video has already been downloaded.",
  viewVideo: "View Video",
  previouslyDeletedVideo: "Previously Deleted Video",
  previouslyDeleted: "Previously Deleted",
  videoWasDeleted: "This video was previously downloaded but has been deleted.",
  downloadAgain: "Download Again",
  downloadedOn: "Downloaded on",
  deletedOn: "Deleted on",
  existingVideo: "Existing Video",
  skipped: "Skipped",
  videoSkippedExists: "Video already exists, skipped download",
  videoSkippedDeleted: "Video was previously deleted, skipped download",
  downloading: "Downloading...",
  poweredBy: "Powered by MyTube",
  changeSettings: "Change Settings",

  // Sorting
  sort: "Sort",
  sortBy: "Sort by",
  dateDesc: "Date Added (Newest)",
  dateAsc: "Date Added (Oldest)",
  viewsDesc: "Views (High to Low)",
  viewsAsc: "Views (Low to High)",
  nameAsc: "Name (A-Z)",
  videoDateDesc: "Video Create Date (Newest)",
  videoDateAsc: "Video Create Date (Oldest)",
  random: "Random Shuffle",

  // yt-dlp Configuration
  ytDlpConfiguration: "yt-dlp Configuration",
  ytDlpConfigurationDescription: "Configure yt-dlp download options. See",
  ytDlpConfigurationDocs: "documentation",
  ytDlpConfigurationDescriptionEnd: "for more information.",
  ytDlpConfigurationPolicyNotice:
    "Raw yt-dlp configuration is disabled by deployment security policy in application trust mode.",
  mountDirectoriesPolicyNotice:
    "Mount directories require host-level admin trust.",
  customize: "Customize",
  hide: "Hide",
  reset: "Reset",
  more: "More",
  proxyOnlyApplyToYoutube: "Proxy only apply to Youtube",
  moveSubtitlesToVideoFolder: "Subtitles Location",
  moveSubtitlesToVideoFolderOn: "With video together",
  moveSubtitlesToVideoFolderOff: "In isolated subtitle folder",
  moveSubtitlesToVideoFolderDescription:
    "When enabled, subtitle files will be moved to the same folder as the video file. When disabled, they will be moved to the isolated subtitle folder.",
  moveThumbnailsToVideoFolder: "Thumbnail Location",
  moveThumbnailsToVideoFolderOn: "With video together",
  moveThumbnailsToVideoFolderOff: "In isolated images folder",
  moveThumbnailsToVideoFolderDescription:
    "When enabled, full-size thumbnail files will be moved to the same folder as the video file. When disabled, they will be moved to the isolated images folder. MyTube also keeps a small internal preview cache under `images-small/` that mirrors the thumbnail folder layout; it can be ignored or excluded from media-server libraries.",
  saveAuthorFilesToCollection: "Save Author's Files in Collection",
  saveAuthorFilesToCollectionOn: "Organize by author",
  saveAuthorFilesToCollectionOff: "Save to root folders",
  saveAuthorFilesToCollectionDescription:
    "When enabled, new downloaded videos, thumbnails, and subtitles will be automatically organized into collections named after the video author. If a collection doesn't exist, it will be created automatically.",
  authorOrganizationMode: "Author Organization",
  authorOrganizationModeDescription:
    "Choose whether author names affect physical folders, logical collections, or neither.",
  authorOrganizationModeRoot: "Keep in root folders",
  authorOrganizationModeRootDescription:
    "Do not create author folders or author collections. Only playlist and manual collections apply.",
  authorOrganizationModeAuthorFolderOnly: "Author folders only",
  authorOrganizationModeAuthorFolderOnlyDescription:
    "With legacy filenames, move files into author-named folders without linking an author collection.",
  authorOrganizationModeAuthorCollectionLinked: "Author collection + folder",
  authorOrganizationModeAuthorCollectionLinkedDescription:
    "Link videos to an author collection. With legacy filenames, files also move into the author folder.",
  authorOrganizationModeRecommendation:
    "If you want author-based folders without duplicate author collections in MyTube, use Author folders only.",
  authorOrganizationModeTemplateNote:
    "Non-legacy filename presets control the physical folder structure. In those modes, author organization only affects collection linking.",
  cleanupAuthorCollections: "Clean Up Existing Author Collections",
  cleanupAuthorCollectionsDescription:
    "After switching to Author folders only, remove redundant author-collection links from videos that already belong to another collection. Files on disk are not moved.",
  cleanupAuthorCollectionsButton: "Remove Redundant Links",
  cleanupAuthorCollectionsConfirmTitle: "Remove Redundant Author Collection Links",
  cleanupAuthorCollectionsConfirmMessage:
    "This will unlink author collections from videos that already belong to another collection. Empty author collections will be deleted. Files on disk will stay where they are.",
  cleanupAuthorCollectionsSuccess:
    "Removed {links} links across {videos} videos. Deleted {collections} empty author collections.",
  cleanupAuthorCollectionsNothingToDo:
    "No redundant author collection links needed cleanup.",
  cleanupAuthorCollectionsFailed: "Failed to clean up author collections",

  // Cloudflare Tunnel
  cloudflaredTunnel: "Cloudflare Tunnel",
  enableCloudflaredTunnel: "Enable Cloudflare Tunnel",
  cloudflaredToken: "Tunnel Token (Optional)",
  cloudflaredTokenHelper:
    "Paste your tunnel token here, or leave empty to use a random Quick Tunnel.",
  allowedHosts: "Published Application Routes",
  allowedHostsHelper:
    "Comma-separated list of allowed hosts for Vite dev server. Domain whitelist for Cloudflare Tunnel.",
  allowedHostsRequired:
    "Published Application Routes is required when tunnel token is provided.",
  waitingForUrl: "Waiting for Quick Tunnel URL...",
  running: "Running",
  stopped: "Stopped",
  tunnelId: "Tunnel ID",
  accountTag: "Account Tag",
  copied: "Copied!",
  clickToCopy: "Click to copy",
  quickTunnelWarning:
    "Quick Tunnel URLs change every time the tunnel restarts.",
  managedInDashboard:
    "Public hostname is managed in your Cloudflare Zero Trust Dashboard.",

  // Database Export/Import
  exportImportDatabase: "Export/Import Database",
  exportImportDatabaseDescription:
    "Export your database as a backup file or import a previously exported backup. Importing will overwrite existing data with the backup data.",
  exportDatabase: "Export Database",
  importDatabase: "Import Database",
  mergeDatabase: "Merge Database",
  onlyDbFilesAllowed: "Only .db files are allowed",
  importDatabaseWarning:
    "Warning: Importing a database will overwrite all existing data. Make sure to export your current database first as a backup.",
  mergeDatabaseWarning:
    "Merge another MyTube backup into this instance. Existing records stay as-is, and only missing records from the uploaded backup are added.",
  mergeDatabaseContentsVideos:
    "Videos are matched by source URL, and existing videos are kept.",
  mergeDatabaseContentsCollections:
    "Collections and collection membership are merged into matching collection names.",
  mergeDatabaseContentsSubscriptions:
    "Subscriptions are merged by subscription URL, with existing subscriptions kept.",
  mergeDatabaseContentsHistory:
    "Download history and download tracking are added when matching entries do not already exist.",
  mergeDatabaseContentsTags:
    "Tag settings are merged so imported video tags remain available in the UI.",
  mergeDatabaseKeepsCurrentData:
    "Current settings, passwords, active downloads, and task runtime state are not replaced.",
  mergeDatabaseStatisticsNotice:
    "Statistics collected by this instance stay local and are not merged from the uploaded database.",
  mergeDatabasePreviewScanning: "Scanning uploaded database...",
  mergeDatabasePreviewResults: "Merge Preview",
  mergeDatabasePreviewConfirmHint:
    "Continue only if these counts match what you expect.",
  mergeDatabasePreviewFailed: "Failed to scan uploaded database: {error}",
  mergeDatabasePreviewErrorDefault: "Unable to scan uploaded database.",
  mergeDatabaseMergedCount: "Merged: {count}",
  mergeDatabaseSkippedCount: "Skipped: {count}",
  mergeDatabasePreviewVideos: "Videos",
  mergeDatabasePreviewCollections: "Collections",
  mergeDatabasePreviewCollectionLinks: "Collection links",
  mergeDatabasePreviewSubscriptions: "Subscriptions",
  mergeDatabasePreviewDownloadHistory: "Download history",
  mergeDatabasePreviewVideoDownloads: "Download tracking",
  mergeDatabasePreviewTags: "Tags",
  mergeDatabasePreviewFavoriteCollections: "Favorite collections",
  mergeDatabasePreviewFavoriteAuthors: "Favorite authors",
  selectDatabaseFile: "Select Database File",
  databaseExportedSuccess: "Database exported successfully",
  databaseExportFailed: "Failed to export database",
  databaseImportedSuccess:
    "Database imported successfully. Existing data has been overwritten with the backup data.",
  databaseImportFailed: "Failed to import database",
  databaseMergedSuccess:
    "Database merged successfully. Existing data was kept, and missing data from the backup was added.",
  databaseMergeFailed: "Failed to merge database",
  cleanupBackupDatabases: "Clean Up Backup Databases",
  cleanupBackupDatabasesWarning:
    "Warning: This will permanently delete all backup database files (mytube-backup-*.db.backup) that were created during previous imports. This action cannot be undone. Are you sure you want to continue?",
  backupDatabasesCleanedUp: "Backup databases cleaned up successfully",

  // History Filter
  filterAll: "All",
  backupDatabasesCleanupFailed: "Failed to clean up backup databases",
  restoreFromLastBackup: "Restore from Last Backup",
  restoreFromLastBackupWarning:
    "Warning: This will restore the database from the last auto backup file. All current data will be overwritten with the backup data. This action cannot be undone. Are you sure you want to continue?",
  restoreFromLastBackupSuccess: "Database restored successfully from backup",
  restoreFromLastBackupFailed: "Failed to restore from backup",
  lastBackupDate: "Last backup date",
  noBackupAvailable: "No backup available",
  failedToDownloadVideo: "Failed to download video. Please try again.",
  failedToDownload: "Failed to download. Please try again.",
  openFolder: "Open Folder",
  openInNewTab: "Open in New Tab",
  copyLink: "Copy Link",
  refresh: "Refresh",
  showSensitiveContent: "Show Sensitive Content",
  hideSensitiveContent: "Hide Sensitive Content",
  sensitiveContentWarning:
    "This video may contain sensitive content. Click to view.",
  soundNone: "None",
  soundBell: "Bell Ding",
  soundMessage: "Message Incoming",
  soundMicrowave: "Microwave Ding",
  soundNotification: "New Notification",
  soundDrop: "Object Drops in Water",
  soundWater: "Waterdrop on Metal",
  videoLoadTimeout:
    "Video is taking too long to load. Please try again or check your connection.",
  failedToLoadVideo: "Failed to load video.",
  videoLoadingAborted: "Video loading was aborted.",
  videoLoadNetworkError:
    "Network error while loading video. Please check your connection.",
  safariWebmLimitedSupportError:
    "Safari has limited support for WebM/VP9 codec, especially for 4K videos. Please re-download the video with H.264/MP4 format for better Safari compatibility.",
  safariVideoDecodeError:
    "Video decoding error. Safari may not support this video codec. Try re-downloading with H.264/MP4 format.",
  videoDecodeError:
    "Video decoding error. The file may be corrupted or use an unsupported codec.",
  safariVideoFormatNotSupported:
    "Video format not supported by Safari. Safari works best with H.264/MP4 videos. Please re-download with H.264 codec, or try another browser like Chrome.",
  browserVideoFormatNotSupported:
    "Video format not supported by your browser.",

  // RSS Feed Settings
  rssFeedSettings: "RSS Feeds",
  rssFeedSettingsDescription: "Manage private RSS feed links for external readers. RSS links must be accessed over HTTPS.",
  rssCreateToken: "Create RSS link",
  rssEditToken: "Edit RSS link",
  rssCopyLink: "Copy link",
  rssLinkCopied: "Link copied",
  rssResetLink: "Reset link",
  rssResetLinkConfirm: "The old link will stop working immediately.",
  rssDisableLink: "Disable",
  rssEnableLink: "Enable",
  rssDeleteLink: "Delete RSS link",
  rssDeleteLinkConfirm: "This RSS link will be permanently deleted.",
  rssAdminRoleWarning: "Admin RSS links can include hidden videos. Treat the URL like a password.",
  rssPublicAggregatorWarning: "Do not share this URL or paste it into public feed directories.",
  rssFilterAllVideos: "All videos",
  rssFilterAllSources: "All sources (no limit)",
  rssFilterChannels: "Channels",
  rssFilterAuthors: "Authors",
  rssFilterTags: "Tags",
  rssFilterSources: "Sources",
  rssFilterRecentDays: "Recent days",
  rssFilterMaxItems: "Max items",
  rssLoadTokensError: "Failed to load RSS tokens. Please try again.",
  rssNoFeeds: "No RSS feeds yet. Create one to get started.",
  rssNoLabel: "(no label)",
  rssActive: "Active",
  rssDisabled: "Disabled",
  rssAccessCount: "Created {date} - {count} access(es)",
  rssFiltersSummary: "Filters: {filters} - Max {maxItems} items",
  rssAuthorsSummary: "authors: {authors}",
  rssChannelsSummary: "{count} channel(s)",
  rssTagsSummary: "tags: {tags}",
  rssRecentDaysSummary: "last {days} days",
  rssEditAction: "Edit",
  rssLabel: "Label",
  rssLabelPlaceholder: "e.g. All Videos",
  rssRole: "Role",
  rssRoleCannotChange: "Role: {role} (cannot be changed - delete and recreate to change)",
  rssRoleDescription: "visitor shows only public videos; admin also includes hidden videos. The role cannot be changed after creation.",
  rssFilters: "Filters",
  rssChannelsSelectedAuthorDisabled: "Channel selected - author filter disabled",
  rssDays: "{days} days",

  // Role-based settings middleware errors
  settingsApiKeyForbidden:
    "API key authentication cannot access settings endpoints.",
  settingsVisitorAccessRestricted:
    "Visitor role: Access to this resource is restricted.",
  settingsVisitorWriteRestricted:
    "Visitor role: Write operations are not allowed. Read-only access only.",
  settingsVisitorWriteForbidden:
    "Visitor role: Write operations are not allowed.",
  settingsAuthRequired:
    "Authentication required. Please log in to access this resource.",

  // Filename template
  filenameTemplate: "File Naming",
  filenameTemplateDescription: "Choose how downloaded files are named. Non-legacy modes enable media-center-friendly folder structures.",
  filenamePresetLabel: "Naming mode",
  filenamePresetLegacy: "Current compatible mode (Title-Author-Year)",
  filenamePresetMediaCenterDateIndex:
    "Media center - Season/Episode by date and index",
  filenamePresetChannelYearDateIndex: "Channel – Season/Episode by year and date",
  filenamePresetPlaylistStaticIndex: "Playlist – Season 1 / Episode by index",
  filenamePresetPlaylistStaticDate: "Playlist – Season 1 / Episode by date",
  filenamePresetSourceDateFlat: "Source - Date then title",
  filenamePresetCustom: "Custom template",
  filenameCustomTemplateLabel: "Custom template",
  filenameCustomTemplatePlaceholder: "{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}",
  filenamePreviewTitle: "Preview",
  filenamePreviewVideo: "Video",
  filenamePreviewThumbnail: "Thumbnail",
  filenamePreviewSubtitle: "Subtitle",
  filenamePreviewScenarioChannel: "Channel",
  filenamePreviewScenarioPlaylist: "Playlist",
  filenamePreviewScenarioSingle: "Single Video",
  filenameWarningMediaPlaylistIndexUnavailable:
    "media_playlist_index is unavailable for non-playlist sources and will fall back to 00.",
  filenameWarningSourceCollectionMetadataMayBeEmpty:
    "source_collection_name/id may be empty for single-video downloads.",
  filenameValidating: "Validating…",
  filenameValidationError: "Template error",
  filenameBatchRenameButton: "Rename existing files to match current pattern",
  filenameBatchRenameDescription: "Rename all local video, image, and subtitle files to match the current naming pattern shown above. Saving only changes the default for future downloads. Downloads are paused while the rename runs.",
  filenameBatchRenameDisabledRunning: "A rename job is already running.",
  filenameBatchRenameDisabledInvalidTemplate: "Fix the custom template before running rename.",
  filenameBatchRenameConfirmTitle: "Rename all local files?",
  filenameBatchRenameConfirmBody: "This will rename all local video, thumbnail, and subtitle files to match the current naming pattern shown above, even if you have not saved settings yet. The operation cannot be undone automatically. If interrupted, already-renamed files keep their new names.",
  filenameBatchRenameConfirm: "Start renaming",
  filenameBatchRenameRunning: "Renaming files…",
  filenameBatchRenamePaused: "Downloads are paused while rename is in progress.",
  filenameBatchRenameComplete: "Rename complete",
  filenameBatchRenameSummary: "{succeeded} renamed, {skipped} skipped, {failed} failed.",
  filenameBatchRenameError: "Rename failed",
  // Filename template reference (information panel)
  filenameRefInformationTitle: "Information",
  filenameRefInfoLiquid:
    "Use Liquid syntax like {{ title }} for MyTube naming aliases and single-word yt-dlp metadata fields.",
  filenameRefInfoYtdlp:
    "Use yt-dlp syntax like %(upload_date>%Y-%m-%d)s or %(subtitles.en.-1.ext)s for formatted dates, durations, and nested raw metadata paths.",
  filenameRefInfoExtension:
    "The final filename segment must end with .{{ ext }}, .%(ext)s, or .%(ext)S.",
  filenameRefInfoFallbacks:
    "source_collection_name/id can be empty for single-video downloads, and media_playlist_index falls back to 00 outside playlist sources.",
  filenameRefSectionCoreTitle: "Core fields",
  filenameRefSectionUploadTitle: "upload_* namespace",
  filenameRefSectionSourceTitle: "source_* namespace",
  filenameRefSectionPlaylistTitle: "Playlist namespace",
  filenameRefSectionSeasonTitle: "season_* aliases",
  filenameRefSectionStaticTitle: "static_* aliases",
  filenameRefSectionRawMetadataTitle: "Raw yt-dlp metadata",
  filenameRefSectionRawMetadataDescription:
    "These patterns expose yt-dlp metadata beyond the built-in aliases.",
  filenameRefItemTitleDesc: "Video title.",
  filenameRefItemIdDesc: "Platform video ID or local video ID.",
  filenameRefItemExtDesc: "Final file extension without the dot.",
  filenameRefItemUploaderDesc: "Uploader or author name.",
  filenameRefItemChannelDesc: "Channel name, falling back to uploader.",
  filenameRefItemDurationStringDesc: "Duration formatted as HH-MM-SS or MM-SS.",
  filenameRefItemArtistNameDesc:
    "Artist-style fallback chain for media-center naming.",
  filenameRefItemUploadDateDesc: "Upload date as YYYYMMDD.",
  filenameRefItemUploadYyyyMmDdDesc: "Upload date as YYYY-MM-DD.",
  filenameRefItemUploadYearDesc: "Upload year.",
  filenameRefItemUploadMonthDesc: "Upload month.",
  filenameRefItemUploadDayDesc: "Upload day of month.",
  filenameRefItemSourceCustomNameDesc:
    "User-defined source or subscription name. Direct downloads fall back to uploader or channel when no override exists.",
  filenameRefItemSourceCollectionNameDesc:
    "Channel, playlist, or collection name when available.",
  filenameRefItemSourceCollectionIdDesc:
    "Channel, playlist, or collection ID when available.",
  filenameRefItemSourceCollectionTypeDesc:
    "One of channel, playlist, single, or unknown.",
  filenameRefItemMediaPlaylistIndexDesc: "Playlist index padded to two digits.",
  filenameRefItemSeasonFromDateDesc: "Upload year.",
  filenameRefItemSeasonEpisodeFromDateDesc: "Date-shaped episode key.",
  filenameRefItemSeasonEpisodeIndexFromDateDesc:
    "Date-shaped episode key with a two-digit per-day index suffix.",
  filenameRefItemSeasonByYearEpisodeByDateDesc:
    "Season folder plus date-based episode key.",
  filenameRefItemSeasonByYearEpisodeByDateAndIndexDesc:
    "Season folder plus date-based episode key with a per-day index suffix.",
  filenameRefItemStaticSeasonEpisodeByIndexDesc:
    "Season 1 folder plus a two-digit episode number from playlist order.",
  filenameRefItemStaticSeasonEpisodeByDateDesc:
    "Season 1 folder plus a date-based episode key.",
  filenameRefItemGenericSingleWordDesc:
    "Any single-word yt-dlp metadata field can be referenced with Liquid syntax when it exists in raw metadata.",
  filenameRefItemBasicYtdlpDesc:
    "yt-dlp placeholder syntax is supported for title, id, channel, uploader, upload_date, and ext.",
  filenameRefItemFormattedUploadDateDesc:
    "Formats upload_date with yt-dlp date formatting.",
  filenameRefItemFormattedDurationDesc:
    "Formats duration with yt-dlp time formatting.",
  filenameRefItemNestedPathDesc:
    "Reads nested raw metadata paths, including array indexes, through yt-dlp placeholder syntax.",
  // Statistics
  statisticsTitle: "Statistics",
  statisticsSection: "Statistics",
  statisticsHelper: "Statistics are stored locally in MyTube only.",
  statisticsEnableLabel: "Enable statistics collection",
  statisticsRetentionLabel: "Keep detailed event data",
  statisticsRetention90: "90 days",
  statisticsRetention365: "365 days",
  statisticsRetentionForever: "Forever",
  statisticsCaptureSearchTextLabel: "Include raw search text in reports",
  statisticsTrackVisitorLabel: "Track visitor usage",
  statisticsKeepDataLabel: "Keep data when collection is disabled",
  statisticsClear: "Clear collected statistics",
  statisticsClearConfirm: "Clear all collected statistics data?",
  statisticsClearSuccess: "Statistics data cleared.",
  statisticsAdminOnly: "Statistics is admin-only.",
  statisticsDisabledNotice: "Statistics collection is disabled. Enable it in Settings → Advanced → Statistics.",
  statisticsDisabledKeepVisibleNotice:
    "Statistics collection is disabled. Existing reports remain available until you clear them.",
  statisticsDisabledOpenSettings: "Change in Settings",
  statisticsHealth: "Statistics health",
  statisticsLastRunAt: "Last run {date}",
  statisticsWorkerNotRunYet: "Worker has not run yet",
  statisticsDirtyDays: "Dirty days: {count}",
  statisticsSealedDays: "Sealed days: {count}",
  statisticsLastHourAccepted: "Last hour accepted: {count}",
  statisticsDropped: "Dropped: {count}",
  statisticsErrors: "Errors: {count}",
  statisticsSealedDayDrops: "Sealed-day drops: {count}",
  statisticsCompletedCount: "{count} completed",
  statisticsFailedCount: "{count} failed",
  statisticsNotEnoughHistoricalDataYet: "Not enough historical data yet",
  statisticsNoData: "No data",
  statisticsItem: "Item",
  statisticsValue: "Value",
  statisticsDaysRemaining: "{count} days",
  statisticsDiskRunwayUnavailable: "Unavailable for this storage mode",
  statisticsDiskRunwayInsufficientActivity: "Not enough recent activity",
  statisticsFailureBucket_auth_required: "Authentication required",
  statisticsFailureBucket_source_unavailable: "Source unavailable",
  statisticsFailureBucket_geo_or_network_blocked: "Geo or network blocked",
  statisticsFailureBucket_extractor_changed: "Extractor changed",
  statisticsFailureBucket_filesystem_error: "Filesystem error",
  statisticsFailureBucket_cloud_upload_failed: "Cloud upload failed",
  statisticsFailureBucket_unknown: "Unknown",
  totalVideos: "Total videos",
  totalStorage: "Total storage",
  downloadSuccessRate: "Download success rate",
  netNewVideos: "Net new videos",
  downloadVolume: "Download volume",
  watchTime: "Watch time",
  diskRunway: "Disk runway",
  activeSubscriptions: "Active subscriptions",
  activeRssTokens: "Active RSS tokens",
  watchTimeByDay: "Watch time by day",
  completedVsFailedByDay: "Completed vs failed downloads",
  libraryAdditionsByDay: "Library additions by day",
  topWatchedVideos: "Top watched videos",
  mostProductiveSubscriptions: "Most productive subscriptions",
  mostAccessedRssFeeds: "Most accessed RSS feeds",
  mostCommonFailures: "Most common failure buckets",
  largestNeverWatched: "Largest never-watched items",
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  last90Days: "Last 90 days",
  last365Days: "Last 365 days",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
  recomputeStatistics: "Recompute",
  favorite: "Favorite",
  favoritesEmptyTitle: "No favorites yet",
  favoritesEmptySubtitle: "Star collections and authors to pin them here.",
  favoriteCollection: "Favorite collection",
  favoriteAuthor: "Favorite author",
  unfavorite: "Remove from favorites",
  favoriteCollections: "Favorite Collections",
  favoriteAuthors: "Favorite Authors",
  topRated: "Top Rated",
  topRatedSubtitle: "Top-rated videos from the library",
  featured: "Featured",
  continueWatching: "Continue watching",
  browseCollections: "Browse collections",
  findAuthors: "Find authors",
  favoritesUpdateFailed: "Could not update favorites",
  favoriteUnavailable: "Unavailable",
  favoritesLoadFailed: "Some favorites could not be loaded",
  stars: "stars",
  play: "Play",
  openCollection: "Open collection",
};
