// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import path from "path";
import { runMigrations } from "./db/migrate";
import { errorHandler } from "./middleware/errorHandler";
import downloadManager from "./services/downloadManager";
import * as storageService from "./services/storageService";
import { logger } from "./utils/logger";
import { VERSION } from "./version";
import { registerApiRoutes } from "./server/apiRoutes";
import { buildCorsOptionsDelegate } from "./server/cors";
import { registerCloudRoutes } from "./server/cloudRoutes";
import { configureRateLimiting } from "./server/rateLimit";
import { registerSpaFallback, registerStaticRoutes } from "./server/staticRoutes";
import { startBackgroundJobs } from "./server/startupJobs";

VERSION.displayVersion();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5551;

app.set("trust proxy", 1);
app.disable("x-powered-by");

const authLimiter = configureRateLimiting(app);
app.use(cors(buildCorsOptionsDelegate()));
app.use(cookieParser());
app.use(express.json({ limit: "100gb" }));
app.use(express.urlencoded({ extended: true, limit: "100gb" }));

const startServer = async (): Promise<void> => {
  try {
    await runMigrations();

    storageService.initializeStorage();
    downloadManager.initialize();

    const frontendDist = path.join(__dirname, "../../frontend/dist");

    registerStaticRoutes(app, frontendDist);
    registerCloudRoutes(app);
    registerApiRoutes(app, authLimiter);
    registerSpaFallback(app, frontendDist);

    // Global error middleware (must be registered after routes)
    app.use(errorHandler);

    const HOST = process.env.HOST || "0.0.0.0";
    app.listen(PORT, HOST, () => {
      logger.info(`Server running on ${HOST}:${PORT}`);
      startBackgroundJobs(PORT);
    });
  } catch (error) {
    logger.error(
      "Failed to start server:",
      error instanceof Error ? error : new Error(String(error))
    );
    process.exit(1);
  }
};

void startServer();
