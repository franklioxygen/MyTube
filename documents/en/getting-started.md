# Getting Started

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Docker (optional, for containerized deployment)
- Python 3.8+ (for yt-dlp and PO Token provider)
- yt-dlp (installed via pip/pipx)

## Installation

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

    **Note**: The backend installation will automatically build the `bgutil-ytdlp-pot-provider` server. However, you must ensure `yt-dlp` and the `bgutil-ytdlp-pot-provider` python plugin are installed in your environment:

    ```bash
    # Install yt-dlp and the plugin
    pip install yt-dlp bgutil-ytdlp-pot-provider
    # OR using pipx (recommended)
    pipx install yt-dlp
    pipx inject yt-dlp bgutil-ytdlp-pot-provider
    ```

### Using npm Scripts

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

## Accessing the Application

- Frontend: http://localhost:5556
- Backend API: http://localhost:5551
