# Change Log



## v1.7.60 (2026-01-14)

### Refactor

- refactor: Update cloudflaredService with execSync and fs.existsSync (f68c05e)

## v1.7.59 (2026-01-14)

### Feat

- feat: Add Cinema Mode Control component (28fa3e7)
- feat: add subscribe authors playlists (a64b600)
- feat: Add centralized API and backend URL helpers (44d0bcd)

## v1.7.58 (2026-01-14)

### Refactor

- refactor: Update subscription choice descriptions (c7f79e9)

### Chore

- chore: Update settings in videoController tests (14d3948)

## v1.7.57 (2026-01-13)

### Feat

- feat: Update browser extension installation instructions (93cceb4)
- feat: Add option to re-download deleted videos (15d55fd)

### Fix

- fix: Update version to 1.0.1 (5343901)

## v1.7.56 (2026-01-13)

### Feat

- feat: Add support for Bilibili collections/series URLs (a3f6d9e)
- feat: Subscribe to playlist with download option (53d12ab)

### Style

- style: Improve padding and margins for tab view on SettingsPage (9ccbf2d)

## v1.7.55 (2026-01-12)

### Feat

- feat: Add retry logic and timeout handling to getCloudStorageSignedUrl (7bd6718)
- feat: Add AuthorListItem memoization for performance (72bac4f)
- feat: download authors avatar (3ce517a)
- feat: Add Chrome extension for easier video downloading (2656648)

## v1.7.54 (2026-01-11)

### Feat

- feat: create chrome extension (6df4496)

## v1.7.53 (2026-01-11)

### Style

- style: Update formatting in YtDlpSettings file (9d1fadb)
- style: Remove unnecessary Collapse component and update TextField properties (009ca0d)

## v1.7.52 (2026-01-10)

### Feat

- feat: Add functionality to scan mount directories (0d3dd04)
- feat: Add tabbed navigation to SettingsPage (aa86b72)
- feat: Add TMDB integration for metadata scraping (4edfdfe)

### Refactor

- refactor: Improve date handling in scanFiles function (144b1cf)

## v1.7.51 (2026-01-09)

### Feat

- feat: add TMDB scrape (1722502)

### Fix

- fix: frontend/package.json & frontend/package-lock.json to reduce vulnerabilities (cc2130a)

### Chore

- chore: Update language translations (edd0466)

## v1.7.50 (2026-01-09)

### Feat

- feat: show continous task in download history (063f21b)
- feat: Add maxConcurrentDescription to DownloadSettings (406f1d0)

### Style

- style: Fix code indentation and formatting issues (efd5fca)
- style: Improve container usage in DownloadPage (6f9da06)

### Chore

- chore: Clean up local images after building and pushing (b229fb6)

## v1.7.49 (2026-01-08)

### Feat

- feat: Add sound selection for task completion (ba30dab)
- feat: Add new tools and dependencies (f2edd01)

## v1.7.48 (2026-01-08)

### Feat

- feat(frontend): add sorting functionality for collections table (4c26ccc)

## v1.7.47 (2026-01-08)

### Feat

- feat: Add confirmation modal for downloading playlists (c9de2fa)
- feat: Add function to download all channel playlists (e77c7bf)

### Refactor

- refactor: Update import order in HomeHeader component (778f798)

### Style

- style: Remove unnecessary comments and whitespace (6463436)

## v1.7.46 (2026-01-07)

### Chore

- chore: Update video MIME types and Safari error handling (e9db8e6)

## v1.7.45 (2026-01-07)

### Style

- style: Enable CSS code splitting and use esbuild for minification (20bd425)

## v1.7.44 (2026-01-07)

### Feat

- feat: Enhance video duration handling (033399d)
- feat: Add responsive pagination size and sibling count (b4a7282)

### Build

- build: Optimize vendor bundle splitting (8ff1962)

### Test

- test: update translations tests for async functions (114ee3d)

## v1.7.43 (2026-01-07)

### Feat

- feat: add pre-signed URLs for cloud video and thumbnail (19f57cb)
- feat: Add video prefetch optimization on hover (1e49db2)
- feat: Add video prefetch functionality (5c6afda)

### Refactor

- refactor: Improve code formatting for server.ts (59ac4dd)

## v1.7.42 (2026-01-06)

### Refactor

- refactor: Improve formatting for server.ts and useVideoLoading.ts (c89285e)

## v1.7.41 (2026-01-06)

### Feat

- feat: Add video streaming optimizations (ff3b0e3)

### Fix

- fix: Update API_URL environment variable retrieval (e09550a)

### Chore

- chore: Update build date in Vite config and Footer component (654285b)

## v1.7.40 (2026-01-06)

### Feat

- feat: Add fallback copy function for copying link (35ec579)

## v1.7.39 (2026-01-06)

### Feat

- feat: Add keyboard shortcuts for seeking left and right (cd50f0c)
- feat: Add useSettings hook for dynamic website title (c82b9f0)
- feat: Add functionality to copy video link with snackbar feedback (b13dd0e)

### Refactor

- refactor: Remove unused 'collections' prop from VideoCard (1e41d0c)

## v1.7.38 (2026-01-06)

### Feat

- feat: Add functionality to save author files and improve error logging (e6019dd)

