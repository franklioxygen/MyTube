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
```

Data and uploads are stored under `backend/data` and `backend/uploads` by default (relative to the backend working directory).

#### Frontend Configuration

Create a `.env` file in the `frontend/` directory:

```env
VITE_API_URL=/api
VITE_BACKEND_URL=
```

`backend/.env.example` is provided. Copy it to `backend/.env` and adjust as needed. The frontend ships with `frontend/.env`; use `frontend/.env.local` to override defaults.

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

### Production Mode (Local)

Build and start in production mode:

```bash
# Build frontend
npm run build

# Start backend
cd backend
npm run start

# In another terminal, preview the frontend build
cd frontend
npm run preview
```

For Docker-based production, follow the [Docker Deployment Guide](docker-guide.md).

`npm run start` at the repo root is a convenience command that runs the backend start script and the frontend dev server together.

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
npm run start        # Start backend + frontend dev server (convenience)
npm run build        # Build the frontend for production
npm run install:all  # Install dependencies for root, frontend, and backend
npm run test         # Run frontend + backend tests
npm run test:frontend # Run frontend tests
npm run test:backend  # Run backend tests
```

Backend-specific scripts (from `backend/` directory):

```bash
npm run dev          # Start backend with nodemon (auto-reload)
npm run start        # Start backend in production mode
npm run build        # Compile TypeScript to JavaScript
npm run test         # Run tests with Vitest
npm run test:coverage # Run tests with coverage report
npm run generate     # Generate database migrations with Drizzle Kit
npm run reset-password # Reset admin password via script
```

Frontend-specific scripts (from `frontend/` directory):

```bash
npm run dev          # Start Vite dev server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run test         # Run tests with Vitest
npm run test:coverage # Run tests with coverage report
```

## First-Time Setup

1. **Access the Application**: Open http://localhost:5556 in your browser

2. **Set Up Login Protection** (Optional):

   - Go to Settings → Security
   - Enable login and set an admin password
   - Optionally register a passkey (WebAuthn)

3. **Configure Download Settings**:

   - Go to Settings → Download Settings
   - Set concurrent download limit
   - Configure download quality preferences

4. **Upload Cookies** (Optional, for age-restricted/premium content):

   - Go to Settings → Cookie Settings
   - Upload your `cookies.txt` file

5. **Configure Cloud Storage** (Optional):

   - Go to Settings → Cloud Drive Settings
   - Enable "Enable Auto Save to Cloud"
   - Enter your OpenList/Alist API URL (e.g., `https://your-alist-instance.com/api/fs/put`)
   - Enter your API token
   - Optionally set a public URL for direct file access
   - Set the upload path (e.g., `/mytube-uploads`)
   - Test the connection to verify settings
   - Note: When enabled, videos will be automatically uploaded to cloud storage after download, and local files will be deleted

6. **Configure Visitor User** (Optional):

   - Go to Settings → Security
   - Enable "Visitor User" to allow read-only access
   - Set a visitor password for the read-only role

7. **Start Downloading**:
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

### File Watcher Limit (ENOSPC Error)

If you encounter `ENOSPC: System limit for number of file watchers reached` when running the frontend dev server:

**Note:** The project's `vite.config.js` is already configured with polling-based file watching as a workaround, which should prevent this error in most cases. If you still encounter this issue, try the solutions below:

**On Linux (host system):**

```bash
# Check current limit
cat /proc/sys/fs/inotify/max_user_watches

# Increase the limit (temporary, until reboot)
sudo sysctl fs.inotify.max_user_watches=524288

# Make it permanent
echo "fs.inotify.max_user_watches=524288" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**In Docker:**
Add to your `docker-compose.yml` under the frontend service:

```yaml
services:
  frontend:
    sysctls:
      - fs.inotify.max_user_watches=524288
```

Or run the container with:

```bash
docker run --sysctl fs.inotify.max_user_watches=524288 ...
```

**Alternative: Configure Vite to use polling (already configured in this project):**

The `vite.config.js` file includes a watch configuration that uses polling instead of native file watchers, which bypasses the inotify limit entirely:

```js
server: {
  watch: {
    usePolling: true,
    interval: 2000,
    ignored: ['/node_modules/']
  }
}
```

This is already configured in the project, so the error should not occur. If you're using a custom Vite config, make sure to include this configuration.

## Next Steps

- Read the [API Endpoints](api-endpoints.md) documentation
- Check the [Directory Structure](directory-structure.md) for code organization
- Review the [Docker Deployment Guide](docker-guide.md) for production deployment
