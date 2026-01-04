# Directory Structure

```
mytube/
├── backend/                           # Express.js backend (TypeScript)
│   ├── src/                           # Source code
│   │   ├── __tests__/                 # Test files
│   │   ├── config/                    # Configuration (paths, etc.)
│   │   ├── controllers/               # Route controllers
│   │   │   ├── cleanupController.ts
│   │   │   ├── cloudStorageController.ts
│   │   │   ├── collectionController.ts
│   │   │   ├── cookieController.ts
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
│   │   ├── db/                        # Drizzle ORM + SQLite
│   │   ├── errors/                    # Custom error classes
│   │   ├── middleware/                # Express middleware
│   │   │   ├── authMiddleware.ts
│   │   │   ├── roleBasedAuthMiddleware.ts
│   │   │   ├── roleBasedSettingsMiddleware.ts
│   │   │   └── errorHandler.ts
│   │   ├── routes/                    # Route definitions
│   │   │   ├── api.ts                 # Main API routes
│   │   │   └── settingsRoutes.ts      # Settings-specific routes
│   │   ├── scripts/                   # Utility scripts (VTT cleanup, rescans)
│   │   ├── services/                  # Business logic
│   │   │   ├── cloudStorage/          # Cloud storage helpers and cache
│   │   │   ├── continuousDownload/    # Subscription task engine
│   │   │   ├── downloaders/           # Platform downloaders (yt-dlp, Bilibili, MissAV)
│   │   │   ├── storageService/        # Modular storage service
│   │   │   └── *.ts                   # Other services (auth, metadata, etc.)
│   │   ├── utils/                     # Shared utilities
│   │   ├── server.ts                  # Server bootstrap
│   │   └── version.ts                 # Version info
│   ├── bgutil-ytdlp-pot-provider/     # PO Token provider plugin
│   ├── data/                          # Runtime data (db, hooks, backups)
│   ├── drizzle/                       # Database migrations
│   ├── uploads/                       # Media storage (videos, images, subtitles, cache)
│   ├── scripts/                       # Maintenance scripts (reset-password, migrate, verify)
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   ├── nodemon.json
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── frontend/                          # React frontend (Vite + TypeScript)
│   ├── src/                           # Source code
│   │   ├── __tests__/                 # Test files
│   │   ├── assets/                    # Static assets
│   │   ├── components/                # UI components by feature
│   │   ├── contexts/                  # React Context state
│   │   ├── hooks/                     # Custom hooks (player, settings, data)
│   │   ├── pages/                     # Route pages
│   │   ├── utils/                     # API client, helpers, i18n
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── theme.ts
│   │   └── version.ts
│   ├── public/                        # Public assets
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── nginx.conf
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.js
├── documents/                         # Documentation (EN/ZH)
├── docker-compose.yml                 # Compose for standard deployments
├── docker-compose.host-network.yml    # Host-network compose for OpenWrt/iStoreOS
├── README.md
├── README-zh.md
└── package.json                       # Root scripts
```

## Architecture Overview

### Backend Architecture

The backend follows a **layered architecture** pattern:

1. **Routes** (`routes/`): Define API endpoints and map them to controllers
2. **Controllers** (`controllers/`): HTTP request/response handling
3. **Services** (`services/`): Business logic (downloaders, storage, cloud, subscriptions)
4. **Database** (`db/`): Drizzle ORM + SQLite
5. **Utilities** (`utils/`): Shared helpers and infrastructure

### Frontend Architecture

The frontend follows a **component-based architecture**:

1. **Pages** (`pages/`): Top-level route components
2. **Components** (`components/`): Feature-oriented UI building blocks
3. **Contexts** (`contexts/`): React Context global state
4. **Hooks** (`hooks/`): Reusable logic and data access
5. **Utils** (`utils/`): API client, formatting, and i18n helpers

### Database Schema

Key tables include:

- `videos`: Video metadata and file paths
- `collections`: Video collections/playlists
- `collection_videos`: Many-to-many relationship between videos and collections
- `subscriptions`: Channel/creator subscriptions
- `downloads`: Active download queue
- `download_history`: Completed download history
- `video_downloads`: Tracks downloaded videos to prevent duplicates
- `settings`: Application configuration
