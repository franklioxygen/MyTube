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
});
