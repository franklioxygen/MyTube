import express, { Express, Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import {
  AVATARS_DIR,
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  IMAGES_SMALL_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../config/paths";
import { authMiddleware } from "../middleware/authMiddleware";
import { requireAuthenticatedMediaAccess } from "../middleware/mediaAuthMiddleware";
import {
  ensureSmallThumbnailForRelativePath,
  getThumbnailRelativePath,
} from "../services/thumbnailMirrorService";
import {
  normalizeSafeAbsolutePath,
  resolveSafeChildPath,
} from "../utils/security";

// Media-serving routes were historically mounted before the API auth stack,
// leaving them fully unauthenticated (GHSA-rwwf-29mq-5j43). These two
// middlewares re-introduce the credential check for media access:
//  - authMiddleware: resolves req.user / req.apiKeyAuthenticated (does not block)
//  - requireAuthenticatedMediaAccess: enforces login when loginEnabled=true
const mediaAuthStack = [authMiddleware, requireAuthenticatedMediaAccess];

const setCommonImageHeaders = (res: Response): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
};

const IMAGE_MIME_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const getImageMimeType = (filePath: string): string | null =>
  IMAGE_MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? null;

const isReservedBackendPath = (requestPath: string): boolean =>
  requestPath.startsWith("/api") ||
  requestPath.startsWith("/cloud") ||
  requestPath.startsWith("/feed");

const isSingleSegmentRootFileRequest = (requestPath: string): boolean => {
  const segments = requestPath.split("/").filter(Boolean);
  return (
    segments.length === 1 && path.posix.extname(segments[0] ?? "") !== ""
  );
};

const resolveOriginalThumbnailAbsolutePath = async (
  relativePath: string,
): Promise<string | null> => {
  const candidates: string[] = [];

  for (const baseDir of [IMAGES_DIR, VIDEOS_DIR]) {
    try {
      candidates.push(resolveSafeChildPath(baseDir, relativePath));
    } catch {
      // Ignore traversal attempts and continue checking other managed roots.
    }
  }

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
};

const ensureSmallThumbnail = async (
  req: Request,
  res: Response,
  next: express.NextFunction,
): Promise<void> => {
  const wildcardPath = req.params["0"];
  const relativePath = getThumbnailRelativePath(
    typeof wildcardPath === "string" ? wildcardPath : req.path,
  );

  if (!relativePath) {
    res.status(400).send("Invalid image path");
    return;
  }

  try {
    await ensureSmallThumbnailForRelativePath(relativePath);
    next();
  } catch (error) {
    const fallbackAbsolutePath = await resolveOriginalThumbnailAbsolutePath(
      relativePath,
    );
    if (!fallbackAbsolutePath) {
      next(error);
      return;
    }

    setCommonImageHeaders(res);
    res.sendFile(fallbackAbsolutePath, (sendFileError?: Error | null) => {
      if (sendFileError != null) {
        next(sendFileError);
      }
    });
  }
};

export const registerStaticRoutes = (
  app: Express,
  frontendDist: string
): void => {
  const safeFrontendDist = normalizeSafeAbsolutePath(frontendDist);
  const safeFrontendAssetsDir = resolveSafeChildPath(safeFrontendDist, "assets");

  app.use(
    "/videos",
    ...mediaAuthStack,
    express.static(VIDEOS_DIR, {
      fallthrough: false,
      setHeaders: (res, filePath) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Accept-Ranges, Content-Range, Content-Length"
        );

        const lowerPath = filePath.toLowerCase();
        const imageMimeType = getImageMimeType(lowerPath);
        if (imageMimeType) {
          res.setHeader("Content-Type", imageMimeType);
        } else if (lowerPath.endsWith(".mp4")) {
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
        } else if (lowerPath.endsWith(".vtt")) {
          res.setHeader("Content-Type", "text/vtt");
        } else if (lowerPath.endsWith(".srt")) {
          res.setHeader("Content-Type", "application/x-subrip");
        } else if (lowerPath.endsWith(".ass") || lowerPath.endsWith(".ssa")) {
          res.setHeader("Content-Type", "text/x-ssa");
        } else {
          res.setHeader("Content-Type", "video/mp4");
        }
      },
    })
  );

  app.use(
    "/images",
    ...mediaAuthStack,
    express.static(IMAGES_DIR, {
      fallthrough: false,
      setHeaders: setCommonImageHeaders,
    })
  );

  app.get(
    "/images-small/*",
    ...mediaAuthStack,
    (req, res, next) => {
      void ensureSmallThumbnail(req, res, next);
    }
  );

  app.use(
    "/images-small",
    ...mediaAuthStack,
    express.static(IMAGES_SMALL_DIR, {
      fallthrough: false,
      setHeaders: setCommonImageHeaders,
    })
  );

  app.use(
    "/avatars",
    ...mediaAuthStack,
    express.static(AVATARS_DIR, {
      fallthrough: false,
      setHeaders: setCommonImageHeaders,
    })
  );

  app.use(
    "/api/cloud/thumbnail-cache",
    ...mediaAuthStack,
    express.static(CLOUD_THUMBNAIL_CACHE_DIR, {
      fallthrough: false,
    })
  );

  app.use(
    "/subtitles",
    ...mediaAuthStack,
    express.static(SUBTITLES_DIR, {
      fallthrough: false,
      setHeaders: (res, filePath) => {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".vtt")) {
          res.setHeader("Content-Type", "text/vtt");
          res.setHeader("Access-Control-Allow-Origin", "*");
        } else if (lower.endsWith(".srt")) {
          res.setHeader("Content-Type", "application/x-subrip");
          res.setHeader("Access-Control-Allow-Origin", "*");
        } else if (lower.endsWith(".ass") || lower.endsWith(".ssa")) {
          res.setHeader("Content-Type", "text/x-ssa");
          res.setHeader("Access-Control-Allow-Origin", "*");
        }
      },
    })
  );

  app.use(
    "/assets",
    express.static(safeFrontendAssetsDir, {
      fallthrough: false,
    })
  );

  app.use(express.static(safeFrontendDist));
};

export const registerSpaFallback = (
  app: Express,
  frontendDist: string
): void => {
  const safeFrontendDist = normalizeSafeAbsolutePath(frontendDist);

  app.get("*", (req, res) => {
    if (isReservedBackendPath(req.path)) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (isSingleSegmentRootFileRequest(req.path)) {
      res.status(404).send("Not Found");
      return;
    }

    res.sendFile("index.html", { root: safeFrontendDist });
  });
};
