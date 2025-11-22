# MyTube

A YouTube/Bilibili video downloader and player application that allows you to download and save YouTube/Bilibili videos locally, along with their thumbnails. Organize your videos into collections for easy access and management.

[中文](README-zh.md)

![Nov-22-2025 13-56-10](https://github.com/user-attachments/assets/ee8e9f84-1597-4d4e-a238-8ea7d9e0f590)


## Features

- Download YouTube and Bilibili videos with a simple URL input
- Automatically save video thumbnails
- Browse and play downloaded videos
- View videos by specific authors
- Organize videos into collections
- Add videos to multiple collections
- Responsive design that works on all devices

## Directory Structure

```
mytube/
├── backend/             # Express.js backend
│   ├── src/             # Source code
│   │   ├── config/      # Configuration files
│   │   ├── controllers/ # Route controllers
│   │   ├── routes/      # API routes
│   │   ├── services/    # Business logic services
│   │   └── utils/       # Utility functions
│   ├── uploads/         # Uploaded files directory
│   │   ├── videos/      # Downloaded videos
│   │   └── images/      # Downloaded thumbnails
│   └── server.js        # Main server file
├── frontend/            # React.js frontend
│   ├── public/          # Static assets
│   ├── src/             # Source code
│   │   ├── assets/      # Images and styles
│   │   ├── components/  # React components
│   │   └── pages/       # Page components
│   └── index.html       # HTML entry point
├── start.sh             # Unix/Mac startup script
├── start.bat            # Windows startup script
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

   ```
   git clone <repository-url>
   cd mytube
   ```

2. Install dependencies:

   You can install all dependencies for the root, frontend, and backend with a single command:

   ```
   npm run install:all
   ```

   Or manually:

   ```
   npm install
   cd frontend && npm install
   cd ../backend && npm install
   ```

#### Using npm Scripts

Alternatively, you can use npm scripts:

```
npm run dev       # Start both frontend and backend in development mode
```

Other available scripts:

```
npm run start     # Start both frontend and backend in production mode
npm run build     # Build the frontend for production
```

### Accessing the Application

- Frontend: http://localhost:5556
- Backend API: http://localhost:5551

## API Endpoints

- `POST /api/download/youtube` - Download a YouTube video
- `POST /api/download/bilibili` - Download a Bilibili video
- `GET /api/videos` - Get all downloaded videos
- `GET /api/videos/:id` - Get a specific video
- `DELETE /api/videos/:id` - Delete a video
- `GET /api/collections` - Get all collections
- `POST /api/collections` - Create a new collection
- `PUT /api/collections/:id` - Update a collection
- `DELETE /api/collections/:id` - Delete a collection
- `POST /api/collections/:id/videos` - Add a video to a collection
- `DELETE /api/collections/:id/videos/:videoId` - Remove a video from a collection

## Collections Feature

MyTube allows you to organize your videos into collections:

- **Create Collections**: Create custom collections to categorize your videos
- **Add to Collections**: Add videos to one or more collections directly from the video player
- **Remove from Collections**: Remove videos from collections with a single click
- **Browse Collections**: View all your collections in the sidebar and browse videos by collection

## User Interface

The application features a modern, dark-themed UI with:

- Responsive design that works on desktop and mobile devices
- Video grid layout for easy browsing
- Video player with collection management
- Author and collection filtering
- Search functionality for finding videos

## Environment Variables

The application uses environment variables for configuration. Here's how to set them up:

### Frontend (.env file in frontend directory)

```
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
VITE_APP_PORT=5556
```

### Backend (.env file in backend directory)

```
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
MAX_FILE_SIZE=500000000
```

Copy the `.env.example` files in both frontend and backend directories to create your own `.env` files and replace the placeholders with your desired values.

## Deployment

For detailed instructions on how to deploy MyTube using Docker or on QNAP Container Station, please refer to [DEPLOYMENT.md](DEPLOYMENT.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right)](https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right)

## License

MIT
