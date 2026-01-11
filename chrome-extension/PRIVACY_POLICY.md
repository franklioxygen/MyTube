# Privacy Policy for MyTube Downloader Chrome Extension

**Last Updated:** December 2024

## Introduction

MyTube Downloader ("the Extension") is a Chrome extension that allows users to download videos from supported websites to their own MyTube server. This Privacy Policy explains what data the Extension collects and how it is used.

## Data Collection

**The Extension does NOT collect, store, or transmit any personal information or user data.**

The Extension only stores the following information locally in your browser:

1. **MyTube Server URL**: The Extension stores the server URL that you explicitly configure in the extension's settings page (e.g., `http://localhost:3000`). This is stored locally in your browser using Chrome's sync storage API and is never transmitted to any third-party service.

## Data Usage

The Extension uses the stored server URL only to:

- Send video URLs to your configured MyTube server when you click a download button
- Test the connection to your server when you use the "Test Connection" feature

## Data Transmission

- **No data is transmitted to third-party services**
- **No data is transmitted to the Extension developer or any external servers**
- The Extension only communicates with your own MyTube server (which you configure)
- Video URLs are sent to your server only when you explicitly click a download button

## Data Storage

- All data is stored locally in your browser
- No data is stored on external servers
- The stored server URL is managed by Chrome's sync storage API
- You can delete the stored data at any time by clearing the extension's storage or uninstalling the extension

## Permissions

The Extension requires the following permissions:

1. **activeTab**: To access the current tab's URL when you click "Download Current Page" in the popup
2. **storage**: To store your MyTube server URL locally
3. **scripting**: To inject content scripts that add download buttons on supported video sites
4. **host_permissions**: To inject content scripts on supported video sites and communicate with your configured MyTube server

For detailed justifications of these permissions, see the Extension's privacy practices documentation.

## Third-Party Services

The Extension does not use any third-party analytics, tracking, or data collection services.

## Children's Privacy

The Extension does not knowingly collect any information from children. As the Extension does not collect any user data, this does not apply.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this policy.

## Contact

If you have any questions about this Privacy Policy, please contact us through the MyTube project repository or file an issue on the project's GitHub page.

## Summary

**The Extension does not collect, store, or transmit any personal information or user data. All data (the server URL you configure) is stored locally in your browser and is never shared with third parties.**
