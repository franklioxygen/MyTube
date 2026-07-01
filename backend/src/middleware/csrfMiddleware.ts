import { Request, Response, NextFunction } from "express";
import { doubleCsrf } from "csrf-csrf";
import { getAuthCookieName } from "../services/authService";
import {
  CSRF_COOKIE_NAME,
  CSRF_IGNORED_METHODS,
  CSRF_SECRET,
  csrfCookieOptions,
  getCsrfSessionIdentifier,
  getCsrfTokenFromRequest,
  shouldSkipCsrfProtection,
} from "./csrfConfig";

type CsrfTokenOptions = {
  overwrite?: boolean;
};

const {
  doubleCsrfProtection: configuredDoubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: getCsrfSessionIdentifier,
  cookieName: CSRF_COOKIE_NAME,
  cookieOptions: csrfCookieOptions,
  ignoredMethods: [...CSRF_IGNORED_METHODS],
  getCsrfTokenFromRequest,
  // API key requests are not cookie-based and are not vulnerable to CSRF.
  // RSS token management rejects API keys separately and must remain CSRF-protected.
  skipCsrfProtection: shouldSkipCsrfProtection,
});

const requiresCsrfValidation = (req: Request): boolean =>
  !CSRF_IGNORED_METHODS.includes(
    req.method as (typeof CSRF_IGNORED_METHODS)[number],
  ) && !shouldSkipCsrfProtection(req);

export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // CodeQL recognizes this literal cookie/header comparison as the CSRF guard;
  // csrf-csrf below still performs the session-bound HMAC validation.
  if (
    requiresCsrfValidation(req) &&
    (!req.cookies || req.cookies.mytube_csrf !== req.headers["x-csrf-token"])
  ) {
    next(invalidCsrfTokenError);
    return;
  }

  configuredDoubleCsrfProtection(req, res, next);
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
  const authCookieName = getAuthCookieName();

  if (sessionId) {
    req.cookies[authCookieName] = sessionId;
  } else {
    req.cookies[authCookieName] = undefined;
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

export const doubleCsrfProtection = csrfProtection;
