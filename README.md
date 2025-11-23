# MyTube

A YouTube/Bilibili video downloader and player application that allows you to download and save YouTube/Bilibili videos locally, along with their thumbnails. Organize your videos into collections for easy access and management.

[中文](README-zh.md)

![Nov-21-2025 16-53-03](https://github.com/user-attachments/assets/1f23ba18-da7a-4011-b716-6daa628552a5)

## Features

- **Video Downloading**: Download YouTube and Bilibili videos with a simple URL input.
- **Bilibili Support**: Support for downloading single videos, multi-part videos, and entire collections/series.
- **Parallel Downloads**: Queue multiple downloads and track their progress simultaneously.
- **Local Library**: Automatically save video thumbnails and metadata for a rich browsing experience.
- **Search**: Search for videos locally in your library or online via YouTube.
- **Collections**: Organize videos into custom collections for easy access.
- **Modern UI**: Responsive, dark-themed interface with a "Back to Home" feature and glassmorphism effects.
- **Theme Support**: Toggle between Light and Dark modes.

## Directory Structure

```
mytube/
├── backend/             # Express.js backend (TypeScript)
│   ├── src/             # Source code
│   │   ├── config/      # Configuration files
│   │   ├── controllers/ # Route controllers
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
│   │   ├── pages/       # Page components
│   │   └── theme.ts     # Theme configuration
│   └── package.json     # Frontend dependencies
├── build-and-push.sh    # Docker build script
├── docker-compose.yml   # Docker Compose configuration
├── DEPLOYMENT.md        # Deployment guide
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
```

### Accessing the Application

- Frontend: http://localhost:5556
- Backend API: http://localhost:5551

## API Endpoints

### Videos
- `POST /api/download` - Download a video (YouTube or Bilibili)
- `GET /api/videos` - Get all downloaded videos
- `GET /api/videos/:id` - Get a specific video
- `DELETE /api/videos/:id` - Delete a video
- `GET /api/search` - Search for videos online
- `GET /api/download-status` - Get status of active downloads
- `GET /api/check-bilibili-parts` - Check if a Bilibili video has multiple parts
- `GET /api/check-bilibili-collection` - Check if a Bilibili URL is a collection/series

### Collections
- `GET /api/collections` - Get all collections
- `POST /api/collections` - Create a new collection
- `PUT /api/collections/:id` - Update a collection (add/remove videos)
- `DELETE /api/collections/:id` - Delete a collection

## Collections Feature

MyTube allows you to organize your videos into collections:

- **Create Collections**: Create custom collections to categorize your videos.
- **Add to Collections**: Add videos to one or more collections directly from the video player or manage page.
- **Remove from Collections**: Remove videos from collections easily.
- **Browse Collections**: View all your collections in the sidebar and browse videos by collection.

## User Interface

The application features a modern, premium UI with:

- **Dark/Light Mode**: Toggle between themes to suit your preference.
- **Responsive Design**: Works seamlessly on desktop and mobile devices.
- **Video Grid**: Easy-to-browse grid layout for your video library.
- **Confirmation Modals**: Safe deletion with custom confirmation dialogs.
- **Search**: Integrated search bar for finding local and online content.

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

## Deployment

For detailed instructions on how to deploy MyTube using Docker or on QNAP Container Station, please refer to [DEPLOYMENT.md](DEPLOYMENT.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right)](https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right)

## License

MIT
