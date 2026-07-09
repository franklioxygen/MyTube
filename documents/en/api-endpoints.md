# API Endpoints

All API routes are mounted under `/api` unless noted otherwise.

## Auth & Access Notes

- Auth is cookie-based (HTTP-only JWT cookie). Authorization header is also accepted for backward compatibility.
- When password login is enabled, unauthenticated users can only access login-related public endpoints.
- Visitor role is read-only for most resources.
- API key auth is supported via `X-API-Key` or `Authorization: ApiKey <key>` when `apiKeyEnabled` is true.
- API key auth allows `POST /api/download` plus a minimal read-only library surface:
  - `GET /api/videos`
  - `GET /api/videos/:id`
  - `GET /api/mount-video/:id`
  - `GET /api/collections`
  - `GET /api/system/version`
  - Other API-key-authenticated endpoints return `403`.

## Video Download & Search

- `GET /api/search` - Search videos online (YouTube)
  - Query params: `query` (required), `limit` (optional, default: `8`), `offset` (optional, default: `1`)
- `POST /api/download` - Queue a video download
  - Body: `{ youtubeUrl: string, downloadAllParts?: boolean, collectionName?: string, downloadCollection?: boolean, collectionInfo?: object, forceDownload?: boolean }`
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
  - Supports: YouTube, Bilibili, Twitch VODs, MissAV and other yt-dlp supported sites
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
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
- `GET /api/videos/:id` - Get one video by ID
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
- `GET /api/mount-video/:id` - Stream a mount-directory video by video ID (supports Range)
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
- `PUT /api/videos/:id` - Update video metadata
  - Body allows: `{ title?, tags?, visibility?, subtitles? }`
- `POST /api/videos/:id/subtitles` - Upload subtitle file for a video
  - Multipart form-data: `subtitle` (required), `language` (optional)
  - Supported upload formats: `.vtt`, `.srt`, `.ass`, `.ssa`
- `DELETE /api/videos/:id` - Delete video record and related files
- `GET /api/videos/:id/comments` - Get comments for the video (if available)
- `POST /api/videos/:id/rate` - Rate a video
  - Body: `{ rating: number }` where `1 <= rating <= 5`
- `POST /api/videos/:id/refresh-thumbnail` - Refresh thumbnail
  - Uses a random local video frame when the video file is available locally
  - Falls back to re-downloading the original remote thumbnail when the local video file cannot be resolved
- `POST /api/videos/:id/redownload-thumbnail` - Re-download the original remote thumbnail from the source URL
- `POST /api/videos/:id/view` - Increment view count
- `PUT /api/videos/:id/progress` - Save playback progress
  - Body: `{ progress: number }`
- `GET /api/videos/author-channel-url` - Resolve channel/author URL from source URL
  - Query params: `sourceUrl` (required)
  - Supports: YouTube, Bilibili and Twitch source URLs

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
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
- `POST /api/collections` - Create collection
  - Body: `{ name: string, videoId?: string }`
- `PUT /api/collections/:id` - Update collection
  - Body: `{ name?: string, videoId?: string, action?: "add" | "remove" }`
- `DELETE /api/collections/:id` - Delete collection
  - Query params: `deleteVideos=true` (optional, also delete videos in the collection)

## Favorites

Favorites are scoped to the authenticated owner. When login protection is disabled, the legacy single-user owner is used. Visitor sessions may read and change their own favorites; API-key authentication is not accepted for these personal endpoints.

- `GET /api/favorites/collections` - List the caller's favorite collections
  - Response items include `collectionId`, display metadata, `videoCount`, `thumbnailVideoId`, and `favoritedAt`
- `POST /api/favorites/collections/:id` - Favorite a collection (idempotent)
- `DELETE /api/favorites/collections/:id` - Remove a collection from favorites
- `GET /api/favorites/authors` - List the caller's favorite authors
  - Response items include the exact `author` key, display metadata, visibility-scoped `videoCount`, and `favoritedAt`
- `POST /api/favorites/authors` - Favorite or refresh an author metadata snapshot (idempotent upsert)
  - Body: `{ author: string, displayName?: string, avatarPath?: string, channelUrl?: string }`
- `DELETE /api/favorites/authors` - Remove an author from favorites
  - Body: `{ author: string }`; the author is carried in the body so names containing `/`, `?`, or `#` remain exact

## Subscriptions

