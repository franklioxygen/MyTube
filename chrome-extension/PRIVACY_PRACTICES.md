# Chrome Web Store - Privacy Practices Justifications

This document provides justifications for the permissions used in the MyTube Chrome Extension. Use these when filling out the Privacy practices tab in the Chrome Web Store Developer Dashboard.

## Permissions Justifications

### 1. activeTab Permission

**Justification:**
The extension uses the `activeTab` permission to access the current tab's URL when users click the "Download Current Page" button in the extension popup. This allows the extension to retrieve the video URL from the active tab so it can send it to the MyTube server for downloading. The permission is only activated when the user explicitly clicks the download button, ensuring user-initiated access.

**Use case:**

- User clicks the extension icon to open the popup
- User clicks "Download Current Page" button
- Extension reads the current tab's URL
- Extension sends the URL to the MyTube server

---

### 2. storage Permission

**Justification:**
The extension uses the `storage` permission to save the user's MyTube server URL configuration (e.g., `http://localhost:3000`) locally in the browser. This setting is stored using Chrome's sync storage API so users don't have to re-enter their server URL every time they use the extension. No personal information or browsing data is stored - only the server URL that the user explicitly provides in the extension's settings page.

**Use case:**

- User configures their MyTube server URL in the extension's options page
- Extension stores the URL locally for future use
- Extension retrieves the stored URL when making download requests

**Data stored:**

- Server URL (provided by user)
- No personal data, browsing history, or user content is stored

---

### 3. scripting Permission

**Justification:**
The extension uses the `scripting` permission (via `host_permissions`) to inject a content script that adds a floating download button on supported video websites (YouTube, Bilibili, MissAV). This button allows users to quickly download videos with one click. The content script only runs on video pages of supported sites and does not collect or transmit any user data - it only detects video URLs when the user clicks the download button.

**Use case:**

- Extension injects content script on supported video sites
- Content script adds a floating download button
- User clicks the button to download the current video
- The video URL is sent to the user's configured MyTube server

**Sites where content script runs:**

- YouTube (youtube.com, youtu.be)
- Bilibili (bilibili.com)
- MissAV (missav.com, 123av.com, and related domains)

---

### 4. host_permissions (<all_urls>)

**Justification:**
The extension requires host permissions to:

1. Inject content scripts on supported video websites (YouTube, Bilibili, MissAV) to add the floating download button
2. Communicate with the user's MyTube server (which can be hosted on any domain/port that the user configures)

The extension does NOT collect, transmit, or store data from visited websites. It only:

- Detects video URLs when the user explicitly clicks the download button
- Sends the video URL to the user's own MyTube server (which the user controls)
- Stores only the user's server URL configuration locally

**Use case:**

- Content script runs on supported video sites to add download buttons
- Extension communicates with user's configured MyTube server (which can be on any domain)
- All data is sent only to the user's own server, not to any third-party services

**Note:** The extension requires `<all_urls>` permission because users can configure their MyTube server to run on any URL (localhost, custom domains, different ports), and the extension needs to be able to communicate with that server.

---

### 5. Single Purpose Description

**Single Purpose:**
This extension allows users to download videos from supported websites (YouTube, Bilibili, MissAV, and all yt-dlp supported sites) to their own MyTube server with one click. Users configure their own MyTube server URL, and all downloads are sent only to their server. The extension does not collect, store, or transmit any personal data or browsing information to third parties.

**Summary:**

- **Purpose:** One-click video downloading to user's own MyTube server
- **No data collection:** Extension does not collect user data or browsing history
- **User-controlled:** All downloads go to the user's own configured server
- **Privacy-focused:** No third-party data transmission

---

## Data Usage Certification

**Certification Statement:**

I certify that this extension:

1. Does NOT collect any personal information from users
2. Does NOT transmit data to third-party services
3. Only stores the user's configured MyTube server URL locally (provided explicitly by the user)
4. Only sends video URLs to the user's own configured server when the user explicitly clicks a download button
5. Does NOT track user browsing behavior or collect analytics
6. Does NOT use any remote code execution - all code is bundled in the extension
7. Does NOT access user data beyond what is necessary for the extension's stated purpose (downloading videos to user's server)

**Data Flow:**

- User configures their MyTube server URL → Stored locally in browser
- User clicks download button → Extension sends video URL to user's server
- No data flows to third parties or external services

---

## How to Fill Out the Privacy Practices Tab

1. **Single Purpose:** Copy the "Single Purpose Description" above
2. **Permission Justifications:** Copy the justifications for each permission (activeTab, storage, scripting, host_permissions)
3. **Data Usage:** Select "No" for all data collection questions (the extension does not collect data)
4. **Data Handling:** State that the extension only stores the user's server URL locally and sends video URLs to the user's own server
5. **Certification:** Check the certification checkbox after reading the statement above

---

## Notes

### Remote Code Use Justification

**Important:** The extension loads translation files (locale files) dynamically at runtime. These translation files are bundled with the extension (in the `locales/` directory) and are loaded via script injection to set `window.currentTranslations` for internationalization support.

**Justification for Remote Code Use:**
The extension dynamically loads translation files from the bundled `locales/` directory to support multiple languages based on the user's browser language preference. These translation files:

- Are part of the extension package (bundled with the extension)
- Are NOT downloaded from external servers
- Only contain static translation strings (no executable code logic)
- Are loaded to provide localized text in the extension UI (popup, options page)

**Use case:**

- Extension detects user's browser language
- Extension loads appropriate translation file from bundled `locales/` directory
- Translation file sets translation strings for the UI
- Extension UI displays text in the user's preferred language

**Security:** All translation files are bundled with the extension and verified by the Chrome Web Store review process. No external code is fetched or executed.

### Other Notes

- The extension communicates with a remote server (the user's MyTube server), but this is user-configured and all communication is initiated by explicit user actions (clicking download buttons)
- For "remote code use" justification in the Chrome Web Store, explain that the extension loads bundled translation files dynamically for internationalization support
