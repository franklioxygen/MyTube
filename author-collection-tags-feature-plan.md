# Implementation Plan: Author & Collection Tags

## Overview

Add the ability to assign **tags** to **authors** (on AuthorVideos page) and **collections** (on CollectionPage). These tags are displayed on the respective pages and participate in **Home tag filtering**: when the user filters by tags on Home, videos are shown if they match by **video tags**, **author tags**, or **collection tags**.

Additional decisions:
- Tag matching is **case-insensitive**. Normalize tags with `trim().toLowerCase()` at both save time and filter time.
- In **collections** view, filtering must cover both cases:
  - The collection’s **first video** matches by video/author/collection tags.
  - **Any** video in the collection matches by video/author/collection tags.
- **TagsModal** only edits tags for **video / author / collection**. It must **not** add or remove global system tags in settings. System tags are managed only in Settings.

---

## 1. Data Model & Storage

### 1.1 Where to store author/collection tags

- **Authors** have no backend entity (they are derived from `video.author`). Store **author tags** in app settings, keyed by **normalized author name**.
- **Collections** exist in the DB but adding a `tags` column would require a migration and API changes. For consistency and minimal backend change, store **collection tags** in app settings as well, keyed by collection id.

### 1.2 Settings shape

- **`authorTags`**: `Record<string, string[]>` — key = normalized author name, value = array of tag strings.
- **`collectionTags`**: `Record<string, string[]>` — key = collection id, value = array of tag strings.

Normalization:
- Define `normalize(value) = value.trim().toLowerCase()`.
- When saving tags, normalize with `normalize(...)`.
- Use a consistent author key by normalizing author names on both save and filter. Prefer the **actual `video.author`** value over the route param to avoid encoding/format drift.

### 1.3 Backend changes

| File                                              | Change                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/services/storageService/settings.ts` | Add `"authorTags"` and `"collectionTags"` to `WHITELISTED_SETTINGS` so they can be saved.                                                                                                                   |
| `backend/src/types/settings.ts`                   | Optionally add `authorTags?: Record<string, string[]>` and `collectionTags?: Record<string, string[]>` for type documentation (settings are stored as key-value JSON; new keys work without schema change). |

No database migration: settings are key-value; new keys are stored as JSON in the existing `settings` table.

### 1.4 Frontend types

| File                    | Change                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/types.ts` | On `Settings` interface, add `authorTags?: Record<string, string[]>` and `collectionTags?: Record<string, string[]>` so hooks and components are typed. |

---

## 2. AuthorVideos Page

### 2.1 Add Tag button and TagsModal

- Add an **“Add Tag”** (or “Tags”) icon button in the header row next to the existing “Create collection” and “Delete author” buttons. The **Add Tag** button is shown even when the author has no videos; the other actions remain gated by having videos.
- Clicking it opens **TagsModal**.
- **TagsModal** is already implemented for video tags; reuse it with:
  - **videoTags** → current tags for this author: `authorTags[normalize(author)] ?? []` (from settings).
  - **availableTags** → from `useVideo().availableTags` or `useSettings().tags` (global tag list for suggestions only).
  - **onSave** → update settings: set `authorTags = { ...authorTags, [normalize(author)]: normalizedTags }` (and prune empty arrays if desired), then call settings save mutation (e.g. `useSettingsMutations().saveMutation`).

### 2.2 State and data flow

- Use **useSettings** to read `authorTags` and **useSettingsMutations** to persist changes.
- Local state: `isTagsModalOpen` to control TagsModal visibility.
- After save, invalidate/refetch settings (or rely on mutation cache) so the page shows updated tags.
- If the author has **no videos**, use `normalize(author)` from the route param as the `authorTags` key for read/write.

### 2.3 Display tags on the page

- Show the author’s tags **below the title** (e.g. under “{authorName}” and “X videos”), as a row of chips or compact labels.
- Only render when `(authorTags[normalize(author)] ?? []).length > 0`.

### 2.4 Files to touch

- `frontend/src/pages/AuthorVideos.tsx`: add button, modal, tags display, and settings read/write for `authorTags`.

---

## 3. CollectionPage

### 3.1 Add Tag button and TagsModal

- Add an **“Add Tag”** (or “Tags”) icon button in the header row (e.g. next to the collection name / sort control).
- Open **TagsModal** with:
  - **videoTags** → current tags for this collection: `collectionTags[collection.id] ?? []`.
  - **availableTags** → from `useVideo().availableTags` or `useSettings().tags` (suggestions only).
  - **onSave** → update settings: `collectionTags = { ...collectionTags, [collection.id]: normalizedTags }`, then save via settings mutation.

### 3.2 Display tags on the page

- Show the collection’s tags **below the title** (under collection name and “X videos”), same pattern as AuthorVideos (chips or labels).
- Only when `(collectionTags[collection.id] ?? []).length > 0`.

### 3.3 Files to touch

- `frontend/src/pages/CollectionPage.tsx`: add button, TagsModal, tags display, and settings read/write for `collectionTags`.

---

## 4. Home Tag Filtering

