/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware } from "../../middleware/authMiddleware";
import {
  deleteSession,
  getAuthCookieName,
  getUserPayloadFromSession,
} from "../../services/authService";
import { getSettings } from "../../services/storageService";
import { isUserSessionPayloadValid } from "../../services/userService";

vi.mock("../../services/authService", () => ({
  deleteSession: vi.fn(),
  getAuthCookieName: vi.fn(),
  getUserPayloadFromSession: vi.fn(),
}));

vi.mock("../../services/userService", () => ({
  isUserSessionPayloadValid: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));

describe("authMiddleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { headers: {}, cookies: {} };
    res = {};
    next = vi.fn();
    vi.mocked(getAuthCookieName).mockReturnValue("mytube_auth_session");
    vi.mocked(isUserSessionPayloadValid).mockReturnValue(true);
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: false,
      apiKey: "",
    } as any);
  });

  it("uses session cookie first and sets req.user", () => {
    const payload = { role: "admin", id: "u1" } as const;
    req.cookies = { mytube_auth_session: "sid-1" };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(payload as any);

    authMiddleware(req as Request, res as Response, next);

    expect(getUserPayloadFromSession).toHaveBeenCalledWith("sid-1");
    expect((req as Request).user).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("deletes stale user-backed sessions and continues unauthenticated", () => {
    const payload = {
      role: "visitor",
      id: "login-1",
      userId: "user-1",
      sessionVersion: 1,
    } as const;
    req.cookies = { mytube_auth_session: "sid-1" };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(payload as any);
    vi.mocked(isUserSessionPayloadValid).mockReturnValue(false);

    authMiddleware(req as Request, res as Response, next);

    expect(deleteSession).toHaveBeenCalledWith("sid-1");
    expect((req as Request).user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged admin bearer token (GHSA-rm8x-hmvr-qgp3)", () => {
    // A JWT signed with a leaked or default key must not authenticate anything:
    // bearer tokens are no longer an auth path at all.
    req.headers = {
      authorization: `Bearer ${jwt.sign({ role: "admin" }, "default_development_secret_do_not_use_in_production")}`,
    };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignores a bearer token even when the session cookie is unresolvable", () => {
    req.cookies = { mytube_auth_session: "expired-or-missing" };
    req.headers = {
      authorization: `Bearer ${jwt.sign({ role: "admin" }, "any-key")}`,
    };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);

    authMiddleware(req as Request, res as Response, next);

    expect(getUserPayloadFromSession).toHaveBeenCalledWith(
      "expired-or-missing"
    );
    expect((req as Request).user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed authorization header", () => {
    req.headers = { authorization: "Basic abc" };

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("marks request as api-key-authenticated when a valid X-API-Key is provided", () => {
    req.headers = { "x-api-key": "my-valid-key" };
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: true,
      apiKey: "my-valid-key",
    } as any);

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toBeUndefined();
    expect((req as Request).apiKeyAuthenticated).toBe(true);
    expect(getUserPayloadFromSession).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not authenticate with an invalid API key", () => {
    req.headers = { "x-api-key": "wrong-key" };
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: true,
      apiKey: "my-valid-key",
    } as any);

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toBeUndefined();
    expect((req as Request).apiKeyAuthenticated).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("prefers valid session auth even when API key is present", () => {
    const payload = { role: "admin", id: "u1" } as const;
    req.cookies = { mytube_auth_session: "sid-1" };
    req.headers = { "x-api-key": "my-valid-key" };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(payload as any);
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: true,
      apiKey: "my-valid-key",
    } as any);

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toEqual(payload);
    expect((req as Request).apiKeyAuthenticated).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not authenticate when apiKeyEnabled is false even with the correct key", () => {
    req.headers = { "x-api-key": "my-valid-key" };
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: false,
      apiKey: "my-valid-key",
    } as any);

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toBeUndefined();
    expect((req as Request).apiKeyAuthenticated).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("authenticates via Authorization: ApiKey <key> header format", () => {
    req.headers = { authorization: "ApiKey my-valid-key" };
    vi.mocked(getSettings).mockReturnValue({
      apiKeyEnabled: true,
      apiKey: "my-valid-key",
    } as any);

    authMiddleware(req as Request, res as Response, next);

    expect((req as Request).user).toBeUndefined();
    expect((req as Request).apiKeyAuthenticated).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
