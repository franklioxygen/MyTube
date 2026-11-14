import { Express, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { hasUsableFederationCredential } from "../services/federation/tokenService";
import { buildErrorRssXml, getBaseUrl, setRssNoStoreHeaders } from "../services/rssService";
import { getClientIp } from "../utils/security";
import { logger } from "../utils/logger";

export interface AuthLimiters {
  adminPasswordLimiter: RequestHandler;
  visitorPasswordLimiter: RequestHandler;
  adminReauthLimiter: RequestHandler;
  passkeyAuthLimiter: RequestHandler;
  passkeyRegistrationLimiter: RequestHandler;
  gestureAuthLimiter: RequestHandler;
  feedLimiter: RequestHandler;
  statisticsIngestionLimiter: RequestHandler;
  liveTranslationSessionLimiter: RequestHandler;
  federationProtocolLimiter: RequestHandler;
}

type RateLimitedRequest = Request & {
  rateLimit?: {
    resetTime?: Date | number;
  };
};

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 5;
const RATE_LIMIT_VALIDATE_OPTIONS = {
  // server.ts intentionally enables trust proxy for deployed reverse proxies.
  // getClientIp() is the single source for limiter keys, so disable only the
  // express-rate-limit trustProxy validation warning.
  trustProxy: false,
};

function getRateLimitWaitTimeMs(
  req: RateLimitedRequest,
  fallbackWindowMs: number
): number {
  const resetTime = req.rateLimit?.resetTime;

  if (resetTime instanceof Date) {
    return Math.max(resetTime.getTime() - Date.now(), 0);
  }

  if (typeof resetTime === "number") {
    return Math.max(resetTime - Date.now(), 0);
  }

  return fallbackWindowMs;
}

function sendRateLimitResponse(
  req: Request,
  res: Response,
  windowMs: number,
  scope: string,
  message = "Too many failed attempts. Please wait before trying again."
): void {
  const waitTime = getRateLimitWaitTimeMs(req as RateLimitedRequest, windowMs);
  logger.warn("Authentication rate limit triggered", {
    scope,
    ip: getClientIp(req),
    method: req.method,
    path: req.path,
    waitTimeMs: waitTime,
    windowMs,
    maxAttempts: AUTH_MAX_ATTEMPTS,
  });

  res.status(429).json({
    success: false,
    message,
    waitTime,
    statusCode: 429,
  });
}

function sendFeedRateLimitResponse(res: Response, xml: string): void {
  res.status(429).type("application/rss+xml; charset=utf-8").send(xml);
}

const createFeedLimiter = (): RequestHandler =>
  rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    validate: RATE_LIMIT_VALIDATE_OPTIONS,
    handler: (req, res) => {
      const baseUrl = getBaseUrl(req);
      setRssNoStoreHeaders(res);
      sendFeedRateLimitResponse(
        res,
        buildErrorRssXml({
          title: "Rate limit exceeded",
          link: baseUrl,
          description: "Too many feed requests. Please retry later.",
        })
      );
    },
  });

const createGeneralLimiter = (): RequestHandler => {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    validate: RATE_LIMIT_VALIDATE_OPTIONS,
  });
};

const createStatisticsIngestionLimiter = (): RequestHandler =>
  rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    validate: RATE_LIMIT_VALIDATE_OPTIONS,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: "Statistics ingestion rate limit exceeded.",
      });
    },
  });

const createScopedAuthLimiter = (scope: string): RequestHandler => {
  return rateLimit({
    windowMs: AUTH_WINDOW_MS,
    max: AUTH_MAX_ATTEMPTS,
    message: "Too many authentication attempts, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => getClientIp(req),
    handler: (req, res) => {
      sendRateLimitResponse(req, res, AUTH_WINDOW_MS, scope);
    },
    validate: RATE_LIMIT_VALIDATE_OPTIONS,
  });
};

const createLiveTranslationSessionLimiter = (): RequestHandler => {
  return rateLimit({
    windowMs: AUTH_WINDOW_MS,
    max: AUTH_MAX_ATTEMPTS,
    message: "Too many live translation sessions, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    handler: (req, res) => {
      sendRateLimitResponse(
        req,
        res,
        AUTH_WINDOW_MS,
        "live-translation-session",
        "Too many live translation sessions. Please wait before trying again."
      );
    },
    validate: RATE_LIMIT_VALIDATE_OPTIONS,
  });
};

