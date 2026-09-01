import { api } from "./apiClient";

/**
 * Shared client contract for admin Gesture Login.
 *
 * Deliberately not part of the generic `Settings` interface: the credential is
 * mutated immediately through its own endpoints, like a passkey, and never
 * travels through the deferred settings Save flow.
 */

export interface GestureLoginStatus {
  configured: boolean;
  canConfigure: boolean;
  locked: boolean;
  available: boolean;
  attemptsRemaining: number | null;
  resetRequired: boolean;
}

export const GESTURE_LOGIN_STATUS_QUERY_KEY = ["gesture-login-status"] as const;

export const GESTURE_MAX_ATTEMPTS = 3;

export type GestureErrorCode =
  | "gesture_invalid"
  | "gesture_incorrect"
  | "gesture_locked"
  | "gesture_unavailable"
  | "gesture_password_login_required"
  | "gesture_configuration_failed"
  | "gesture_authentication_failed"
  | "gesture_requires_password_login";

export interface GestureErrorBody {
  code?: GestureErrorCode;
  message?: string;
  attemptsRemaining?: number;
}

/**
 * Never converted to "not configured" on failure. A status request that fails
 * leaves the state unknown, and rendering an interactive grid on a guess is
 * worse than rendering nothing.
 */
export const fetchGestureLoginStatus = async (): Promise<GestureLoginStatus> => {
  const response = await api.get("/settings/gesture-login/status", {
    timeout: 5000,
  });
  return response.data as GestureLoginStatus;
};

export const configureGestureLogin = async (
  pattern: number[]
): Promise<{ status: GestureLoginStatus }> => {
  const response = await api.put("/settings/gesture-login", { pattern });
  return response.data as { status: GestureLoginStatus };
};

export const removeGestureLogin = async (): Promise<void> => {
  await api.delete("/settings/gesture-login");
};

export const authenticateGestureLogin = async (
  pattern: number[]
): Promise<{ role: "admin" }> => {
  const response = await api.post("/settings/gesture-login/authenticate", {
    pattern,
  });
  return response.data as { role: "admin" };
};

/** Pull the structured error body out of an Axios failure, if there is one. */
export const getGestureErrorBody = (error: unknown): GestureErrorBody => {
  const body = (error as { response?: { data?: unknown } })?.response?.data;
  return body && typeof body === "object" ? (body as GestureErrorBody) : {};
};

const ERROR_TRANSLATION_KEYS: Record<GestureErrorCode, string> = {
  gesture_invalid: "gestureLoginMinimumDots",
  gesture_incorrect: "gestureLoginIncorrectAttemptsRemaining",
  gesture_locked: "gestureLoginLockedPasswordRecovery",
  gesture_unavailable: "gestureLoginUnavailable",
  gesture_password_login_required: "gestureLoginPasswordRequired",
  gesture_configuration_failed: "gestureLoginSaveFailed",
  gesture_authentication_failed: "gestureLoginUnavailable",
  gesture_requires_password_login: "gestureLoginDisablePasswordBlocked",
};

/**
 * Map a backend code to a locale key. Backend messages are English fallbacks
 * only; internal detail must never reach the UI.
 */
export const getGestureErrorTranslationKey = (
  code: GestureErrorCode | undefined
): string | null => (code ? ERROR_TRANSLATION_KEYS[code] ?? null : null);
