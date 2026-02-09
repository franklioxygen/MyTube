import { Express, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../utils/security";

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

const createAuthLimiter = (): RequestHandler => {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many authentication attempts, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => getClientIp(req),
    validate: {
      trustProxy: false,
    },
  });
};

export const configureRateLimiting = (app: Express): RequestHandler => {
  const generalLimiter = createGeneralLimiter();
  const authLimiter = createAuthLimiter();

  app.use((req, res, next) => {
    if (
      req.path.startsWith("/videos/") ||
      req.path.startsWith("/api/mount-video/") ||
      req.path.startsWith("/images/") ||
      req.path.startsWith("/subtitles/") ||
      req.path.startsWith("/avatars/")
    ) {
      return next();
    }

    if (
      req.path.startsWith("/api/download") ||
      req.path.startsWith("/api/check-video-download") ||
      req.path.startsWith("/api/check-bilibili") ||
      req.path.startsWith("/api/check-playlist") ||
      req.path.startsWith("/api/collections") ||
      req.path.startsWith("/api/downloads/")
    ) {
      return next();
    }

    if (
      req.path === "/api/settings/password-enabled" ||
      req.path === "/api/settings/passkeys/exists" ||
      req.path === "/api/settings/reset-password-cooldown" ||
      req.path === "/api/settings"
    ) {
      return next();
    }

    return generalLimiter(req, res, next);
  });

  return authLimiter;
};
