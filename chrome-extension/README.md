# MyTube Downloader Chrome Extension

A Chrome extension that allows one-click downloading of videos from YouTube, Bilibili, MissAV, and **all yt-dlp supported sites** (see [yt-dlp supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)) to your MyTube server.

## Features

- ✨ One-click download button on supported video sites
- ⚙️ Easy server configuration in extension options
- 🔍 Connection testing to verify server accessibility
- 🎯 Supports YouTube, Bilibili, MissAV, and all yt-dlp supported sites
- 🚀 Works with both local and remote MyTube servers

## Installation

### From Source

1. Clone or download this repository
2. Navigate to the `chrome-extension` directory
3. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
4. Open Chrome and navigate to `chrome://extensions/`
5. Enable "Developer mode" (toggle in the top right)
6. Click "Load unpacked"
7. Select the `chrome-extension` directory
8. The extension should now be installed!

## Setup

1. Click the extension icon in your browser toolbar
2. Click "⚙️ Settings" button
3. Enter your MyTube server URL (e.g., `http://localhost:3000` or `https://your-server.com`)
4. Click "Test Connection" to verify the connection
5. Click "Save Settings"

## Usage

### Option 1: Download Button on Video Pages

When you visit a supported video site, a floating download button will appear in the bottom-right corner of the page. Simply click it to add the video to your MyTube download queue.

### Option 2: Extension Popup

1. Click the extension icon in your browser toolbar
2. Click "Download Current Page" to download the video from the current tab

## Supported Sites

The extension supports **all sites supported by yt-dlp** (see the [full list](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)), including:

- **YouTube** (youtube.com, youtu.be) - with floating download button
- **Bilibili** (bilibili.com) - with floating download button
- **MissAV** (missav.com, 123av.com) - with floating download button
- **All other yt-dlp supported sites** - via the extension popup ("Download Current Page" button)

Popular sites include but are not limited to: Vimeo, Dailymotion, Twitch, TikTok, Instagram, Facebook, Twitter/X, Reddit, SoundCloud, and hundreds more.

> **Note**: The floating download button appears on YouTube, Bilibili, and MissAV pages. For other sites, use the extension popup icon and click "Download Current Page".

## Icons

The extension requires icons in the `icons/` directory:

- `icon16.png` (16x16 pixels)
- `icon32.png` (32x32 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

You can create simple icons or use placeholder images. The icons should represent the MyTube downloader concept (e.g., a download arrow with a video icon).

## Development

### Building

This extension is written in TypeScript. To build it:

```bash
npm install
npm run build
```

This compiles the TypeScript files from `src/` to JavaScript files in the root directory.

### File Structure

```
chrome-extension/
├── src/                # TypeScript source files
│   ├── background.ts   # Service worker source
│   ├── content.ts      # Content script source
│   ├── popup.ts        # Popup script source
│   ├── options.ts      # Options page script source
│   ├── i18n.ts         # Internationalization utilities
│   └── types.ts        # Shared type definitions
├── manifest.json       # Extension manifest (Manifest V3)
├── background.js       # Compiled service worker (generated)
├── content.js          # Compiled content script (generated)
├── popup.html          # Extension popup HTML
├── popup.js            # Compiled popup script (generated)
├── popup.css           # Extension popup styles
├── options.html        # Options page HTML
├── options.js          # Compiled options script (generated)
├── options.css         # Options page styles
├── i18n.js             # Compiled i18n utilities (generated)
├── locales/            # Translation files
│   ├── en.js
│   ├── zh.js
│   └── ...
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # This file
```

### API Integration

The extension communicates with your MyTube server using the following endpoints:

- `GET /api/settings` - Used for connection testing
- `POST /api/download` - Used to queue video downloads
  - Request body: `{ youtubeUrl: string }`

## Troubleshooting

### Connection Failed

- Verify your MyTube server is running
- Check that the server URL is correct (including protocol: `http://` or `https://`)
- Ensure there are no firewall or CORS restrictions blocking the connection
- Try the "Test Connection" button in the options page

### Download Button Not Appearing

- Make sure you're on a supported video page (not just the homepage)
- For YouTube: Navigate to a video page (URL contains `?v=...`)
- For Bilibili: Navigate to a video page (URL contains `/video/`)
- For MissAV: Navigate to a video page (URL contains `/cn/` or `/ja/`)

### Downloads Not Queuing

- Verify the server connection is working (use "Test Connection")
- Check the browser console for any error messages
- Ensure your MyTube server is accessible from your network

## Packaging for Chrome Web Store

To create a zip file for Chrome Web Store submission:

```bash
npm run package
```

This will:

1. Build the TypeScript files to JavaScript
2. Create a zip file named `mytube-extension-v{version}.zip`
3. Include only the necessary files (manifest.json, compiled JS files, HTML, CSS, icons, locales)
4. Exclude development files (TypeScript sources, node_modules, etc.)

The zip file will be created in the `chrome-extension` directory and is ready to upload to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Manual Packaging

If you prefer to create the zip file manually:

1. Run `npm run build` to compile TypeScript files
2. Create a zip file containing:
   - `manifest.json`
   - All `.js`, `.html`, `.css` files (background.js, content.js, popup.js, popup.html, popup.css, options.js, options.html, options.css, i18n.js)
   - `icons/` directory (all icon files)
   - `locales/` directory (all translation files)
3. Do NOT include: `src/`, `node_modules/`, `package.json`, `.git/`, TypeScript files, or development files

## License

Same license as the main MyTube project.