- `GET /api/subscriptions` - Get all subscriptions
- `POST /api/subscriptions` - Create subscription
  - Body: `{ url: string, interval: number, authorName?: string, downloadAllPrevious?: boolean, downloadShorts?: boolean, downloadOrder?: 'dateDesc' | 'dateAsc' | 'viewsDesc' | 'viewsAsc' }`
  - `downloadOrder` is only applied when `downloadAllPrevious` is `true`; defaults to `dateDesc`
  - Accepts: YouTube channel URLs, Bilibili space URLs, and Twitch channel URLs
  - Twitch notes:
    - `downloadShorts` is ignored and persisted as disabled
    - new Twitch subscriptions poll for published VODs (`archive` and `upload`), not live streams
    - `twitchClientId` and `twitchClientSecret` are optional; when they are missing, the backend falls back to yt-dlp polling in best-effort mode
    - adding Twitch app credentials improves channel resolution and polling reliability
- `PUT /api/subscriptions/:id` - Update subscription
  - Body: `{ interval?: number, retentionDays?: number | null }`
  - At least one field is required; when both are provided, they are updated in one database operation
  - `interval` must be a positive integer in minutes
  - `retentionDays` must be a positive integer; use `null` or an empty string to disable auto-delete
  - Auto-delete only removes expired videos downloaded by that subscription when no other successful download history references the same local video
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

## RSS Feeds

- RSS management endpoints require an admin session. API key authentication is rejected for these endpoints.
- Management responses return `Cache-Control: no-store` because token IDs and `feedUrl` values are bearer secrets.
- `GET /api/rss/tokens` - List RSS feed tokens
  - Response includes `feedUrl` for each token
- `POST /api/rss/tokens` - Create an RSS feed token
  - Body: `{ label: string, role: "admin" | "visitor", filters?: RssFilters }`
- `PUT /api/rss/tokens/:id` - Update token label, filters, or active state
  - Body: `{ label?: string, filters?: RssFilters, isActive?: boolean }`
- `DELETE /api/rss/tokens/:id` - Delete an RSS feed token
- `POST /api/rss/tokens/:id/reset` - Rotate the feed URL while preserving label, role, filters, and active state
- `RssFilters`: `{ authors?: string[], channelUrls?: string[], tags?: string[], sources?: string[], dayRange?: number, maxItems?: number }`
  - Supported `sources`: `youtube`, `bilibili`, `twitch`, `local`, `missav`, `cloud`
  - Empty or missing `sources` means all sources, including future or unknown source values
  - `maxItems` accepts `1` through `200`; the settings UI exposes a friendlier `10` through `200` slider

## Settings

- `GET /api/settings` - Get app settings (password hashes are excluded)
  - Response may include service configuration for admin users, or for any client when login protection is disabled
  - When login protection is enabled, visitor and unauthenticated responses hide service secrets such as `apiKey`, `openListToken`, `cloudflaredToken`, `telegramBotToken`, `twitchClientId`, and `twitchClientSecret`
  - The Gemini live translation key (`liveTranslationApiKey`) is never returned to any client (not even admins); responses instead expose a derived `liveTranslationApiKeyConfigured` boolean (admins / login-disabled only)
- `PATCH /api/settings` - Partially update settings
  - Body: partial settings object
  - Supports `apiKeyEnabled?: boolean` and `apiKey?: string`
  - Supports `twitchClientId?: string` and `twitchClientSecret?: string`
  - If `apiKeyEnabled` is set to `true` and `apiKey` is empty/missing, server auto-generates a 64-character hex key
  - Supports live translation fields: `liveTranslationEnabled?: boolean`, `liveTranslationModel?: string`, `liveTranslationApiKey?: string`, `liveTranslationSourceLanguage?: string` (`"auto"` or BCP-47), `liveTranslationTargetLanguage?: string` (BCP-47, not `"auto"`)
    - Enabling the feature requires a stored or incoming API key, a valid model, and a target language
    - Send `liveTranslationApiKey: ""` to clear the stored key; omit it to leave the stored key unchanged
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
  - Response includes `hasVisitorUsers`, `isVisitorPasswordSet`, `visitorUserEnabled`, `passwordLoginAllowed`, and the authenticated role/username context when available
- `GET /api/settings/reset-password-cooldown` - Removed
  - This endpoint was tied to the deprecated public web reset flow and is no longer available.
