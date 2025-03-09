# MyTube

A YouTube/Bilibili video downloader and player application that allows you to download and save YouTube/Bilibili videos locally, along with their thumbnails. Organize your videos into collections for easy access and management.

## Features

- Download YouTube videos with a simple URL input
- Automatically save video thumbnails
- Browse and play downloaded videos
- View videos by specific authors
- Organize videos into collections
- Add or remove videos from collections
- Responsive design that works on all devices

## Directory Structure

```
mytube/
├── backend/             # Express.js backend
│   ├── uploads/         # Uploaded files directory
│   │   ├── videos/      # Downloaded videos
│   │   └── images/      # Downloaded thumbnails
│   └── server.js        # Main server file
├── frontend/            # React.js frontend
│   ├── src/             # Source code
│   │   ├── components/  # React components
│   │   └── pages/       # Page components
│   └── index.html       # HTML entry point
├── start.sh             # Unix/Mac startup script
├── start.bat            # Windows startup script
└── package.json         # Root package.json for running both apps
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository:

   ```
   git clone <repository-url>
   cd mytube
   ```

2. Install dependencies:

   ```
   npm run install:all
   ```

   This will install dependencies for the root project, frontend, and backend.

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

- `POST /api/download` - Download a YouTube video
- `GET /api/videos` - Get all downloaded videos
- `GET /api/videos/:id` - Get a specific video
- `DELETE /api/videos/:id` - Delete a video

## Collections Feature

MyTube allows you to organize your videos into collections:

- **Create Collections**: Create custom collections to categorize your videos
- **Add to Collections**: Add videos to collections directly from the video player
- **Remove from Collections**: Remove videos from collections with a single click
- **Browse Collections**: View all your collections in the sidebar and browse videos by collection
- **Note**: A video can only belong to one collection at a time

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
VITE_API_URL=http://{host}:{backend_port}/api
VITE_BACKEND_URL=http://{host}:{backend_port}
```

### Backend (.env file in backend directory)

```
PORT={backend_port}
```

Copy the `.env.example` files in both frontend and backend directories to create your own `.env` files and replace the placeholders with your desired values.

## License

MIT
