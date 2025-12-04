// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import express from "express";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "./config/paths";
import apiRoutes from "./routes/api";
import settingsRoutes from './routes/settingsRoutes';
import downloadManager from "./services/downloadManager";
import * as storageService from "./services/storageService";
import { VERSION } from "./version";

// Display version information
VERSION.displayVersion();

const app = express();
const PORT = process.env.PORT || 5551;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize storage (create directories, etc.)
// Initialize storage (create directories, etc.)
storageService.initializeStorage();

// Run database migrations
import { runMigrations } from "./db/migrate";

const startServer = async () => {
  try {
    // Run migrations before starting anything else
    await runMigrations();

    // Initialize download manager (restore queued tasks)
    // This must happen AFTER migrations to ensure tables exist
    downloadManager.initialize();

    // Serve static files
    app.use("/videos", express.static(VIDEOS_DIR));
    app.use("/images", express.static(IMAGES_DIR));
    app.use("/subtitles", express.static(SUBTITLES_DIR));

    // API Routes
    app.use("/api", apiRoutes);
    app.use('/api/settings', settingsRoutes);

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      
      // Start subscription scheduler
      import("./services/subscriptionService").then(({ subscriptionService }) => {
        subscriptionService.startScheduler();
      }).catch(err => console.error("Failed to start subscription service:", err));

      // Run duration backfill in background
      import("./services/metadataService").then(service => {
        service.backfillDurations();
      }).catch(err => console.error("Failed to start metadata service:", err));
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