## v1.7.37 (2026-01-06)

### Feat

- feat: Add functionality to save author files to collection (023f27c)
- feat: move author videos to collection (8defbc3)

### Refactor

- refactor: Improve error logging in storage service functions (4ec4926)

## v1.7.36 (2026-01-05)

### Feat

- feat: add pause subscription/continous task feature (ff78ddf)

### Style

- style: Update resolution limits in YtDlpSettings (de3a65f)

### Chore

- chore: remove unnecssary files (e6b612b)

## v1.7.35 (2026-01-05)

### Fix

- fix: Update SOCKS proxy URL for remote DNS resolution (afb4e20)

## v1.7.34 (2026-01-04)

### Feat

- feat: Add isVisitor check to BasicSettings and useVideoProgress (3e44960)

### Feat

- feat: Add refetchOnMount option to DownloadProvider (91d53f0)

## v1.7.33 (2026-01-04)

### Feat

- feat: Add support for SOCKS5 proxies in axios config (695489d)

### Refactor

- refactor: Add default timeout for thumbnail downloads (494b85d)

### Chore

- chore: update doc (a4eaaa3)

## v1.7.32 (2026-01-04)

### Style

- style: Update cookie security settings for better usability (46c8d77)

## v1.7.31 (2026-01-04)

### Feat

- feat: Implement helper for selecting best m3u8 URL (f76acfd)
- feat: Add executeYtDlpJson function (98ec0b3)

### Refactor

- refactor: Update axios configuration for downloading subtitles (c995eb3)

## v1.7.30 (2026-01-04)

### Test

- test: Update mock SettingsPage test to include refetch (eeac567)

### Style

- style: Improve comments for YtDlpSettings file (e7bdf18)

### Test

- test: Add file_location test and mock settings in ytdlpVideo (a5e82b9)

## v1.7.29 (2026-01-03)

### Feat

- feat: Enable visitor user with password option (ccd2729)
- feat: enhance visitor mode (e18f49d)
- feat: enhance visitor mode (13de853)
- feat: enhance visitor mode (76d4269)
- feat: Add visitor mode in LoginPage component (44b2454)

### Test

- test: Add role to response in passwordController tests (a9f7864)

## v1.7.28 (2026-01-03)

### Refactor

- refactor: Improve m3u8 URL selection strategy (3717296)

## v1.7.27 (2026-01-03)

### Feat

- feat: Add endpoint for retrieving reset password cooldown (092a79f)
- feat: Add WebAuthn error translations (9296390)

## v1.7.26 (2026-01-03)

### Feat

- feat: Add script to reset password securely (1b9451b)
- feat: Add allowResetPassword setting and UI components (9968268)
- feat: Add password login permission handling (ce544ff)

## v1.7.25 (2026-01-02)

### Feat

- feat: add passkey feature (6fdfa90)

### Refactor

- refactor: Update formatUtils to use formatRelativeDownloadTime function (c9657ba)

## v1.7.24 (2026-01-01)

### Refactor

- refactor: Explicitly preserve network-related options (90a2445)

## v1.7.23 (2026-01-01)

### Feat

- feat: Add logic to refresh thumbnail with random timestamp (6bbb40e)
- feat: Add reset password route and update dependencies (c00b552)

### Feat

- feat: Add reset password route (845e184)

### Fix

- fix: backend/package.json & backend/package-lock.json to reduce vulnerabilities (b0428b9)

## v1.7.22 (2025-12-30)

### Feat

- feat: Add risk command scanning for hook uploads (c32fa3e)

### Refactor

- refactor: Improve handling of absolute paths in security functions (351f187)

## v1.7.21 (2025-12-30)

### Feat

- feat: Add hook functionality for task lifecycle (6f1a1cd)
- feat: add task hooks (8ac9e99)

## v1.7.20 (2025-12-30)

### Chore

- chore: Update language support to include Russian and update api document (b204fc5)

## v1.7.19 (2025-12-29)

### Test

- test: improve frontend test coverage (cb808a3)
- test: improve backend test coverage (3a16577)


## v1.7.18 (2025-12-29)

### Refactor

- refactor: reorgnize settings page (f812fe4)

## v1.7.17 (2025-12-29)

### Feat

- feat: Update version to 1.7.17 and add CollapsibleSection (e56db6d)

### Style

- style: Improve formatting in DownloadsMenu component (094e628)

### Test

- test: remove unnecessary text assertions (c9e15a7)


## v1.7.16 (2025-12-29)

### Feat

- feat(api): Add system controller and version check endpoint (db3d917)
- feat: Add pause on focus loss functionality (a664baf)

### Style

- style: Update spacing to use Grid component in UpNextSidebar (21c3f4c)


## v1.7.15 (2025-12-29)

### Feat

- feat: Add cloud storage redirect functionality (b52547b)

### Refactor

- refactor: Remove unnecessary cache flag from Docker build commands (5422e47)

## v1.7.14 (2025-12-29)

### Style

- style: update import statements in test files (01292ce)

### Test

