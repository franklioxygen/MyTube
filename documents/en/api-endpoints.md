# API Endpoints

All API routes are mounted under `/api` unless noted otherwise.

## Auth & Access Notes

- Auth is cookie-based (HTTP-only JWT cookie). Authorization header is also accepted for backward compatibility.
- When password login is enabled, unauthenticated users can only access login-related public endpoints.
- Visitor role is read-only for most resources.
- API key auth is supported via `X-API-Key` or `Authorization: ApiKey <key>` when `apiKeyEnabled` is true.
- API key auth is restricted to `POST /api/download` only; using it on other endpoints returns `403`.

## Video Download & Search

- `GET /api/search` - Search videos online (YouTube)
  - Query params: `query` (required), `limit` (optional, default: `8`), `offset` (optional, default: `1`)
- `POST /api/download` - Queue a video download
  - Body: `{ youtubeUrl: string, downloadAllParts?: boolean, collectionName?: string, downloadCollection?: boolean, collectionInfo?: object, forceDownload?: boolean }`
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
  - Supports: YouTube, Bilibili, MissAV and other yt-dlp supported sites
- `GET /api/check-video-download` - Check whether a source URL was downloaded before
  - Query params: `url` (required)
- `GET /api/check-bilibili-parts` - Check whether a Bilibili video has multiple parts
  - Query params: `url` (required)
- `GET /api/check-bilibili-collection` - Check whether a Bilibili URL is a collection/series
  - Query params: `url` (required)
- `GET /api/check-playlist` - Check whether a URL is a playlist (YouTube/Bilibili supported)
  - Query params: `url` (required)
- `GET /api/download-status` - Get active and queued downloads

## Video Management

- `POST /api/upload` - Upload one local video file
  - Multipart form-data: `video` (required), `title` (optional), `author` (optional)
  - Notes:
    - Content is validated as a supported video before it is accepted.
    - Duplicate uploads are skipped by content hash.
- `POST /api/upload/batch` - Upload multiple local video files in one request
  - Multipart form-data: `videos` (one or more required), `title` (optional, only used when exactly one file is uploaded), `author` (optional)
  - Response data shape: `{ results: Array<{ originalName, status, message, video? }>, summary: { total, uploaded, duplicates, failed } }`
  - Notes:
    - Intended for multi-file selection and folder uploads.
    - Folder uploads import supported video files only; subdirectory structure is not preserved.
    - Duplicate uploads are skipped by content hash.
- `GET /api/videos` - Get all videos (no server-side pagination/filtering in current implementation)
- `GET /api/videos/:id` - Get one video by ID
- `GET /api/mount-video/:id` - Stream a mount-directory video by video ID (supports Range)
- `PUT /api/videos/:id` - Update video metadata
  - Body allows: `{ title?, tags?, visibility?, subtitles? }`
- `POST /api/videos/:id/subtitles` - Upload subtitle file for a video
  - Multipart form-data: `subtitle` (required), `language` (optional)
  - Supported upload formats: `.vtt`, `.srt`, `.ass`, `.ssa`
- `DELETE /api/videos/:id` - Delete video record and related files
- `GET /api/videos/:id/comments` - Get comments for the video (if available)
- `POST /api/videos/:id/rate` - Rate a video
  - Body: `{ rating: number }` where `1 <= rating <= 5`
- `POST /api/videos/:id/refresh-thumbnail` - Regenerate thumbnail from a random frame
- `POST /api/videos/:id/view` - Increment view count
- `PUT /api/videos/:id/progress` - Save playback progress
  - Body: `{ progress: number }`
- `GET /api/videos/author-channel-url` - Resolve channel/author URL from source URL
  - Query params: `sourceUrl` (required)

## Download Queue & History

- `POST /api/downloads/channel-playlists` - One-time process: download all playlists from a channel
  - Body: `{ url: string }`
