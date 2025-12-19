# Directory Structure

```
mytube/
├── backend/                          # Express.js backend (TypeScript)
│   ├── src/                          # Source code
│   │   ├── __tests__/                # Test files
│   │   │   ├── controllers/          # Controller tests
│   │   │   ├── middleware/           # Middleware tests
│   │   │   ├── services/             # Service tests
│   │   │   └── utils/                # Utility tests
│   │   ├── config/                   # Configuration files
│   │   │   └── paths.ts              # Path configuration
│   │   ├── controllers/              # Route controllers
│   │   │   ├── cleanupController.ts  # Cleanup operations
│   │   │   ├── collectionController.ts
│   │   │   ├── downloadController.ts
│   │   │   ├── scanController.ts
│   │   │   ├── settingsController.ts
│   │   │   ├── subscriptionController.ts
│   │   │   ├── videoController.ts
│   │   │   ├── videoDownloadController.ts
│   │   │   └── videoMetadataController.ts
│   │   ├── db/                       # Database layer
│   │   │   ├── index.ts              # Database connection (Drizzle ORM)
│   │   │   ├── migrate.ts            # Migration runner
│   │   │   └── schema.ts             # Database schema definitions
│   │   ├── errors/                   # Custom error classes
│   │   │   └── DownloadErrors.ts
│   │   ├── middleware/               # Express middleware
│   │   │   ├── errorHandler.ts       # Error handling middleware
│   │   │   ├── visitorModeMiddleware.ts # Visitor mode (read-only) middleware
│   │   │   └── visitorModeSettingsMiddleware.ts # Visitor mode settings middleware
│   │   ├── routes/                   # API route definitions
│   │   │   ├── api.ts                # Main API routes
│   │   │   └── settingsRoutes.ts     # Settings-specific routes
│   │   ├── scripts/                  # Utility scripts
│   │   │   ├── cleanVttFiles.ts
│   │   │   └── rescanSubtitles.ts
│   │   ├── services/                 # Business logic services
│   │   │   ├── downloaders/          # Downloader implementations
│   │   │   │   ├── BaseDownloader.ts # Abstract base class
│   │   │   │   ├── BilibiliDownloader.ts
│   │   │   │   ├── MissAVDownloader.ts
│   │   │   │   ├── YtDlpDownloader.ts
│   │   │   │   ├── bilibili/         # Bilibili-specific modules
│   │   │   │   │   ├── bilibiliApi.ts
│   │   │   │   │   ├── bilibiliCollection.ts
│   │   │   │   │   ├── bilibiliCookie.ts
│   │   │   │   │   ├── bilibiliSubtitle.ts
│   │   │   │   │   ├── bilibiliVideo.ts
│   │   │   │   │   └── types.ts
│   │   │   │   └── ytdlp/            # yt-dlp-specific modules
│   │   │   │       ├── types.ts
│   │   │   │       ├── ytdlpChannel.ts
│   │   │   │       ├── ytdlpConfig.ts
│   │   │   │       ├── ytdlpHelpers.ts
│   │   │   │       ├── ytdlpMetadata.ts
│   │   │   │       ├── ytdlpSearch.ts
│   │   │   │       ├── ytdlpSubtitle.ts
│   │   │   │       └── ytdlpVideo.ts
│   │   │   ├── storageService/       # Modular storage service
│   │   │   │   ├── index.ts          # Main export file
│   │   │   │   ├── types.ts          # Type definitions
│   │   │   │   ├── initialization.ts # Database initialization
│   │   │   │   ├── downloadStatus.ts # Active/queued downloads
│   │   │   │   ├── downloadHistory.ts # Download history
│   │   │   │   ├── videoDownloadTracking.ts # Duplicate prevention
│   │   │   │   ├── settings.ts       # Application settings
│   │   │   │   ├── videos.ts         # Video CRUD operations
│   │   │   │   ├── collections.ts    # Collection operations
│   │   │   │   └── fileHelpers.ts    # File system utilities
│   │   │   ├── CloudStorageService.ts
│   │   │   ├── commentService.ts
│   │   │   ├── downloadManager.ts    # Download queue management
│   │   │   ├── downloadService.ts
│   │   │   ├── loginAttemptService.ts
│   │   │   ├── metadataService.ts
│   │   │   ├── migrationService.ts
│   │   │   ├── storageService.ts     # Legacy compatibility export
│   │   │   ├── subscriptionService.ts
│   │   │   ├── subtitleService.ts
│   │   │   └── thumbnailService.ts
│   │   ├── utils/                    # Utility functions
│   │   │   ├── bccToVtt.ts           # Subtitle conversion
│   │   │   ├── downloadUtils.ts
│   │   │   ├── helpers.ts
│   │   │   ├── logger.ts
│   │   │   ├── progressTracker.ts
│   │   │   ├── response.ts
│   │   │   └── ytDlpUtils.ts
│   │   ├── server.ts                 # Main server file
│   │   └── version.ts                # Version information
│   ├── bgutil-ytdlp-pot-provider/    # PO Token provider plugin
│   │   ├── plugin/                   # Python plugin
│   │   │   └── yt_dlp_plugins/
│   │   └── server/                   # TypeScript server
│   │       └── src/
│   ├── data/                         # Data directory
│   │   ├── mytube.db                 # SQLite database
│   │   ├── cookies.txt               # yt-dlp cookies (optional)
│   │   └── login-attempts.json       # Login attempt tracking
│   ├── drizzle/                      # Database migrations
│   │   └── meta/                     # Migration metadata
│   ├── uploads/                      # Uploaded files directory
│   │   ├── videos/                   # Downloaded videos
│   │   ├── images/                   # Downloaded thumbnails
│   │   └── subtitles/                 # Downloaded subtitles
│   ├── dist/                         # Compiled JavaScript
│   ├── coverage/                     # Test coverage reports
│   ├── Dockerfile                    # Backend Docker image
│   ├── drizzle.config.ts             # Drizzle ORM configuration
│   ├── nodemon.json                  # Nodemon configuration
│   ├── package.json                  # Backend dependencies
│   ├── tsconfig.json                 # TypeScript configuration
│   └── vitest.config.ts              # Vitest test configuration
├── frontend/                         # React.js frontend (Vite + TypeScript)
│   ├── src/                          # Source code
│   │   ├── __tests__/                # Test files
│   │   ├── assets/                   # Static assets
│   │   │   └── logo.svg
│   │   ├── components/               # React components
│   │   │   ├── Header/               # Header component group
│   │   │   │   ├── ActionButtons.tsx
│   │   │   │   ├── DownloadsMenu.tsx
│   │   │   │   ├── index.tsx
│   │   │   │   ├── Logo.tsx
│   │   │   │   ├── ManageMenu.tsx
│   │   │   │   ├── MobileMenu.tsx
│   │   │   │   ├── SearchInput.tsx
│   │   │   │   └── types.ts
│   │   │   ├── ManagePage/           # Management page components
│   │   │   │   ├── CollectionsTable.tsx
│   │   │   │   └── VideosTable.tsx
│   │   │   ├── Settings/             # Settings page components
│   │   │   │   ├── AdvancedSettings.tsx
│   │   │   │   ├── CloudDriveSettings.tsx
│   │   │   │   ├── CookieSettings.tsx
│   │   │   │   ├── DatabaseSettings.tsx
│   │   │   │   ├── DownloadSettings.tsx
│   │   │   │   ├── GeneralSettings.tsx
│   │   │   │   ├── SecuritySettings.tsx
│   │   │   │   ├── TagsSettings.tsx
│   │   │   │   ├── VideoDefaultSettings.tsx
│   │   │   │   └── YtDlpSettings.tsx
│   │   │   ├── VideoPlayer/           # Video player components
│   │   │   │   ├── CommentsSection.tsx
│   │   │   │   ├── UpNextSidebar.tsx
│   │   │   │   ├── VideoControls.tsx
│   │   │   │   ├── VideoInfo.tsx
│   │   │   │   └── VideoInfo/         # Video info subcomponents
│   │   │   │       ├── EditableTitle.tsx
│   │   │   │       ├── VideoActionButtons.tsx
│   │   │   │       ├── VideoAuthorInfo.tsx
│   │   │   │       ├── VideoDescription.tsx
│   │   │   │       ├── VideoMetadata.tsx
│   │   │   │       ├── VideoRating.tsx
│   │   │   │       └── VideoTags.tsx
│   │   │   ├── AlertModal.tsx
│   │   │   ├── AnimatedRoutes.tsx
│   │   │   ├── AuthorsList.tsx
│   │   │   ├── BatchDownloadModal.tsx
│   │   │   ├── BilibiliPartsModal.tsx
│   │   │   ├── CollectionCard.tsx
│   │   │   ├── CollectionModal.tsx
│   │   │   ├── Collections.tsx
│   │   │   ├── ConfirmationModal.tsx
│   │   │   ├── DeleteCollectionModal.tsx
│   │   │   ├── Disclaimer.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── PageTransition.tsx
│   │   │   ├── SubscribeModal.tsx
│   │   │   ├── TagsList.tsx
│   │   │   ├── UploadModal.tsx
│   │   │   └── VideoCard.tsx
│   │   ├── contexts/                 # React contexts for state management
│   │   │   ├── AuthContext.tsx
│   │   │   ├── CollectionContext.tsx
│   │   │   ├── DownloadContext.tsx
│   │   │   ├── LanguageContext.tsx
│   │   │   ├── SnackbarContext.tsx
│   │   │   ├── ThemeContext.tsx
│   │   │   └── VideoContext.tsx
│   │   ├── hooks/                    # Custom React hooks
│   │   │   ├── useDebounce.ts
│   │   │   ├── useShareVideo.ts
│   │   │   └── useVideoResolution.ts
│   │   ├── pages/                    # Page components
│   │   │   ├── AuthorVideos.tsx
│   │   │   ├── CollectionPage.tsx
│   │   │   ├── DownloadPage/          # Download page components
│   │   │   │   ├── ActiveDownloadsTab.tsx
│   │   │   │   ├── CustomTabPanel.tsx
│   │   │   │   ├── HistoryItem.tsx
│   │   │   │   ├── HistoryTab.tsx
│   │   │   │   ├── index.tsx
│   │   │   │   └── QueueTab.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── InstructionPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ManagePage.tsx
│   │   │   ├── SearchPage.tsx
│   │   │   ├── SearchResults.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── SubscriptionsPage.tsx
│   │   │   └── VideoPlayer.tsx
│   │   ├── utils/                    # Utilities and locales
│   │   │   ├── locales/              # Internationalization files
│   │   │   │   ├── ar.ts             # Arabic
│   │   │   │   ├── de.ts             # German
│   │   │   │   ├── en.ts             # English
│   │   │   │   ├── es.ts             # Spanish
│   │   │   │   ├── fr.ts             # French
│   │   │   │   ├── ja.ts             # Japanese
│   │   │   │   ├── ko.ts             # Korean
│   │   │   │   ├── pt.ts             # Portuguese
│   │   │   │   ├── ru.ts             # Russian
│   │   │   │   └── zh.ts             # Chinese
│   │   │   ├── consoleManager.ts
│   │   │   ├── constants.ts
│   │   │   ├── formatUtils.ts
│   │   │   ├── recommendations.ts
│   │   │   └── translations.ts
│   │   ├── App.tsx                   # Main application component
│   │   ├── App.css
│   │   ├── index.css
│   │   ├── main.tsx                  # Application entry point
│   │   ├── setupTests.ts
│   │   ├── theme.ts                  # Material-UI theme configuration
│   │   ├── types.ts                  # TypeScript type definitions
│   │   ├── version.ts                # Version information
│   │   └── vite-env.d.ts
│   ├── dist/                         # Production build output
│   ├── public/                       # Public static files
│   ├── Dockerfile                    # Frontend Docker image
│   ├── entrypoint.sh                 # Docker entrypoint script
│   ├── eslint.config.js              # ESLint configuration
│   ├── index.html                    # HTML template
│   ├── nginx.conf                    # Nginx configuration
│   ├── package.json                  # Frontend dependencies
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── tsconfig.node.json
│   └── vite.config.js                # Vite configuration
├── documents/                         # Documentation
│   ├── en/                           # English documentation
│   │   ├── api-endpoints.md
│   │   ├── directory-structure.md
│   │   ├── docker-guide.md
│   │   └── getting-started.md
│   └── zh/                           # Chinese documentation
│       ├── api-endpoints.md
│       ├── directory-structure.md
│       ├── docker-guide.md
│       └── getting-started.md
├── data/                             # Root data directory (optional)
│   └── mytube.db
├── build-and-push.sh                 # Docker build and push script
├── docker-compose.yml                # Docker Compose configuration
├── CHANGELOG.md                      # Changelog
├── CODE_OF_CONDUCT.md                # Code of conduct
├── CONTRIBUTING.md                   # Contributing guidelines
├── LICENSE                           # MIT License
├── README.md                         # English README
├── README-zh.md                      # Chinese README
├── RELEASING.md                      # Release process guide
├── SECURITY.md                       # Security policy
└── package.json                      # Root package.json for running both apps
```