- test(useVideoHoverPreview): Add hover delay for desktop (694b4f3)
- test: Add unit tests for cloud storage utils and URL validation (5b78b8a)
- test: Implement Missing Tests (37a57dc)
- test(SubscriptionModal): Add subscription modal tests (aaa5a46)
- test: Add unit tests for new components and features (0acbcb7)
- test: Add unit tests for video card utils and player utils (0e42c65)
- test(useViewMode): add hook for managing view mode (80c6efd)
- test: Add unit tests for various utils functions (c998780)

## v1.7.13 (2025-12-28)

### Chore

- chore: Prune Docker builder cache for space optimization (3e18cc2)

### Test

- test: improve test coverage (a01ec2d)

## v1.7.12 (2025-12-28)

### Fix

- fix: fix task cleanup test (6d07967)

## v1.7.11 (2025-12-28)

### Feat

- feat: add HomeHeader, HomeSidebar, VideoGrid components (00b192b)
- feat: Add custom hooks for managing modals and mutations (128624b)

### Fix

- fix: Update VideoPlayer to handle null src value (05df7e2)

### Refactor

- refactor: Improve error handling in delete operation (7002387)
- refactor: Remove duplicate code for getting poster thumbnail URL (630ecd2)
- refactor: Reorder import statements for consistency (fb3a627)
- refactor: refactor bilibiliVideo.ts (a1289d9)
- refactor: refactor videoplayer page (8a00ef2)
- refactor: refactor videocard (ea9ead5)

### Style

- style: Improve code formatting and indentation (a4a24c0)

### Test

- test: improve test coverage (a1ede96)
- test: Mock database and dependencies in taskCleanup.test file (6d07967)

## v1.7.10 (2025-12-28)

### Refactor

- refactor: Improve file streaming with cleanup and error handling (b76e699)

## v1.7.9 (2025-12-28)

### Fix

- fix: exclude uploads directory from docker build (73b4fe0)

### Refactor

- refactor: Refactor and improve code formatting (1d3f024)

### Style

- style: Improve code formatting and add error retries (d0c316a)

## v1.7.8 (2025-12-27)

### Refactor

- refactor: refactor collection (7f0d340)
- refactor: refactor collection (286401c)
- refactor: Consolidate file moving operations into file manager (56662e5)
- refactor: breakdown settingsController (63ea6a1)
- refactor: breakdown VideoControls (d33d3b1)

## v1.7.7 (2025-12-27)

### Feat

- feat: Add functionality to clear finished tasks (604ff71)

### Refactor

- refactor: breakdown continuousDownloadService (68d4b8a)

## v1.7.6 (2025-12-27)

### Feat

- feat: Add poster prop to VideoControls component (3632151)

### Refactor

- refactor: Update error logging in video download tracking functions (db16896)
- refactor: Update yt-dlp to use Node.js runtime alternative (6d04ce4)

## v1.7.5 (2025-12-27)

### Refactor

- refactor: Add centralized API client and query configuration (3d0bf34)

## v1.7.4 (2025-12-27)

### Refactor

- refactor: Improve video memory management and error handling (27db579)

## v1.7.3 (2025-12-27)

### Feat

- feat: Add function to configure SQLite database (0ec8478)

## v1.7.2 (2025-12-27)

### Feat

- feat: Allow access CloudFlare tunnel in visitor mode (2902ba8)

## v1.7.1 (2025-12-26)

### Fix

- fix: Add missing dependencies for canvas in Dockerfile (c8a199c)

## v1.7.0 (2025-12-26)

### Fix

- fix: upgrade vulnerabilities; enhance security (aa8e8f0)

### Refactor

- refactor: Update paths and imports in controllers (1d97659)

## v1.6.49 (2025-12-26)

### Feat

- feat: Add lazy loading attribute to images (9a955fa)
- feat: add youtube playlist download feature (e5fcf66)

### Refactor

- refactor: Configure QueryClient with memory management settings (e03db8f)

### Docs

- docs: Update localization files with new content (0553bc6)

### Test

- test: Improve clipboard functionality and axios mocking (6296f0b)

## v1.6.48 (2025-12-26)

### Chore

- chore: Update docker-compose files and configurations (33fa090)

### Refactor

- refactor: Improve cloud thumbnail generation with retry mechanism and optimized ffmpeg parameters

## v1.6.47 (2025-12-25)

### Fix

- fix: Fix API URL in frontend (1d2f9db)

### Feat

- feat: Add Cloudflare Tunnel integration (431e716)
- feat: Add Cloudflare Tunnel settings and service (508daae)

## v1.6.46 (2025-12-25)

### Feat

- feat: Add cloud thumbnail cache functionality (85b34ec)

## v1.6.45 (2025-12-25)

### Feat

- feat: Add new player utilities and update video player components (1f85b37)
- feat: Add incrementView function to VideoContext (0225912)

## v1.6.44 (2025-12-25)

### Feat

- feat: Add multi-architecture support and manifests creation (dec45d4)

## v1.6.43 (2025-12-24)

### Feat

- feat: Add count of videos added from cloud scan (7af272a)

### Refactor

- refactor: Update VideoCard and VideoActionButtons to use async/await for getVideoUrl function (853e7a5)

## v1.6.42 (2025-12-23)

### Feat

- feat: Add hide video for visitor mode feature
- feat: Add translations for hide video feature in all supported languages
- feat: Add database migration for hidden video field

## v1.6.41 (2025-12-23)

