/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware } from "../../middleware/authMiddleware";
import {
  getAuthCookieName,
  getUserPayloadFromSession,
  verifyToken,
} from "../../services/authService";
import { getSettings } from "../../services/storageService";

vi.mock("../../services/authService", () => ({
  getAuthCookieName: vi.fn(),
  getUserPayloadFromSession: vi.fn(),
  verifyToken: vi.fn(),
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
    expect(verifyToken).not.toHaveBeenCalled();
    expect((req as Request).user).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("falls back to bearer token when session cookie is missing", () => {
    const payload = { role: "visitor", id: "u2" } as const;
    req.headers = { authorization: "Bearer token-123" };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(payload as any);

    authMiddleware(req as Request, res as Response, next);

    expect(verifyToken).toHaveBeenCalledWith("token-123");
    expect((req as Request).user).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("continues when bearer token is invalid", () => {
    req.headers = { authorization: "Bearer invalid" };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(null);

    authMiddleware(req as Request, res as Response, next);

    expect(verifyToken).toHaveBeenCalledWith("invalid");
    expect((req as Request).user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed authorization header", () => {
    req.headers = { authorization: "Basic abc" };

    authMiddleware(req as Request, res as Response, next);

    expect(verifyToken).not.toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("tries bearer token if session exists but is not resolvable", () => {
    const payload = { role: "admin", id: "u3" } as const;
    req.cookies = { mytube_auth_session: "expired-or-missing" };
    req.headers = { authorization: "Bearer t2" };
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(payload as any);

    authMiddleware(req as Request, res as Response, next);

    expect(getUserPayloadFromSession).toHaveBeenCalledWith(
      "expired-or-missing"
    );
    expect(verifyToken).toHaveBeenCalledWith("t2");
    expect((req as Request).user).toEqual(payload);
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
    expect(verifyToken).not.toHaveBeenCalled();
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
