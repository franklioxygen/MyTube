# Change Log

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
