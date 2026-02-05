# API Endpoints

All API routes are mounted under `/api` unless noted otherwise.

## Video Download & Search

- `GET /api/search` - Search videos online (YouTube)
  - Query params: `query` (required), `limit` (optional, default: 8), `offset` (optional, default: 1)
- `POST /api/download` - Download a video from supported platforms
  - Body: `{ youtubeUrl: string, ...options }`
  - Supports: YouTube, Bilibili, MissAV, and all yt-dlp supported sites
- `GET /api/check-video-download` - Check if a video has already been downloaded
  - Query params: `url` (required)
  - Returns: `{ found: boolean, status: 'exists' | 'deleted', videoId?: string, ... }`
- `GET /api/check-bilibili-parts` - Check if a Bilibili video has multiple parts
  - Query params: `url` (required)
- `GET /api/check-bilibili-collection` - Check if a Bilibili URL is a collection/series
  - Query params: `url` (required)
- `GET /api/check-playlist` - Check if a URL is a supported playlist
  - Query params: `url` (required)
- `GET /api/download-status` - Get active/queued download status
  - Returns: `{ activeDownloads: DownloadInfo[], queuedDownloads: DownloadInfo[] }`

## Video Management

- `POST /api/upload` - Upload a local video file
  - Multipart form data: `video` (file)
  - Automatically generates thumbnail
- `GET /api/videos` - Get all downloaded videos
  - Query params: `page` (optional), `limit` (optional), `sortBy` (optional), `order` (optional), `search` (optional), `author` (optional), `tags` (optional)
- `GET /api/mount-video/:id` - Serve mount directory video file
  - Supports HTTP Range requests for streaming
- `GET /api/videos/:id` - Get a specific video by ID
- `PUT /api/videos/:id` - Update video details
  - Body: `{ title?, author?, tags?, rating?, ... }`
- `POST /api/videos/:id/subtitles` - Upload a subtitle for a video
  - Multipart form data: `subtitle` (file)
  - Body: `language` (optional)
- `DELETE /api/videos/:id` - Delete a video and its files
- `GET /api/videos/:id/comments` - Get video comments (if available)
- `POST /api/videos/:id/rate` - Rate a video (1-5 stars)
  - Body: `{ rating: number }`
- `POST /api/videos/:id/refresh-thumbnail` - Refresh video thumbnail
- `POST /api/videos/:id/view` - Increment view count
- `PUT /api/videos/:id/progress` - Update playback progress
  - Body: `{ progress: number }` (seconds)
- `GET /api/videos/author-channel-url` - Get author channel URL for a video
  - Query params: `sourceUrl` (required)
  - Returns: `{ success: boolean, channelUrl: string | null }`

## Download Management
- `POST /api/downloads/channel-playlists` - Process channel playlists download (one-time)
  - Body: `{ url: string }`
- `POST /api/downloads/cancel/:id` - Cancel an active download
- `DELETE /api/downloads/queue/:id` - Remove a download from queue
- `DELETE /api/downloads/queue` - Clear entire download queue
- `GET /api/downloads/history` - Get download history
  - Query params: `page` (optional), `limit` (optional)
- `DELETE /api/downloads/history/:id` - Remove an item from download history
- `DELETE /api/downloads/history` - Clear entire download history

## Collections

- `GET /api/collections` - Get all collections
- `POST /api/collections` - Create a new collection
  - Body: `{ name: string, videoIds?: string[] }`
- `PUT /api/collections/:id` - Update a collection (add/remove videos)
  - Body: `{ name?: string, videoIds?: string[], action?: 'add' | 'remove' }`
- `DELETE /api/collections/:id` - Delete a collection

## Subscriptions

- `GET /api/subscriptions` - Get all subscriptions
- `POST /api/subscriptions` - Create a new subscription
  - Body: `{ authorUrl: string, interval: number, platform?: string }`
  - `interval`: Check interval in minutes
  - `platform`: 'YouTube' (default) or 'Bilibili'
- `POST /api/subscriptions/playlist` - Create a new playlist subscription
  - Body: `{ playlistUrl: string, interval: number, collectionName: string, downloadAll?: boolean }`
- `POST /api/subscriptions/channel-playlists` - Subscribe to all playlists from a channel
  - Body: `{ url: string, interval: number, downloadAllPrevious?: boolean }`
- `PUT /api/subscriptions/:id/pause` - Pause a subscription
- `PUT /api/subscriptions/:id/resume` - Resume a subscription
- `DELETE /api/subscriptions/:id` - Delete a subscription

## Continuous Download Tasks (Subscriptions)

