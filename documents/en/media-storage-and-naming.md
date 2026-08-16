# Media Storage & Filename Naming

This document explains how MyTube decides **where a downloaded file is stored** and **how its filename is generated**. The current model was introduced to fix media collisions and ordering issues (Issue #391) and unifies every path that writes media to disk.

At a high level:

> Each media item gets a **stable identity** `(platform, sourceVideoId, mediaType, part)` → a filename is produced by the **legacy** or **template** naming mode → the path is placed under the **author-folder** physical layout → the **output-path allocator** reserves the whole file family and steps the name aside on collision → the file is published to its final path with a **no-overwrite, staging + hard-link** model that is crash-safe and supports rollback.

---

## 1. Storage directory layout

All media lives under `backend/uploads/`, split into three managed roots:

| Type | Directory | Web path prefix |
|---|---|---|
| Video | `uploads/videos/` | `/videos/...` |
| Thumbnail | `uploads/images/` | `/images/...` |
| Subtitle | `uploads/subtitles/` | `/subtitles/...` |

- Thumbnails and subtitles can optionally be **co-located in the video folder** (via the "move thumbnails/subtitles to video folder" settings). When enabled, they are written under `/videos/...` instead of their isolated roots.
- `images-small/` holds an internal downscaled preview cache and mirrors the full-size thumbnail layout.
- `backend/data/` holds internal state that supports concurrency and crash recovery:
  - `output-path-reservations/` — path reservation lock files (see §4)
  - `output-family-journals/` — publication journals used for crash recovery / rollback (see §5)
  - `.mytube-staging/` — a same-volume staging directory on the destination disk

Roots are defined in `backend/src/config/paths.ts`.

---

## 2. Stable media identity

Every download now carries a `MediaIdentity`:

```ts
{ platform, sourceVideoId, mediaType: "video" | "audio", partNumber?, localVideoId? }
```

- The `videos` table has a `sourceVideoId` column, and a `video_downloads` tracking table is keyed by **(sourceVideoId, platform, mediaType)**. Its deterministic id is `platform:sourceVideoId` (audio also appends `:mediaType`).
- For **multipart** media the tracking row points at the **lowest surviving part**. Deleting a part hands the tracking row over to the next part automatically.
- Persisting an identity is **fail-closed**: the source id derived from the URL, the value on the video row, and the identity must agree, otherwise it throws.

Relevant code: `backend/src/services/storageService/downloadedMediaIdentity.ts`.

---

## 3. Filename naming

Naming has two modes (setting `downloadFilenameMode`), dispatched in `planVideoOutputPaths` (`backend/src/services/filenameTemplate/renderer.ts`).

### 3.1 Legacy mode

Bypasses the template renderer and uses `formatVideoFilename(title, author, date)` → `Title-Author-YYYY` (symbols removed, spaces turned into dots). This keeps output byte-identical to older files so batch rename can detect files that are already at the target. When switching between legacy and template modes, `stripLegacyFilenameSuffix` first removes any recognizable old suffix so it is not concatenated twice.

### 3.2 Template mode (Liquid templates)

A Liquid-style template renders the relative path. Variables are defined in `backend/src/services/filenameTemplate/reference.ts`. Key variables:

| Variable | Meaning | Example |
|---|---|---|
| `{{ title }}` | Title | `Sample Video` |
| `{{ source_video_id }}` | Source platform video ID | `BV1AB411c7mD` |
| `{{ id }}` | **Now equal to `source_video_id`** (no longer the local id) | `dQw4w9WgXcQ` |
| `{{ local_video_id }}` | Local library row id (includes part) | `1785234567890_part2` |
| `{{ download_datetime }}` | Download timestamp (UTC) | `2026-07-28_14-03-52` |
| `{{ ext }}` | Extension | `mp4` |
| `{{ uploader }}` / `{{ channel }}` / `{{ artist_name }}` | Author / channel | `Sample Channel` |
| `{{ upload_yyyy_mm_dd }}` / `{{ upload_date }}` / `{{ upload_year }}` … | Upload date parts | `2026-04-30` |
| `{{ source_custom_name }}` / `{{ source_collection_name }}` … | Source name / collection | `Sample Channel` |
| `{{ season_* }}` / `{{ static_season__* }}` | Season/episode helpers | `Season 2026/s2026e0430` |
| `%(title)s`, `%(upload_date>%Y-%m-%d)s` … | Raw yt-dlp placeholders | — |

> **Important behavior change:** `{{ id }}` now maps to **source-video-id**, so the id embedded in a filename is the stable source identifier that naturally distinguishes different sources.

**Built-in presets** (`backend/src/services/filenameTemplate/presets.ts`) include the collision-resistant `source_date_id`:

```
{{ source_custom_name }}/{{ upload_yyyy_mm_dd }} - {{ title }} [{{ source_video_id }}].{{ ext }}
```

Putting `source_video_id` in the filename keeps same-titled videos from different sources apart from the start.

### 3.3 Author-folder organization

`applyPhysicalOrganization` (`backend/src/services/filenameTemplate/organizationPath.ts`) now applies to **both legacy and template modes**. When author-folder organization is enabled and the rendered path does not already start with the author segment, the whole path is placed under a physical `Author/...` folder.

---

## 4. Output-path allocator (collision handling)

Every final write goes through `allocateOutputFamilySync` (`backend/src/services/filenameTemplate/outputPathAllocator.ts`). It reserves the **whole "family"** — video + thumbnail + subtitle stem — as one unit, so a subtitle whose language is not yet known cannot be claimed by another row.

On collision the suffix **escalates**:

1. `none` — the preferred path is free; use it as-is.
2. `source_id` — append a source suffix `` [<sourceId>-p02-audio]`` (part zero-padded, `-audio` for audio). Example: `Title [BV1AB411c7mD-p02].mp4`.
3. `numeric` — still colliding, so append ` (2)`, ` (3)`, … (can combine with the source_id suffix).

A candidate "conflicts" when a file already exists on disk that is **not owned by this row**, or when another DB row already registers that path. Concurrency is protected by **lock files with heartbeats** under `data/output-path-reservations/`. Locks work across processes and stale locks are reclaimable (dead-process detection plus a 5-minute expiry).

---

## 5. Publication model (no-overwrite, crash-safe)

Once a path is allocated, the file is **not** moved directly. Instead `promoteFileNoOverwriteSync`:

1. Stages the file in `.mytube-staging/` on the **same volume** as the destination (avoids cross-device moves).
2. **Publishes by hard link** to the final path and verifies the file size matches.
3. Falls back to **copy** when hard links are unsupported (EXDEV / EPERM / ENOTSUP, etc.).
4. Uses **no-overwrite** semantics (`wx` flag + a claim marker): if the destination already exists it is not overwritten.
5. Writes a journal to `data/output-family-journals/` at each step (`staged` / `hard_linking` / `committed`), so after a crash the operation can be resumed or cleaned up.

---

## 6. Redownload replacement (same row)

When the **same library row** is redownloaded, it may replace the file it already owns. `replaceOwnedFileWithBackupSync` backs up the current file (`.mytube-replace-backup`), replaces it, and rolls back on failure.

If the target path changed (e.g. a template or author-organization change), the old, now-unreferenced file is identified by `resolveSupersededManagedPath` (`backend/src/services/downloaders/supersededOutput.ts`) and removed. It compares **absolute paths** rather than basenames, so it catches directory-only moves and never deletes the file that was just written.

---

## 7. Unified across all write paths

The same allocator + publication model is used by every path that writes media, so media from different sources cannot overwrite each other:

- yt-dlp downloads · Bilibili (including multipart) · MissAV
- **Batch rename** (`renameJobService`)
- **Collection relocation** (`collectionFileManager`)

---

## 8. Collision audit & repair

- `mediaCollisionAuditService` — a **read-only** scan that reports rows pointing at the same physical file or otherwise colliding.
- `mediaCollisionRepairService` — the accompanying repair / redownload plumbing, exposed through `mediaCollisionAuditController`.

---

## 9. Managed media-server TV library (optional)

> Opt-in. Nothing in this section happens unless you set **Media server export layout** to
> `Author → playlist seasons (managed TV library)` in Settings. The default is
> `Adjacent sidecars`, which keeps the historical behavior exactly as it was.

Media servers want a `Show / Season NN / SxxExxx` tree. Your `uploads/videos/` layout is
driven by your own filename and author-organization settings and does not have to match
that. Rather than forcing one onto the other, MyTube can build a **separate, managed
mirror**:

```text
uploads/media-library/
└── Kurzgesagt/
    ├── tvshow.nfo
    ├── poster.jpg
    ├── Season 01/
    │   ├── season.nfo
    │   ├── S01E001 - Human Origins.mp4
    │   ├── S01E001 - Human Origins.nfo
    │   └── S01E001 - Human Origins-thumb.jpg
    └── Season 02/
        ├── season.nfo
        ├── S02E001 - Ants.mp4
        └── S02E001 - Ants.nfo
```

Add **`uploads/media-library/`** to your media server as a *Shows* library. Do not add
`uploads/videos/` as well, or every episode appears twice.

### 9.1 What maps to what

| Source concept | Media-server concept |
|---|---|
| A channel / author | One show directory + `tvshow.nfo` |
| A source-backed playlist | One numbered season + `season.nfo` |
| One `(playlist, video)` membership | One episode |
| A video in no source playlist | `Season 00`, titled *Specials / Unassigned* |

Only playlists with a **durable source identity** become seasons — playlist subscriptions
and Bilibili collections/series. Collections you created by hand are not turned into
seasons.

### 9.2 Your original files are never touched

Episodes in the mirror are **hard links** back to the file in `uploads/videos/`. A hard
link is a second name for the same bytes, so:

- no video is moved, renamed, or duplicated;
- the mirror normally consumes **no additional disk space**;
- deleting the mirror never affects your originals.

Hard links only work **within one filesystem**. If `uploads/media-library/` and
`uploads/videos/` end up on different disks — or on a filesystem that cannot link — MyTube
falls back to copying, which *does* consume a second full copy of each affected video. The
rebuild summary always reports how many files were linked versus copied. You can turn the
fallback off, in which case those episodes are reported as failed instead.

Artwork is always copied rather than linked, so regenerating a thumbnail inside MyTube
cannot alter what your media server already scanned.

### 9.3 Stable numbering

Season and episode numbers are assigned **once** and then never change:

- A playlist gets the next free season number the first time it is attached to a show.
  Deleting a playlist does not free its number for reuse.
- An episode number is taken from the playlist position observed when MyTube first imported
  that item. If the upstream playlist is later reordered, MyTube records the new position
  for diagnostics but does **not** renumber existing episodes.
- An item newly inserted at the top of an upstream playlist gets the next unused episode
  number, not `E001`.

"Playlist order" here means MyTube's stable first-import order, not a continuously mutable
upstream sort order. This is deliberate: renumbering would move every file in a season and
break watch state in your media server.

Renaming a channel or a playlist updates the NFO title only. The directory keeps the name it
was created with.

### 9.4 The same video in several playlists

A video that belongs to two playlists becomes two episodes — one in each season — each with
its own NFO and its own unique id. Both point at the same original file via hard links, so
this costs no extra space.

### 9.5 Cleanup safety

Every file MyTube generates under `uploads/media-library/` is recorded in an ownership
ledger in the database. Cleanup deletes **only** files listed there. Anything you put in the
mirror yourself is left alone and reported as a conflict rather than overwritten, and the
originals in `uploads/videos/` are never touched.

Disabling the layout does not delete the mirror. To remove it, set the export mode to
**Off** and run the cleanup action. Season and episode numbers are retained, so re-enabling
later reproduces the same tree.

---

## Summary

Stable identity → filename (legacy or Liquid template; `{{ id }}` = source id, recommended `[source_video_id]` for collision resistance) → author-folder physical organization → allocator reserves the whole file family and steps aside on collision via `none → source_id → numeric` → no-overwrite publication through staging + hard link (copy fallback), with locks and journals guaranteeing concurrency and crash safety.
