import express from "express";
import fs from "fs-extra";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../middleware/errorHandler";
import {
  registerSpaFallback,
  registerStaticRoutes,
} from "../../server/staticRoutes";

describe("server/staticRoutes integration", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
  });

  it("should return 404 for missing static assets instead of the SPA fallback", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-routes-"));
    tempDirs.push(tempDir);

    const frontendDist = path.join(tempDir, "frontend-dist");
    await fs.ensureDir(path.join(frontendDist, "assets"));
    await fs.writeFile(path.join(frontendDist, "index.html"), "SPA");

    const app = express();
    registerStaticRoutes(app, frontendDist);
    registerSpaFallback(app, frontendDist);
    app.use(errorHandler);

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

    const spaRes = await request(app).get("/home");
    expect(spaRes.status).toBe(200);
    expect(spaRes.text).toBe("SPA");

    const dottedSpaRes = await request(app).get("/author/jane.doe");
    expect(dottedSpaRes.status).toBe(200);
    expect(dottedSpaRes.text).toBe("SPA");
  });
});
