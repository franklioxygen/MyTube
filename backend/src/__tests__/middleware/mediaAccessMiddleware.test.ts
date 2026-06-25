import crypto from "crypto";
import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canVisitorAccessMedia,
  getRequestedMediaCandidates,
  mediaAccessMiddleware,
} from "../../middleware/mediaAccessMiddleware";
import { isLoginRequired } from "../../services/passwordService";
import * as storageService from "../../services/storageService";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  getVideos: vi.fn(),
}));

const createRes = () => {
  const res: Partial<Response> = {};
  Object.assign(res, {
    status: vi.fn().mockReturnValue(res),
    send: vi.fn().mockReturnValue(res),
  });
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
};

describe("mediaAccessMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLoginRequired).mockReturnValue(true);
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "public",
        title: "Public",
        sourceUrl: "https://example.com/public",
        createdAt: "2026-01-01",
        visibility: 1,
        videoPath: "/videos/public.mp4",
        thumbnailPath: "/images/public.jpg",
        authorAvatarPath: "/avatars/public.jpg",
        subtitles: [
          {
            language: "en",
            filename: "public.vtt",
            path: "/subtitles/public.vtt",
          },
        ],
      },
      {
        id: "hidden",
        title: "Hidden",
        sourceUrl: "https://example.com/hidden",
        createdAt: "2026-01-01",
        visibility: 0,
        videoPath: "/videos/hidden.mp4",
        thumbnailPath: "cloud:hidden.jpg",
      },
    ] as any);
  });

  it("allows media when login is disabled", () => {
    vi.mocked(isLoginRequired).mockReturnValue(false);
    const req = { baseUrl: "/videos", path: "/hidden.mp4" } as Request;
    const res = createRes();
    const next = vi.fn();

    mediaAccessMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks unauthenticated media when login is required", () => {
    const req = { baseUrl: "/videos", path: "/public.mp4" } as Request;
    const res = createRes();
    const next = vi.fn();

    mediaAccessMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith("Authentication required");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows admins to access protected media", () => {
    const req = {
      baseUrl: "/videos",
      path: "/hidden.mp4",
      user: { role: "admin" },
    } as Request;
    const res = createRes();
    const next = vi.fn();

    mediaAccessMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows visitors to access media attached to public videos", () => {
    const req = {
      baseUrl: "/images",
      path: "/public.jpg",
      user: { role: "visitor" },
    } as Request;
    const res = createRes();
    const next = vi.fn();

    mediaAccessMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("hides media that is only attached to hidden videos from visitors", () => {
    const req = {
      baseUrl: "/videos",
      path: "/hidden.mp4",
      user: { role: "visitor" },
    } as Request;
    const res = createRes();
    const next = vi.fn();

    mediaAccessMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith("Not Found");
    expect(next).not.toHaveBeenCalled();
  });

  it("maps small thumbnail requests back to public original thumbnails", () => {
    const req = {
      baseUrl: "/images-small",
      path: "/public.jpg",
    } as Request;

    expect(getRequestedMediaCandidates(req)).toEqual([
      "/images/public.jpg",
      "/videos/public.jpg",
    ]);
  });

  it("authorizes cached cloud thumbnails only for public matching videos", () => {
    const publicCacheName = `${crypto
      .createHash("sha256")
      .update("cloud:public-cloud.jpg")
      .digest("hex")}.jpg`;

    expect(
      canVisitorAccessMedia(
        [`/api/cloud/thumbnail-cache/${publicCacheName}`],
        [
          {
            id: "public-cloud",
            title: "Public Cloud",
            sourceUrl: "https://example.com/public-cloud",
            createdAt: "2026-01-01",
            visibility: 1,
            thumbnailPath: "cloud:public-cloud.jpg",
          } as any,
        ]
      )
    ).toBe(true);
  });
});