### Feat

- feat: Add "Download all previous videos" option when subscribing to authors
- feat: Add continuous download tasks for downloading all previous videos from subscribed authors
- feat: Add task management UI in SubscriptionsPage with progress tracking, cancel, and delete functionality
- feat: Add translations for continuous download tasks in all supported languages

### Fix

- fix: Fix subscription disappearing issue by adding race condition protection and verification before updates
- fix: Improve subscription update logic to prevent concurrent processing and silent failures

### Refactor

- refactor: Update subscription service to update lastCheck before download to prevent concurrent processing
- refactor: Improve error handling and logging in subscription check process

## v1.6.40 (2025-12-23)

### Refactor

- refactor: Update author URL decoding in subscriptionService (9f2dd1a)

## v1.6.39 (2025-12-23)

### Feat

- feat: Add deleteVideos function in VideoContext (faf09f4)

## v1.6.38 (2025-12-23)

### Feat

- feat: Implement SortControl component for sorting videos (f2cd4c8)
- feat: Update deleteVideo function signature (1712a0b)

## v1.6.37 (2025-12-23)

### Refactor

- refactor: Improve thumbnail uploading and path handling (3608296)

## v1.6.36 (2025-12-23)

### Refactor

- refactor: Improve readability of file search function (e6a8e94)
- refactor(urlSigner): Improve file search logic for getFileUrlsWithSign function (fd97f20)

## v1.6.35 (2025-12-22)

### Refactor

- refactor: Improve file search logic for getFileUrlsWithSign function (e2991f9)

## v1.6.34 (2025-12-22)

### Feat

- feat: Add infinite scroll and video columns settings (fefe603)

### Style

- style: Update paths in comments and documentation (54537b8)

## v1.6.33 (2025-12-22)

### Style

- style: Update Discord invite link in README files (6e4a4f5)

## v1.6.32 (2025-12-22)

### Chore

- chore: update bgutil-ytdlp-pot-provider submodule (d59617c)

## v1.6.31 (2025-12-22)

### Feat

- feat: Add security measures and URL validation (bbea5b3)

## v1.6.30 (2025-12-22)

### Feat

- feat: Add support for multiple scan paths in cloud storage (31b2d05)
- feat: Add function to check if file exists before upload (2816ea1)

### Refactor

- refactor: Reorganize imports in cloudScanner.ts (d96c785)

## v1.6.29 (2025-12-21)

### Style

- style: Improve cloud drive settings URL handling (8e6dd5c)
- style: Remove unnecessary comment and white space (765b8de)

## v1.6.28 (2025-12-21)

### Feat

- feat: Add two-way sync for cloud storage (bc86d48)

### Refactor

- refactor: breakdown CloudStorageService (2a50d96)

## v1.6.27 (2025-12-21)

### Feat

- feat: Improve error handling and logging in download process (8982c11)

### Refactor

- refactor: Improve finding or creating collections in downloadVideo function (d366123)
- refactor: Improve video part skipping and processing (e4a34ac)
- refactor: Improve URL validation in CloudDriveSettings (b5bc532)

## v1.6.26 (2025-12-20)

### Feat

- feat: Add paste functionality to search input (81d4a71)
- feat: Add new features and improve styles (02e9b32)

## v1.6.25 (2025-12-20)

### Feat

- feat: Add logic to check if video is new (bfc2fe8)
- feat: Add support for Twitter/X URL with Safari compatibility (70c8538)

### Style

- style: Improve touch screen compatibility (9823e63)

## v1.6.24 (2025-12-20)

### Feat

- feat: Add functionality to format, rename, and store video files (24078d5)
- feat: Add new features to improve file handling (441fd12)

## v1.6.23 (2025-12-20)

### Feat

- feat: Add syncToCloud feature with progress updates (10c2fe2)
- feat: Implement request coalescing for getSignedUrl (a0ba15a)

## v1.6.22 (2025-12-19)

### Feat

- feat: Add mobile scroll to top button and gradient header background (b637a66)

## v1.6.21 (2025-12-18)

### Fix

- fix: Only load thumbnails from cloud storage when video is in cloud storage (prevents 403 errors for local videos)

## v1.6.20 (2025-12-19)

### feat

- feat: Add useCloudStorageUrl hook for cloud storage paths

### Fix

- style: Fix indentation issues in settingsController and SettingsPage

## v1.6.19 (2025-12-18)

### Feat

- feat: Add public URL field in settings and services (4144038)

## v1.6.18 (2025-12-18)

### Feat

- feat: Add savedVisitorMode to GeneralSettings (e684118)
- feat: add visitor mode (read only) (60a02e8)

### Refactor

- refactor: Remove commented-out code for password verification (775d024)

## v1.6.17 (2025-12-18)

### Feat

- feat: Add video deletion functionality (8719186)
- feat: Add VideoKebabMenuButtons component (cf5a48a)

### Style

- style: Improve VideoCard layout styling and responsiveness (dfd4310)

### Test

- test: Pass delete handler to menu in VideoCard (a20964e)

## v1.6.16 (2025-12-18)

### Style

- style: Make video thumbnails edge-to-edge on mobile view while maintaining vertical spacing between cards

## v1.6.15 (2025-12-18)

### Performance

