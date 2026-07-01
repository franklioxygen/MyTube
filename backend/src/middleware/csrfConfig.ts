import { Request } from "express";
import crypto from "crypto";
import { isApiKeyAuthorized } from "../utils/apiKeyAuth";

export const CSRF_SECRET =
  process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");

export const CSRF_COOKIE_NAME = "mytube_csrf";
export const CSRF_IGNORED_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
export const RSS_MANAGEMENT_PATH = "/api/rss/tokens";

export const csrfCookieOptions = {
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.SECURE_COOKIES === "true",
  httpOnly: true,
};

export const getCsrfSessionIdentifier = (req: Request): string =>
  req.cookies?.mytube_auth_session ?? "anonymous";

export const getCsrfTokenFromRequest = (
  req: Request
): string | undefined => {
  return req.headers["x-csrf-token"] as string | undefined;
};

export const isRssManagementRequest = (req: Request): boolean => {
  const originalPath = req.originalUrl.split("?")[0];

  return [req.path, originalPath].some(
    (requestPath) =>
      requestPath === RSS_MANAGEMENT_PATH ||
      requestPath.startsWith(`${RSS_MANAGEMENT_PATH}/`)
  );
};

export const shouldSkipCsrfProtection = (req: Request): boolean =>
  !isRssManagementRequest(req) && isApiKeyAuthorized(req);