- `POST /api/settings/verify-password` - Verify password (deprecated, kept for compatibility)
  - Body: `{ password: string }`
- `POST /api/settings/verify-admin-password` - Verify admin password
  - Body: `{ password: string }`
- `POST /api/settings/verify-user-login` - Verify a named visitor user and issue an auth cookie
  - Body: `{ username: string, password: string }`
- `POST /api/settings/verify-visitor-password` - Verify the legacy shared visitor password (deprecated, kept for compatibility)
  - Body: `{ password: string }`
- `POST /api/settings/reset-password` - Removed
  - Password recovery must be performed from the backend environment via `node dist/scripts/reset-password.js <new-password>` or the equivalent Docker command.
- `POST /api/settings/logout` - Clear auth cookie

## Visitor Users

Visitor user management requires an admin session. Visitor sessions, unauthenticated requests, and API-key authentication are rejected.

- `GET /api/users` - List visitor users
  - Response: `{ users: VisitorUser[] }`
- `POST /api/users` - Create a visitor user
  - Body: `{ username: string, password: string }`
- `PATCH /api/users/:id` - Update a visitor user
  - Body allows: `{ username?: string, password?: string, enabled?: boolean }`
  - Password changes and disabling a user revoke that user's active sessions immediately.
- `DELETE /api/users/:id` - Delete a visitor user and revoke that user's active sessions
- `VisitorUser`: `{ id, username, role, enabled, isLegacyShared, sessionVersion, lastLoginAt, createdAt, updatedAt }`; password hashes are never returned.

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

## Live Audio Translation

Optional admin feature that translates the playing video's audio in real time via Google Gemini Live Translation. The Gemini API key is stored server-side and never returned to clients. API key authentication is rejected for all live translation endpoints; visitor access is rejected in the current implementation.

- `GET /api/live-translation/config` - Get secret-free feature availability for the current user
  - Response: `{ enabled, available, canUse, model, sourceLanguage, targetLanguage, apiKeyConfigured, requiresAdmin, reason }`
  - `reason` is `null` when usable, otherwise one of: `feature_disabled`, `unsupported_model`, `api_key_missing`, `target_language_missing`, `admin_required`
  - `apiKeyConfigured` is only included for admins / when login is disabled
- `POST /api/live-translation/sessions` - Mint a one-use, short-lived WebSocket ticket
  - Body: `{ videoId: string }`
  - Requires a normal authenticated session and CSRF token; requires the admin role when login is enabled; rate limited
  - Response: `{ ticket, expiresAt, ttlMs, wsPath, config: { model, sourceLanguage, targetLanguage } }`
  - The ticket is one-use and expires quickly (~60s); the config snapshot is captured at mint time

WebSocket stream (mounted under `/api`, upgraded — not a JSON route):

- `GET /api/live-translation/ws?ticket=<ticket>` - WebSocket upgrade for the live audio stream
  - The ticket may also be supplied via the `Sec-WebSocket-Protocol` header to keep it out of access logs
  - Validated on upgrade: `Origin` must match the host/allowed hosts; the ticket must exist, be unexpired and unused; visitor tickets and a disabled/unconfigured feature are rejected
  - Client → server messages: `start`, `audio` (base64 PCM16, 16 kHz mono, ~100 ms chunks), `pause`, `resume`, `seek`, `stop`, `ping`
  - Server → client messages: `ready`, `status`, `inputTranscript`, `outputTranscript`, `audio` (base64 PCM16, 24 kHz mono), `pong`, `error`, `closed`
  - Per-server active session cap and a session duration cap apply; audio and transcript content are not persisted or logged

## System

- `GET /api/system/version` - Get version/update info
  - Returns: `{ currentVersion, latestVersion, releaseUrl, hasUpdate, ... }`
  - Auth: accepts session cookie/Bearer JWT, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)

## Non-API Routes (Not Under `/api`)

- `GET /feed/:token` - Public RSS 2.0 feed endpoint; the path token is the bearer credential
  - No session cookie or API key is required
  - Invalid or disabled tokens return RSS XML with a 404 status
- `GET /cloud/videos/:filename` - Redirect to signed cloud video URL
- `GET /cloud/images/:filename` - Serve cached cloud image or redirect to signed image URL
- `GET /videos/*` - Static local videos
- `GET /images/*` - Static local thumbnails/images
- `GET /subtitles/*` - Static subtitle files
- `GET /avatars/*` - Static avatar files