- `POST /api/downloads/cancel/:id` - Cancel active download
- `DELETE /api/downloads/queue/:id` - Remove queued download
- `DELETE /api/downloads/queue` - Clear download queue
- `GET /api/downloads/history` - Get download history
- `DELETE /api/downloads/history/:id` - Delete one history item
- `DELETE /api/downloads/history` - Clear download history

## Collections

- `GET /api/collections` - Get all collections
- `POST /api/collections` - Create collection
  - Body: `{ name: string, videoId?: string }`
- `PUT /api/collections/:id` - Update collection
  - Body: `{ name?: string, videoId?: string, action?: "add" | "remove" }`
- `DELETE /api/collections/:id` - Delete collection
  - Query params: `deleteVideos=true` (optional, also delete videos in the collection)

## Subscriptions

- `GET /api/subscriptions` - Get all subscriptions
- `POST /api/subscriptions` - Create subscription
  - Body: `{ url: string, interval: number, authorName?: string, downloadAllPrevious?: boolean, downloadShorts?: boolean, downloadOrder?: 'dateDesc' | 'dateAsc' | 'viewsDesc' | 'viewsAsc' }`
  - `downloadOrder` is only applied when `downloadAllPrevious` is `true`; defaults to `dateDesc`
- `PUT /api/subscriptions/:id/pause` - Pause subscription
- `PUT /api/subscriptions/:id/resume` - Resume subscription
- `DELETE /api/subscriptions/:id` - Delete subscription
- `POST /api/subscriptions/playlist` - Create playlist subscription
  - Body: `{ playlistUrl: string, interval: number, collectionName: string, downloadAll?: boolean, collectionInfo?: object }`
- `POST /api/subscriptions/channel-playlists` - Subscribe all playlists from a channel and create watcher
  - Body: `{ url: string, interval: number, downloadAllPrevious?: boolean }`

## Continuous Download Tasks

- `GET /api/subscriptions/tasks` - Get all continuous download tasks
- `POST /api/subscriptions/tasks/playlist` - Create one playlist continuous task
  - Body: `{ playlistUrl: string, collectionName: string }`
- `PUT /api/subscriptions/tasks/:id/pause` - Pause task
- `PUT /api/subscriptions/tasks/:id/resume` - Resume task
- `DELETE /api/subscriptions/tasks/:id` - Cancel task
- `DELETE /api/subscriptions/tasks/:id/delete` - Delete task record
- `DELETE /api/subscriptions/tasks/clear-finished` - Clear finished tasks

## Settings

- `GET /api/settings` - Get app settings (password hashes are excluded)
  - Response may include `apiKeyEnabled` and `apiKey`; these are hidden from visitor users when login is enabled
- `PATCH /api/settings` - Partially update settings
  - Body: partial settings object
  - Supports `apiKeyEnabled?: boolean` and `apiKey?: string`
  - If `apiKeyEnabled` is set to `true` and `apiKey` is empty/missing, server auto-generates a 64-character hex key
- `POST /api/settings/migrate` - Migrate legacy JSON data to SQLite
- `POST /api/settings/delete-legacy` - Delete legacy JSON data files
- `POST /api/settings/format-filenames` - Format legacy filenames
- `GET /api/settings/cloudflared/status` - Get Cloudflared tunnel status
- `POST /api/settings/tags/rename` - Rename tag
  - Body: `{ oldTag: string, newTag: string }`
- `POST /api/settings/telegram/test` - Send a test Telegram notification
  - Body: `{ botToken: string, chatId: string }`

## Password & Session

- `GET /api/settings/password-enabled` - Check whether login/password is enabled
- `GET /api/settings/reset-password-cooldown` - Removed
  - This endpoint was tied to the deprecated public web reset flow and is no longer available.
- `POST /api/settings/verify-password` - Verify password (deprecated, kept for compatibility)
  - Body: `{ password: string }`
- `POST /api/settings/verify-admin-password` - Verify admin password
  - Body: `{ password: string }`
- `POST /api/settings/verify-visitor-password` - Verify visitor password
  - Body: `{ password: string }`
