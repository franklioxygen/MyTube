# Getting Started

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher) or **yarn**
- **Python 3.8+** (for yt-dlp and PO Token provider)
- **yt-dlp** (installed via pip/pipx)
- **Docker** (optional, for containerized deployment)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/franklioxygen/mytube.git
cd mytube
```

### 2. Install Dependencies

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

**Note**: The backend installation will automatically build the `bgutil-ytdlp-pot-provider` server. However, you must ensure `yt-dlp` and the `bgutil-ytdlp-pot-provider` python plugin are installed in your environment:

```bash
# Install yt-dlp and the plugin
pip install yt-dlp bgutil-ytdlp-pot-provider

# OR using pipx (recommended for isolation)
pipx install yt-dlp
pipx inject yt-dlp bgutil-ytdlp-pot-provider
```

### 3. Configure Environment Variables

#### Backend Configuration

Create a `.env` file in the `backend/` directory:

```env
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
SUBTITLES_DIR=uploads/subtitles
DATA_DIR=data
MAX_FILE_SIZE=500000000
```

#### Frontend Configuration

Create a `.env` file in the `frontend/` directory:

```env
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
```

### 4. Database Setup

The application uses **SQLite** with **Drizzle ORM**. The database will be automatically created and migrated on first startup:

- Database location: `backend/data/mytube.db`
- Migrations are run automatically when the server starts
- If you have legacy JSON data, you can migrate it using the settings page or API endpoint

## Running the Application

### Development Mode

From the root directory, start both frontend and backend:

```bash
npm run dev
```

This will start:
- **Frontend**: http://localhost:5556 (Vite dev server with hot reload)
- **Backend API**: http://localhost:5551 (Express server with nodemon)

### Production Mode

Build and start in production mode:

```bash
# Build frontend
npm run build

# Start both services
npm run start
```

### Individual Services

You can also run services individually:

```bash
# Backend only
cd backend
npm run dev        # Development mode
npm run start      # Production mode

# Frontend only
cd frontend
npm run dev        # Development mode
npm run preview    # Preview production build
```

## Available Scripts

From the root directory:

```bash
npm run dev          # Start both frontend and backend in development mode
npm run start        # Start both frontend and backend in production mode
npm run build        # Build the frontend for production
npm run install:all  # Install dependencies for root, frontend, and backend
```

Backend-specific scripts (from `backend/` directory):

```bash
npm run dev          # Start backend with nodemon (auto-reload)
npm run start        # Start backend in production mode
npm run build        # Compile TypeScript to JavaScript
npm run test         # Run tests with Vitest
npm run test:coverage # Run tests with coverage report
npm run generate     # Generate database migrations with Drizzle Kit
```

Frontend-specific scripts (from `frontend/` directory):

```bash
npm run dev          # Start Vite dev server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run test         # Run tests with Vitest
```

## First-Time Setup

1. **Access the Application**: Open http://localhost:5556 in your browser

2. **Set Up Password Protection** (Optional):
   - Go to Settings → Security
   - Enable password protection and set a password

3. **Configure Download Settings**:
   - Go to Settings → Download Settings
   - Set concurrent download limit
   - Configure download quality preferences

4. **Upload Cookies** (Optional, for age-restricted/premium content):
   - Go to Settings → Cookie Settings
   - Upload your `cookies.txt` file

5. **Start Downloading**:
   - Enter a video URL in the download input
   - Supported platforms: YouTube, Bilibili, MissAV, and all yt-dlp supported sites

## Architecture Overview

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: SQLite with Drizzle ORM
- **Architecture**: Layered (Routes → Controllers → Services → Database)
- **Downloaders**: Abstract base class pattern for platform-specific implementations

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **UI Library**: Material-UI (MUI)
- **State Management**: React Context API
- **Routing**: React Router v7

### Key Features
- **Modular Storage Service**: Split into focused modules for maintainability
- **Download Queue Management**: Concurrent downloads with queue support
- **Video Download Tracking**: Prevents duplicate downloads
- **Subscription System**: Automatic downloads from subscribed channels
- **Database Migrations**: Automatic schema updates on startup

## Troubleshooting

### Database Issues
- If you encounter database errors, check that the `backend/data/` directory exists and is writable
- To reset the database, delete `backend/data/mytube.db` and restart the server

### Download Issues
- Ensure `yt-dlp` is installed and accessible in your PATH
- Check that the `bgutil-ytdlp-pot-provider` plugin is installed
- Verify network connectivity and firewall settings

### Port Conflicts
- If ports 5551 or 5556 are in use, modify the PORT environment variables
- Update frontend `VITE_API_URL` and `VITE_BACKEND_URL` accordingly

## Next Steps

- Read the [API Endpoints](api-endpoints.md) documentation
- Check the [Directory Structure](directory-structure.md) for code organization
- Review the [Docker Deployment Guide](docker-guide.md) for production deployment
