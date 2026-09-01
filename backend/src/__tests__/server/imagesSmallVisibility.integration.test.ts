/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import request from "supertest";
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
vi.mock("../../services/rssService", () => ({ getRssToken: getRssTokenMock }));
vi.mock("../../services/storageService", () => ({
  classifyMediaVisibility: classifyMediaVisibilityMock,
}));
vi.mock("../../utils/logger", () => ({ logger: { warn: vi.fn() } }));

import { requireVisibleMediaForVisitors } from "../../middleware/mediaAuthMiddleware";

const HIDDEN_ORIGINALS = ["/images/hidden/poster.jpg", "/videos/hidden/poster.jpg"];

describe("images-small visibility guard (Express 5 wildcard)", () => {
  const seenPaths: string[][] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    seenPaths.length = 0;
    isLoginRequiredMock.mockReturnValue(true);
    classifyMediaVisibilityMock.mockImplementation((opts: any) => {
      const paths: string[] = opts.exactPaths ?? [];
      seenPaths.push(paths);
      return paths.some((p) => HIDDEN_ORIGINALS.includes(p))
        ? "hidden"
        : "unknown";
    });
  });

  // Mirrors registerStaticRoutes: an explicit GET that ensures the small
  // thumbnail exists and falls through, then the use() mount that serves it.
  const buildApp = () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { role: "visitor" };
      next();
    });
    app.get(
      "/images-small/{*splat}",
      requireVisibleMediaForVisitors("images-small"),
      (_req, _res, next) => next()
    );
    app.use(
      "/images-small",
      requireVisibleMediaForVisitors("images-small"),
      (_req, res) => res.send("THUMB BYTES")
    );
    return app;
  };

  it("does not serve a visitor the small thumbnail of a hidden video", async () => {
    const response = await request(buildApp()).get(
      "/images-small/hidden/poster.jpg"
    );

    expect(response.text).not.toBe("THUMB BYTES");
    expect(response.status).toBe(404);
  });

  it("still serves a visitor a public small thumbnail", async () => {
    const response = await request(buildApp()).get(
      "/images-small/public/poster.jpg"
    );

    expect(response.status).toBe(200);
    expect(response.text).toBe("THUMB BYTES");
  });

  it("classifies the wildcard route against the real original paths", async () => {
    await request(buildApp()).get("/images-small/hidden/poster.jpg");

    // The explicit GET route must resolve /images-small/hidden/poster.jpg to
    // the originals it mirrors, not to a doubled /images/images-small/... path.
    expect(seenPaths[0]).toEqual(HIDDEN_ORIGINALS);
  });
});
