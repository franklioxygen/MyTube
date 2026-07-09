import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { isLoginRequired } from "../../services/passwordService";

vi.mock("../../services/passwordService", () => ({ isLoginRequired: vi.fn() }));
vi.mock("../../services/storageService", () => ({ getSettings: vi.fn() }));

describe("roleBasedAuthMiddleware favorites access", () => {
  const next = vi.fn() as unknown as NextFunction;
  const json = vi.fn();
  const res = {
    status: vi.fn(() => ({ json })),
  } as unknown as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLoginRequired).mockReturnValue(true);
  });

  it("allows visitors to POST favorites", () => {
    roleBasedAuthMiddleware(
      { method: "POST", path: "/favorites/authors", user: { role: "visitor", userId: "visitor-1" } } as Request,
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows visitors to DELETE favorites", () => {
    roleBasedAuthMiddleware(
      { method: "DELETE", path: "/favorites/authors", user: { role: "visitor", userId: "visitor-1" } } as Request,
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("continues to block unrelated visitor deletes", () => {
    roleBasedAuthMiddleware(
      { method: "DELETE", path: "/collections/collection-1", user: { role: "visitor", userId: "visitor-1" } } as Request,
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
