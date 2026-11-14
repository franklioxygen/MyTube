# API Endpoints

All API routes are mounted under `/api` unless noted otherwise.

## Auth & Access Notes

- Browser authentication uses an HTTP-only cookie containing an opaque server-side session ID. Bearer JWTs are not accepted.
- When password login is enabled, unauthenticated users can only access login-related public endpoints.
- Visitor role is read-only for most resources.
- Cookie-authenticated writes require the matching `mytube_csrf` cookie and `X-CSRF-Token` request header. Read the token from the `X-CSRF-Token` response header and keep it updated after login/session changes.
- API key auth is supported via `X-API-Key` or `Authorization: ApiKey <key>` when `apiKeyEnabled` is true.
- API key auth allows `POST /api/download` plus a minimal read-only library surface:
  - `GET /api/videos`
  - `GET /api/videos/:id`
  - `GET /api/mount-video/:id`
  - `GET /api/collections`
  - `GET /api/system/version`
  - Other API-key-authenticated endpoints return `403`.

## Video Download & Search

- `GET /api/search` - Search videos online (`source=youtube` by default, or `source=bilibili`)
  - Query params: `query` (required), `limit` (optional, default: `8`), `offset` (optional, default: `1`)
- `POST /api/download` - Queue a video download
  - Body: `{ youtubeUrl: string, downloadAllParts?: boolean, collectionName?: string, downloadCollection?: boolean, collectionInfo?: object, forceDownload?: boolean }`
  - Auth: accepts a session cookie, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
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

### Bulk organization

Both endpoints require admin access when login is enabled and the existing CSRF cookie/header. They also work when login is disabled. API-key callers and visitors cannot use them.

- `POST /api/videos/batch/tags`
  - Body: `{ videoIds: string[], tags: string[] }`
  - Appends tags and updates the global tag catalog in one transaction; existing tags are preserved. Matching is case-insensitive. New additions use the catalog spelling; an existing video's spelling is preserved.
  - Limits: 1–500 raw video IDs, 1–20 raw tags, at most 80 Unicode characters per trimmed tag. IDs are nonempty trimmed strings of at most 200 UTF-16 code units. Duplicate IDs/tags are processed once.
  - `200`: `{ success: true, data: { requestedCount, changedVideoIds, unchangedVideoIds, catalogChanged, videos: [{ id, tags }] } }`
- `POST /api/collections/batch-add`
  - Existing collection: `{ videoIds: string[], collectionId: string }`
  - Create and add atomically: `{ videoIds: string[], newCollection: { id: string, name: string } }`
  - Provide exactly one target. The new ID must be UUID v4; retry the same creation draft with the same ID. Names are trimmed, 1–200 Unicode characters, and cannot contain filesystem-reserved/control characters or end in a dot. Windows device names (including names such as `CON.txt`) are rejected; name/title conflicts are checked without regard to case.
  - Appends missing members in request order, preserving existing order, other memberships and all video file paths. No files are moved.
  - `200`: `{ success: true, data: { requestedCount, changedVideoIds, unchangedVideoIds, collection: { id, name, created } } }`

Validation errors return `400`; missing videos/collections return `404`; damaged stored tags, new-name collisions and mismatched reused collection IDs return `409`. Expected errors include `{ success: false, error, type, details }`; details may contain `missingVideoIds`, `invalidVideoIds`, or `existingCollectionId`. Invalid tag errors report all damaged selected video IDs. The dialog shows their count and lets users exclude them from the current request while preserving the tag draft. Database failures return `500`. Every database change within one request rolls back on failure; no partial-success response is used. New-name conflicts require explicitly choosing the existing collection. The older single-video create endpoint keeps its existing name-merge behavior.

Repeated additions are safe while their targets remain unchanged. A network timeout does not prove rollback; a concurrent collection rename/deletion may make a retry return a conflict/not-found response. Tags trigger best-effort media metadata export after commit, skipping damaged records individually and loading the full library only for TV show aggregation. Single-video exports and rebuilds use the same record validation; orphan cleanup checks all stored video paths, including damaged records; export failure or restart does not undo database changes. A successful response whose subsequent list refresh fails should be shown as saved with a refresh warning.

