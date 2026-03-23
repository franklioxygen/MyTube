import { Request, Response, NextFunction } from "express";
import { doubleCsrf } from "csrf-csrf";
import crypto from "crypto";
import { getAuthCookieName } from "../services/authService";

const CSRF_SECRET =
  process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");

const CSRF_COOKIE_NAME = "mytube_csrf";

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: (req: Request) => {
    const cookieName = getAuthCookieName();
    return req.cookies?.[cookieName] ?? "anonymous";
  },
  cookieName: CSRF_COOKIE_NAME,
  cookieOptions: {
    sameSite: "lax",
    path: "/",
    secure: process.env.SECURE_COOKIES === "true",
    httpOnly: true,
  },
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req: Request) => {
    return req.headers["x-csrf-token"] as string | undefined;
  },
});

/**
 * Middleware that generates a CSRF token and sets the cookie on every response.
 * The token value is exposed via the `X-CSRF-Token` response header so the
 * frontend can read it and attach it to subsequent state-changing requests.
 */
export const csrfTokenProvider = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const token = generateCsrfToken(req, res);
  res.setHeader("X-CSRF-Token", token);
  next();
};

/**
 * Middleware that validates the CSRF token on state-changing requests
 * (POST, PUT, PATCH, DELETE). Skips validation for API-key-authenticated
 * requests since they are not cookie-based and thus not vulnerable to CSRF.
 */
export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // API key requests are not cookie-based — CSRF does not apply.
  if (req.headers["x-api-key"] || req.headers.authorization?.startsWith("ApiKey ")) {
    next();
    return;
  }

  doubleCsrfProtection(req, res, next);
};
