/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(),
}));

vi.mock("../../services/authService", () => ({
  getUserPayloadFromSession: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  classifyMediaVisibility: vi.fn(),
}));

import { mediaVisibilityGuard } from "../../middleware/mediaAccessMiddleware";
import {
  getUserPayloadFromSession,
  verifyToken,
} from "../../services/authService";
import { isLoginRequired } from "../../services/passwordService";
import * as storageService from "../../services/storageService";

const createRes = () => {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
};

const createReq = (overrides: Partial<Request> = {}): Request =>
  ({
    path: "/secret.mp4",
    params: {},
    headers: {},
    cookies: {},
    ...overrides,
  } as unknown as Request);

describe("mediaVisibilityGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows everything when login is not required (single-user mode)", () => {
    vi.mocked(isLoginRequired).mockReturnValue(false);
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("videos")(createReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(storageService.classifyMediaVisibility).not.toHaveBeenCalled();
  });

  it("allows admins to access hidden media via session cookie", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(getUserPayloadFromSession).mockReturnValue({
      role: "admin",
      id: "a1",
    });
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("videos")(
      createReq({ cookies: { mytube_auth_session: "sid" } as any }),
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(storageService.classifyMediaVisibility).not.toHaveBeenCalled();
  });

  it("blocks anonymous access to hidden media with 404", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(null);
    vi.mocked(storageService.classifyMediaVisibility).mockReturnValue("hidden");
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("videos")(createReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith("Not Found");
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks a logged-in visitor from hidden media", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(getUserPayloadFromSession).mockReturnValue({
      role: "visitor",
      id: "v1",
    });
    vi.mocked(storageService.classifyMediaVisibility).mockReturnValue("hidden");
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("videos")(
      createReq({ cookies: { mytube_auth_session: "sid" } as any }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows public media to be served without a session (RSS clients)", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(null);
    vi.mocked(storageService.classifyMediaVisibility).mockReturnValue("public");
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("videos")(createReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows unknown media (orphan files, frontend assets, avatars)", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(null);
    vi.mocked(storageService.classifyMediaVisibility).mockReturnValue("unknown");
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("subtitles")(createReq({ path: "/x.vtt" }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("classifies cloud routes by the filename route param", () => {
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(getUserPayloadFromSession).mockReturnValue(null);
    vi.mocked(verifyToken).mockReturnValue(null);
    vi.mocked(storageService.classifyMediaVisibility).mockReturnValue("public");
    const next = vi.fn() as NextFunction;
    const res = createRes();

    mediaVisibilityGuard("cloud-video")(
      createReq({ params: { filename: "abc.mp4" } as any }),
      res,
      next
    );

    expect(storageService.classifyMediaVisibility).toHaveBeenCalledWith({
      exactPaths: ["cloud:abc.mp4"],
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