- `POST /api/upload` - Upload one local video file
  - Multipart form-data: `video` (required), `title` (optional), `author` (optional), `authorKey` (optional exact existing author)
  - Notes:
    - Content is validated as a supported video before it is accepted.
    - Duplicate uploads are skipped by content hash.
- `POST /api/upload/batch` - Upload multiple local video files in one request
  - Multipart form-data: `videos` (one or more required), `title` (optional, only used when exactly one file is uploaded), `author` (optional), `authorKey` (optional exact existing author)
  - Response data shape: `{ results: Array<{ originalName, status, message, video? }>, summary: { total, uploaded, duplicates, failed } }`
  - Notes:
    - Intended for multi-file selection and folder uploads.
    - Folder uploads import supported video files only; subdirectory structure is not preserved.
    - Duplicate uploads are skipped by content hash.

For both upload endpoints, `authorKey` takes precedence and must exactly match an existing video author, including whitespace and case; invalid or stale selections return `400`. Without it, `author` is trimmed and defaults to `Admin` when empty. The upload picker sends `authorKey` only for an existing selection.

- `GET /api/videos` - Get all videos (no server-side pagination/filtering in current implementation)
  - Auth: accepts a session cookie, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
  - For the owner (an admin session, or login-disabled mode), the list also holds items synced from connected instances (see Federation, Prime Side), merged newest first. They carry `origin`, `availability`, and `capabilities`, and their asset paths point at `/api/federation/media`. API keys and visitors get native videos only.
- `GET /api/videos/:id` - Get one video by ID
  - Auth: accepts a session cookie, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
  - For the owner, a remote item's ID returns fresh detail from its peer (`private, no-store`). If the peer cannot answer, the last synced summary is returned with `availability: "offline"`, without a media path.
- `GET /api/mount-video/:id` - Stream a mount-directory video by video ID (supports Range)
  - Auth: accepts a session cookie, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
- `PUT /api/videos/:id` - Update video metadata
  - Body allows: `{ title?, tags?, visibility?, subtitles? }`
  - `subtitles`, when supplied, must be an array of objects with a string `path` or `filename`. If either field is non-null, it must be a string. Invalid input returns `400` before saving any fields; `[]` clears subtitles. The write and stored-row validators use the same rule.
  - `tags`, when supplied, must be an array of strings (`[]` clears tags). Non-array values and non-string entries return `400` before any fields are saved. Legacy arrays containing non-string entries remain readable: read responses expose only string tags without rewriting stored values. Submit a valid tag array to repair them.
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

## Author Avatars

These four endpoints manage a library-wide avatar for the **exact** `author` string, across downloaded and locally uploaded videos. Names are case-sensitive and are not trimmed or renamed by these endpoints. They require an administrator session when login is enabled; when login is disabled they follow the existing single-user management policy. API-key authentication is rejected. Session writes use the normal CSRF protection described above.

- `GET /api/authors/profile?author=<URL-encoded name>` - Read the editor profile, including authors with no videos
  - Returns `{ success: true, data: AuthorProfile }` with `Cache-Control: private, no-store`.
  - `AuthorProfile` has this shape:

    ```json
    {
      "author": "Example Author",
      "customAvatarPath": "/avatars/custom-<uuid>.jpg",
      "effectiveAvatarPath": "/avatars/custom-<uuid>.jpg",
      "defaultAvatarPath": "/avatars/youtube-example.author.jpg",
      "avatarOrigin": "custom",
      "videoCount": 12,
      "multipleSources": false,
      "avatarSources": [
        { "platform": "youtube", "channelUrl": "https://www.youtube.com/@example" }
      ]
    }
    ```

  - Avatar paths can be `null`; `avatarOrigin` is `custom`, `auto`, or `none`. `videoCount` counts the entire author group, not a page's current tag filter.
  - `avatarSources` lists deduplicated, currently available channel sources already associated with the author's videos. Platforms are `youtube`, `bilibili`, and `twitch`. Twitch avatar lookup requires both `twitchClientId` and `twitchClientSecret`; Twitch is omitted when either is missing or blank. Uploading an avatar and restoring cached defaults remain available without Twitch credentials. Local-only authors may have no source addresses.
