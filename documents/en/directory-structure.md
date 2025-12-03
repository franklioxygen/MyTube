# Directory Structure

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
