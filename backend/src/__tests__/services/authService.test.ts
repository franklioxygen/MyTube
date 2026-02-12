/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  clearAuthCookie,
  generateToken,
  getAuthCookieName,
  getUserPayloadFromSession,
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
});
