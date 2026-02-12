import express, { Express } from "express";
import path from "path";
import {
  AVATARS_DIR,
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../config/paths";

export const registerStaticRoutes = (
  app: Express,
  frontendDist: string
): void => {
  app.use(
    "/videos",
    express.static(VIDEOS_DIR, {
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