### 4.1 Desired behavior

When the user selects one or more tags in the Home sidebar (case-insensitive):

- **Current behavior**: show videos whose **video tags** include all selected tags (AND).
- **New behavior**: also show videos that:
  - have an **author** whose `authorTags` include all selected tags, or
  - belong to at least one **collection** whose `collectionTags` include all selected tags.

So a video is shown if **any** of the following is true:

1. All selected tags are in `video.tags`.
2. All selected tags are in `authorTags[normalize(video.author)]` (author key is normalized).
3. The video is in some collection `c` and all selected tags are in `collectionTags[c.id]` (collection tags are normalized at save time).

### 4.2 useVideoFiltering changes

| File                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frontend/src/hooks/useVideoFiltering.ts` | Extend the hook’s props with `authorTags?: Record<string, string[]>` and `collectionTags?: Record<string, string[]>`. In each view mode (all-videos, history, collections), when `selectedTags.length > 0`, include a video if **either** the existing condition (video tags match) **or** author tags match **or** any of its collections’ tags match. Keep existing behavior when `authorTags`/`collectionTags` are missing (only video tags). Use case-insensitive comparison by normalizing tags. |

Collections view behavior:
- Also show a collection if **any** video in the collection matches by video/author/collection tags, even if the first video does not match.
- Maintain the UI rule that only one video per collection is shown. If a collection matches by a non-first video, still render the **first video** as the representative card.
- Suggested implementation order: first compute the set of collection IDs that have **any** matching video, then in collections mode keep only the **first video** from those collections.

Helper logic (conceptual, case-insensitive):

- Normalize `selectedTags`, `video.tags`, `authorTags`, and `collectionTags` with the same function (e.g., `trim().toLowerCase()`) before comparison.
- `authorKey = normalize(video.author)` for consistent lookup in `authorTags`.
- `videoMatchesByAuthor = selectedTags.every(tag => (authorTags?.[authorKey] ?? []).includes(tag))`
- `videoMatchesByCollection = collections.some(c => c.videos.includes(video.id) && selectedTags.every(tag => (collectionTags?.[c.id] ?? []).includes(tag)))`
- Include video if existing video-tags match **or** `videoMatchesByAuthor` **or** `videoMatchesByCollection`.

### 4.3 Home.tsx wiring

| File                          | Change                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/pages/Home.tsx` | Use **useSettings** (or existing hook that exposes settings) to read `authorTags` and `collectionTags`. Pass them into **useVideoFiltering** along with existing `videos`, `viewMode`, `selectedTags`, and `collections`. |

---

## 5. TagsModal Reuse

- **TagsModal** currently takes `videoTags`, `availableTags`, `onSave`. No API change required: for author/collection, pass the entity’s tag array as `videoTags` and an async `onSave` that updates settings and then closes the modal.
- **Important change**: TagsModal must **not** mutate global `settings.tags`. It only edits tags for the current entity (video/author/collection). System tags are created/removed in Settings only.
- Implementation option: add `persistNewTagsToSettings?: boolean` (true for video, false for author/collection), or move the global tag write-back to the video caller instead of TagsModal.
- If a user enters a tag that is not in `availableTags`, it can still be saved to the entity, but it will **not** appear in the global tag list until added in Settings.

---

## 6. Delete-Filtered behavior (Home)

- Home has a “delete all filtered videos” action. Current behavior deletes videos that match the selected **video** tags.
- Decision: **match the filter** — delete all videos that are currently shown when filtering by the selected tags (including those shown due to author/collection tags), so behavior is consistent with what the user sees.

---

## 7. Implementation Order

1. **Data & types**: Backend whitelist + frontend `Settings` types for `authorTags` and `collectionTags`.
2. **AuthorVideos**: Add tag button, TagsModal, settings read/write, and display tags below title.
3. **CollectionPage**: Same for collection tags.
4. **useVideoFiltering**: Add `authorTags` and `collectionTags` and extend filter logic (all view modes).
5. **Home**: Pass settings-derived `authorTags` and `collectionTags` into `useVideoFiltering`; align “delete filtered” with new filter semantics.
6. **i18n**: Add any new copy (e.g. “Add tags”, “Author tags”, “Collection tags”) in locale files if needed.
7. **Tests**: Unit tests for `useVideoFiltering` with author/collection tags; optionally shallow tests for AuthorVideos/CollectionPage tag UI and modal.

---

## 8. Summary Table

| Area            | Storage                                 | UI                                                         | Filtering                                                   |
| --------------- | --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Author tags     | Settings `authorTags[normalize(authorName)]` | AuthorVideos: button + modal + chips below title       | Home: include video if author’s tags match selected         |
| Collection tags | Settings `collectionTags[collectionId]` | CollectionPage: button + modal + chips below title         | Home: include video if any collection’s tags match selected |
| TagsModal       | —                                       | Reused as-is with entity-specific `videoTags` and `onSave` | —                                                           |

This plan keeps backend changes minimal (settings whitelist only), reuses TagsModal, and extends Home filtering so author- and collection-tagged content is included when the user filters by tags.
