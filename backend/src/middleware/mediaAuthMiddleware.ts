import { NextFunction, Request, Response } from "express";
import { isLoginRequired } from "../services/passwordService";
import { getRssToken } from "../services/rssService";
import { logger } from "../utils/logger";

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

  if (req.user || req.apiKeyAuthenticated === true) {
    next();
    return;
  }

  // RSS readers don't carry a session cookie; allow a feed token.
  const rssTokenId = getRssTokenFromRequest(req);
  if (rssTokenId) {
    try {
      const token = await getRssToken(rssTokenId);
      if (token?.isActive) {
        next();
        return;
      }
    } catch (error) {
      logger.warn("Failed to validate RSS media token", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.status(401).json({
    success: false,
    error: "Authentication required. Please log in to access this resource.",
  });
};
