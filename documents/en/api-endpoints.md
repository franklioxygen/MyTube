# API Endpoints

## Videos
- `POST /api/download` - Download a video (YouTube or Bilibili)
- `POST /api/upload` - Upload a local video file
- `GET /api/videos` - Get all downloaded videos
- `GET /api/videos/:id` - Get a specific video
- `PUT /api/videos/:id` - Update video details
- `DELETE /api/videos/:id` - Delete a video
- `GET /api/videos/:id/comments` - Get video comments
- `POST /api/videos/:id/rate` - Rate a video
- `POST /api/videos/:id/refresh-thumbnail` - Refresh video thumbnail
- `POST /api/videos/:id/view` - Increment view count
- `PUT /api/videos/:id/progress` - Update playback progress
- `GET /api/search` - Search for videos online
- `GET /api/download-status` - Get status of active downloads
- `GET /api/check-bilibili-parts` - Check if a Bilibili video has multiple parts
- `GET /api/check-bilibili-collection` - Check if a Bilibili URL is a collection/series
- `GET /api/check-video-download` - Check if a video has already been downloaded (by URL)

## Download Management
- `POST /api/downloads/cancel/:id` - Cancel a download
- `DELETE /api/downloads/queue/:id` - Remove from queue
- `DELETE /api/downloads/queue` - Clear queue
- `GET /api/downloads/history` - Get download history
- `DELETE /api/downloads/history/:id` - Remove from history
- `DELETE /api/downloads/history` - Clear history

## Collections
- `GET /api/collections` - Get all collections
- `POST /api/collections` - Create a new collection
- `PUT /api/collections/:id` - Update a collection (add/remove videos)
- `DELETE /api/collections/:id` - Delete a collection

## Subscriptions
- `GET /api/subscriptions` - Get all subscriptions
- `POST /api/subscriptions` - Create a new subscription
- `DELETE /api/subscriptions/:id` - Delete a subscription

## Settings & System
- `GET /api/settings` - Get application settings
- `POST /api/settings` - Update application settings
- `POST /api/settings/verify-password` - Verify login password
- `POST /api/settings/migrate` - Migrate data from JSON to SQLite
- `POST /api/settings/delete-legacy` - Delete legacy JSON data
- `POST /api/scan-files` - Scan for existing files
- `POST /api/cleanup-temp-files` - Cleanup temporary download files
- `GET /api/settings/password-enabled` - Check if password protection is enabled
- `POST /api/settings/upload-cookies` - Upload cookies.txt for yt-dlp
- `POST /api/settings/delete-cookies` - Delete cookies.txt
- `GET /api/settings/check-cookies` - Check if cookies.txt exists
