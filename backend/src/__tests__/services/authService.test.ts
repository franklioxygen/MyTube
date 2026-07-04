/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  clearAuthCookie,
  deleteSession,
  generateToken,
  getAuthCookieName,
  getUserPayloadFromSession,
  revokeSessionsByUserId,
  setAuthCookie,
  updateSessionUsernames,
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

  it("revokes and updates user-backed sessions by user id", () => {
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any;
    const token = generateToken({
      role: "visitor",
      userId: "user-1",
      username: "Alice",
      sessionVersion: 1,
    });

    const sessionId = setAuthCookie(res, token, "visitor");

    updateSessionUsernames("user-1", "Alicia");
    expect(getUserPayloadFromSession(sessionId)?.username).toBe("Alicia");

    expect(revokeSessionsByUserId("user-1")).toBe(1);
    expect(getUserPayloadFromSession(sessionId)).toBeNull();
  });

  it("deletes an individual session", () => {
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any;
    const sessionId = setAuthCookie(res, generateToken({ role: "admin" }), "admin");

    deleteSession(sessionId);

    expect(getUserPayloadFromSession(sessionId)).toBeNull();
  });

  it("returns null for unknown sessions and invalid tokens", () => {
    expect(getUserPayloadFromSession("missing-session")).toBeNull();
    expect(verifyToken("not-a-token")).toBeNull();
  });

  describe("Secure cookie attribute (F-3)", () => {
    const setCookieAndReadSecure = (
      reqSecure: boolean | undefined,
      secureCookiesEnv?: string,
    ): boolean => {
      const previous = process.env.SECURE_COOKIES;
      if (secureCookiesEnv === undefined) {
        delete process.env.SECURE_COOKIES;
      } else {
        process.env.SECURE_COOKIES = secureCookiesEnv;
      }
      try {
        const res = {
          cookie: vi.fn(),
          clearCookie: vi.fn(),
          req: reqSecure === undefined ? undefined : { secure: reqSecure },
        } as any;
        setAuthCookie(res, generateToken({ role: "admin" }), "admin");
        const [, , cookieOptions] = vi.mocked(res.cookie).mock.calls[0] as [
          string,
          string,
          Record<string, unknown>,
        ];
        return cookieOptions.secure === true;
      } finally {
        if (previous === undefined) {
          delete process.env.SECURE_COOKIES;
        } else {
          process.env.SECURE_COOKIES = previous;
        }
      }
    };

    it("is NOT secure on a plain-HTTP request (keeps LAN logins working)", () => {
      expect(setCookieAndReadSecure(false)).toBe(false);
      expect(setCookieAndReadSecure(undefined)).toBe(false);
    });

    it("is secure automatically when the request arrived over HTTPS", () => {
      expect(setCookieAndReadSecure(true)).toBe(true);
    });

    it("honours SECURE_COOKIES=true even on a plain-HTTP request", () => {
      expect(setCookieAndReadSecure(false, "true")).toBe(true);
    });
  });
});
