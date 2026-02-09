import { Express, Request, Response } from "express";
import path from "path";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
} from "../config/paths";
import { cloudflaredService } from "../services/cloudflaredService";
import { getCachedThumbnail } from "../services/cloudStorage/cloudThumbnailCache";
import { CloudStorageService } from "../services/CloudStorageService";
import * as storageService from "../services/storageService";
import { logger } from "../utils/logger";
import {
  validateCloudThumbnailCachePath,
  validateRedirectUrl,
} from "../utils/security";

const redirectCloudFile = async (
  req: Request,
  res: Response,
  fileType: "video" | "image"
): Promise<void> => {
  try {
    const filename = req.params.filename;
    const settings = storageService.getSettings();

    if (
      !settings.cloudDriveEnabled ||
      !settings.openListApiUrl ||
      !settings.openListToken
    ) {
      res.status(404).send("Cloud storage not configured");
      return;
    }

    if (fileType === "image") {
      const cloudPath = `cloud:${filename}`;
      const cachedPath = getCachedThumbnail(cloudPath);

      if (cachedPath) {
        const validatedPath = validateCloudThumbnailCachePath(cachedPath);
        const relativePath = path.relative(
          CLOUD_THUMBNAIL_CACHE_DIR,
          validatedPath
        );

        if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
          logger.warn(
            `[CloudStorage] Suspicious relative path detected: ${relativePath}`
          );
          res.status(500).send("Invalid file path");
          return;
        }

        res.sendFile(relativePath, {
          root: CLOUD_THUMBNAIL_CACHE_DIR,
        });
        return;
      }
    }

    const signedUrl = await CloudStorageService.getSignedUrl(
      filename,
      fileType === "video" ? "video" : "thumbnail"
    );

    if (!signedUrl) {
      res.status(404).send("File not found in cloud storage");
      return;
    }

    const apiBaseUrl = settings.openListApiUrl.replace("/api/fs/put", "");
    const publicUrl = settings.openListPublicUrl || apiBaseUrl;
    const allowedOrigin = new URL(publicUrl).origin;

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
      res.status(500).send("Invalid cloud storage URL");
      return;
    }

    const validatedUrlObj = new URL(validatedUrl);
    if (validatedUrlObj.origin !== allowedOrigin) {
      logger.error(
        `[CloudStorage] Critical: Validated URL origin mismatch detected: ${validatedUrlObj.origin} != ${allowedOrigin}`
      );
      res.status(500).send("Invalid cloud storage URL");
      return;
    }

    const allowedUrls: string[] = [];
    if (validatedUrlObj.origin === allowedOrigin) {
      allowedUrls.push(validatedUrl);
    }

    if (!allowedUrls.includes(validatedUrl)) {
      logger.error(`[CloudStorage] URL not in allowlist: ${validatedUrl}`);
      res.status(400).send("Invalid redirect URL");
      return;
    }

    const redirectUrl = allowedUrls[0];
    if (!redirectUrl || redirectUrl !== validatedUrl) {
      res.status(400).send("Invalid redirect URL");
      return;
    }

    res.redirect(302, redirectUrl);
  } catch (error) {
    logger.error(
      `Error redirecting cloud ${fileType}:`,
      error instanceof Error ? error : new Error(String(error))
    );
    if (!res.headersSent) {
      res.status(500).send(`Error fetching ${fileType} from cloud storage`);
    }
  }
};

export const registerCloudRoutes = (app: Express): void => {
  app.get("/cloud/videos/:filename", (req, res) => {
    void redirectCloudFile(req, res, "video");
  });
  app.get("/cloud/images/:filename", (req, res) => {
    void redirectCloudFile(req, res, "image");
  });
};

export const startCloudflaredIfEnabled = (port: number): void => {
  const settings = storageService.getSettings();
  if (!settings.cloudflaredTunnelEnabled) {
    return;
  }

  if (settings.cloudflaredToken) {
    cloudflaredService.start(settings.cloudflaredToken);
    return;
  }

  cloudflaredService.start(undefined, port);
};
