/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware } from "../../middleware/authMiddleware";
import {
  getAuthCookieName,
  getUserPayloadFromSession,
  verifyToken,
} from "../../services/authService";

vi.mock("../../services/authService", () => ({
  getAuthCookieName: vi.fn(),
  getUserPayloadFromSession: vi.fn(),
  verifyToken: vi.fn(),
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
});
