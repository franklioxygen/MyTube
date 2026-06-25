/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isLoginRequiredMock, getRssTokenMock, classifyMediaVisibilityMock } =
  vi.hoisted(() => ({
    isLoginRequiredMock: vi.fn(),
    getRssTokenMock: vi.fn(),
    classifyMediaVisibilityMock: vi.fn(),
  }));

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: isLoginRequiredMock,
}));

vi.mock("../../services/rssService", () => ({
  getRssToken: getRssTokenMock,
}));

vi.mock("../../services/storageService", () => ({
  classifyMediaVisibility: classifyMediaVisibilityMock,
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn() },
}));

import {
  requireAuthenticatedMediaAccess,
  requireVisibleMediaForVisitors,
} from "../../middleware/mediaAuthMiddleware";

describe("middleware/mediaAuthMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createReq = (overrides: Partial<Request> = {}): Request =>
    ({
      cookies: {},
      query: {},
      ...overrides,
    } as unknown as Request);

  const createRes = () => {
    const res: Partial<Response> = {};
    const status = vi.fn().mockReturnValue(res);
    const json = vi.fn().mockReturnValue(res);
    const send = vi.fn().mockReturnValue(res);
    Object.assign(res, { status, json, send });
    return res as Response & {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
  };

  it("allows access when login is not required (single-user mode)", async () => {
    isLoginRequiredMock.mockReturnValue(false);
    const next = vi.fn();
    await requireAuthenticatedMediaAccess(
      createReq(),
      createRes(),
      next as any
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows access for an authenticated session user", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    const next = vi.fn();
    await requireAuthenticatedMediaAccess(
      createReq({ user: { role: "visitor" } as any }),
      createRes(),
      next as any
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows access for an API-key-authenticated request", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    const next = vi.fn();
    await requireAuthenticatedMediaAccess(
      createReq({ apiKeyAuthenticated: true } as any),
      createRes(),
      next as any
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows access with a valid, active RSS token query param", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    getRssTokenMock.mockResolvedValue({ isActive: true });
    const next = vi.fn();
    await requireAuthenticatedMediaAccess(
      createReq({ query: { rss: "550e8400-e29b-41d4-a716-446655440000" } } as any),
      createRes(),
      next as any
    );
    expect(getRssTokenMock).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000"
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows access with a valid RSS token cookie", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    getRssTokenMock.mockResolvedValue({ isActive: true });
    const next = vi.fn();
    await requireAuthenticatedMediaAccess(
      createReq({
        cookies: { mytube_rss_token: "550e8400-e29b-41d4-a716-446655440000" },
      } as any),
      createRes(),
      next as any
    );
    expect(getRssTokenMock).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000"
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects an inactive RSS token", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    getRssTokenMock.mockResolvedValue({ isActive: false });
    const res = createRes();
    await requireAuthenticatedMediaAccess(
      createReq({ query: { rss: "550e8400-e29b-41d4-a716-446655440000" } } as any),
      res,
      vi.fn() as any
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it("rejects an unauthenticated request with no credential", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    getRssTokenMock.mockResolvedValue(null);
    const res = createRes();
    const next = vi.fn();
    await requireAuthenticatedMediaAccess(createReq(), res, next as any);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects when the RSS token is too short to be valid", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    const res = createRes();
    await requireAuthenticatedMediaAccess(
      createReq({ query: { rss: "short" } } as any),
      res,
      vi.fn() as any
    );
    expect(getRssTokenMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects when getRssToken throws (defensive)", async () => {
    isLoginRequiredMock.mockReturnValue(true);
    getRssTokenMock.mockRejectedValue(new Error("db down"));
    const res = createRes();
    await requireAuthenticatedMediaAccess(
      createReq({ query: { rss: "550e8400-e29b-41d4-a716-446655440000" } } as any),
      res,
      vi.fn() as any
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("middleware/requireVisibleMediaForVisitors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createReq = (overrides: Partial<Request> = {}): Request =>
    ({
      cookies: {},
      query: {},
      params: {},
      path: "/secret.mp4",
      ...overrides,
    } as unknown as Request);

  const createRes = () => {
    const res: Partial<Response> = {};
    const status = vi.fn().mockReturnValue(res);
    const send = vi.fn().mockReturnValue(res);
    Object.assign(res, { status, send });
    return res as Response & {
      status: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
  };

  it("skips the check entirely in single-user mode", () => {
    isLoginRequiredMock.mockReturnValue(false);
    const next = vi.fn();
    requireVisibleMediaForVisitors("videos")(createReq(), createRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(classifyMediaVisibilityMock).not.toHaveBeenCalled();
  });

  it("lets admins reach hidden media without classifying", () => {
    isLoginRequiredMock.mockReturnValue(true);
    const next = vi.fn();
    requireVisibleMediaForVisitors("videos")(
      createReq({ user: { role: "admin" } as any }),
      createRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(classifyMediaVisibilityMock).not.toHaveBeenCalled();
  });

  it("lets API-key automation reach hidden media without classifying", () => {
    isLoginRequiredMock.mockReturnValue(true);
    const next = vi.fn();
    requireVisibleMediaForVisitors("videos")(
      createReq({ apiKeyAuthenticated: true } as any),
      createRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(classifyMediaVisibilityMock).not.toHaveBeenCalled();
  });

  it("404s a visitor requesting media that belongs solely to a hidden video", () => {
    isLoginRequiredMock.mockReturnValue(true);
    classifyMediaVisibilityMock.mockReturnValue("hidden");
    const res = createRes();
    const next = vi.fn();
    requireVisibleMediaForVisitors("videos")(
      createReq({ user: { role: "visitor" } as any, path: "/secret.mp4" }),
      res,
      next
    );
    expect(classifyMediaVisibilityMock).toHaveBeenCalledWith({
      exactPaths: ["/videos/secret.mp4"],
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith("Not Found");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a visitor to reach public media", () => {
    isLoginRequiredMock.mockReturnValue(true);
    classifyMediaVisibilityMock.mockReturnValue("public");
    const next = vi.fn();
    requireVisibleMediaForVisitors("images")(
      createReq({ user: { role: "visitor" } as any, path: "/poster.jpg" }),
      createRes(),
      next
    );
    expect(classifyMediaVisibilityMock).toHaveBeenCalledWith({
      exactPaths: ["/images/poster.jpg"],
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows unknown (orphan) media so RSS/shared files keep resolving", () => {
    isLoginRequiredMock.mockReturnValue(true);
    classifyMediaVisibilityMock.mockReturnValue("unknown");
    const next = vi.fn();
    requireVisibleMediaForVisitors("subtitles")(
      createReq({ user: { role: "visitor" } as any, path: "/x.vtt" }),
      createRes(),
      next
    );
    expect(classifyMediaVisibilityMock).toHaveBeenCalledWith({
      subtitlePaths: ["/subtitles/x.vtt"],
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("checks both /images and /videos originals for images-small", () => {
    isLoginRequiredMock.mockReturnValue(true);
    classifyMediaVisibilityMock.mockReturnValue("public");
    requireVisibleMediaForVisitors("images-small")(
      createReq({ user: { role: "visitor" } as any, path: "/poster.jpg" }),
      createRes(),
      vi.fn()
    );
    expect(classifyMediaVisibilityMock).toHaveBeenCalledWith({
      exactPaths: ["/images/poster.jpg", "/videos/poster.jpg"],
    });
  });

  it("classifies cloud routes by the cloud: filename param", () => {
    isLoginRequiredMock.mockReturnValue(true);
    classifyMediaVisibilityMock.mockReturnValue("hidden");
    const res = createRes();
    requireVisibleMediaForVisitors("cloud-video")(
      createReq({ user: { role: "visitor" } as any, params: { filename: "secret.mp4" } } as any),
      res,
      vi.fn()
    );
    expect(classifyMediaVisibilityMock).toHaveBeenCalledWith({
      exactPaths: ["cloud:secret.mp4"],
    });
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
