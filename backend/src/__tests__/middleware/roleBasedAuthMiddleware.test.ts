/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { isStrictSecurityModel } from "../../config/securityModel";
import { isLoginRequired } from "../../services/passwordService";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(),
}));
vi.mock("../../config/securityModel", () => ({
  isStrictSecurityModel: vi.fn(),
}));
vi.mock("../../services/securityAuditService", () => ({
  recordSecurityAuditEvent: vi.fn(),
}));

describe("roleBasedAuthMiddleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isStrictSecurityModel).mockReturnValue(false);
    vi.mocked(isLoginRequired).mockReturnValue(false);
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

  it("allows unauthenticated logout in strict mode", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/logout",
      url: "/settings/logout",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows unauthenticated GET to passkeys exists in strict mode", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    req = {
      method: "GET",
      path: "/settings/passkeys/exists",
      url: "/settings/passkeys/exists",
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated non-public write requests in strict mode", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    vi.mocked(isLoginRequired).mockReturnValue(false);
    req = {
      method: "POST",
      path: "/settings/tags/rename",
      url: "/settings/tags/rename",
      user: undefined,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      })
    );
  });

  it("blocks unauthenticated reset-password in strict mode", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/reset-password",
      url: "/settings/reset-password",
      user: undefined,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("allows unauthenticated reset-password when recovery token header is present", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/reset-password",
      url: "/settings/reset-password",
      headers: {
        "x-mytube-recovery-token": "token-123",
      } as any,
      user: undefined,
      body: {},
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated passkeys/register in strict mode", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(true);
    req = {
      method: "POST",
      path: "/settings/passkeys/register",
      url: "/settings/passkeys/register",
      user: undefined,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("allows unauthenticated write requests in legacy mode when login is not required", () => {
    vi.mocked(isStrictSecurityModel).mockReturnValue(false);
    vi.mocked(isLoginRequired).mockReturnValue(false);
    req = {
      method: "POST",
      path: "/settings/tags/rename",
      url: "/settings/tags/rename",
      user: undefined,
    };

    roleBasedAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
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
