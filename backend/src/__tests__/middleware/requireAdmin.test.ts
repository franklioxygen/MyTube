/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../../middleware/requireAdmin";
import { isLoginRequired } from "../../services/passwordService";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(),
}));

describe("requireAdmin", () => {
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
    req = { headers: {} };
    res = { status, json };
    next = vi.fn();
  });

  it("allows admin users", () => {
    req.user = { role: "admin" } as any;

    requireAdmin(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows management when login is disabled", () => {
    vi.mocked(isLoginRequired).mockReturnValue(false);

    requireAdmin(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects visitor users", () => {
    req.user = { role: "visitor" } as any;

    requireAdmin(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Admin access is required.",
      })
    );
  });

  it("rejects API key authentication even if the API key route would otherwise be allowed", () => {
    req.apiKeyAuthenticated = true;
    req.user = { role: "admin" } as any;

    requireAdmin(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "API key authentication cannot manage RSS tokens.",
      })
    );
  });

  it("rejects RSS management requests that include API key credentials with an admin session", () => {
    req.user = { role: "admin" } as any;
    req.headers = { "x-api-key": "secret" } as any;

    requireAdmin(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "API key authentication cannot manage RSS tokens.",
      })
    );
  });
});
