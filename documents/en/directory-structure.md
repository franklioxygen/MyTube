# Directory Structure

```
mytube/
├── backend/                           # Express backend (TypeScript)
│   ├── src/
│   │   ├── __tests__/                 # Unit/integration tests
│   │   ├── config/                    # Path and runtime config
│   │   ├── controllers/               # HTTP controllers
│   │   │   ├── cleanupController.ts
│   │   │   ├── cloudStorageController.ts
│   │   │   ├── collectionController.ts
│   │   │   ├── cookieController.ts
│   │   │   ├── databaseBackupController.ts
│   │   │   ├── downloadController.ts
│   │   │   ├── hookController.ts
│   │   │   ├── passkeyController.ts
│   │   │   ├── passwordController.ts
│   │   │   ├── scanController.ts
│   │   │   ├── settingsController.ts
│   │   │   ├── subscriptionController.ts
│   │   │   ├── systemController.ts
│   │   │   ├── videoController.ts
│   │   │   ├── videoDownloadController.ts
│   │   │   └── videoMetadataController.ts
│   │   ├── db/                        # Drizzle schema + migration runner
│   │   ├── errors/                    # Custom error types
│   │   ├── middleware/                # Auth/role/error middlewares
│   │   ├── routes/                    # API route registration
│   │   ├── scripts/                   # Internal maintenance scripts
│   │   ├── services/                  # Business logic
│   │   │   ├── cloudStorage/          # Cloud drive upload/sign/cache utilities
│   │   │   ├── continuousDownload/    # Continuous task processing
│   │   │   ├── downloaders/           # Provider download implementations
│   │   │   │   ├── bilibili/
│   │   │   │   └── ytdlp/
│   │   │   ├── storageService/        # File/DB storage modules
│   │   │   └── *.ts                   # Auth, subscription, metadata, etc.
│   │   ├── types/                     # Shared TS type declarations
│   │   ├── utils/                     # Shared helpers
│   │   ├── server.ts                  # App bootstrap
│   │   └── version.ts                 # App version info
│   ├── bgutil-ytdlp-pot-provider/     # yt-dlp PO token helper project
│   ├── data/                          # Backend runtime data (DB, hooks, cookies)
│   ├── drizzle/                       # SQL migration files
│   ├── uploads/                       # Backend media files and caches
│   ├── scripts/                       # CLI maintenance scripts
│   ├── dist/                          # Compiled backend output
│   ├── coverage/                      # Test coverage output
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   ├── nodemon.json
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── frontend/                          # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── __tests__/                 # App-level tests
│   │   ├── assets/                    # Static assets (logo, sounds, etc.)
│   │   ├── components/                # UI components (Header, Settings, VideoPlayer...)
│   │   ├── contexts/                  # Global state providers
│   │   ├── hooks/                     # Data-fetching and UI logic hooks
│   │   ├── pages/                     # Route-level pages
│   │   ├── utils/                     # API helpers, i18n, formatting
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── theme.ts
│   │   └── version.ts
│   ├── public/                        # Public static files
│   ├── scripts/                       # Frontend utility scripts (e.g. waitForBackend)
│   ├── dist/                          # Frontend build output
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.js
├── chrome-extension/                  # Browser extension source
├── documents/                         # Documentation (EN/ZH)
│   ├── en/
│   └── zh/
├── codeql-db/                         # CodeQL database (analysis artifact)
├── codeql-reports/                    # CodeQL report output
├── data/                              # Optional runtime data (if backend started from repo root)
├── uploads/                           # Optional runtime media (if backend started from repo root)
├── stacks/                            # Deployment stack examples
│   ├── docker-compose.yml
│   ├── docker-compose.host-network.yml
│   └── docker-compose.single-container.yml
├── README.md
├── README-zh.md
└── package.json                       # Root task runner scripts
```

## Architecture Overview

### Backend Architecture

The backend uses a layered design:

1. **Routes** (`backend/src/routes/`): Define endpoints and map to controllers.
2. **Controllers** (`backend/src/controllers/`): Validate request input and shape HTTP responses.
3. **Services** (`backend/src/services/`): Core business logic for downloading, subscriptions, cloud sync, storage, auth, and metadata.
4. **Storage Layer**:
   - **Database** (`backend/src/db/`, `backend/drizzle/`) via Drizzle + SQLite.
   - **Filesystem** (`backend/uploads/`, `backend/data/`) for media and runtime state.
5. **Middleware + Utils** (`backend/src/middleware/`, `backend/src/utils/`): Auth, role control, error handling, shared helpers.

### Frontend Architecture

The frontend is organized by UI responsibility:

1. **Pages** (`frontend/src/pages/`): Route-level screens.
2. **Components** (`frontend/src/components/`): Reusable feature components.
3. **Contexts** (`frontend/src/contexts/`): Cross-page state management.
4. **Hooks** (`frontend/src/hooks/`): Shared behavior for fetching/state/interaction.
5. **Utils** (`frontend/src/utils/`): API wrappers, i18n strings, formatting and media helpers.

### Database Schema (Key Tables)

Defined in `backend/src/db/schema.ts`:

- `videos`: Video metadata, paths, tags, playback data.
- `collections`: Collection metadata.
- `collection_videos`: Many-to-many mapping between collections and videos.
- `settings`: Key-value app settings store.
- `downloads`: Active/queued download status.
- `download_history`: Historical download records.
- `subscriptions`: Author/playlist subscription definitions.
- `video_downloads`: Source-level de-duplication tracking.
- `continuous_download_tasks`: Long-running background download task records.
