# Issue 295 Upgrade Guide

Date: 2026-06-06
Related design: [issue295-tech-design.md](./issue295-tech-design.md)

## Status

The Issue 295 design is now implemented end to end.

There is no open design item left. The only newly added migration step is optional at runtime, but it is implemented:

- cleanup of redundant author-collection links after switching to `author_folder_only`

## What Changed

### 1. Collection membership is no longer implicitly exclusive

Videos can now belong to more than one collection at the same time.

That is an intentional behavior change. Before this work, adding a video to an author collection could silently remove it from its original Bilibili collection. That path now uses additive linking.

Impact:

- code or scripts that assumed one "primary" collection per video need to stop relying on `getCollectionByVideoId()` as the only truth
- callers should prefer multi-collection-aware logic where possible

### 2. Author organization now uses `authorOrganizationMode`

The old boolean:

- `saveAuthorFilesToCollection`

has been replaced logically by:

- `root`
- `author_folder_only`
- `author_collection_linked`

Compatibility behavior:

- old stored `false` becomes `root`
- old stored `true` becomes `author_collection_linked`
- the legacy boolean is still backfilled for compatibility, but it is no longer the source of truth

Impact:

- external clients should migrate writes to `authorOrganizationMode`
- reading only `saveAuthorFilesToCollection` is deprecated behavior now

### 3. Bilibili aggregate downloads can now finish as `partial`

Download history status is no longer just `success` or `failed`.

New meaningful status:

- `partial`

Impact:

- API consumers, dashboards, or scripts that parse history status must handle `partial`
- partial Bilibili jobs are now retryable repair targets, not generic failures

### 4. Re-downloading the same Bilibili link now repairs missing members

Multipart BV downloads and Bilibili collection downloads now:

- persist expected/completed/failed membership state
- reuse the original linked collection
- download only missing or failed members on retry

Impact:

- same-link retries no longer behave like fresh unrelated downloads
- downstream automation should expect repair behavior instead of duplicate collection creation

### 5. Collection order is now persisted and respected

MyTube now writes and reads `collection_videos.order`.

Impact:

- collection rendering is now stable and explicit
- code that relied on incidental insertion order may observe different, but now correct, ordering

### 6. Legacy multipart Bilibili filenames are zero-padded

New legacy multipart downloads use padded numeric prefixes such as:

- `01`
- `02`
- `10`

Impact:

- new files sort correctly in file browsers
- existing old files are not renamed automatically unless the user runs `Format Legacy Filenames`

### 7. Channel-playlist watcher flows now always create playlist collections

Author organization no longer suppresses playlist collection creation.

Impact:

- users who previously relied on the old coupling will now get playlist collections consistently

## Recommended User Upgrade Path

### For normal users

1. Back up the database.
2. Upgrade to the new build.
3. Open Settings -> Data Management -> Author Organization.
4. Choose the mode that matches the real intent:
   - `root`: no author folders, no author collections
   - `author_folder_only`: author folders on disk, no redundant author collections in MyTube
   - `author_collection_linked`: keep author collections as logical groupings
5. If the goal is author folders without duplicate author collections, select `author_folder_only`.
6. Run `Clean Up Existing Author Collections`.
7. If old legacy multipart filenames already sort badly on disk, run `Format Legacy Filenames`.
8. Re-submit any incomplete Bilibili link once; MyTube will repair only the missing episodes.

### What the cleanup action does

The cleanup action is intentionally conservative.

It only:

- unlinks author-collection memberships from videos that already belong to another collection
- deletes author collections that become empty

It does not:

- move files on disk
- delete videos
- rewrite unrelated collections

## Recommended Integration Upgrade Path

### Settings API clients

Stop treating `saveAuthorFilesToCollection` as the primary setting.

Use:

- `authorOrganizationMode`

Compatibility support still exists, but new clients should write the explicit mode.

### History/status consumers

Add handling for:

- `partial`

Do not collapse `partial` into `success`. It means the aggregate job completed with missing members still outstanding.

### Collection-aware code

Audit code that assumes:

- one video -> one collection

That assumption is no longer safe for author-linked and playlist-linked videos.

## Known Intentional Behavior Differences

These are not regressions. They are the new model:

- author linking no longer steals videos from Bilibili collections
- same-link Bilibili retries repair incomplete sets instead of creating fresh duplicates
- playlist watchers always create playlist collections
- collection pages respect stored order first, not accidental lexicographic order

## Troubleshooting

If a user upgrades and still sees duplicate author collections:

1. verify `authorOrganizationMode` is set to `author_folder_only`
2. run `Clean Up Existing Author Collections`
3. refresh the library view

If a user upgrades and old files still sort badly on disk:

1. verify the files were downloaded before this change
2. run `Format Legacy Filenames`

If an API consumer breaks after upgrade:

1. check for `partial` history-status handling
2. check for direct writes to `saveAuthorFilesToCollection`
3. check for single-collection assumptions in collection logic
