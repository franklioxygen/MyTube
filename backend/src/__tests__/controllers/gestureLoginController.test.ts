import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  getGestureLoginStatus: vi.fn(),
  configureGesture: vi.fn(),
  removeGesture: vi.fn(),
  authenticateGesture: vi.fn(),
}));

vi.mock("../../services/gestureLoginService", () => service);

const setAuthCookie = vi.fn(() => "session-id");
vi.mock("../../services/authService", () => ({
  setAuthCookie: (...args: unknown[]) => setAuthCookie(...(args as [])),
}));

const refreshCsrfTokenForSession = vi.fn();
vi.mock("../../middleware/csrfMiddleware", () => ({
  refreshCsrfTokenForSession: (...args: unknown[]) =>
    refreshCsrfTokenForSession(...(args as [])),
}));

import {
  authenticateGestureLogin,
  configureGestureLogin,
  getGestureLoginStatus,
  removeGestureLogin,
} from "../../controllers/gestureLoginController";

const CLEAN_STATUS = {
  configured: true,
  canConfigure: true,
  locked: false,
  available: true,
  attemptsRemaining: 3,
  resetRequired: false,
};

let req: Partial<Request>;
let res: Partial<Response>;
let json: ReturnType<typeof vi.fn>;
let status: ReturnType<typeof vi.fn>;
let setHeader: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  setAuthCookie.mockReturnValue("session-id");
  json = vi.fn();
  setHeader = vi.fn();
  status = vi.fn().mockReturnValue({ json });
  req = { body: {} };
  res = { json, status, setHeader } as unknown as Partial<Response>;
});

describe("GET status", () => {
  it("returns the service status and forbids caching", async () => {
    service.getGestureLoginStatus.mockReturnValue(CLEAN_STATUS);

    await getGestureLoginStatus(req as Request, res as Response);

    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(json).toHaveBeenCalledWith(CLEAN_STATUS);
  });

  it("returns 503 rather than a healthy-looking all-false status", async () => {
    service.getGestureLoginStatus.mockImplementation(() => {
      throw new Error("no such table: admin_gesture_credential");
    });

    await getGestureLoginStatus(req as Request, res as Response);

    // All-false is indistinguishable from a working install whose
    // prerequisites are unmet, which made the UI advise saving settings that
    // were already saved. Saying "I cannot tell" lets the client show its
    // status-unavailable message and a retry.
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gesture_status_unavailable" })
    );
  });
});

describe("PUT configure", () => {
  it("returns 201 on first enrolment and 200 on replacement", async () => {
    service.configureGesture.mockResolvedValue({
      ok: true,
      created: true,
      status: CLEAN_STATUS,
    });
    await configureGestureLogin(req as Request, res as Response);
    expect(status).toHaveBeenCalledWith(201);

    service.configureGesture.mockResolvedValue({
      ok: true,
      created: false,
      status: CLEAN_STATUS,
    });
    await configureGestureLogin(req as Request, res as Response);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("passes the pattern through and never echoes it back", async () => {
    req.body = { pattern: [0, 1, 2] };
    service.configureGesture.mockResolvedValue({
      ok: true,
      created: true,
      status: CLEAN_STATUS,
    });

    await configureGestureLogin(req as Request, res as Response);

    expect(service.configureGesture).toHaveBeenCalledWith([0, 1, 2]);
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("0,1,2");
  });

  it("maps each configure failure to its status code", async () => {
    const cases = [
      ["gesture_invalid", 422],
      ["gesture_password_login_required", 409],
      ["gesture_locked", 423],
      ["gesture_configuration_failed", 500],
    ] as const;

    for (const [code, expected] of cases) {
      status.mockClear();
      json.mockClear();
      service.configureGesture.mockResolvedValue({ ok: false, code });

      await configureGestureLogin(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(expected);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, code })
      );
    }
  });

  it("keeps internal failures generic", async () => {
    service.configureGesture.mockResolvedValue({
      ok: false,
      code: "gesture_configuration_failed",
    });

    await configureGestureLogin(req as Request, res as Response);

    const body = json.mock.calls[0][0];
    expect(body.message).toBe("Gesture Login could not be saved.");
    expect(body).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("error");
  });
});

describe("DELETE remove", () => {
  it("reports whether a row was deleted, and stays idempotent", async () => {
    service.removeGesture.mockReturnValue({ ok: true, removed: true });
    await removeGestureLogin(req as Request, res as Response);
    expect(json).toHaveBeenCalledWith({ success: true, removed: true });

    json.mockClear();
    service.removeGesture.mockReturnValue({ ok: true, removed: false });
    await removeGestureLogin(req as Request, res as Response);
    expect(json).toHaveBeenCalledWith({ success: true, removed: false });
    expect(status).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when removal could not be persisted", async () => {
    service.removeGesture.mockReturnValue({
      ok: false,
      code: "gesture_removal_failed",
    });

    await removeGestureLogin(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: "gesture_removal_failed",
      message: "Gesture Login could not be removed.",
    });
  });
});

describe("POST authenticate", () => {
  it("sets the admin session cookie and rotates CSRF on success", async () => {
    service.authenticateGesture.mockResolvedValue({
      ok: true,
      token: "token",
      role: "admin",
    });

    await authenticateGestureLogin(req as Request, res as Response);

    expect(setAuthCookie).toHaveBeenCalledWith(res, "token", "admin");
    expect(refreshCsrfTokenForSession).toHaveBeenCalledWith(
      req,
      res,
      "session-id"
    );
    expect(json).toHaveBeenCalledWith({ success: true, role: "admin" });
    // The token belongs in the HTTP-only cookie, never in the body.
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("token");
  });

  it("returns 401 with the remaining count for a wrong gesture", async () => {
    service.authenticateGesture.mockResolvedValue({
      ok: false,
      code: "gesture_incorrect",
      attemptsRemaining: 2,
    });

    await authenticateGestureLogin(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gesture_incorrect", attemptsRemaining: 2 })
    );
  });

  it("returns 423 once locked", async () => {
    service.authenticateGesture.mockResolvedValue({
      ok: false,
      code: "gesture_locked",
      attemptsRemaining: 0,
    });

    await authenticateGestureLogin(req as Request, res as Response);

    expect(status).toHaveBeenCalledWith(423);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "gesture_locked", attemptsRemaining: 0 })
    );
  });

  it("maps the remaining authentication failures", async () => {
    const cases = [
      ["gesture_invalid", 422],
      ["gesture_unavailable", 409],
      ["gesture_authentication_failed", 500],
    ] as const;

    for (const [code, expected] of cases) {
      status.mockClear();
      json.mockClear();
      service.authenticateGesture.mockResolvedValue({ ok: false, code });

      await authenticateGestureLogin(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(expected);
      // No attemptsRemaining when the service did not supply one, so the UI
      // cannot infer a count from a request that never reached the credential.
      expect(json.mock.calls[0][0]).not.toHaveProperty("attemptsRemaining");
    }
  });

  it("never creates a session for a failed attempt", async () => {
    service.authenticateGesture.mockResolvedValue({
      ok: false,
      code: "gesture_incorrect",
      attemptsRemaining: 1,
    });

    await authenticateGestureLogin(req as Request, res as Response);

    expect(setAuthCookie).not.toHaveBeenCalled();
    expect(refreshCsrfTokenForSession).not.toHaveBeenCalled();
  });

  it("forbids caching on every response", async () => {
    service.authenticateGesture.mockResolvedValue({
      ok: false,
      code: "gesture_incorrect",
      attemptsRemaining: 1,
    });

    await authenticateGestureLogin(req as Request, res as Response);

    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