## Architecture Overview

### Backend Architecture

The backend follows a **layered architecture** pattern:

1. **Routes Layer** (`routes/`): Defines API endpoints and maps them to controllers
2. **Controllers Layer** (`controllers/`): Handles HTTP requests/responses and delegates to services
3. **Services Layer** (`services/`): Contains business logic
   - **Downloaders**: Abstract base class pattern for platform-specific downloaders
   - **Storage Service**: Modular service split into focused modules
   - **Supporting Services**: Download management, subscriptions, metadata, etc.
4. **Database Layer** (`db/`): Drizzle ORM with SQLite for data persistence
5. **Utils Layer** (`utils/`): Shared utility functions

### Frontend Architecture

The frontend follows a **component-based architecture**:

1. **Pages** (`pages/`): Top-level route components
2. **Components** (`components/`): Reusable UI components organized by feature
3. **Contexts** (`contexts/`): React Context API for global state management
4. **Hooks** (`hooks/`): Custom React hooks for reusable logic
5. **Utils** (`utils/`): Helper functions and internationalization

### Database Schema

The application uses **SQLite** with **Drizzle ORM** for data persistence. Key tables include:

- `videos`: Video metadata and file paths
- `collections`: Video collections/playlists
- `collection_videos`: Many-to-many relationship between videos and collections
- `subscriptions`: Channel/creator subscriptions
- `downloads`: Active download queue
- `download_history`: Completed download history
- `video_downloads`: Tracks downloaded videos to prevent duplicates
- `settings`: Application configuration
