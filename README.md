# MyTube

Self-hosted downloader and player for YouTube, Bilibili, MissAV, and [yt-dlp sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md##). Features channel subscriptions, auto-downloads, and local storage for media. Organize your library into collections with a sleek UI. Includes built-in Cloudflare Tunnel support for secure remote access without port forwarding. Docker-ready deployment.

🚀 100% Prompt-Engineered. 0 Lines of Manual Code.

[![GitHub License](https://img.shields.io/github/license/franklioxygen/mytube)](https://github.com/franklioxygen/mytube)
![Docker Pulls](https://img.shields.io/docker/pulls/franklioxygen/mytube)
[![Discord](https://img.shields.io/badge/Discord-Join_Us-7289DA?logo=discord&logoColor=white)](https://discord.gg/dXn4u9kQGN)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/franklioxygen/MyTube/master.yml)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/266f0b53788f463a97230cb0c9d1d890)](https://app.codacy.com/gh/franklioxygen/MyTube/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)
[![GitHub Repo stars](https://img.shields.io/github/stars/franklioxygen/mytube)](https://github.com/franklioxygen/mytube)

[中文](README-zh.md) | [Changelog](CHANGELOG.md)

## Demo

🌐 **Try the live demo (read only): [https://mytube-demo.vercel.app](https://mytube-demo.vercel.app)**

[![Watch the video](https://img.youtube.com/vi/0_5ZpgsWTp0/maxresdefault.jpg)](https://www.youtube.com/watch?v=0_5ZpgsWTp0)

## Features

- **Video Downloading**: Download YouTube, Bilibili and MissAV videos with a simple URL input.
- **Video Upload**: Upload local video files directly to your library with automatic thumbnail generation.
- **TMDB Metadata Scraping**: Automatically scrape movie and TV show metadata (title, description, poster, director, year, rating) from TMDB based on filename. Supports localized content matching your site language.
- **Parallel Downloads**: Queue multiple downloads and track their progress simultaneously.
- **Batch Download**: Add multiple video URLs at once to the download queue.
- **Concurrent Download Limit**: Set a limit on the number of simultaneous downloads to manage bandwidth.
- **Cloud Storage Integration**: Automatically upload videos and thumbnails to cloud storage (OpenList/Alist) after download.
- **Auto Subtitles**: Automatically download YouTube / Bilibili default language subtitles.
- **Collections**: Organize videos into custom collections for easy access.
- **Subscriptions**: Manage subscriptions to channels or creators to automatically download new content.
- **Login Protection**: Secure your application with password login and optional passkeys (WebAuthn).
- **Visitor User**: Enable a read-only role for safe sharing without modification capabilities.
- **Internationalization**: Support for multiple languages including English, Chinese, Spanish, French, German, Japanese, Korean, Arabic, Portuguese, and Russian.
- **Mobile Optimizations**: Mobile-friendly tags menu and optimized layout for smaller screens.
- **Cookie Management**: Support for uploading `cookies.txt` to enable downloading of age-restricted or premium content.
- **yt-dlp Configuration**: Customize global `yt-dlp` arguments, network proxy, and other advanced settings via settings page.
- **TMDB Integration**: Configure your TMDB API key in settings to enable automatic metadata scraping for local video files. The scraper intelligently parses filenames to extract titles and matches them with TMDB database.
- **Cloudflare Tunnel Integration**: Built-in Cloudflare Tunnel support to easily expose your local MyTube instance to the internet without port forwarding.
- **Task Hooks**: Execute custom shell scripts at various stages of a download task (start, success, fail, cancel) for integration and automation. See [Task Hooks Guide](documents/en/hooks-guide.md).
- **Browser Extension**: A Chrome extension to download videos directly from your browser. Supports all yt-dlp supported sites.

## Browser Extension

For installation and usage instructions, please refer to [Browser Extension](documents/en/chrome-extension.md).


## Directory Structure

For a detailed breakdown of the project structure, please refer to [Directory Structure](documents/en/directory-structure.md).

## Getting Started

For installation and setup instructions, please refer to [Getting Started](documents/en/getting-started.md).

## API Endpoints

For a list of available API endpoints, please refer to [API Endpoints](documents/en/api-endpoints.md).

## Technology Stack

### Backend

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: SQLite with Drizzle ORM
- **Testing**: Vitest
- **Architecture**: Layered architecture (Routes → Controllers → Services → Database)

### Frontend

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **UI Library**: Material-UI (MUI)
- **State Management**: React Context API
- **Routing**: React Router v7
- **HTTP Client**: Axios with React Query

### Key Architectural Features

- **Modular Storage Service**: Split into focused modules for maintainability
- **Downloader Pattern**: Abstract base class for platform-specific implementations
- **Database Migrations**: Automatic schema updates using Drizzle Kit
- **Download Queue Management**: Concurrent downloads with queue support
- **Video Download Tracking**: Prevents duplicate downloads across sessions

## Environment Variables

The application uses environment variables for configuration.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=/api
VITE_BACKEND_URL=
```

### Backend (`backend/.env`)

```env
PORT=5551
```

Data and uploads are stored under `backend/data` and `backend/uploads` by default (relative to the backend working directory).

Copy `backend/.env.example` to `backend/.env` and adjust as needed. The frontend ships with `frontend/.env`; use `frontend/.env.local` to override defaults.

## Database

MyTube uses **SQLite** with **Drizzle ORM** for data persistence. The database is automatically created and migrated on first startup:

- **Location**: `backend/data/mytube.db`
- **Migrations**: Automatically run on server startup
- **Schema**: Managed through Drizzle Kit migrations
- **Legacy Support**: Migration tools available to convert from JSON-based storage

Key database tables:

- `videos`: Video metadata and file paths
- `collections`: Video collections/playlists
- `subscriptions`: Channel/creator subscriptions
- `downloads`: Active download queue
- `download_history`: Completed download history
- `video_downloads`: Tracks downloaded videos to prevent duplicates
- `settings`: Application configuration

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started, our development workflow, and code quality guidelines.

## Deployment

For detailed instructions on how to deploy MyTube using Docker, please refer to [Docker Deployment Guide](documents/en/docker-guide.md).

## Star History

<a href="https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right" />
 </picture>
</a>

## Disclaimer

- Purpose and Restrictions This software (including code and documentation) is intended solely for personal learning, research, and technical exchange. It is strictly prohibited to use this software for any commercial purposes or for any illegal activities that violate local laws and regulations.

- Liability The developer is unaware of and has no control over how users utilize this software. Any legal liabilities, disputes, or damages arising from the illegal or improper use of this software (including but not limited to copyright infringement) shall be borne solely by the user. The developer assumes no direct, indirect, or joint liability.

- Modifications and Distribution This project is open-source. Any individual or organization modifying or forking this code must comply with the open-source license. Important: If a third party modifies the code to bypass or remove the original user authentication/security mechanisms and distributes such versions, the modifier/distributor bears full responsibility for any consequences. We strongly discourage bypassing or tampering with any security verification mechanisms.

- Non-Profit Statement This is a completely free open-source project. The developer does not accept donations and has never published any donation pages. The software itself allows no charges and offers no paid services. Please be vigilant and beware of any scams or misleading information claiming to collect fees on behalf of this project.

## License

MIT