- perf: Store channel URL in database to avoid unnecessary yt-dlp calls when opening video player pages
- perf: Update getAuthorChannelUrl endpoint to check database first before fetching from YouTube/Bilibili API

### Feat

- feat: Add channelUrl field to videos table schema
- feat: Extract and save channel URL during video download for YouTube and Bilibili videos

## v1.6.14 (2025-12-18)

### Fix

- fix: Fix Openlist cloud storage video and thumbnail display issues by fetching sign information and building correct URLs
- fix: Update frontend to support full URLs (http:// or https://) for cloud storage paths

## v1.6.13 (2025-12-18)

### Fix

- fix: Add polling-based file watching to vite.config.js to prevent ENOSPC file watcher errors

### Docs

- docs: Add troubleshooting section for file watcher limit (ENOSPC) errors in getting-started documentation

## v1.6.12 (2025-12-17)

### Feat

- feat: Add restore from last backup database functionality (a1b2c3d)

## v1.6.11 (2025-12-17)

- feat: Add translations for restore feature and OK button to all languages (e4f5g6h)

## v1.6.10 (2025-12-17)

### Feat

- feat: Add cloud storage settings and connection test feature (7585e74)

## v1.6.9 (2025-12-16)

### Fix

- fix: Change js-runtime from node to deno (recommended by yt-dlp) and add deno installation to Dockerfile

## v1.6.8 (2025-12-16)

### Feat

- feat: Add external player options to VideoActionButtons (b57e9df)

### Refactor

- refactor: Simplify handling of extractorArgs in ytdlpConfig (422701b)

### Style

- style: Update button styles and add kebab menu for mobile (65b749d)
- style: Update styles for VideoAuthorInfo and VideoTags (22d625b)

## v1.6.7 (2025-12-16)

### Feat

- feat: Add subscribe functionality to VideoPlayer page (4624d12)
- feat: Add function to get author channel URL (a7a4eae)

### Refactor

- refactor: Update quotation marks to use double quotes consistently (6430605)

### Docs

- docs: Update documentation (0ba6e20)

## v1.6.6 (2025-12-16)

### Fix

- fix: Prevent accidental tag loss when saving settings (preserve existing tags when undefined or empty array sent)

## v1.6.5 (2025-12-16)

### Feat

- fix: Add build dependencies for native modules (df8d279)

## v1.6.4 (2025-12-15)

### Feat

- feat: Add functionality to reset password and handle wait time (c1d898b)
- feat: Implement core video download function using yt-dlp (b4277dd)
- feat: Add new header components and functionality (87f8d60)
- feat: Add ActiveDownloadsTab, CustomTabPanel, HistoryItem, HistoryTab, QueueTab components (a0bb415)
- feat: Added components for video title editing, rating, tags, author info, description, and metadata (abb79d4)

### Refactor

- refactor: breakdown downloaders and controllers (c748651)
- refactor: breakdown storageServive (3698d45)

### Style

- style: Remove unused imports and variables (4fb1c1c)

### Test

- test: Update video controller tests and downloader tests (748c80c)

## v1.6.3 (2025-12-15)

### Fix

- fix: Fix pipeline test error

## v1.6.2 (2025-12-15)

### Fix

- fix: Update version number in Footer test

## v1.6.1 (2025-12-15)

### Test

- test: improve overall test coverage

## v1.6.0 (2025-12-15)

### Feat

- feat: Add detailed logging for subtitle download process (ea46066)
- feat: Implement getVideoInfo and downloadVideo for Bilibili (f864b90)

### Refactor

- refactor: Simplify Bilibili subtitle download logic (8279e64)
- refactor: Update response format for backward compatibility (e82ead6)
- refactor: refactor controller (4e0dd4c)
- refactor: refactor downloader (07ca438)

## v1.5.14 (2025-12-14)

### Feat

- feat: Add functionality to move thumbnails to video folder (dd94d80)

## v1.5.13 (2025-12-14)

### Refactor

- refactor: Update default and YouTube video formats for compatibility (0444527)

## v1.5.12 (2025-12-14)

### Refactor

- refactor: Update yt-dlp installation and fix cookies usage (5aff222)

## v1.5.11 (2025-12-14)

### Refactor

- refactor: Update merge output format handling (98694d5)

### Style

- style: Remove unused onSave function and related logic (59a890a)

## v1.5.10 (2025-12-14)

### Feat

- feat: Add discriminated union types for download errors (4df83c9)

## v1.5.9 (2025-12-14)

### Test

- test: Add mock for storageService.checkVideoDownloadBySourceId (358c04b)

## v1.5.8 (2025-12-13)

### Feat

- feat: Update YtDlpSettings to include onSave callback (c704e1a)
- feat: Improve MissAV video ID extraction logic (4e6291d)

### Refactor

- refactor: Update yt-dlp downloader script for flexibility (2d1b737)

## v1.5.7 (2025-12-12)

### Feat

- feat: Add option to move subtitles to video folder (72b0e7e)

## v1.5.6 (2025-12-12)

### Feat

- feat: Add proxy only for YouTube setting (98a0911)

## v1.5.5 (2025-12-12)

### Feat

- feat: Implement loading more search results (9b9fdc1)
- feat: Add state management for video download status (3ae277b)
- feat: Add MissAVDownloader tests and extract author from URL (0f23220)

## v1.5.4 (2025-12-11)

### Feat

- feat: Add showYoutubeSearch feature (0976bea)

### Refactor

- refactor: Improve autosave functionality and settings comparison (da3221f)

## v1.5.3 (2025-12-10)

### Feat

- feat: Add external player integration for video playback (15b3900)
- feat: Add BilibiliDownloader methods for author info & video (7c40f1c)
- feat: Add theme context provider for global theme management (b3a01ea)

## v1.5.2 (2025-12-10)

### Feat

- feat: add yt-dlp config (db94ed0)

### Docs

- docs: Update yt-dlp utils for Bilibili network settings (c52721c)

## v1.5.1 (2025-12-10)

### Test

- test: Update expect calls in downloadService tests (84b36bf)

## v1.5.0 (2025-12-10)

### Feat

- feat: Add yt-dlp functionality and improve code readability (4cda9d3)
- feat: Add yt-dlp download functionality and helpers (b10e1f8)

### Refactor

- refactor: Improve cancellation error handling and file cleanup (60f58d0)
- refactor: Improve code readability and maintainability (7d17f70)
- refactor: optimize download manage page (dfeec2b)
- refactor: use yt-dlp instead of wrapper (9f4716f)

## v1.4.19 (2025-12-09)

### Feat

- feat: Add sorting functionality for videos on Home page (ee813b3)

### Refactor

- refactor: Improve code readability and structure (6b50d50)
- refactor: Update translations for "downloading" and "poweredBy" (6d6dba2)

### Docs

- docs: Update sorting translations (ab1c931)

## v1.4.18 (2025-12-09)

### Feat

- feat: Add video description support for Bilibili and YtDlp (4d88066)

## v1.4.17 (2025-12-09)

### Feat

- feat: Add functionality to format legacy filenames (2dbc47f)
- feat: Add formatVideoFilename helper function (fd70120)

## v1.4.16 (2025-12-08)

### Docs

- docs: Update localization messages for link copy status (7821851)

## v1.4.15 (2025-12-08)

### Feat

- feat: Add itemsPerPage setting to GeneralSettings (bc520dc)
- feat: Add websiteName field to settings and UI (56c7643)

## v1.4.14 (2025-12-08)

### Chore

- chore: Add release notes for version 1.4.13 (b095a68)
- chore(release): Update package-lock versions to 1.4.13 (e8acd13)

## v1.4.13 (2025-12-08)

### Fix

- fix: fix potential issue; update docs (b1cdf12)
- fix: Update package versions to 1.4.12 in lock files (f1ef1d0)

## v1.4.12 (2025-12-08)

### Fix

- fix: Update backend and frontend package versions to 1.4.11 (fadfd0b)

### Test

- test: Add additional test coverage for video download handling (8888b4d)

## v1.4.11 (2025-12-08)

### Feat

- feat: Add previously deleted video localization (fee82d5)
- feat: add delete history detect (397d003)
- feat: Add downloadId parameter for progress monitoring (a265d94)

### Fix

- fix: Update backend and frontend package versions to 1.4.10 (8b33392)

## v1.4.10 (2025-12-08)

### Fix

- fix: Update package versions to 1.4.9 in lock files (56cd662)

### Refactor

- refactor: Update MissAV download logic to include 123av (d772916)

## v1.4.9 (2025-12-08)

### Feat

- feat: Improve MissAVDownloader methods and error handling (59ea919)

### Fix

- fix: Update backend and frontend package versions to 1.4.7 (8dcd7ab)

### Refactor

- refactor: missav use yt-dlp (386bf2b)

## v1.4.7 (2025-12-07)

### Fix

- fix: Update backend and frontend package versions to 1.4.6 (45c8bb8)

### Style

- style: Add ReplayIcon and improve button layout (0ae5fe0)

## v1.4.6 (2025-12-06)

### Fix

- fix: Update backend and frontend package versions to 1.4.5 (be8e1e7)

### Style

- style: Add zIndex to VideoCard styles (12c4dd2)

## v1.4.5 (2025-12-06)

### Fix

- fix: Update GitHub Actions Workflow Status link (bf21813)
- fix: Update default branch name to 'master' in workflows and badges (67d4900)
- fix: Update package versions to 1.4.4 (24cb067)

### Docs

- docs: Add Skeleton loading for VideoCard and UpNextSidebar (e052edb)

### Style

- style: Update default branch name to 'master' in CONTRIBUTING.md and RELEASING.md (78e2f1d)

### Test

- test: Fix test case count mismatch in storageService test (0644cd5)

## v1.4.4 (2025-12-05)

### Fix

- fix: Update package versions to 1.4.3 (1e0680a)

### Style

- style: Update favicon image URLs in HTML and SVG files (8fdc638)

## v1.4.3 (2025-12-05)

### Feat

- feat: Add 'history' view mode to Home page (7c8ab4e)

### Fix

- fix: Update backend and frontend package versions to 1.4.2 (0950d33)

### Style

- style: Improve button styling in VideoInfo component (b9266d7)

## v1.4.2 (2025-12-05)

### Feat

- feat: Add support for deleting cookies (240c3a2)

### Fix

- fix: Update package versions to 1.4.1 (7b76b20)

## v1.4.1 (2025-12-05)

### Fix

- fix: Update backend and frontend package versions to 1.4.0 (ecf6e86)

### Style

- style: Improve UI layout in VideoCard and UpNextSidebar (5829d84)

## v1.4.0 (2025-12-05)

### Feat

- feat: Add formatDuration and formatSize functions (9225c78)
- feat: Add SearchPage component and route (02fc034)
- feat: Add file scanning and deletion functionality (1a93b15)

### Fix

- fix: Update backend and frontend package versions to 1.3.19 (8b2e41c)

### Refactor

- refactor: breakdown files to components (5e97696)
- refactor: Update scan confirmation messages (9569c00)

## v1.3.19 (2025-12-04)

### Feat

- feat: Add autoPlayNext feature (7246d59)
- feat: Add expand/collapse functionality to video title (84ccf0d)

### Fix

- fix: Update backend and frontend package versions to 1.3.18 (bf4eccd)

## v1.3.18 (2025-12-04)

### Feat

- feat: Add subtitle language selection in video controls (febebc5)
- feat: bilibili subtitle download (8b660cd)

### Fix

- fix: Update package versions to 1.3.17 (9e0a0a3)

## v1.3.17 (2025-12-04)

### Fix

- fix: Update backend and frontend package versions to 1.3.16 (25502bb)

### Refactor

- refactor: Update handleVideoSubmit function signature (69e0263)

### Style

- style: Update Tabs component in DownloadPage (e3831fb)

## v1.3.16 (2025-12-04)

### Feat

- feat: Add nodemon configuration for TypeScript files (84f0b48)

### Fix

- fix: Update backend and frontend package versions to 1.3.15 (26c5ddc)

### Other

- Remove duplicate Discord badge (47e8c5b)

## v1.3.15 (2025-12-03)

### Fix

- fix: Update package versions to 1.3.14 (0560ce6)

### Refactor

- refactor: Update runMigrations to be an async function (efa8a7e)

## v1.3.14 (2025-12-03)

### Fix

- fix: Update package versions to 1.3.10 (fec1d6c)

### Style

- style: Update video preview image link in README files (d6d6824)

## v1.3.10 (2025-12-02)

### Feat

- feat: Add logic to organize videos into collections (e96b4e4)
- feat: Add documentation for API endpoints and directory structure (eed2458)

### Fix

- fix: Update package versions to 1.3.9 in lock files (63914a7)

### Docs

- docs: Update deployment instructions in README (10d6933)

## v1.3.9 (2025-12-02)

### Feat

- feat: Add subtitles support and rescan for existing subtitles (a6920ef)

### Fix

- fix: Update backend and frontend package versions to 1.3.8 (12858c5)

## v1.3.8 (2025-12-02)

### Fix

- fix: Update route path for collection in App component (0cf2947)
- fix: Update backend and frontend versions to 1.3.7 (9c48b5c)

### Refactor

- refactor: Update download history logic to exclude cancelled tasks (75b6f89)

## v1.3.7 (2025-12-02)

### Feat

- feat: Add bgutil-ytdlp-pot-provider integration (26184ba)

### Fix

- fix: Update versions to 1.3.5 and revise features (04790fd)

### Refactor

- refactor: Update character set for sanitizing filename (1e5884d)

### Docs

- docs: Update README with Python and yt-dlp installation instructions (5341bf8)

## v1.3.5 (2025-12-02)

### Feat

- feat: subscription for youtube platfrom (6a42b65)
- feat: subscription for youtube platfrom (7caa924)

### Fix

- fix: Update package versions to 1.3.4 (50ae086)

## v1.3.4 (2025-12-01)

### Fix

- fix: Update package-lock.json versions to 1.3.3 (1d421f7)

### Refactor

- refactor: Update VideoCard to handle video playing state (b49bfc8)

## v1.3.3 (2025-12-01)

### Feat

- feat: Add hover functionality to VideoCard (26fd63e)
- feat: Add pagination and toggle for sidebar in Home page (f20ecd4)
- feat: Add upload and scan modals on DownloadPage (7969412)
- feat: Add batch download feature (c88909b)

### Fix

- fix: Update package versions to 1.3.2 in lock files (618d905)

### Style

- style: Update Header component UI for manageDownloads (ae8507a)

## v1.3.2 (2025-11-30)

### Feat

- feat: Add Cloud Storage Service and settings for OpenList (cffe231)

### Fix

- fix: Update package versions to 1.3.1 (19383ad)

## v1.3.1 (2025-11-29)

### Feat

- feat: Update versions and add support for more sites (56557da)

### Refactor

- refactor: Remove unnecessary youtubedl call arguments (f2b5af0)

## v1.3.0 (2025-11-28)

### Fix

- fix: Update backend and frontend package versions to 1.2.5 (d1ceef9)

### Refactor

- refactor: Update YouTubeDownloader to YtDlpDownloader (fc070da)

## v1.2.5 (2025-11-27)

### Fix

- fix: Update package versions to 1.2.4 (bc3ab6f)

### Style

- style: Improve speed calculation and add version in footer (710e85a)

## v1.2.4 (2025-11-27)

### Feat

- feat: Add support for multilingual snackbar messages (6621be1)

### Fix

- fix: Update package versions to 1.2.3 (10d5423)

## v1.2.3 (2025-11-27)

### Feat

- feat: Add last played timestamp to video data (0009f7b)
- feat: Add file size to video metadata (591e85c)

### Fix

- fix: Update package versions to 1.2.2 (d9bce6d)

### Other

- Add image to README-zh.md and enhance layout (610bc61)
- Add image to README and enhance demo section (70defde)

## v1.2.2 (2025-11-27)

### Feat

- feat: Add new features and optimizations (8c33d29)

### Fix

- fix: Update package versions to 1.2.1 (3ad06c0)

## v1.2.1 (2025-11-26)

### Feat

- feat: Introduce AuthProvider for authentication (f418024)
- feat: refactor with Tanstack Query (350cacb)

### Fix

- fix: Update package versions to 1.2.0 (1fbec80)

## v1.2.0 (2025-11-26)

### Feat

- feat: Add file_size column to videos table (0f36b4b)
- feat: download management page (3933db6)
- feat: Add tags functionality to VideoContext and Home page (f22e103)
- feat: Add background backfill for video durations (5684c02)
- feat: Add view count and progress tracking for videos (ecc1787)
- feat: Add functionality to refresh video thumbnail (f021fd4)

### Docs

- docs: Remove legacy \_journal.json file and add videos list (cac5338)

### Style

- style: Update component styles and minor refactorings (c5d9eaa)

## v1.0.1 (2025-11-25)

### Feat

- feat: Add release script for versioning and tagging (9cb674d)
- feat: Update Dockerfile for production deployment (46a58eb)
- feat: add more languages (72aab10)
- feat: Add toggle for view mode in Home page (b725a91)
- feat: Add tags support to videos and implement tag management (f0568e8)
- feat(frontend): enable title editing in VideoPlayer (2779595)
- feat: Add option to delete legacy data from disk (b2244bc)
- feat: Add Dockerignore files for backend and frontend (89a1451)
- feat: migrate json file based DB to sqlite (f03bcf3)
- feat: Add MissAV support and new features (e739901)
- feat: add MissAV support (046ad4f)
- feat: Add fullscreen functionality (6e2d648)
- feat: Add collection translation for CollectionCard (fc9252e)
- feat: Add AnimatedRoutes component for page transitions (1292777)
- feat: add rating; UI adjustment (d25f845)
- feat: Add settings functionality and settings page (c9d683e)
- feat: Add Footer component (395f085)
- feat: Add video upload functionality (d1285af)
- feat: Add video upload functionality (0fcd886)
- feat: Add functionality to fetch and display video comments (8978c52)
- feat: Add pagination logic and controls for videos (0e2a0a7)
- feat: Add snackbar notifications for various actions (e0b1f59)
- feat: Add confirmation modals for video and collection actions (8e65f40)
- feat: Add Bilibili collection handling functionality (63bce0e)
- feat(Home): Add reset search button in search results (23bd6d7)
- feat: Add options to delete videos with a collection (6f77ee3)
- feat: Add video management functionality (390d3f4)
- feat: Add active downloads indicator (1fd06af)
- feat: Customize build configuration with environment variables (2c15fc8)
- feat: Add Chinese translation in README and README-zh file (d01cd7f)
- feat: Add Bilibili video download support and frontend build fix (6d64f5d)
- feat(frontend): Add search functionality to homepage (a45babd)
- feat: Add Bilibili multi-part download functionality (b09504d)
- feat: Initialize status.json for tracking download status (e1c8292)
- feat: Add delete collection modal (0f14404)
- feat: Add server-side collection management (4ea5328)
- feat: Add URL extraction and resolution functions (61d251a)

### Fix

- fix: Update key event from onKeyPress to onKeyDown (12213fd)
- fix: Update CMD to run compiled TypeScript code (3238718)
- fix: Update frontend and backend URLs to new ports (15d71f5)

### Refactor

- refactor: Improve video handling in collectionController (2b6b4e4)
- refactor: Update frontend and backend URLs for Docker environment (f70f415)
- refactor: Improve comments section toggling logic (32ea97c)
- refactor with MUI (eb53d29)
- refactor with TypeScript (11bd2f3)
- refactor backend (fa0f063)
- refactor: Update bilibili URL regex pattern (bbdc78d)

### Docs

- docs: Update deployment instructions and Docker scripts (8985c3d)
- docs: Update deployment guide with server deployment option (742447f)

### Style

- style: Update branch name to 'master' in release script (a89eda8)
- style: Update settings and grid sizes in frontend pages (81ec7a8)
- style: Update styles for better spacing and alignment (9d78f7a)
- style: Add useMediaQuery hook for responsiveness (018e0b1)
- style: Update button variants to outlined in modals (b6231d2)
- style: Refactor header layout for mobile and desktop (7a847ed)
- style: Add responsive viewport meta tag and css rules (534044c)
- style: Update VideoCard component props and logic (d97bbde)
- style: Update video player page layout and styling (f9754c8)

### Test

- test: remove coverage files (cc522fe)
- test: create backend test cases (20ab002)

### Chore

- chore: Create necessary directories and display version information (0726bba)
