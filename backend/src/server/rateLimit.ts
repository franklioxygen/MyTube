import { Express, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../utils/security";
import { logger } from "../utils/logger";

export interface AuthLimiters {
  adminPasswordLimiter: RequestHandler;
  visitorPasswordLimiter: RequestHandler;
  adminReauthLimiter: RequestHandler;
  passkeyAuthLimiter: RequestHandler;
  passkeyRegistrationLimiter: RequestHandler;
}

type RateLimitedRequest = Request & {
  rateLimit?: {
    resetTime?: Date | number;
  };
};

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 5;

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
  scope: string
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
    message: "Too many failed attempts. Please wait before trying again.",
    waitTime,
    statusCode: 429,
  });
}

const createGeneralLimiter = (): RequestHandler => {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    validate: {
      trustProxy: false,
    },
  });
};

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
    validate: {
      trustProxy: false,
    },
  });
};

export const configureRateLimiting = (app: Express): AuthLimiters => {
  const generalLimiter = createGeneralLimiter();
  const authLimiters: AuthLimiters = {
    adminPasswordLimiter: createScopedAuthLimiter("admin-password"),
    visitorPasswordLimiter: createScopedAuthLimiter("visitor-password"),
    adminReauthLimiter: createScopedAuthLimiter("admin-reauth"),
    passkeyAuthLimiter: createScopedAuthLimiter("passkey-auth"),
    passkeyRegistrationLimiter: createScopedAuthLimiter("passkey-registration"),
  };

  app.use((req, res, next) => {
    const shouldBypassLimiter =
      req.path.startsWith("/videos/") ||
      req.path.startsWith("/api/mount-video/") ||
      req.path.startsWith("/images/") ||
      req.path.startsWith("/subtitles/") ||
      req.path.startsWith("/avatars/") ||
      req.path.startsWith("/api/download") ||
      req.path.startsWith("/api/check-video-download") ||
      req.path.startsWith("/api/check-bilibili") ||
      req.path.startsWith("/api/check-playlist") ||
      req.path.startsWith("/api/collections") ||
      req.path.startsWith("/api/downloads/") ||
      req.path === "/api/settings/password-enabled" ||
      req.path === "/api/settings/passkeys/exists" ||
      req.path === "/api/settings";

    if (shouldBypassLimiter) {
      next();
    } else {
      generalLimiter(req, res, next);
    }
  });

  return authLimiters;
};
