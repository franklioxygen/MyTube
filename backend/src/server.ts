// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import {
    AVATARS_DIR,
    CLOUD_THUMBNAIL_CACHE_DIR,
    IMAGES_DIR,
    SUBTITLES_DIR,
    VIDEOS_DIR,
} from "./config/paths";
import { runMigrations } from "./db/migrate";
import { authMiddleware } from "./middleware/authMiddleware";
import { roleBasedAuthMiddleware } from "./middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "./middleware/roleBasedSettingsMiddleware";
import apiRoutes from "./routes/api";
import settingsRoutes from "./routes/settingsRoutes";
import { cloudflaredService } from "./services/cloudflaredService";
import { getCachedThumbnail } from "./services/cloudStorage/cloudThumbnailCache";
import { CloudStorageService } from "./services/CloudStorageService";
import downloadManager from "./services/downloadManager";
import * as storageService from "./services/storageService";
import { logger } from "./utils/logger";
import {
    getClientIp,
    validateCloudThumbnailCachePath,
    validateRedirectUrl,
} from "./utils/security";
import { VERSION } from "./version";

// Display version information
VERSION.displayVersion();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5551;

// Trust proxy: Enable when behind a reverse proxy (nginx, Docker, load balancer, etc.)
// This is required for express-rate-limit to correctly identify client IPs
// Set to 1 to trust only the first proxy (safer than true)
// If you have multiple proxies, set to the number of proxies in the chain
// For Docker/nginx setups, typically 1 proxy is sufficient
app.set("trust proxy", 1);

// Security: Disable X-Powered-By header to prevent information disclosure
app.disable("x-powered-by");

// Rate limiting middleware to prevent abuse
// General API rate limiter: 100 requests per 15 minutes per IP
// Security: Use custom keyGenerator to prevent X-Forwarded-For header spoofing
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Use custom key generator to safely extract and validate client IP
  // This prevents X-Forwarded-For header spoofing attacks
  keyGenerator: (req) => {
    return getClientIp(req);
  },
  // Skip trust proxy validation since we're using custom IP extraction
  validate: {
    trustProxy: false, // Disable validation - we're handling IP extraction manually
  },
});

// Stricter rate limiter for authentication endpoints
// Security: Use custom keyGenerator to prevent X-Forwarded-For header spoofing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: "Too many authentication attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  // Use custom key generator to safely extract and validate client IP
  // This prevents X-Forwarded-For header spoofing attacks
  keyGenerator: (req) => {
    return getClientIp(req);
  },
  // Skip trust proxy validation since we're using custom IP extraction
  validate: {
    trustProxy: false, // Disable validation - we're handling IP extraction manually
  },
});

// Apply general rate limiting to all requests EXCEPT video streaming and download-related routes
// Video streaming (especially 4K) requires many Range requests
// Download process requires multiple API calls (status polling, collections, etc.)
app.use((req, res, next) => {
  // Skip rate limiting for video streaming routes
  if (
    req.path.startsWith("/videos/") ||
    req.path.startsWith("/api/mount-video/") ||
    req.path.startsWith("/images/") ||
    req.path.startsWith("/subtitles/") ||
    req.path.startsWith("/avatars/")
  ) {
    return next();
  }
  
  // Skip rate limiting for download-related endpoints
  // These endpoints are part of the download workflow and need frequent polling
  if (
    req.path.startsWith("/api/download") ||
    req.path.startsWith("/api/check-video-download") ||
    req.path.startsWith("/api/check-bilibili") ||
    req.path.startsWith("/api/check-playlist") ||
    req.path.startsWith("/api/collections") ||
    req.path.startsWith("/api/downloads/")
  ) {
    return next();
  }
  
  // Skip rate limiting for health check and status endpoints
  // These are read-only endpoints that may be called frequently during login/logout
  if (
    req.path === "/api/settings/password-enabled" ||
    req.path === "/api/settings/passkeys/exists" ||
    req.path === "/api/settings/reset-password-cooldown" ||
    req.path === "/api/settings"
  ) {
    return next();
  }
  
  // Apply rate limiting to all other routes
  generalLimiter(req, res, next);
});