// Counts only requests that fail authentication. Secrets are 256-bit, so this
// bounds noise from misconfigured or probing clients. An authenticated
// consumer's 404s (a missing thumbnail) or 409s (a stale snapshot) are normal
// protocol traffic and must not lock it out. Nor may its concurrency: the
// limiter counts a request on arrival, so a prime loading a thumbnail grid or
// holding long media streams would fill the window. A request carrying a
// usable credential is therefore never counted; the check has no side effects
// and the protocol router verifies the credential again.
const FEDERATION_MAX_FAILED_REQUESTS = 30;

const createFederationProtocolLimiter = (): RequestHandler =>
  rateLimit({
    windowMs: AUTH_WINDOW_MS,
    max: FEDERATION_MAX_FAILED_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => hasUsableFederationCredential(req.headers.authorization),
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) =>
      res.statusCode < 400 || req.federationPrincipal !== undefined,
    keyGenerator: (req) => getClientIp(req),
    validate: RATE_LIMIT_VALIDATE_OPTIONS,
    handler: (req, res) => {
      logger.warn("Federation protocol rate limit triggered", {
        ip: getClientIp(req),
        method: req.method,
        path: req.path,
      });
      res.status(429).json({
        success: false,
        code: "FEDERATION_RATE_LIMITED",
        error: "Too many rejected federation requests. Please retry later.",
      });
    },
  });

export const configureRateLimiting = (app: Express): AuthLimiters => {
  const generalLimiter = createGeneralLimiter();
  const authLimiters: AuthLimiters = {
    adminPasswordLimiter: createScopedAuthLimiter("admin-password"),
    visitorPasswordLimiter: createScopedAuthLimiter("visitor-password"),
    adminReauthLimiter: createScopedAuthLimiter("admin-reauth"),
    passkeyAuthLimiter: createScopedAuthLimiter("passkey-auth"),
    passkeyRegistrationLimiter: createScopedAuthLimiter("passkey-registration"),
    // Its own bucket on purpose: drawing gestures must not be able to consume
    // the password attempts that are the documented recovery path.
    gestureAuthLimiter: createScopedAuthLimiter("gesture-auth"),
    feedLimiter: createFeedLimiter(),
    statisticsIngestionLimiter: createStatisticsIngestionLimiter(),
    // Ticket minting has per-use Gemini cost; rate limit it per client.
    liveTranslationSessionLimiter: createLiveTranslationSessionLimiter(),
    federationProtocolLimiter: createFederationProtocolLimiter(),
  };

  app.use((req, res, next) => {
    const shouldBypassLimiter =
      req.path.startsWith("/feed/") ||
      req.path.startsWith("/api/rss/feed/") ||
      req.path.startsWith("/videos/") ||
      req.path.startsWith("/api/mount-video/") ||
      req.path.startsWith("/images-small/") ||
      req.path.startsWith("/images/") ||
      req.path.startsWith("/subtitles/") ||
      req.path.startsWith("/avatars/") ||
      // Authenticated server-to-server traffic (thumbnails, Range seeks) with
      // its own failed-authentication limiter.
      req.path.startsWith("/api/federation/v1/") ||
      // The prime's media gateway: Range seeks from the owner's player.
      req.path.startsWith("/api/federation/media/") ||
      req.path.startsWith("/api/download") ||
      req.path.startsWith("/api/check-video-download") ||
      req.path.startsWith("/api/check-bilibili") ||
      req.path.startsWith("/api/check-playlist") ||
      req.path.startsWith("/api/collections") ||
      req.path.startsWith("/api/downloads/") ||
      req.path === "/api/statistics/events" ||
      req.path === "/api/settings/password-enabled" ||
      req.path === "/api/settings/passkeys/exists" ||
      req.path === "/api/settings/gesture-login/status" ||
      req.path === "/api/settings";

    if (shouldBypassLimiter) {
      next();
    } else {
      generalLimiter(req, res, next);
    }
  });

  return authLimiters;
};
