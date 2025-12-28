// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import cors from "cors";
import express from "express";
import path from "path";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "./config/paths";
import { runMigrations } from "./db/migrate";
import { visitorModeMiddleware } from "./middleware/visitorModeMiddleware";
import { visitorModeSettingsMiddleware } from "./middleware/visitorModeSettingsMiddleware";
import apiRoutes from "./routes/api";
import settingsRoutes from "./routes/settingsRoutes";
import { cloudflaredService } from "./services/cloudflaredService";
import downloadManager from "./services/downloadManager";
import * as storageService from "./services/storageService";
import { logger } from "./utils/logger";
import { VERSION } from "./version";

// Display version information
VERSION.displayVersion();

const app = express();
const PORT = process.env.PORT || 5551;

// Security: Disable X-Powered-By header to prevent information disclosure
app.disable("x-powered-by");

// Middleware
app.use(cors());
// Increase body size limits for large file uploads (10GB)
app.use(express.json({ limit: "100gb" }));
app.use(express.urlencoded({ extended: true, limit: "100gb" }));

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
      "/api/cloud/thumbnail-cache",
      express.static(CLOUD_THUMBNAIL_CACHE_DIR)
    );
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

    // Serve Frontend Static Files
    const frontendDist = path.join(__dirname, "../../frontend/dist");
    app.use(express.static(frontendDist));

    // Cloud storage proxy endpoints
    // Proxy /cloud/videos/* and /cloud/images/* to Alist API
    const proxyCloudFile = async (
      req: express.Request,
      res: express.Response,
      fileType: "video" | "image"
    ) => {
      try {
        const { filename } = req.params;
        const settings = storageService.getSettings();

        if (
          !settings.cloudDriveEnabled ||
          !settings.openListApiUrl ||
          !settings.openListToken
        ) {
          return res.status(404).send("Cloud storage not configured");
        }

        // Construct Alist API URL for file download
        const apiBaseUrl = settings.openListApiUrl.replace("/api/fs/put", "");
        const uploadPath = (settings.cloudDrivePath || "/").replace(/\\/g, "/");
        const normalizedPath = uploadPath.endsWith("/")
          ? `${uploadPath}${filename}`
          : `${uploadPath}/${filename}`;
        const filePath = normalizedPath.startsWith("/")
          ? normalizedPath
          : `/${normalizedPath}`;

        // Alist API endpoint for getting file: /api/fs/get (POST with JSON body)
        const alistUrl = `${apiBaseUrl}/api/fs/get`;

        // Handle range requests for video streaming
        const range = req.headers.range;
        const headers: any = {
          Authorization: settings.openListToken,
        };

        if (range) {
          headers.Range = range;
        }

        // Make request to Alist API (POST method with path in body)
        const response = await axios.post(
          alistUrl,
          { path: filePath },
          {
            headers: headers,
            responseType: "stream",
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
          }
        );

        // Set appropriate content type
        const ext = filename.split(".").pop()?.toLowerCase();
        if (fileType === "video") {
          if (ext === "mp4") {
            res.setHeader("Content-Type", "video/mp4");
          } else if (ext === "webm") {
            res.setHeader("Content-Type", "video/webm");
          } else if (ext === "mkv") {
            res.setHeader("Content-Type", "video/x-matroska");
          } else {
            res.setHeader("Content-Type", "application/octet-stream");
          }
          // Support range requests for video streaming
          // Always advertise byte range support for videos
          res.setHeader("Accept-Ranges", "bytes");
          
          if (range && response.headers["content-range"]) {
            res.setHeader("Content-Range", response.headers["content-range"]);
            res.status(206); // Partial Content
          }
        } else {
          // Image
          if (ext === "jpg" || ext === "jpeg") {
            res.setHeader("Content-Type", "image/jpeg");
          } else if (ext === "png") {
            res.setHeader("Content-Type", "image/png");
          } else if (ext === "gif") {
            res.setHeader("Content-Type", "image/gif");
          } else {
            res.setHeader("Content-Type", "image/jpeg");
          }
        }

        // Set content length if available
        if (response.headers["content-length"]) {
          res.setHeader("Content-Length", response.headers["content-length"]);
        }

        // Stream the file to client with cleanup
        const stream = response.data;
        
        // Handle client disconnect - destroy upstream stream to prevent memory leaks
        res.on("close", () => {
          if (stream.destroy) {
            stream.destroy();
          }
        });

        stream.pipe(res);

        stream.on("error", (err: Error) => {
          // Only log if it's not a client disconnect (ECONNRESET)
          if ((err as any).code !== "ECONNRESET") {
             logger.error("Error streaming cloud file:", err);
          }
          
          if (!res.headersSent) {
            res.status(500).send("Error streaming file from cloud storage");
          }
        });
      } catch (error: any) {
        logger.error(
          `Error proxying cloud ${fileType}:`,
          error instanceof Error ? error : new Error(String(error))
        );
        if (!res.headersSent) {
          res.status(500).send(`Error fetching ${fileType} from cloud storage`);
        }
      }
    };

    app.get("/cloud/videos/:filename", (req, res) =>
      proxyCloudFile(req, res, "video")
    );
    app.get("/cloud/images/:filename", (req, res) =>
      proxyCloudFile(req, res, "image")
    );

    // API Routes
    // Apply visitor mode middleware to all API routes
    app.use("/api", visitorModeMiddleware, apiRoutes);
    // Use separate middleware for settings that allows disabling visitor mode
    app.use("/api/settings", visitorModeSettingsMiddleware, settingsRoutes);

    // SPA Fallback for Frontend
    app.get("*", (req, res) => {
      // Don't serve index.html for API calls that 404
      if (req.path.startsWith("/api") || req.path.startsWith("/cloud")) {
        res.status(404).send("Not Found");
        return;
      }
      res.sendFile(path.join(frontendDist, "index.html"));
    });

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

      // Start Cloudflared tunnel if enabled
      const settings = storageService.getSettings();
      if (settings.cloudflaredTunnelEnabled) {
        if (settings.cloudflaredToken) {
          cloudflaredService.start(settings.cloudflaredToken);
        } else {
          // Quick Tunnel
          const port = typeof PORT === "string" ? parseInt(PORT) : PORT;
          cloudflaredService.start(undefined, port);
        }
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
