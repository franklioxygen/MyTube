import express, { Express, NextFunction, Request, Response } from "express";
import fs from "fs-extra";
import { Jimp } from "jimp";
import path from "path";
import {
  AVATARS_DIR,
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../config/paths";
import { resolveRealPath, statPath } from "../utils/fileSystemAccess";

const DEFAULT_RESPONSIVE_IMAGE_QUALITY = 72;
const MAX_RESPONSIVE_IMAGE_WIDTH = 1600;
const MIN_RESPONSIVE_IMAGE_WIDTH = 64;
const IMAGE_ROOT_PATH = path.resolve(IMAGES_DIR);

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const isOptimizableThumbnail = (filePath: string): boolean =>
  /\.(jpe?g)$/i.test(filePath);

const isPathInsideImageRoot = (candidatePath: string): boolean => {
  const relativePath = path.relative(IMAGE_ROOT_PATH, candidatePath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

const resolveResponsiveImageCandidatePath = (
  requestPath: string,
): string | null => {
  const relativeImagePath = requestPath.startsWith("/images/")
    ? requestPath.replace(/^\/images\/+/, "")
    : requestPath;
  if (!relativeImagePath) {
    return null;
  }

  const normalizedSegments = relativeImagePath.replace(/\\/g, "/").split("/");
  if (
    normalizedSegments.some((segment) => {
      return segment === "." || segment === ".." || segment.includes("\0");
    })
  ) {
    return null;
  }

  const safeSegments = normalizedSegments
    .map((segment) => path.basename(segment))
    .filter((segment) => segment.length > 0);
  if (safeSegments.length === 0) {
    return null;
  }

  const candidatePath = path.resolve(IMAGE_ROOT_PATH, ...safeSegments);
  if (!isPathInsideImageRoot(candidatePath)) {
    return null;
  }

  return candidatePath;
};

const serveResponsiveImage = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const requestedWidth = parsePositiveInteger(
    Array.isArray(req.query.w) ? req.query.w[0] : req.query.w,
  );
  const requestedQuality = parsePositiveInteger(
    Array.isArray(req.query.q) ? req.query.q[0] : req.query.q,
  );

  if (!requestedWidth && !requestedQuality) {
    next();
    return;
  }

  const wildcardImagePath = req.params?.["0"];
  const candidateImagePath = resolveResponsiveImageCandidatePath(
    typeof wildcardImagePath === "string" ? wildcardImagePath : req.path,
  );
  if (!candidateImagePath) {
    res.status(400).send("Invalid image path");
    return;
  }

  if (
    !isOptimizableThumbnail(candidateImagePath) ||
    !(await fs.pathExists(candidateImagePath))
  ) {
    next();
    return;
  }

  let absoluteImagePath: string;
  try {
    absoluteImagePath = await resolveRealPath(candidateImagePath, [IMAGES_DIR]);

    if (!isPathInsideImageRoot(absoluteImagePath)) {
      res.status(400).send("Invalid image path");
      return;
    }

    const imageStats = await statPath(absoluteImagePath, [IMAGES_DIR]);
    if (!imageStats.isFile()) {
      next();
      return;
    }
  } catch {
    next();
    return;
  }

  const targetWidth = requestedWidth
    ? clamp(requestedWidth, MIN_RESPONSIVE_IMAGE_WIDTH, MAX_RESPONSIVE_IMAGE_WIDTH)
    : null;
  const targetQuality = clamp(
    requestedQuality ?? DEFAULT_RESPONSIVE_IMAGE_QUALITY,
    40,
    90,
  );

  try {
    const image = await Jimp.read(absoluteImagePath);

    if (targetWidth && image.bitmap.width > targetWidth) {
      image.scaleToFit({ w: targetWidth, h: image.bitmap.height });
    }

    const imageBuffer = await image.getBuffer("image/jpeg", {
      quality: targetQuality,
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(imageBuffer);
  } catch {
    next();
  }
};

export const registerStaticRoutes = (
  app: Express,
  frontendDist: string
): void => {
  app.use(
    "/videos",
    express.static(VIDEOS_DIR, {
      fallthrough: false,
      setHeaders: (res, filePath) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Accept-Ranges, Content-Range, Content-Length"
        );

        const lowerPath = filePath.toLowerCase();
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

  app.get("/images/*", (req, res, next) => {
    void serveResponsiveImage(req, res, next);
  });

  app.use(
    "/images",
    express.static(IMAGES_DIR, {
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    })
  );

  app.use(
    "/avatars",
    express.static(AVATARS_DIR, {
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    })
  );

  app.use(
    "/api/cloud/thumbnail-cache",
    express.static(CLOUD_THUMBNAIL_CACHE_DIR, {
      fallthrough: false,
    })
  );

  app.use(
    "/subtitles",
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
    express.static(path.join(frontendDist, "assets"), {
      fallthrough: false,
    })
  );

  app.use(express.static(frontendDist));
};

export const registerSpaFallback = (
  app: Express,
  frontendDist: string
): void => {
  const safeFrontendDist = path.resolve(frontendDist);

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/cloud")) {
      res.status(404).send("Not Found");
      return;
    }

    res.sendFile("index.html", { root: safeFrontendDist });
  });
};
