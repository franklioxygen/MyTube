# Directory Structure

```
mytube/
├── backend/             # Express.js backend (TypeScript)
│   ├── src/             # Source code
│   │   ├── config/      # Configuration files
│   │   ├── controllers/ # Route controllers
│   │   ├── db/          # Database migrations and setup
│   │   ├── routes/      # API routes
│   │   ├── scripts/     # Utility scripts
│   │   ├── services/    # Business logic services
│   │   ├── utils/       # Utility functions
│   │   ├── server.ts    # Main server file
│   │   └── version.ts   # Version information
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
│   │   ├── App.tsx      # Main application component
│   │   ├── main.tsx     # Application entry point
│   │   ├── theme.ts     # Theme configuration
│   │   ├── types.ts     # TypeScript type definitions
│   │   └── version.ts   # Version information
│   └── package.json     # Frontend dependencies
├── build-and-push.sh    # Docker build script
├── docker-compose.yml   # Docker Compose configuration
├── DEPLOYMENT.md        # Deployment guide
├── CONTRIBUTING.md      # Contributing guidelines
├── EXAMPLES.md          # Example usage and screenshots
├── RELEASING.md         # Release process guide
├── SECURITY.md          # Security policy
├── CODE_OF_CONDUCT.md   # Code of conduct
└── package.json         # Root package.json for running both apps
```