- `POST /api/settings/reset-password` - Removed
  - Password recovery must be performed from the backend environment via `node dist/scripts/reset-password.js <new-password>` or the equivalent Docker command.
- `POST /api/settings/logout` - Clear auth cookie

## Passkeys

- `GET /api/settings/passkeys` - Get passkey list (safe fields only)
- `GET /api/settings/passkeys/exists` - Check whether passkeys exist
- `POST /api/settings/passkeys/register` - Generate passkey registration options
  - Body: `{ userName?: string }`
- `POST /api/settings/passkeys/register/verify` - Verify passkey registration
  - Body: `{ body: object, challenge: string }`
- `POST /api/settings/passkeys/authenticate` - Generate passkey authentication options
- `POST /api/settings/passkeys/authenticate/verify` - Verify passkey authentication and issue auth cookie
  - Body: `{ body: object, challenge: string }`
- `DELETE /api/settings/passkeys` - Remove all passkeys

## Cookies

- `POST /api/settings/upload-cookies` - Upload cookie file for yt-dlp
  - Multipart form-data: `file`
- `POST /api/settings/delete-cookies` - Delete cookie file
- `GET /api/settings/check-cookies` - Check whether cookie file exists

## Hooks

- `GET /api/settings/hooks/status` - Get hook installation status
- `POST /api/settings/hooks/:name` - Upload hook script
  - Multipart form-data: `file`
  - Valid `:name`: `task_before_start`, `task_success`, `task_fail`, `task_cancel`
- `DELETE /api/settings/hooks/:name` - Delete hook script

## Database Backups

- `GET /api/settings/export-database` - Download current DB backup file
- `POST /api/settings/import-database` - Import `.db` backup file and overwrite current DB
  - Multipart form-data: `file`
- `POST /api/settings/merge-database-preview` - Scan uploaded `.db` backup and return merge counts without modifying current DB
  - Multipart form-data: `file`
  - Response `summary` includes `videos`, `collections`, `collectionLinks`, `subscriptions`, `downloadHistory`, `videoDownloads`, and `tags`; each item contains `{ merged, skipped }`
- `POST /api/settings/merge-database` - Merge uploaded `.db` backup into current DB while keeping existing records
  - Multipart form-data: `file`
  - Response includes the same merge `summary` shape as preview
- `GET /api/settings/last-backup-info` - Get latest backup metadata
- `POST /api/settings/restore-from-last-backup` - Restore from latest backup
- `POST /api/settings/cleanup-backup-databases` - Cleanup backup DB files

## File Maintenance

- `POST /api/scan-files` - Scan local uploads video directory and sync with DB
- `POST /api/scan-mount-directories` - Scan configured mount directories and sync with DB
  - Body: `{ directories: string[] }` (non-empty)
- `POST /api/cleanup-temp-files` - Remove temporary download files (`.part`, `.ytdl`, `temp_*`)

## Cloud Storage

- `GET /api/cloud/signed-url` - Get cloud signed URL (or cached thumbnail URL)
  - Query params: `filename` (required), `type` (optional: `video` or `thumbnail`)
- `POST /api/cloud/sync` - Two-way sync local/cloud videos
  - Response is streamed JSON lines progress events
- `DELETE /api/cloud/thumbnail-cache` - Clear local cloud thumbnail cache
- `GET /api/cloud/thumbnail-cache/:filename` - Serve cached cloud thumbnail file (static route)

## System

- `GET /api/system/version` - Get version/update info
  - Returns: `{ currentVersion, latestVersion, releaseUrl, hasUpdate, ... }`

## Non-API Routes (Not Under `/api`)

- `GET /cloud/videos/:filename` - Redirect to signed cloud video URL
- `GET /cloud/images/:filename` - Serve cached cloud image or redirect to signed image URL
- `GET /videos/*` - Static local videos
- `GET /images/*` - Static local thumbnails/images
- `GET /subtitles/*` - Static subtitle files
- `GET /avatars/*` - Static avatar files