- `GET /api/subscriptions/tasks` - Get all continuous download tasks
  - Query params: `page` (optional), `limit` (optional)
- `POST /api/subscriptions/tasks/playlist` - Create a new playlist download task
  - Body: `{ playlistUrl: string, collectionName: string }`
- `PUT /api/subscriptions/tasks/:id/pause` - Pause a continuous download task
- `PUT /api/subscriptions/tasks/:id/resume` - Resume a continuous download task
- `DELETE /api/subscriptions/tasks/:id` - Cancel a continuous download task
- `DELETE /api/subscriptions/tasks/:id/delete` - Delete a task record
- `DELETE /api/subscriptions/tasks/clear-finished` - Clear all finished tasks

## Settings & Passwords

- `GET /api/settings` - Get application settings
- `POST /api/settings` - Update application settings
  - Body: `{ [key: string]: any }` - Settings object
- `POST /api/settings/tags/rename` - Rename a tag
  - Body: `{ oldTag: string, newTag: string }`
- `GET /api/settings/cloudflared/status` - Get Cloudflare Tunnel status
- `POST /api/settings/migrate` - Migrate data from JSON to SQLite
- `POST /api/settings/delete-legacy` - Delete legacy JSON data files
- `POST /api/settings/format-filenames` - Format video filenames according to settings
- `GET /api/settings/password-enabled` - Check if password protection is enabled
- `GET /api/settings/reset-password-cooldown` - Get cooldown time for password reset
- `POST /api/settings/verify-admin-password` - Verify admin password
  - Body: `{ password: string }`
- `POST /api/settings/verify-visitor-password` - Verify visitor password
  - Body: `{ password: string }`
- `POST /api/settings/verify-password` - Verify login password (deprecated)
  - Body: `{ password: string }`
- `POST /api/settings/reset-password` - Reset login password
  - Body: `{ oldPassword: string, newPassword: string }`
- `POST /api/settings/logout` - Logout current session

## Passkey Management

- `GET /api/settings/passkeys` - Get all registered passkeys
- `GET /api/settings/passkeys/exists` - Check if any passkeys are registered
- `POST /api/settings/passkeys/register` - Start passkey registration
- `POST /api/settings/passkeys/register/verify` - Verify passkey registration
- `POST /api/settings/passkeys/authenticate` - Start passkey authentication
- `POST /api/settings/passkeys/authenticate/verify` - Verify passkey authentication
- `DELETE /api/settings/passkeys` - Remove all passkeys

## Cookies

- `POST /api/settings/upload-cookies` - Upload cookies.txt for yt-dlp
  - Multipart form data: `file` (cookies.txt)
- `POST /api/settings/delete-cookies` - Delete cookies.txt
- `GET /api/settings/check-cookies` - Check if cookies.txt exists

## Task Hooks

- `GET /api/settings/hooks/status` - Get status of all hooks
- `POST /api/settings/hooks/:name` - Upload a hook script
  - Multipart form data: `file` (script file)
  - Params: `name` (hook name, e.g., `task_success`)
- `DELETE /api/settings/hooks/:name` - Delete a hook script

## Database Backups

- `GET /api/settings/export-database` - Export database as backup file
- `POST /api/settings/import-database` - Import database from backup file
  - Multipart form data: `file` (database backup file)
- `GET /api/settings/last-backup-info` - Get information about the last database backup
- `POST /api/settings/restore-from-last-backup` - Restore database from the last backup
- `POST /api/settings/cleanup-backup-databases` - Clean up old backup database files

## File Management

- `POST /api/scan-files` - Scan for existing video files in uploads directory
- `POST /api/scan-mount-directories` - Scan mount directories for video files
  - Body: `{ directories: string[] }`
- `POST /api/cleanup-temp-files` - Cleanup temporary download files

## Cloud Storage

- `GET /api/cloud/signed-url` - Get a signed URL for cloud storage
  - Query params: `filename` (required), `type` (optional: `video` or `thumbnail`)
- `POST /api/cloud/sync` - Sync local videos to cloud storage (streams JSON lines)
- `DELETE /api/cloud/thumbnail-cache` - Clear local thumbnail cache
- `GET /api/cloud/thumbnail-cache/:filename` - Serve a cached cloud thumbnail
- `GET /cloud/videos/:filename` - Redirect to signed URL for cloud videos
- `GET /cloud/images/:filename` - Redirect to signed URL (or cached file) for cloud thumbnails

## System

- `GET /api/system/version` - Get current and latest version info
  - Returns: `{ currentVersion, latestVersion, releaseUrl, hasUpdate }`
