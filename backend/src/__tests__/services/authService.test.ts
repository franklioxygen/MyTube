/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  assertJwtSecretConfiguration,
  clearAuthCookie,
  generateToken,
  getAuthCookieName,
  getUserPayloadFromSession,
  revokeAllAuthSessionsForRole,
  revokeAuthSession,
  setAuthCookie,
  verifyToken,
} from "../../services/authService";

describe("authService", () => {
  it("stores opaque session id cookie and resolves it to a payload", () => {
    const token = generateToken({ role: "admin" });
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any;

    setAuthCookie(res, token, "admin");

    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, cookieOptions] = vi.mocked(res.cookie).mock
      .calls[0] as [string, string, Record<string, unknown>];

    expect(cookieName).toBe(getAuthCookieName());
    expect(cookieValue).not.toBe(token);
    expect(cookieOptions.httpOnly).toBe(true);

    const payload = getUserPayloadFromSession(cookieValue);
    expect(payload?.role).toBe("admin");
  });

  it("clears session and legacy role cookies", () => {
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any;

    clearAuthCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      getAuthCookieName(),
      expect.objectContaining({
        httpOnly: true,
        path: "/",
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      "mytube_role",
      expect.objectContaining({
        path: "/",
      }),
    );
  });

  it("returns null for unknown sessions and invalid tokens", () => {
    expect(getUserPayloadFromSession("missing-session")).toBeNull();
    expect(verifyToken("not-a-token")).toBeNull();
  });

  it("revokes a single session", () => {
    const token = generateToken({ role: "admin" });
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any;

    setAuthCookie(res, token, "admin");
    const [, sessionId] = vi.mocked(res.cookie).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(getUserPayloadFromSession(sessionId)?.role).toBe("admin");

    expect(revokeAuthSession(sessionId, "test_revoke")).toBe(true);
    expect(getUserPayloadFromSession(sessionId)).toBeNull();
  });

  it("revokes all sessions for a role", () => {
    const adminToken = generateToken({ role: "admin" });
    const visitorToken = generateToken({ role: "visitor" });
    const adminRes = { cookie: vi.fn(), clearCookie: vi.fn() } as any;
    const visitorRes = { cookie: vi.fn(), clearCookie: vi.fn() } as any;

    setAuthCookie(adminRes, adminToken, "admin");
    setAuthCookie(visitorRes, visitorToken, "visitor");

    const [, adminSessionId] = vi.mocked(adminRes.cookie).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    const [, visitorSessionId] = vi.mocked(visitorRes.cookie).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];

    const revokedCount = revokeAllAuthSessionsForRole(
      "admin",
      "test_logout_all",
    );
    expect(revokedCount).toBeGreaterThan(0);
    expect(getUserPayloadFromSession(adminSessionId)).toBeNull();
    expect(getUserPayloadFromSession(visitorSessionId)?.role).toBe("visitor");
  });

  it("fails closed for missing production JWT secret", () => {
    expect(() =>
      assertJwtSecretConfiguration({
        nodeEnv: "production",
        jwtSecret: "",
      }),
    ).toThrow(/JWT_SECRET/i);
  });

  it("accepts sufficiently long production JWT secret", () => {
    expect(
      assertJwtSecretConfiguration({
        nodeEnv: "production",
        jwtSecret: "a".repeat(40),
      }),
    ).toBe("a".repeat(40));
  });
});
