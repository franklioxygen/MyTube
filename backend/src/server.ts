// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import express from "express";
import { IMAGES_DIR, VIDEOS_DIR } from "./config/paths";
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
storageService.initializeStorage();

// Run database migrations
import { runMigrations } from "./db/migrate";
runMigrations();

// Initialize download manager (restore queued tasks)
downloadManager.initialize();

// Serve static files
app.use("/videos", express.static(VIDEOS_DIR));
app.use("/images", express.static(IMAGES_DIR));

// API Routes
app.use("/api", apiRoutes);
app.use('/api/settings', settingsRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Run duration backfill in background
  import("./services/metadataService").then(service => {
    service.backfillDurations();
  }).catch(err => console.error("Failed to start metadata service:", err));
});

