# Chrome Extension

The project includes a Chrome Extension for easier downloading.

## Features
- One-click download button on video websites.
- "Download Current Page" button for all other supported sites.
- Connection testing to verify server accessibility.

## Installation

### Quick Install (Recommended)
1. Download the [mytube-extension-v1.0.2.zip](../../chrome-extension/mytube-extension-v1.0.2.zip) file.
2. Unzip the file to a folder.
3. Open Chrome and navigate to `chrome://extensions/`.
4. Enable "Developer mode" (toggle in the top right).
5. Click "Load unpacked".
6. Select the folder where you unzipped the extension.
7. The extension should now be installed!

### From Source
1. Navigate to the `chrome-extension` directory.
2. Install dependencies and build:
   ```bash
   cd chrome-extension
   npm install
   npm run build
   ```
3. Open Chrome and navigate to `chrome://extensions/`.
4. Enable "Developer mode".
5. Click "Load unpacked" and select the `chrome-extension` directory.

For more details, see [Chrome Extension Documentation](../../chrome-extension/README.md).
