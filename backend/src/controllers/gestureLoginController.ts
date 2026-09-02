import { Request, Response } from "express";
import { refreshCsrfTokenForSession } from "../middleware/csrfMiddleware";
import { setAuthCookie } from "../services/authService";
import * as gestureLoginService from "../services/gestureLoginService";

/**
 * HTTP surface for admin Gesture Login.
 *
 * Authorization is not enforced here. Both role middlewares run first and
 * reject unauthenticated, visitor, and API-key callers with their existing
 * shapes, so a request that reaches these handlers has already cleared them.
 */

const CONFIGURE_ERROR_STATUS: Record<
  gestureLoginService.GestureConfigureErrorCode,
  number
> = {
  gesture_invalid: 422,
  gesture_password_login_required: 409,
  gesture_locked: 423,
  gesture_configuration_failed: 500,
};

const CONFIGURE_ERROR_MESSAGE: Record<
  gestureLoginService.GestureConfigureErrorCode,
  string
> = {
  gesture_invalid: "Draw a gesture connecting at least 3 dots.",
  gesture_password_login_required:
    "Enable and save password login before setting up Gesture Login.",
  gesture_locked:
    "Gesture Login is locked. Sign in with the admin password to restore it.",
  gesture_configuration_failed: "Gesture Login could not be saved.",
};

const AUTH_ERROR_STATUS: Record<
  gestureLoginService.GestureAuthErrorCode,
  number
> = {
  gesture_invalid: 422,
  gesture_incorrect: 401,
  gesture_locked: 423,
  gesture_unavailable: 409,
  gesture_authentication_failed: 500,
};

const AUTH_ERROR_MESSAGE: Record<
  gestureLoginService.GestureAuthErrorCode,
  string
> = {
  gesture_invalid: "Invalid gesture.",
  gesture_incorrect: "Incorrect gesture.",
  gesture_locked:
    "Gesture Login is locked. Sign in with the admin password to restore it.",
  gesture_unavailable: "Gesture Login is not available.",
  gesture_authentication_failed: "Gesture Login could not be verified.",
};

/** These responses are login-state dependent and must never be cached. */
const setNoStore = (res: Response): void => {
  res.setHeader("Cache-Control", "no-store");
};

/**
 * Public status for the login screen, like /password-enabled.
 * Exposes only booleans and the remaining attempt count.
 */
export const getGestureLoginStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  setNoStore(res);

  try {
    res.json(gestureLoginService.getGestureLoginStatus());
  } catch {
    // Say "I cannot tell" rather than returning all-false, which the UI cannot
    // distinguish from a healthy install with unmet prerequisites. The client
    // shows its status-unavailable message and a retry instead of advising an
    // action that would not help.
    res.status(503).json({
      success: false,
      code: "gesture_status_unavailable",
      message: "Gesture Login status could not be loaded.",
    });
  }
};

/** Create or replace the credential. Admin session only. */
export const configureGestureLogin = async (
  req: Request,
  res: Response
): Promise<void> => {
  setNoStore(res);

  const result = await gestureLoginService.configureGesture(req.body?.pattern);

  if (!result.ok) {
    res.status(CONFIGURE_ERROR_STATUS[result.code]).json({
      success: false,
      code: result.code,
      message: CONFIGURE_ERROR_MESSAGE[result.code],
    });
    return;
  }

  res
    .status(result.created ? 201 : 200)
    .json({ success: true, status: result.status });
};

/** Delete the credential. Idempotent, and allowed even while locked. */
export const removeGestureLogin = async (
  _req: Request,
  res: Response
): Promise<void> => {
  setNoStore(res);
  const result = gestureLoginService.removeGesture();
  if (!result.ok) {
    res.status(500).json({
      success: false,
      code: result.code,
      message: "Gesture Login could not be removed.",
    });
    return;
  }

  res.json({ success: true, removed: result.removed });
};

/**
 * Authenticate a drawn gesture. Public, like the password endpoints: knowledge
 * of an admin credential is what upgrades the session, so a visitor may post
 * here just as they may post an admin password.
 */
export const authenticateGestureLogin = async (
  req: Request,
  res: Response
): Promise<void> => {
  setNoStore(res);

  const result = await gestureLoginService.authenticateGesture(
    req.body?.pattern
  );

  if (result.ok) {
    // Same session and CSRF handling as password and passkey success.
    const sessionId = setAuthCookie(res, result.token, result.role);
    refreshCsrfTokenForSession(req, res, sessionId);
    res.json({ success: true, role: result.role });
    return;
  }

  res.status(AUTH_ERROR_STATUS[result.code]).json({
    success: false,
    code: result.code,
    message: AUTH_ERROR_MESSAGE[result.code],
    ...(result.attemptsRemaining !== undefined
      ? { attemptsRemaining: result.attemptsRemaining }
      : {}),
  });
};
