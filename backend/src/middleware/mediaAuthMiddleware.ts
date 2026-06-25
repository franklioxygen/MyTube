import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import { getRssToken } from "../services/rssService";
import * as storageService from "../services/storageService";
import { getStringParam } from "../utils/paramUtils";
import { logger } from "../utils/logger";

declare global {
  namespace Express {
    interface Request {
      rssTokenRole?: storageService.VideoCallerRole;
    }
  }
}

// Cookie/query key that carries an RSS feed token so media URLs emitted by the
// RSS feed (which have no session cookie) can still authenticate against the
// media routes when login is enabled. The token id is already the feed's
// secret credential, so this introduces no new secret surface.
export const RSS_MEDIA_TOKEN_COOKIE = "mytube_rss_token";
export const RSS_MEDIA_TOKEN_QUERY = "rss";

// Minimum length a token id must have before we bother hitting the database.
// Matches the feed route's own sanity check in rssController.serveFeed.
const MIN_RSS_TOKEN_LENGTH = 10;

const isLikelyRssToken = (value: unknown): value is string =>
  typeof value === "string" && value.length >= MIN_RSS_TOKEN_LENGTH;

/**
 * Resolve an RSS token from the request (query param first, then cookie).
 * RSS readers fetch feed-emitted image URLs as plain GETs with no session
 * cookie, so the feed appends `?rss=<token>` to those URLs (see rssService).
 */
const getRssTokenFromRequest = (req: Request): string | undefined => {
  const fromQuery = req.query[RSS_MEDIA_TOKEN_QUERY];
  if (isLikelyRssToken(fromQuery)) {
    return fromQuery;
  }

  const fromCookie = req.cookies?.[RSS_MEDIA_TOKEN_COOKIE];
  return isLikelyRssToken(fromCookie) ? fromCookie : undefined;
};

/**
 * Guard for static + cloud media routes (videos/images/subtitles/cloud files).
 *
 * When `loginEnabled` is false (single-user mode), every caller is
 * owner-equivalent and media is served as before.
 *
 * When `loginEnabled` is true, media access requires one of:
 *  - an authenticated session (req.user, admin or visitor — visitor scoping
 *    for hidden content is enforced separately in the video query layer), or
 *  - a valid API key (req.apiKeyAuthenticated), or
 *  - a valid, active RSS feed token (query `?rss=` or cookie), so that media
 *    URLs emitted by an RSS feed keep resolving for RSS readers.
 *
 * Must be mounted AFTER `authMiddleware` (which populates req.user /
 * req.apiKeyAuthenticated) and AFTER cookieParser.
 *
 * Fixes GHSA-rwwf-29mq-5j43: static and cloud media routes were registered
 * before the auth stack and were fully unauthenticated, bypassing the login
 * wall that the frontend enforces.
 */
export const requireAuthenticatedMediaAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!isLoginRequired()) {
    next();
    return;
  }

  if (req.user?.role === "admin" || req.apiKeyAuthenticated === true) {
    next();
    return;
  }

  // RSS readers don't carry a session cookie; allow a feed token and preserve
  // its role so admin RSS feeds can resolve hidden media URLs they emit.
  const rssTokenId = getRssTokenFromRequest(req);
  if (rssTokenId) {
    try {
      const token = await getRssToken(rssTokenId);
      if (token?.isActive) {
        req.rssTokenRole = token.role;
        next();
        return;
      }
    } catch (error) {
      logger.warn("Failed to validate RSS media token", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (req.user) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    error: "Authentication required. Please log in to access this resource.",
  });
};

// The static media mounts strip their route prefix from req.path, so it is
// re-added here to reconstruct the stored web path (e.g. videoPath
// "/videos/foo.mp4"). Cloud routes carry the cloud filename as a route param.
type MediaKind =
  | "videos"
  | "images"
  | "images-small"
  | "subtitles"
  | "cloud-video"
  | "cloud-image"
  | "cloud-thumbnail-cache";

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const classifyMediaRequest = (
  kind: MediaKind,
  req: Request
): storageService.MediaVisibility => {
  switch (kind) {
    case "videos":
      return storageService.classifyMediaVisibility({
        exactPaths: [`/videos${safeDecode(req.path)}`],
      });
    case "images":
      return storageService.classifyMediaVisibility({
        exactPaths: [`/images${safeDecode(req.path)}`],
      });
    case "images-small": {
      // Small thumbnails mirror the original thumbnail, which may live under
      // either /images or /videos. Check both candidate originals.
      const wildcardPath = getStringParam(req.params["0"]);
      const sub = safeDecode(wildcardPath ? `/${wildcardPath}` : req.path);
      return storageService.classifyMediaVisibility({
        exactPaths: [`/images${sub}`, `/videos${sub}`],
      });
    }
    case "subtitles":
      return storageService.classifyMediaVisibility({
        subtitlePaths: [`/subtitles${safeDecode(req.path)}`],
      });
    case "cloud-video":
    case "cloud-image": {
      const filename = getStringParam(req.params.filename) ?? "";
      return storageService.classifyMediaVisibility({
        exactPaths: [`cloud:${filename}`],
      });
    }
    case "cloud-thumbnail-cache":
      return storageService.classifyMediaVisibility({
        cloudThumbnailCacheKeys: [safeDecode(req.path)],
      });
    default:
      return "unknown";
  }
};

/**
 * Defense-in-depth per-file visibility guard for static + cloud media routes.
 *
 * `requireAuthenticatedMediaAccess` only enforces *authentication* (the login
 * wall). A logged-in visitor passes that wall, so without this guard they could
 * still fetch a hidden video's file by a known path. This guard closes that gap
 * by classifying the requested media against the videos that reference it and
 * blocking non-admin callers from media that belongs solely to hidden videos.
 * Public/unknown (orphan, shared, frontend asset) media stays reachable, so RSS
 * clients keep working. Part of GHSA-hcm6-w6x8-6jhr.
 *
 * Must be mounted AFTER `authMiddleware` (so `req.user` / `req.apiKeyAuthenticated`
 * are populated) and AFTER `requireAuthenticatedMediaAccess`.
 */
export const requireVisibleMediaForVisitors =
  (kind: MediaKind) =>
  (req: Request, res: Response, next: NextFunction): void => {
    // Single-user mode: no roles, owner-equivalent access to everything.
    if (!isLoginRequired()) {
      next();
      return;
    }

    // Admins and API-key automation (admin-configured owner access) may always
    // reach hidden media.
    if (
      req.user?.role === "admin" ||
      req.rssTokenRole === "admin" ||
      req.apiKeyAuthenticated === true
    ) {
      next();
      return;
    }

    // Visitors and RSS-token callers: serve public/unknown media, but never
    // media that belongs solely to a hidden video.
    if (classifyMediaRequest(kind, req) === "hidden") {
      res.status(404).send("Not Found");
      return;
    }

    next();
  };