- `PUT /api/authors/avatar` - Save or replace a custom avatar
  - Multipart form-data: `author` and one `avatar` file are required. No crop coordinates, remote URL, or filesystem path are accepted.
  - The browser editor accepts original static JPEG/PNG/WebP images up to 5 MiB, 8192 pixels per side and 16 megapixels, then crops to a white-backed 512×512 PNG before uploading.
  - The API upload limit is **2 MiB**, JPEG/PNG/WebP only, with content-signature validation. Decoded dimensions must be 1–1024 pixels per side. The server centers/crops and re-encodes to a metadata-free 512×512 JPEG at a new `/avatars/custom-<uuid>.jpg` path.
  - Returns `{ success: true, data: AuthorProfile }`. The exact author group inherits the override, including future videos. Original automatic avatar fields and files are retained; concurrent saves use last successful write wins.
  - New author names are limited to 200 characters; existing longer names remain editable when their exact key exists in videos or saved author profiles, including profiles with no remaining videos. Empty/whitespace-only names and NUL characters are rejected without rewriting the supplied name.
- `DELETE /api/authors/avatar` - Restore the cached default
  - JSON body: `{ "author": "Example Author" }`.
  - Removes the custom override and its unreferenced file, preserving automatic artwork. Returns `{ success: true, data: AuthorProfile }`.
  - **No network download occurs.** If no automatic avatar is available, the UI falls back to the author's initial.
