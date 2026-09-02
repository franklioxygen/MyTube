import express, { Express } from "express";
import fs from "fs-extra";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../middleware/errorHandler";
import {
  registerSpaFallback,
  registerStaticRoutes,
} from "../../server/staticRoutes";

/**
 * `registerStaticRoutes` mounts the media auth stack on /images and /videos,
 * and `requireAuthenticatedMediaAccess` decides what to do by calling
 * `isLoginRequired()`. Unmocked, that reads `loginEnabled` out of the
 * developer's real database at backend/data/mytube.db, which made this suite
 * pass or fail depending on what happened to be in that file and on which
 * other test in the run had last written settings.
 *
 * Only `mediaAuthMiddleware` reaches into passwordService anywhere in this
 * graph, and only for this one function, so replacing it outright is enough.
 */
const auth = vi.hoisted(() => ({ loginRequired: false }));
vi.mock("../../services/passwordService", () => ({
  isLoginRequired: () => auth.loginRequired,
}));

describe("server/staticRoutes integration", () => {
  const tempDirs: string[] = [];
  let app: Express;

  beforeEach(async () => {
    auth.loginRequired = false;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-routes-"));
    tempDirs.push(tempDir);

    const frontendDist = path.join(tempDir, "frontend-dist");
    await fs.ensureDir(path.join(frontendDist, "assets"));
    await fs.writeFile(path.join(frontendDist, "index.html"), "SPA");

    app = express();
    registerStaticRoutes(app, frontendDist);
    registerSpaFallback(app, frontendDist);
    app.use(errorHandler);
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
  });

  describe("when login is not required", () => {
    it("should return 404 for missing static assets instead of the SPA fallback", async () => {
      const imageRes = await request(app).get("/images/missing.jpg");
      expect(imageRes.status).toBe(404);
      expect(imageRes.text).not.toBe("SPA");

      const videoRes = await request(app).get("/videos/missing.mp4");
      expect(videoRes.status).toBe(404);
      expect(videoRes.text).not.toBe("SPA");

      const assetRes = await request(app).get("/assets/missing.js");
      expect(assetRes.status).toBe(404);
      expect(assetRes.text).not.toBe("SPA");

      const faviconRes = await request(app).get("/favicon-missing.ico");
      expect(faviconRes.status).toBe(404);
      expect(faviconRes.text).toBe("Not Found");

      const apiRes = await request(app).get("/api/missing");
      expect(apiRes.status).toBe(404);
      expect(apiRes.body).toEqual({ error: "Not Found" });

      const feedRes = await request(app).get("/feed/not-a-real-token");
      expect(feedRes.status).toBe(404);
      expect(feedRes.text).not.toBe("SPA");
    });

    it("should serve the SPA for application routes", async () => {
      const spaRes = await request(app).get("/home");
      expect(spaRes.status).toBe(200);
      expect(spaRes.text).toBe("SPA");

      const dottedSpaRes = await request(app).get("/author/jane.doe");
      expect(dottedSpaRes.status).toBe(200);
      expect(dottedSpaRes.text).toBe("SPA");
    });
  });

  describe("when login is required", () => {
    beforeEach(() => {
      auth.loginRequired = true;
    });

    it("should return 401 for unauthenticated media requests", async () => {
      // The guard runs ahead of the static handler, so an unauthenticated
      // caller cannot tell a missing file from one that exists.
      for (const url of ["/images/missing.jpg", "/videos/missing.mp4"]) {
        const res = await request(app).get(url);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ success: false });
        expect(res.text).not.toBe("SPA");
      }
    });

    it("should still 404 for non-media assets, which carry no media guard", async () => {
      const assetRes = await request(app).get("/assets/missing.js");
      expect(assetRes.status).toBe(404);

      const faviconRes = await request(app).get("/favicon-missing.ico");
      expect(faviconRes.status).toBe(404);

      const apiRes = await request(app).get("/api/missing");
      expect(apiRes.status).toBe(404);
    });

    it("should still serve the SPA, which is what renders the login wall", async () => {
      const spaRes = await request(app).get("/home");
      expect(spaRes.status).toBe(200);
      expect(spaRes.text).toBe("SPA");
    });
  });
});
