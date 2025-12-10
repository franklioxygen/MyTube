// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import express from "express";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "./config/paths";
import { runMigrations } from "./db/migrate";
import apiRoutes from "./routes/api";
import settingsRoutes from "./routes/settingsRoutes";
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
// storageService.initializeStorage(); // Moved inside startServer

// Start the server
const startServer = async () => {
  try {
    // Run database migrations
    await runMigrations();

    // Initialize storage (create directories, etc.)
    storageService.initializeStorage();

    // Initialize download manager (restore queued tasks)
    downloadManager.initialize();

    // Serve static files with proper MIME types
    app.use(
      "/videos",
      express.static(VIDEOS_DIR, {
        setHeaders: (res, path) => {
          if (path.endsWith(".mp4")) {
            res.setHeader("Content-Type", "video/mp4");
          } else if (path.endsWith(".webm")) {
            res.setHeader("Content-Type", "video/webm");
          }
        },
      })
    );
    app.use("/images", express.static(IMAGES_DIR));
    app.use(
      "/subtitles",
      express.static(SUBTITLES_DIR, {
        setHeaders: (res, path) => {
          if (path.endsWith(".vtt")) {
            res.setHeader("Content-Type", "text/vtt");
            res.setHeader("Access-Control-Allow-Origin", "*");
          }
        },
      })
    );

    // API Routes
    app.use("/api", apiRoutes);
    app.use("/api/settings", settingsRoutes);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      // Start subscription scheduler
      import("./services/subscriptionService")
        .then(({ subscriptionService }) => {
          subscriptionService.startScheduler();
        })
        .catch((err) =>
          console.error("Failed to start subscription service:", err)
        );

      // Run duration backfill in background
      import("./services/metadataService")
        .then((service) => {
          service.backfillDurations();
        })
        .catch((err) =>
          console.error("Failed to start metadata service:", err)
        );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