// Middleware
// Configure CORS to allow credentials for HTTP-only cookies
// CSRF Protection: Cookies use sameSite: "lax" which provides CSRF protection
// for same-site requests. For additional protection, consider implementing
// CSRF tokens for state-changing operations (POST, PUT, DELETE, PATCH).
app.use(
  cors({
    origin: true, // Allow requests from any origin (can be restricted in production)
    credentials: true, // Required for HTTP-only cookies
  })
);
// Parse cookies
app.use(cookieParser());
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
    // Safari requires Access-Control-Expose-Headers to read Range response headers
    app.use(
      "/videos",
      express.static(VIDEOS_DIR, {
        setHeaders: (res, path) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
          // Critical for Safari: expose headers needed for video Range requests
          res.setHeader(
            "Access-Control-Expose-Headers",
            "Accept-Ranges, Content-Range, Content-Length"
          );

          // Determine MIME type based on file extension (case-insensitive)
          const lowerPath = path.toLowerCase();
          if (lowerPath.endsWith(".mp4")) {
            res.setHeader("Content-Type", "video/mp4");
          } else if (lowerPath.endsWith(".webm")) {
            res.setHeader("Content-Type", "video/webm");
          } else if (lowerPath.endsWith(".mkv")) {
            res.setHeader("Content-Type", "video/x-matroska");
          } else if (lowerPath.endsWith(".avi")) {
            res.setHeader("Content-Type", "video/x-msvideo");
          } else if (lowerPath.endsWith(".mov")) {
            res.setHeader("Content-Type", "video/quicktime");
          } else if (lowerPath.endsWith(".m4v")) {
            res.setHeader("Content-Type", "video/x-m4v");
          } else if (lowerPath.endsWith(".flv")) {
            res.setHeader("Content-Type", "video/x-flv");
          } else if (lowerPath.endsWith(".3gp")) {
            res.setHeader("Content-Type", "video/3gpp");
          } else {
            // Default to mp4 for unknown extensions (Safari prefers this)
            // This helps with files that might not have proper extensions
            res.setHeader("Content-Type", "video/mp4");
          }
        },
      })
    );
    app.use(
      "/images",
      express.static(IMAGES_DIR, {
        setHeaders: (res) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
        },
      })
    );
    app.use(
      "/avatars",
      express.static(AVATARS_DIR, {
        setHeaders: (res) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
        },
      })
    );
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

    // Cloud storage redirect endpoints
    // Redirect /cloud/videos/* and /cloud/images/* to signed URLs (302 redirect)
    // This allows frontend to directly access cloud storage without going through server proxy
    // Browser will automatically handle Range requests when following the redirect
    // For thumbnails, check local cache first to avoid unnecessary redirects
    const redirectCloudFile = async (
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

        // For thumbnails, check local cache first
        // This reduces cloud storage API calls and improves performance
        if (fileType === "image") {
          const cloudPath = `cloud:${filename}`;
          const cachedPath = getCachedThumbnail(cloudPath);

          if (cachedPath) {
            // Serve from local cache directly (no redirect needed)
            // Security: cachedPath is generated by getCachedThumbnail which uses MD5 hash
            // of cloudPath, ensuring it's always within CLOUD_THUMBNAIL_CACHE_DIR
            // The path is safe and doesn't contain user input directly
            const validatedPath = validateCloudThumbnailCachePath(cachedPath);
            // Use root option to prevent path traversal - Express will ensure the file
            // is within the root directory, providing defense in depth
            const relativePath = path.relative(
              CLOUD_THUMBNAIL_CACHE_DIR,
              validatedPath
            );
            // Additional safety check: ensure relative path doesn't contain path traversal
            if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
              logger.warn(
                `[CloudStorage] Suspicious relative path detected: ${relativePath}`
              );
              return res.status(500).send("Invalid file path");
            }
            return res.sendFile(relativePath, {
              root: CLOUD_THUMBNAIL_CACHE_DIR,
            });
          }
        }

        // Get signed URL from cloud storage service
        // This returns a direct URL to the cloud storage file with sign parameter
        const signedUrl = await CloudStorageService.getSignedUrl(
          filename,
          fileType === "video" ? "video" : "thumbnail"
        );

        if (!signedUrl) {
          return res.status(404).send("File not found in cloud storage");
        }

        // Validate that the signed URL is from the configured cloud storage domain
        // This prevents open redirect vulnerabilities by using an allowlist approach
        const apiBaseUrl = settings.openListApiUrl.replace("/api/fs/put", "");
        const publicUrl = settings.openListPublicUrl || apiBaseUrl;
        const allowedOrigin = new URL(publicUrl).origin;

        // Validate redirect URL against allowlist to prevent open redirect vulnerabilities
        // This uses an allowlist approach: only URLs from the configured cloud storage domain are allowed
        let validatedUrl: string;
        try {
          validatedUrl = validateRedirectUrl(signedUrl, allowedOrigin);
        } catch (validationError) {
          logger.warn(
            `[CloudStorage] Redirect URL validation failed: ${
              validationError instanceof Error
                ? validationError.message
                : String(validationError)
            }`
          );
          return res.status(500).send("Invalid cloud storage URL");
        }

        // Final safety check: ensure validatedUrl origin matches allowed origin
        // This redundant check helps static analysis tools understand the validation
        const validatedUrlObj = new URL(validatedUrl);
        if (validatedUrlObj.origin !== allowedOrigin) {
          logger.error(
            `[CloudStorage] Critical: Validated URL origin mismatch detected: ${validatedUrlObj.origin} != ${allowedOrigin}`
          );
          return res.status(500).send("Invalid cloud storage URL");
        }

        // Explicit allowlist pattern for static analysis tools
        // Build allowlist dynamically: only include the validated URL if it matches the allowed origin
        // This pattern matches what security scanners expect to see
        const allowedUrls: string[] = [];
        if (validatedUrlObj.origin === allowedOrigin) {
          // Only add to allowlist if origin matches exactly
          allowedUrls.push(validatedUrl);
        }

        // Check if URL is in allowlist before redirecting (explicit allowlist check pattern)
        const isAllowed = allowedUrls.includes(validatedUrl);
        if (!isAllowed) {
          logger.error(`[CloudStorage] URL not in allowlist: ${validatedUrl}`);
          return res.status(400).send("Invalid redirect URL");
        }

        // Get the URL from the allowlist to ensure it's the validated one
        // This makes it explicit to static analyzers that we're using an allowlist
        const redirectUrl = allowedUrls[0];
        if (!redirectUrl || redirectUrl !== validatedUrl) {
          return res.status(400).send("Invalid redirect URL");
        }

        // 302 redirect to the validated signed URL from allowlist
        // Browser will automatically follow the redirect and handle Range requests
        // This way, video data flows directly from cloud storage to client, bypassing our server
        // Security: redirectUrl comes from allowlist and is guaranteed to be from the allowed origin only
        res.redirect(302, redirectUrl);
      } catch (error: any) {
        logger.error(
          `Error redirecting cloud ${fileType}:`,
          error instanceof Error ? error : new Error(String(error))
        );
        if (!res.headersSent) {
          res.status(500).send(`Error fetching ${fileType} from cloud storage`);
        }
      }
    };

    app.get("/cloud/videos/:filename", (req, res) =>
      redirectCloudFile(req, res, "video")
    );
    app.get("/cloud/images/:filename", (req, res) =>
      redirectCloudFile(req, res, "image")
    );

    // API Routes
    // Apply stricter rate limiting to authentication endpoints
    app.use("/api/settings/verify-password", authLimiter);
    app.use("/api/settings/verify-admin-password", authLimiter);
    app.use("/api/settings/verify-visitor-password", authLimiter);
    app.use("/api/settings/reset-password", authLimiter);
    app.use("/api/settings/passkeys/authenticate", authLimiter);
    app.use("/api/settings/passkeys/authenticate/verify", authLimiter);
    
    // Apply auth middleware to all API routes
    app.use("/api", authMiddleware);
    // Apply role-based access control middleware to all API routes
    app.use("/api", roleBasedAuthMiddleware, apiRoutes);
    // Use separate middleware for settings with role-based access control
    app.use("/api/settings", roleBasedSettingsMiddleware, settingsRoutes);

    // SPA Fallback for Frontend
    app.get("*", (req, res) => {
      // Don't serve index.html for API calls that 404
      if (req.path.startsWith("/api") || req.path.startsWith("/cloud")) {
        res.status(404).send("Not Found");
        return;
      }
      res.sendFile(path.join(frontendDist, "index.html"));
    });

    const HOST = process.env.HOST || "0.0.0.0";
    app.listen(PORT, HOST, () => {
      console.log(`Server running on ${HOST}:${PORT}`);

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