- `POST /api/authors/avatar/from-source` - Fetch a fresh channel avatar **for preview only**
  - JSON body: `{ "author": "Example Author", "channelUrl": "https://www.youtube.com/@example" }`.
  - `channelUrl` must exactly match an entry returned in that author's `avatarSources`. For multiple channels, callers must explicitly select one. Arbitrary image URLs, unrelated channels, and unsupported sources are rejected.
  - Success is the **raw image body**, with `Content-Type: image/jpeg`, `image/png`, or `image/webp`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`; it is not a JSON success envelope. The downloaded image is limited to 5 MiB.
  - Fetching does not modify profiles, video rows, automatic caches, or ETags. The UI previews/crops the image and applies it only through a subsequent `PUT /api/authors/avatar`. A saved source image becomes a custom override; restoring defaults still uses the original automatic cache.
  - Honors configured network/proxy behavior. YouTube channel lookup has a 40-second deadline; image downloads have a 15-second timeout. Client cancellation aborts the preview request and cancels its YouTube subprocess.
  - Limited to **10 requests per client IP per minute**. At most **2 YouTube avatar lookup processes** may be active per server process, including cancelled lookups that have not finished closing. Excess capacity is rejected without starting another process.

Common errors: `400` invalid author/image/source, `401` missing administrator session, `403` insufficient role or API key, `413` avatar upload exceeds 2 MiB, `429` source-request rate limit (with `Retry-After`), `503` YouTube lookup capacity reached (`code: AUTHOR_AVATAR_SOURCE_BUSY`, `Retry-After: 2`), and `502` upstream source failure (`code: AUTHOR_AVATAR_SOURCE_UNAVAILABLE`). Failed uploads/fetches preserve the previous saved avatar.

Video response DTOs also include `authorAvatarOrigin` (`custom` / `auto` / `none`); `authorAvatarPath` and `authorAvatarFilename` contain the effective artwork. Favorites use the same custom override. Avatar saves/restores invalidate video-list ETags. These are response projections: underlying automatic video fields remain unchanged.

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
  - Auth: accepts a session cookie, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)
- `POST /api/collections` - Create collection
  - Body: `{ name: string, videoId?: string }`
- `PUT /api/collections/:id` - Update collection
  - Body: `{ name?: string, videoId?: string, action?: "add" | "remove" }`
- `DELETE /api/collections/empty` - Delete every collection that holds no videos
  - Emptiness is decided by the server, not the caller; no request body or query params
  - Response: `{ success: true, deletedCount: number, deletedCollections: [{ id, name }] }`
  - Registered ahead of `DELETE /api/collections/:id`, so `empty` is never read as a collection id
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

## Federation (Peer Side)

Groundwork for connecting several MyTube instances (issue #354). This instance can issue credentials that another MyTube server presents to it.

This is a preview: remote items do not yet appear in the library, so the settings section for both sides is hidden unless the frontend is built with `VITE_ENABLE_FEDERATION=true`. The endpoints below are available regardless.

- Token management requires an admin session (or login-disabled mode). API key authentication is rejected. Responses return `Cache-Control: no-store`.
- `GET /api/federation/tokens` - `{ instanceId, tokens }`. Secrets are never listed.
- `POST /api/federation/tokens` - Mint a credential
  - Body: `{ label?: string, scopes: ("library:read" | "media:read")[], visibilityCeiling?: "public" | "owner", expiresAt?: number | null }`
  - `visibilityCeiling` defaults to `public`; hidden content is shared only with an explicit `owner` ceiling. `expiresAt` is epoch milliseconds, at most ten years ahead.
  - `201` response: `{ token, credential }`. `credential` (`<id>.<secret>`) is shown only in this response.
- `POST /api/federation/tokens/:id/rotate` - Replace the secret; the old secret stops working immediately and `policyRevision` changes. Also lifts a restore suspension. Returns `{ token, credential }`; `409` for revoked or expired tokens.
- `POST /api/federation/tokens/:id/resume` - Confirm a token suspended by a database restore; issues a new `policyRevision`. `409` for revoked or expired tokens.
- `POST /api/federation/tokens/:id/revoke` - Revoke immediately (idempotent)
- `DELETE /api/federation/tokens/:id` - Delete a token
- `POST /api/federation/identity/reset` - For a deployment cloned from one that keeps running: issue a new `instanceId` and revoke every issued token. Returns `{ instanceId, revokedTokens }`.
- Token `status` is `active`, `suspended`, `expired`, or `revoked`. A database import or restore suspends every usable token, because a backup predates revocations made after it; the owner resumes or rotates each one. `policyRevision` is an opaque string that changes whenever a token's terms do.

Protocol endpoints live under `/api/federation/v1` and accept only `Authorization: Federation <id>.<secret>` plus an `X-MyTube-Instance-Id: <consumer instance UUID>` header. Sessions and API keys are never accepted there. The first consumer to use a token is pinned to it; another instance, or this instance itself, is refused. Errors carry a `code` such as `FEDERATION_UNAUTHORIZED`, `FEDERATION_TOKEN_REVOKED`, `FEDERATION_TOKEN_EXPIRED`, `FEDERATION_TOKEN_SUSPENDED`, `FEDERATION_CONSUMER_REQUIRED`, `FEDERATION_CONSUMER_MISMATCH`, or `FEDERATION_SELF_CONNECTION`.

- `GET /api/federation/v1/capabilities` - Handshake: `{ protocol, protocolVersions, instanceId, credential: { id, scopes, visibilityCeiling, policyRevision, expiresAt }, features, limits: { snapshotPageSize, snapshotTtlMs } }`

Library export (requires the `library:read` scope). Only this instance's own videos are exported, never items it imports from other instances. The effective `audience` is `owner` only when both requested and allowed by the credential's ceiling; otherwise `public`, which excludes hidden videos. Exports never include file paths, storage URLs, descriptions, subtitle contents, or watch state (progress, views, last played).

- `GET /api/federation/v1/library/revision?audience=public|owner` - `{ audience, libraryRevision, policyRevision }`. Opaque values; when both are unchanged, nothing exported changed. Playback progress and view counts do not change `libraryRevision`.
- `POST /api/federation/v1/snapshots` - Body: `{ audience }`. `201`: `{ snapshotId, instanceId, audience, libraryRevision, policyRevision, totalCount, pageSize, expiresAt }`. Snapshots expire after 10 minutes. A credential keeps at most two (creating a third replaces its oldest); `429 FEDERATION_SNAPSHOT_CAPACITY` with `Retry-After` when the instance-wide limit is reached.
- `GET /api/federation/v1/snapshots/:snapshotId/videos?cursor=` - Up to 500 items per page: `{ snapshotId, totalCount, items, nextCursor, complete }`. Only `complete: true` on the final page proves the listing is whole; a genuinely empty library returns `totalCount: 0` and `complete: true`. Any exported change or change of credential terms answers `409 FEDERATION_SNAPSHOT_STALE` and discards the snapshot. Another credential's snapshot is `404`.
  - Item: `{ id, title, author, date, source, sourceUrl, sourceVideoId, channelUrl, addedAt, createdAt, updatedAt, partNumber, totalParts, seriesTitle, rating, duration, width, height, fileSize, mediaType, tags, visibility, assets: { media, thumbnail, avatar, subtitles }, assetRevision }`. `assetRevision` changes whenever any of the item's assets, including its author's effective avatar, does.
- `DELETE /api/federation/v1/snapshots/:snapshotId` - Release a finished snapshot early.
- `GET /api/federation/v1/videos/:nativeId?audience=` (`library:read`) - Fresh detail: the snapshot item plus `description` and `subtitles: [{ trackId, language, format }]`. A hidden video is `404 FEDERATION_VIDEO_NOT_FOUND` to the public audience, exactly like an unknown one.
- `GET`/`HEAD /api/federation/v1/videos/:nativeId/assets/:kind?audience=&track=` (`media:read`) - Bytes for `media`, `thumbnail`, `avatar` (the author's effective avatar), or `subtitle` (`track` is a `trackId` from the detail). Visibility is checked on every request. Supports `Range`/`If-Range`, `ETag`/`Last-Modified` conditionals, `206`/`304`/`412`/`416`, and `HEAD`; responses are `no-store`. Media is served from managed files, mounted directories, and, when configured, cloud storage (`capabilities.assets.mediaStorage`). Cloud bytes are proxied by this instance: signed storage links never leave it, only `Range` and conditional headers go upstream, and only content and validator headers come back. A storage timeout is `504 FEDERATION_UPSTREAM_TIMEOUT` and other storage faults are `502 FEDERATION_UPSTREAM_ERROR`. Remote-URL thumbnails and subtitles report as unavailable. A missing asset is `404 FEDERATION_ASSET_UNAVAILABLE` and says nothing about the video. Revoking, suspending, rotating, or deleting a token ends its transfers immediately.

Protocol `POST`/`DELETE` requests are exempt from CSRF only when they carry a valid, usable federation credential. Protocol traffic bypasses the general API rate limit; only failed authentication counts toward its own limit.

## Federation (Prime Side)

This instance can read other instances' libraries with credentials they issued. All of these endpoints are owner-only (an admin session, or login-disabled mode) for now. Visitors and API keys are refused. For the owner, synced items also appear in `GET /api/videos`; collections, favorites, statistics, and playback progress do not include them yet.

- `GET /api/federation/peers` - Registered peers with their status. Credentials are never returned.
- `POST /api/federation/peers` - Body: `{ name, baseUrl, credential }`. Performs the handshake, pins the peer's instance ID, stores the credential encrypted (key in `MYTUBE_FEDERATION_KEY` or `data/federation.key`, never in the database), and starts a sync.
  - A host that resolves only to private addresses is a LAN exception and may use `http`. A public host must use `https`. A host that resolves to both is refused.
  - `409 FEDERATION_PEER_EXISTS` for an instance already registered (under any URL), and `409 FEDERATION_SELF_CONNECTION` for this instance itself.
- `PATCH /api/federation/peers/:id` - `{ name?, enabled? }`. Disabling hides the peer's items, ends its streams, and discards any sync in flight. Enabling requires a fresh sync.
- `PUT /api/federation/peers/:id/credential` - `{ credential }`. Replaces the credential, which must authenticate as the same instance.
- `POST /api/federation/peers/:id/sync` - Runs a sync and waits for it: `{ result: { status, changed, upserted?, tombstoned?, error? }, peer }`.
- `DELETE /api/federation/peers/:id` - Removes the peer and every item synced from it.
- Peer `status`:
  - `pending`: not synced yet.
  - `ok`: synced.
  - `error`: the last sync failed transiently. Items are still listed, with `availability: "stale"`.
  - `credential_rejected`, `credential_missing`, `identity_mismatch`, `incompatible`: the peer's items are hidden until the owner acts.
- A sync commits only a complete, validated snapshot whose revisions did not change while it was read. Items missing from such a snapshot are tombstoned; a failed or partial read changes nothing.
- A database import or restore disables every peer.
- `GET /api/federation/library?offset=&limit=` - `{ total, items }`, where each item is a snapshot item with a prime-generated `fed_…` `id`, `origin: { kind: "remote", instanceId, instanceName }`, `availability`, and `lastSyncedAt`.
- `GET /api/federation/library/:id` - Fresh detail read from the owning peer.
- `GET`/`HEAD /api/federation/media/:id/:kind?track=` - The media gateway, for kinds `media`, `thumbnail`, `avatar`, and `subtitle`. It supports Range and conditional requests, responds `private, no-store`, and passes back only content and validator headers.
  - Peer failures map to `502`/`504`, never `401`. A peer that refuses the credential is quarantined.
  - Disabling or removing the peer ends its streams.
- `GET`/`HEAD /api/federation/media/:id/subtitle/:track` - The same subtitle track as `?track=`, as a path, which is how library items list their subtitles.

Run the two-instance system test, which starts two real backends from throwaway roots, with `npm run test:federation-system` in `backend/` (`KEEP=1` keeps the roots and logs).

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
- `GET /api/settings/cloudflared/status` - Get Cloudflared tunnel status
- `POST /api/settings/tags/rename` - Rename tag
  - Body: `{ oldTag: string, newTag: string }`
- `POST /api/settings/telegram/test` - Send a test Telegram notification
  - Body: `{ botToken: string, chatId: string }`
- `GET /api/settings/ytdlp/version` - Report the yt-dlp the backend runs and the latest release on PyPI
  - By default this probes only the local binary and does not contact PyPI
  - Query: `checkLatest=true` explicitly looks up the latest release on PyPI
  - Response `data`: `{ version, path, available, isStale, staleAfterDays, latestVersion, updateAvailable, updateSupported, customPathConfigured, errorMessage? }`
  - `latestVersion` is `null` when the lookup was not requested or PyPI is unreachable; `updateAvailable` is then `false`
- `POST /api/settings/ytdlp/update` - Update yt-dlp in place via pip (no image rebuild required)
  - Requires `container` admin trust; returns `403` in `application` trust mode
  - Returns `409` (`errorKey: ytDlpUpdateCustomPath`) when `YT_DLP_PATH` pins a specific binary
  - Response `data`: `{ previousVersion, changed, status }` with `status` shaped like the endpoint above
  - Concurrent requests share a single pip run
  - Installs `yt-dlp[default,curl-cffi]` so the release-coupled pins (yt-dlp-ejs solver, curl-cffi impersonation range) are resolved from the target release instead of drifting
  - The bundled bgutil POT provider is not upgraded: it is loaded from the image ahead of any pip copy and its Node server is not on PyPI
  - In Docker the install persists in the `/app/data` volume and outlives container recreation; see the docker guide for how to roll back to the image-pinned version

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

## Gesture Login (Admin Only)

Gesture Login is an optional convenience credential for the single admin. Password login and login protection must remain enabled while it is configured. The management endpoints require an admin session; status and authentication are public login endpoints. API-key authentication cannot use these routes.

- `GET /api/settings/gesture-login/status` - Get safe Gesture Login state
  - Response: `{ configured, canConfigure, locked, available, attemptsRemaining, resetRequired }`
  - No verifier, pepper identifier, pattern, or timestamp is returned.
- `PUT /api/settings/gesture-login` - Create or replace the admin gesture
  - Admin session required
  - Body: `{ pattern: number[] }`; the server canonicalizes Android-style skipped midpoints and requires at least 3 distinct dots
  - Returns `201` on first setup and `200` on replacement
  - Relevant errors: `409 gesture_password_login_required`, `423 gesture_locked`, `422 gesture_invalid`
- `DELETE /api/settings/gesture-login` - Remove the gesture immediately
  - Admin session required; allowed while the gesture is locked; idempotent
  - Response: `{ success: true, removed: boolean }`
- `POST /api/settings/gesture-login/authenticate` - Authenticate a gesture and issue an admin auth cookie
  - Body: `{ pattern: number[] }`
  - A wrong valid gesture returns `401 gesture_incorrect` with `attemptsRemaining`.
  - Failures are shared across devices. One or two failures expire 12 hours after the most recent wrong gesture. The third failure before expiry returns `423 gesture_locked` and never expires; only one successful admin password login clears it.

While a gesture credential exists, a settings update that disables password login returns `409 gesture_requires_password_login`.

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
  - Response `summary` includes `videos`, `collections`, `collectionLinks`, `subscriptions`, `downloadHistory`, `videoDownloads`, `tags`, and `authorProfiles`; each item contains `{ merged, skipped }`
- `POST /api/settings/merge-database` - Merge uploaded `.db` backup into current DB while keeping existing records
  - Multipart form-data: `file`
  - Response includes the same merge `summary` shape as preview
- `GET /api/settings/last-backup-info` - Get latest backup metadata
- `POST /api/settings/restore-from-last-backup` - Restore from latest backup
- `POST /api/settings/cleanup-backup-databases` - Cleanup backup DB files

Author avatar overrides participate in `merge-database-preview` and `merge-database`. Their merge summary includes `authorProfiles: { merged, skipped }`. Profiles retain their exact author identity when defaults are restored (`custom_avatar_path = NULL`), so even legacy names remain editable after their last video is removed. Identity-only profiles participate in backups and merges. Exact author keys absent from the target are imported; an existing target profile wins a conflict, regardless of source timestamps. These conflict rules and counts apply only to merging. `import-database` replaces the entire database, including author profiles, and does not return merge counts. Older backups without `author_profiles` remain supported. Database imports/merges do not copy avatar image files: back up and restore the avatar directory as well; missing images fall back to automatic artwork.

## File Maintenance

- `POST /api/scan-files` - Scan local uploads video directory and sync with DB
- `POST /api/scan-mount-directories` - Scan configured mount directories and sync with DB
  - Body: `{ directories: string[] }` (non-empty)
- `POST /api/cleanup-temp-files` - Remove temporary download files (`.part`, `.ytdl`, `temp_*`)
- `GET /api/media-integrity-audit` - Check the library's local media files for damage (admin only)
  - Read-only: reports findings and recommends an action, but never repairs or re-downloads anything
  - Reports rows whose file is missing, whose audio and video tracks disagree in length, whose stored duration no longer matches the file, or that ffprobe cannot read
  - Query: `timeline=1` also looks for content missing mid-file, reported with reason `timeline_gap` and a `gaps` list of `{ stream, atSeconds, gapSeconds }`. Long packet durations are reported as `timeline_ambiguous` for manual review; missing packet durations make the check inconclusive rather than proving a gap. Only streams with a measurable frame-count shortfall are scanned; streams without usable frame counts are reported as inconclusive. Each inconclusive file is listed with reason `timeline_inconclusive` for manual review. Opt-in because scans read whole files; completed results are cached for a day per unchanged file
  - `cloud:`, `mount:` and `http(s)` rows are skipped, not reported as missing
  - Response: `{ success, audit: { generatedAt, summary, items, humanSummary } }`
  - Each item: `{ localVideoId, title, mediaType, sourceUrl, videoPath, reasons, detail, storedDurationSeconds, measured, recommendedAction }`, where `mediaType` is `video` or `audio` and `recommendedAction` is `redownload`, `refresh_duration` or `manual_review`
  - Available in the UI as Settings → Library & Storage → Media Integrity Check

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
  - Auth: accepts a session cookie, or API key (`X-API-Key` / `Authorization: ApiKey <key>`)

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
