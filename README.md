# MyTube

A YouTube/Bilibili/MissAV video downloader and player that supports channel subscriptions and auto-downloads, allowing you to save videos and thumbnails locally. Organize your videos into collections for easy access and management. Now supports [yt-dlp sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md##), including Weibo, Xiaohongshu, X.com, etc.

[中文](README-zh.md)

## Demo

🌐 **Try the live demo (read only): [https://mytube-demo.vercel.app](https://mytube-demo.vercel.app)**

![Nov-23-2025 21-19-25](https://github.com/user-attachments/assets/0f8761c9-893d-48df-8add-47f3f19357df)


## Features

- **Video Downloading**: Download YouTube, Bilibili and MissAV videos with a simple URL input.
- **Video Upload**: Upload local video files directly to your library with automatic thumbnail generation.
- **Bilibili Support**: Support for downloading single videos, multi-part videos, and entire collections/series.
- **Parallel Downloads**: Queue multiple downloads and track their progress simultaneously.
- **Batch Download**: Add multiple video URLs at once to the download queue.
- **Concurrent Download Limit**: Set a limit on the number of simultaneous downloads to manage bandwidth.
- **Local Library**: Automatically save video thumbnails and metadata for a rich browsing experience.
- **Video Player**: Custom player with Play/Pause, Loop, Seek, Full-screen, and Dimming controls.
- **Search**: Search for videos locally in your library or online via YouTube.
- **Collections**: Organize videos into custom collections for easy access.
- **Modern UI**: Responsive, dark-themed interface with a "Back to Home" feature and glassmorphism effects.
- **Theme Support**: Toggle between Light and Dark modes with smooth transitions.
- **Login Protection**: Secure your application with a password login page.
- **Internationalization**: Support for multiple languages including English, Chinese, Spanish, French, German, Japanese, Korean, Arabic, and Portuguese.
- **Pagination**: Efficiently browse large libraries with pagination support.
- **Subscriptions**: Manage subscriptions to channels or creators to automatically download new content.
- **Video Rating**: Rate your videos with a 5-star system.
- **Mobile Optimizations**: Mobile-friendly tags menu and optimized layout for smaller screens.
- **Temp Files Cleanup**: Manage storage by cleaning up temporary download files directly from settings.
- **View Modes**: Toggle between Collection View and Video View on the home page.

## Directory Structure

```
mytube/
├── backend/             # Express.js backend (TypeScript)
│   ├── src/             # Source code
│   │   ├── config/      # Configuration files
│   │   ├── controllers/ # Route controllers
│   │   ├── db/          # Database migrations and setup
│   │   ├── routes/      # API routes
│   │   ├── services/    # Business logic services
│   │   ├── utils/       # Utility functions
│   │   └── server.ts    # Main server file
│   ├── uploads/         # Uploaded files directory
│   │   ├── videos/      # Downloaded videos
│   │   └── images/      # Downloaded thumbnails
│   └── package.json     # Backend dependencies
├── frontend/            # React.js frontend (Vite + TypeScript)
│   ├── src/             # Source code
│   │   ├── assets/      # Images and styles
│   │   ├── components/  # React components
│   │   ├── contexts/    # React contexts
│   │   ├── pages/       # Page components
│   │   ├── utils/       # Utilities and locales
│   │   └── theme.ts     # Theme configuration
│   └── package.json     # Frontend dependencies
├── build-and-push.sh    # Docker build script
├── docker-compose.yml   # Docker Compose configuration
├── DEPLOYMENT.md        # Deployment guide
├── CONTRIBUTING.md      # Contributing guidelines
└── package.json         # Root package.json for running both apps
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Docker (optional, for containerized deployment)

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd mytube
   ```

2. Install dependencies:

   You can install all dependencies for the root, frontend, and backend with a single command:

   ```bash
   npm run install:all
   ```

   Or manually:

   ```bash
   npm install
   cd frontend && npm install
   cd ../backend && npm install
   ```

#### Using npm Scripts

You can use npm scripts from the root directory:

```bash
npm run dev       # Start both frontend and backend in development mode
```

Other available scripts:

```bash
npm run start     # Start both frontend and backend in production mode
npm run build     # Build the frontend for production
npm run lint      # Run linting for frontend
npm run lint:fix  # Fix linting errors for frontend
```

### Accessing the Application

- Frontend: http://localhost:5556
- Backend API: http://localhost:5551

## API Endpoints

### Videos
- `POST /api/download` - Download a video (YouTube or Bilibili)
- `POST /api/upload` - Upload a local video file
- `GET /api/videos` - Get all downloaded videos
- `GET /api/videos/:id` - Get a specific video
- `PUT /api/videos/:id` - Update video details
- `DELETE /api/videos/:id` - Delete a video
- `GET /api/videos/:id/comments` - Get video comments
- `POST /api/videos/:id/rate` - Rate a video
- `POST /api/videos/:id/refresh-thumbnail` - Refresh video thumbnail
- `POST /api/videos/:id/view` - Increment view count
- `PUT /api/videos/:id/progress` - Update playback progress
- `GET /api/search` - Search for videos online
- `GET /api/download-status` - Get status of active downloads
- `GET /api/check-bilibili-parts` - Check if a Bilibili video has multiple parts
- `GET /api/check-bilibili-collection` - Check if a Bilibili URL is a collection/series

### Download Management
- `POST /api/downloads/cancel/:id` - Cancel a download
- `DELETE /api/downloads/queue/:id` - Remove from queue
- `DELETE /api/downloads/queue` - Clear queue
- `GET /api/downloads/history` - Get download history
- `DELETE /api/downloads/history/:id` - Remove from history
- `DELETE /api/downloads/history` - Clear history

### Collections
- `GET /api/collections` - Get all collections
- `POST /api/collections` - Create a new collection
- `PUT /api/collections/:id` - Update a collection (add/remove videos)
- `DELETE /api/collections/:id` - Delete a collection

### Subscriptions
- `GET /api/subscriptions` - Get all subscriptions
- `POST /api/subscriptions` - Create a new subscription
- `DELETE /api/subscriptions/:id` - Delete a subscription

### Settings & System
- `GET /api/settings` - Get application settings
- `POST /api/settings` - Update application settings
- `POST /api/settings/verify-password` - Verify login password
- `POST /api/settings/migrate` - Migrate data from JSON to SQLite
- `POST /api/settings/delete-legacy` - Delete legacy JSON data
- `POST /api/scan-files` - Scan for existing files
- `POST /api/cleanup-temp-files` - Cleanup temporary download files

## Collections Feature

MyTube allows you to organize your videos into collections:

- **Create Collections**: Create custom collections to categorize your videos.
- **Add to Collections**: Add videos to one or more collections directly from the video player or manage page.
- **Remove from Collections**: Remove videos from collections easily.
- **Browse Collections**: View all your collections in the sidebar and browse videos by collection.
- **Delete Options**: Choose to delete just the collection grouping or delete the collection along with all its video files from the disk.

## Data Migration

MyTube now uses a SQLite database for better performance and reliability. If you are upgrading from an older version that used JSON files:

1. Go to **Settings**.
2. Scroll down to the **Database** section.
3. Click **Migrate Data from JSON**.
4. The tool will import your existing videos, collections, and download history into the new database.

## User Interface

The application features a modern, premium UI with:

- **Dark/Light Mode**: Toggle between themes to suit your preference.
- **Responsive Design**: Works seamlessly on desktop and mobile devices, with mobile-specific optimizations.
- **Video Grid**: Easy-to-browse grid layout for your video library.
- **Confirmation Modals**: Safe deletion with custom confirmation dialogs.
- **Search**: Integrated search bar for finding local and online content.
- **Snackbar Notifications**: Visual feedback for actions like adding/removing videos.

## Environment Variables

The application uses environment variables for configuration.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
```

### Backend (`backend/.env`)

```env
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
MAX_FILE_SIZE=500000000
```

Copy the `.env.example` files in both frontend and backend directories to create your own `.env` files.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started, our development workflow, and code quality guidelines.

## Deployment

For detailed instructions on how to deploy MyTube using Docker or on QNAP Container Station, please refer to [DEPLOYMENT.md](DEPLOYMENT.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right)](https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right)

## Disclaimer

 - Purpose and Restrictions This software (including code and documentation) is intended solely for personal learning, research, and technical exchange. It is strictly prohibited to use this software for any commercial purposes or for any illegal activities that violate local laws and regulations.

 - Liability The developer is unaware of and has no control over how users utilize this software. Any legal liabilities, disputes, or damages arising from the illegal or improper use of this software (including but not limited to copyright infringement) shall be borne solely by the user. The developer assumes no direct, indirect, or joint liability.

 - Modifications and Distribution This project is open-source. Any individual or organization modifying or forking this code must comply with the open-source license. Important: If a third party modifies the code to bypass or remove the original user authentication/security mechanisms and distributes such versions, the modifier/distributor bears full responsibility for any consequences. We strongly discourage bypassing or tampering with any security verification mechanisms.

 - Non-Profit Statement This is a completely free open-source project. The developer does not accept donations and has never published any donation pages. The software itself allows no charges and offers no paid services. Please be vigilant and beware of any scams or misleading information claiming to collect fees on behalf of this project.

## License

MIT
