/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { isLoginRequired } from "../../services/passwordService";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(),
}));

describe("roleBasedAuthMiddleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLoginRequired).mockReturnValue(true);
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {
      method: "GET",
      path: "/",
      url: "/",
    };
    res = {
      json,
      status,
    };
    next = vi.fn();
  });

  it("allows visitor logout POST requests", () => {
    req = {
      method: "POST",
      path: "/settings/logout",
      url: "/settings/logout",
      user: { role: "visitor" } as any,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks visitor write requests that are not explicitly allowed", () => {
    req = {
      method: "POST",
      path: "/settings/tags/rename",
      url: "/settings/tags/rename",
      user: { role: "visitor" } as any,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });

  it("blocks visitor write requests when query params mimic a public endpoint", () => {
    req = {
      method: "POST",
      path: "/settings/import-database",
      url: "/settings/import-database?t=/verify-password",
      user: { role: "visitor" } as any,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Write operations are not allowed"),
      })
    );
  });

  it("allows unauthenticated logout when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/logout",
      url: "/settings/logout",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows unauthenticated legacy verify-password when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/verify-password",
      url: "/settings/verify-password",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows unauthenticated GET to passkeys exists when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "GET",
      path: "/settings/passkeys/exists",
      url: "/settings/passkeys/exists",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated confirm-admin-password when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/confirm-admin-password",
      url: "/settings/confirm-admin-password",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("blocks unauthenticated passkey registration when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/passkeys/register",
      url: "/settings/passkeys/register",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Authentication required"),
      })
    );
  });

  it("blocks unauthenticated passkey registration verification when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/passkeys/register/verify",
      url: "/settings/passkeys/register/verify",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Authentication required"),
      })
    );
  });

  it("allows unauthenticated upload requests when login is disabled", () => {
    vi.mocked(isLoginRequired).mockReturnValue(false);
    req = {
      method: "POST",
      path: "/upload/batch",
      url: "/upload/batch",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows visitor write requests when login is disabled", () => {
    vi.mocked(isLoginRequired).mockReturnValue(false);
    req = {
      method: "POST",
      path: "/settings/tags/rename",
      url: "/settings/tags/rename",
      user: { role: "visitor" } as any,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated upload requests with 401 when login is required", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/upload",
      url: "/upload",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("allows api-key-authenticated POST /download requests", () => {
    req = {
      method: "POST",
      path: "/download",
      url: "/download",
      apiKeyAuthenticated: true,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks api-key-authenticated requests to non-download endpoints", () => {
    req = {
      method: "GET",
      path: "/videos",
      url: "/videos",
      apiKeyAuthenticated: true,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("only allows POST /api/download"),
      })
    );
  });
});
