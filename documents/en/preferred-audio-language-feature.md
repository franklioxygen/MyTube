# Preferred Audio Language – Implementation Plan

This document describes the implementation plan for adding a **Preferred audio language** setting to Download Settings. When set, YouTube (and other supported) videos that offer multistream audio in that language will be downloaded with that language as the preferred audio track.

## Overview

- **User-facing**: A dropdown in **Settings → Download Storage → Download Settings** labeled “Preferred audio language”, with options from “Default” to a list of common language codes.
- **Behavior**: If the user selects a language (e.g. `en-US`, `ja`) and the video has an audio track in that language, yt-dlp will prefer that track. Otherwise, behavior stays as today (best available audio).

## yt-dlp Reference

- **Format selection**: `-f` / `--format` with filter `ba[language=CODE]` selects best audio in that language ([Filtering Formats](https://github.com/yt-dlp/yt-dlp#filtering-formats)).
- **Audio multistreams**: `--audio-multistreams` allows merging multiple audio streams into one file (e.g. `bv+ba[language=en-US]+ba[language=ja]`).
- **Preferred single track**: To prefer one language without multistream use a format like:  
  `bv+ba[language=LANG_CODE]/bv+ba/b`  
  So: best video + best audio in `LANG_CODE` if available, else best video + best audio, else best combined.

Planned behavior: **prefer the chosen language as the primary (single) audio track** when available, using the format above. No `--audio-multistreams` unless we later add an explicit “also add preferred language as extra track” option.

---

## Step-by-Step Implementation

### 1. Data model and persistence

#### 1.1 Frontend types

- **File**: `frontend/src/types.ts`
- **Change**: Extend `Settings` with an optional field:
  - `preferredAudioLanguage?: string;`
  - `""` or `undefined` = “Default” (no language preference).

#### 1.2 Backend types

- **File**: `backend/src/types/settings.ts`
- **Change**: Add to `Settings` interface and to `defaultSettings`:
  - `preferredAudioLanguage?: string;`
  - Default: `""` or omit (so default behavior is unchanged).

#### 1.3 Backend storage whitelist

- **File**: `backend/src/services/storageService/settings.ts`
- **Change**: Append `"preferredAudioLanguage"` to `WHITELISTED_SETTINGS` so the key is persisted.

#### 1.4 Settings merge/validation (optional)

- **File**: `backend/src/services/settingsValidationService.ts`
- **Change**: If we want to normalize invalid values (e.g. unknown codes), add a short validation for `preferredAudioLanguage`; otherwise leave as-is and let yt-dlp handle unknown codes.

---

### 2. Frontend UI

#### 2.1 Download settings component

- **File**: `frontend/src/components/Settings/DownloadSettings.tsx`
- **Changes**:
  - Import MUI `FormControl`, `InputLabel`, `Select`, `MenuItem` (and optionally `SelectChangeEvent`).
  - Define a constant list of **language options**:  
     `{ value: "", labelKey: "preferredAudioLanguageDefault" },  
{ value: "en", label: "English" },  
{ value: "zh", label: "Chinese" },  
{ value: "ja", label: "Japanese" },  
{ value: "ko", label: "Korean" },  
{ value: "es", label: "Spanish" },  
{ value: "fr", label: "French" },  
{ value: "de", label: "German" },  
{ value: "pt", label: "Portuguese" },  
{ value: "ru", label: "Russian" },  
{ value: "ar", label: "Arabic" },  
{ value: "hi", label: "Hindi" },  
{ value: "it", label: "Italian" },  
{ value: "nl", label: "Dutch" },  
{ value: "pl", label: "Polish" },  
{ value: "tr", label: "Turkish" },  
{ value: "vi", label: "Vietnamese" }`  
     (Use `labelKey` for “Default” for i18n; others can use `label` or keys if you prefer full i18n.)
  - Add a controlled **Select** (dropdown):
    - Label: `t('preferredAudioLanguage')`
    - Value: `settings.preferredAudioLanguage ?? ""`
    - `onChange`: `onChange('preferredAudioLanguage', value)`
  - Add a short description below using `t('preferredAudioLanguageDescription')`.

#### 2.2 Settings page state

- **File**: `frontend/src/pages/SettingsPage.tsx`
- **Change**: Ensure initial `settings` state includes `preferredAudioLanguage: ''` (or omit) so the dropdown works and save payload includes the key when changed. No special handling needed if `handleChange` and API already support arbitrary keys that are in the backend whitelist.

---

### 3. Internationalization (i18n)

- **Files**: All under `frontend/src/utils/locales/` (e.g. `en.ts`, `zh.ts`, `de.ts`, …).
- **New keys** (add to each locale file):
  - `preferredAudioLanguage`: short label for the setting (e.g. “Preferred audio language”).
  - `preferredAudioLanguageDescription`: one line explaining that when the video has audio in this language, that track will be preferred (e.g. “When available, YouTube multistream audio in this language will be preferred for downloads.”).
  - `preferredAudioLanguageDefault`: label for the “no preference” option (e.g. “Default”).

Add translations for at least `en` and `zh`; other locales can start with English text or equivalent translations.

---

### 4. Backend – yt-dlp format and flags

#### 4.1 Where config is built

- **File**: `backend/src/services/downloaders/ytdlp/ytdlpConfig.ts`
- **Function**: `prepareDownloadFlags(videoUrl, outputPath, userConfig?)`
- **Current behavior**: For YouTube, it sets `flags.format` to something like `youtubeFormat` (e.g. best video + best audio in preferred codec). It does not currently pass `preferredAudioLanguage` from app settings.

#### 4.2 Passing the setting into the downloader

- **Option A (recommended)**: Have the caller of `prepareDownloadFlags` pass the merged “app settings” (e.g. from `storageService.getSettings()`) so that `ytdlpConfig` can read `preferredAudioLanguage`. Then inside `prepareDownloadFlags`:
  - If `videoUrl` is YouTube (e.g. `youtube.com` or `youtu.be`) and `preferredAudioLanguage` is non-empty:
    - Set format to prefer that language:  
      `bv+ba[language=${preferredAudioLanguage}]/bv+ba/b`  
      (with optional codec/container constraints to match current YouTube logic, e.g. keep `bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]` style if needed; then add fallback `ba[language=...]`).
  - Else: keep existing format logic unchanged.
- **Option B**: Read `storageService.getSettings()` inside `prepareDownloadFlags` and read `preferredAudioLanguage` there. Simpler but tight coupling to storage.

Recommendation: use **Option B** for minimal call-site changes; only YouTube download path needs to respect the setting.

#### 4.3 Exact format string for YouTube

- For **single preferred language** (no multistream):
  - Base: best video + best audio in preferred language, then fallback:
  - Example:  
    `bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[language=LANG_CODE][ext=m4a]/bestvideo[ext=mp4]+bestaudio[language=LANG_CODE]/bestvideo+bestaudio[language=LANG_CODE]/bestvideo+bestaudio/best`
  - Simpler variant that matches your hint style:  
    `bv+ba[language=LANG_CODE]/bv+ba/b`
  - Use the simpler one first; if some YouTube streams lack `language`, yt-dlp will fall back to `bv+ba` then `b`.
- Do **not** set `--audio-multistreams` for this “single preferred track” behavior.
- If we later want “default + preferred language as second track”, we would set `audioMultistreams: true` and use a format like:  
  `bv+ba+ba[language=LANG_CODE]`  
  (document this as a possible future enhancement in the plan, not in scope for the first version.)

#### 4.4 Implementation details in `ytdlpConfig.ts`

- After the block that sets YouTube-specific `flags.format` (and only when URL is YouTube):
  - Call `getSettings()` (or use injected config) and read `preferredAudioLanguage`.
  - If `preferredAudioLanguage` is a non-empty string:
    - Override `flags.format` with the preferred-language format string (e.g. `bv+ba[language=X]/bv+ba/b`), or compose with existing `youtubeFormat` so that we first try preferred language then fall back to current default.
  - Ensure the value is safe to interpolate (e.g. no `"` or `\` in the string); if in doubt, restrict to alphanumeric and `-`/`_` and reject otherwise.

---

### 5. Call chain and tests

#### 5.1 Call chain

- **Download flow**: e.g. `videoDownloadController` or subscription/task processor → `ytdlpVideo.download()` (or equivalent) → `prepareDownloadFlags(videoUrl, outputPath, userConfig)`.
- **userConfig**: Comes from `getUserYtDlpConfig(videoUrl)` (parsed from `ytDlpConfig` text). It does **not** currently include `preferredAudioLanguage`; that lives in app settings. So either:
  - **ytdlpConfig** reads `getSettings().preferredAudioLanguage` inside `prepareDownloadFlags`, or
  - The download service passes `preferredAudioLanguage` in a merged config object into `prepareDownloadFlags`.  
    Plan assumes **ytdlpConfig** reads from `getSettings()` for simplicity.

#### 5.2 Unit tests

- **Backend**
  - `backend/src/services/downloaders/ytdlp/ytdlpConfig.ts` (or existing test file for it):
    - With YouTube URL and `preferredAudioLanguage` set in settings: assert `flags.format` includes `ba[language=...]` and no `audioMultistreams` (or that it’s false).
    - With YouTube URL and `preferredAudioLanguage` empty: assert format unchanged from current YouTube default.
    - With non-YouTube URL and `preferredAudioLanguage` set: assert format not overridden by this feature.
  - Optional: test that the setting is saved and returned by settings API (already covered if whitelist is correct and frontend sends the key).
- **Frontend**
  - `frontend/src/components/Settings/__tests__/DownloadSettings.test.tsx`:
    - Render with `settings.preferredAudioLanguage === ''` and with `settings.preferredAudioLanguage === 'ja'`, and assert the dropdown shows the correct value and that changing it calls `onChange('preferredAudioLanguage', value)`.

---

### 6. Edge cases and validation

- **Empty / Default**: `""` or `undefined` → do not change format; keep current yt-dlp default.
- **Unknown language code**: Store as-is; yt-dlp will use it in `ba[language=X]`. If no such track exists, it falls back per format string. No need to validate against a fixed list unless we want to restrict the dropdown to a known set only (then validation is only in the UI).
- **YouTube-only**: Apply preferred-audio format only when `videoUrl` is YouTube; other sites keep existing behavior.
- **User custom format**: If the user has specified a custom `-f` in **yt-dlp Configuration** (`ytDlpConfig`), the code currently uses that and skips default format. Decision: when `preferredAudioLanguage` is set, we can either (a) still override format for YouTube so preference applies, or (b) not override when user has set a custom format. Plan recommends **(b)** so advanced users keep full control.

---

### 7. Documentation and Codacy

- **Docs**: Add a short note in `documents/en/getting-started.md` or a “Download settings” section that “Preferred audio language” only affects YouTube (and similar) when multistream audio is available.
- **Codacy**: After editing any file, run Codacy CLI analysis for the changed files as per project rules.

---

### 8. Summary checklist

| #   | Layer       | Task                                                                                                                                                                                   |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Frontend    | Add `preferredAudioLanguage?: string` to `Settings` in `types.ts`.                                                                                                                     |
| 2   | Frontend    | Add dropdown + options and description in `DownloadSettings.tsx`.                                                                                                                      |
| 3   | Frontend    | Add i18n keys for label, description, and “Default” in all locale files.                                                                                                               |
| 4   | Frontend    | Ensure SettingsPage initial state and save include the new key.                                                                                                                        |
| 5   | Backend     | Add `preferredAudioLanguage` to `Settings` and `defaultSettings` in `types/settings.ts`.                                                                                               |
| 6   | Backend     | Add `"preferredAudioLanguage"` to `WHITELISTED_SETTINGS` in `storageService/settings.ts`.                                                                                              |
| 7   | Backend     | In `ytdlpConfig.prepareDownloadFlags`, for YouTube URLs with non-empty `preferredAudioLanguage`, set format to `bv+ba[language=LANG]/bv+ba/b` (and do not set `--audio-multistreams`). |
| 8   | Backend     | Respect user custom format: if user specified `-f`/`--format` in ytDlpConfig, do not override for preferred language (optional but recommended).                                       |
| 9   | Tests       | Unit tests for ytdlpConfig (YouTube with/without preference, non-YouTube) and for DownloadSettings dropdown.                                                                           |
| 10  | Docs/Codacy | Short doc update + run Codacy on modified files.                                                                                                                                       |

---

### 9. Future enhancements (out of scope)

- **Multistream**: Add a checkbox “Include preferred language as extra audio track” and use `--audio-multistreams` with `bv+ba+ba[language=LANG]`.
- **Per-site**: Only YouTube is in scope; same mechanism could later be used for other extractors that expose `language` on audio formats.
- **Dynamic list**: Populate the dropdown from yt-dlp’s list of language codes or from a small API that returns common codes.

---

_End of implementation plan. Do not start implementation until explicitly approved._
