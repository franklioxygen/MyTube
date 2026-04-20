import { Request, Response, NextFunction } from "express";
import { doubleCsrf } from "csrf-csrf";
import crypto from "crypto";

const CSRF_SECRET =
  process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");

const CSRF_COOKIE_NAME = "mytube_csrf";

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: (req: Request) => req.cookies?.mytube_auth_session ?? "anonymous",
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

type CsrfTokenOptions = {
  overwrite?: boolean;
};

const setCsrfTokenHeader = (
  req: Request,
  res: Response,
  options: CsrfTokenOptions = {},
): string => {
  const token = generateCsrfToken(req, res, options);
  res.setHeader("X-CSRF-Token", token);
  return token;
};

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
  setCsrfTokenHeader(req, res);
  next();
};

/**
 * Re-issues a CSRF token immediately after the auth session changes so the
 * response carries a token bound to the new session identifier.
 */
export const refreshCsrfTokenForSession = (
  req: Request,
  res: Response,
  sessionId?: string,
): string => {
  // Keep req.cookies aligned with the session cookie we just issued/cleared on
  // the response so the regenerated CSRF token is bound to the new session.
  req.cookies = req.cookies ?? {};

  if (sessionId) {
    req.cookies.mytube_auth_session = sessionId;
  } else {
    req.cookies.mytube_auth_session = undefined;
  }

  return setCsrfTokenHeader(req, res, { overwrite: true });
};

export const isCsrfTokenError = (
  error: unknown,
): error is Error & { code: "EBADCSRFTOKEN" } => {
  if (!(error instanceof Error)) {
    return false;
  }

  return "code" in error && error.code === "EBADCSRFTOKEN";
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
