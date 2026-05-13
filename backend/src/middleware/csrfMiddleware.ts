import { Request, Response, NextFunction } from "express";
import { doubleCsrf } from "csrf-csrf";
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

export const csrfProtection = configuredDoubleCsrfProtection;
export const doubleCsrfProtection = configuredDoubleCsrfProtection;
