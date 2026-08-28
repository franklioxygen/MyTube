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

---

## 9. Managed media-server TV library (issue #411)

An **opt-in** second layout for the media-server export. Set **Media server export layout**
to *Author → playlist seasons* in Settings. The default stays *Adjacent sidecars*, so an
existing library is unaffected until you switch.

### Concept mapping

| MyTube | Media server |
|---|---|
| Source channel / author | one show |
| Source-backed playlist collection | one numbered season |
| `(playlist, video)` membership | one episode occurrence |
| Video in no source playlist | Season 00, shown as *Specials* |

### Layout

```text
backend/uploads/media-library/
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
        └── S02E001 - Ants.mp4
```

Add `media-library/` to your media server as a **Shows** library. Do **not** add `videos/`
as well, or the same video is imported twice.

### Originals are never touched

The mirror is derived. Original files keep the path and filename your naming settings gave
them; filename settings do not control the mirror. Episodes are **hard links** to the
originals, so they normally consume no second copy of the media. Hard links require the
mirror and `videos/` to sit on the same filesystem — with `uploads/` bind-mounted as one
volume they always do. Where hard links are unavailable, the *copy files when hard links are
unavailable* option keeps the feature working at the cost of disk space; the rebuild summary
reports how many files were linked versus copied.

### Stable numbering

- A playlist is assigned the next free season number the first time it is exported, and
  keeps it forever. Deleting a playlist never frees its number for another one.
- An episode number comes from the position the membership had when it was first imported.
  Reordering the upstream playlist does not renumber anything; MyTube only records the new
  source position.
- A video added at the head of a playlist receives the next unused episode number, not `1`.
- Editing a video title rewrites its `.nfo` but never moves its file.

### One video in several playlists

Each membership is its own episode occurrence with its own season/episode numbers, its own
`.nfo`, and its own hard link. A media server sees them as distinct episodes because each
carries a distinct `uniqueid`.

### Cleanup safety

Every generated file is recorded in an ownership ledger. Cleanup — and stale-file sweeping
during a rebuild — deletes only ledger-owned paths, so an original video can never be
reached, and a file you placed in the mirror yourself is preserved and reported as a
collision instead of being overwritten. Cleanup keeps the season and episode numbers, so
re-enabling the layout later reproduces the same tree.

## Summary

Stable identity → filename (legacy or Liquid template; `{{ id }}` = source id, recommended `[source_video_id]` for collision resistance) → author-folder physical organization → allocator reserves the whole file family and steps aside on collision via `none → source_id → numeric` → no-overwrite publication through staging + hard link (copy fallback), with locks and journals guaranteeing concurrency and crash safety.
