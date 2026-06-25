import { NextFunction, Request, Response } from "express";
import {
  getUserPayloadFromSession,
  verifyToken,
} from "../services/authService";
import { isLoginRequired } from "../services/passwordService";
import * as storageService from "../services/storageService";
import { getStringParam } from "../utils/paramUtils";

/**
 * Static media routes (videos, thumbnails, subtitles, cloud redirects) are
 * registered before the API auth stack, so without this guard they are reachable
 * by anyone even when login is enabled. The guard enforces video `visibility`:
 * media belonging only to hidden videos is served to admins only, while public
 * media stays reachable without a session (so RSS/podcast clients keep working).
 */

type MediaKind =
  | "videos"
  | "images"
  | "images-small"
  | "subtitles"
  | "cloud-video"
  | "cloud-image";

/**
 * Resolve whether the request carries a valid admin session/token. Mirrors the
 * resolution order in authMiddleware (session cookie first, then bearer JWT) but
 * only cares about admin because admins may access hidden media.
 */
const isAdminRequest = (req: Request): boolean => {
  const sessionId = req.cookies?.mytube_auth_session;
  if (sessionId) {
    const payload = getUserPayloadFromSession(sessionId);
    if (payload) {
      return payload.role === "admin";
    }
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const decoded = verifyToken(authHeader.split(" ")[1]);
    if (decoded) {
      return decoded.role === "admin";
    }
  }

  return false;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Build the storage classification query inputs for the requested media. Static
 * mounts strip their prefix from req.path, so it is re-added to reconstruct the
 * stored web path. Cloud routes carry the cloud filename as a route param.
 */
const classifyRequest = (
  kind: MediaKind,
  req: Request
): storageService.MediaVisibility => {
  switch (kind) {
    case "videos": {
      const webPath = `/videos${safeDecode(req.path)}`;
      return storageService.classifyMediaVisibility({ exactPaths: [webPath] });
    }
    case "images": {
      const webPath = `/images${safeDecode(req.path)}`;
      return storageService.classifyMediaVisibility({ exactPaths: [webPath] });
    }
    case "images-small": {
      // Small thumbnails mirror the original thumbnail, which may live under
      // either /images or /videos. Check both candidate originals.
      const sub = safeDecode(req.path);
      return storageService.classifyMediaVisibility({
        exactPaths: [`/images${sub}`, `/videos${sub}`],
      });
    }
    case "subtitles": {
      const webPath = `/subtitles${safeDecode(req.path)}`;
      return storageService.classifyMediaVisibility({
        subtitlePaths: [webPath],
      });
    }
    case "cloud-video": {
      const filename = getStringParam(req.params.filename) ?? "";
      return storageService.classifyMediaVisibility({
        exactPaths: [`cloud:${filename}`],
      });
    }
    case "cloud-image": {
      const filename = getStringParam(req.params.filename) ?? "";
      return storageService.classifyMediaVisibility({
        exactPaths: [`cloud:${filename}`],
      });
    }
    default:
      return "unknown";
  }
};

export const mediaVisibilityGuard =
  (kind: MediaKind) =>
  (req: Request, res: Response, next: NextFunction): void => {
    // Single-user mode: no roles, owner-equivalent access to everything.
    if (!isLoginRequired()) {
      next();
      return;
    }

    // Admins may always access hidden media.
    if (isAdminRequest(req)) {
      next();
      return;
    }

    // Visitors and unauthenticated callers: serve public/unknown media, but
    // never media that belongs solely to a hidden video.
    if (classifyRequest(kind, req) === "hidden") {
      res.status(404).send("Not Found");
      return;
    }

    next();
  };
