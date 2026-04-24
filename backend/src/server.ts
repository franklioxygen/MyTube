// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config();

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "fs-extra";
import path from "path";
import { DATA_DIR } from "./config/paths";
import { runMigrations } from "./db/migrate";
import { errorHandler } from "./middleware/errorHandler";
import { rssManagementNoStoreHeaders } from "./middleware/rssManagementNoStoreHeaders";
import downloadManager from "./services/downloadManager";
import * as storageService from "./services/storageService";
import { logger } from "./utils/logger";
import { VERSION } from "./version";
import { csrfTokenProvider, csrfProtection } from "./middleware/csrfMiddleware";
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

const authLimiters = configureRateLimiting(app);
app.use(cors(buildCorsOptionsDelegate()));
app.use(cookieParser());
app.use(rssManagementNoStoreHeaders);
app.use(express.json({ limit: "100gb" }));
app.use(express.urlencoded({ extended: true, limit: "100gb" }));
app.use(csrfTokenProvider);
app.use(csrfProtection);

const configureProcessCrashReports = (): void => {
  if (!process.report) {
    return;
  }

  try {
    const reportDir = path.join(DATA_DIR, "crash-reports");
    fs.ensureDirSync(reportDir);
    process.report.directory = reportDir;
    process.report.compact = true;
    process.report.reportOnFatalError = true;
    process.report.reportOnUncaughtException = true;
    process.report.reportOnSignal = false;
    logger.info(`Node crash reports enabled: ${reportDir}`);
  } catch (error) {
    logger.warn("Failed to configure Node crash reports", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const startServer = async (): Promise<void> => {
  try {
    configureProcessCrashReports();
    await runMigrations();

    storageService.initializeStorage();
    downloadManager.initialize();

    const frontendDist = path.join(__dirname, "../../frontend/dist");

    registerStaticRoutes(app, frontendDist);
    registerCloudRoutes(app);
    registerApiRoutes(app, authLimiters);
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
