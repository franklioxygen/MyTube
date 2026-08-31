import express from "express";
import fs from "fs-extra";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../middleware/errorHandler";

// The unit tests in middleware/errorHandler.test.ts drive the handler with a
// mock res that does not track headers. send writes Content-Range onto the
// response before forwarding its 416, and a client resuming past EOF needs that
// header to learn the real length -- so assert it survives on a real response.
describe("unsatisfiable range integration", () => {
  const tempDirs: string[] = [];
  const CONTENT_LENGTH = 4096;
  const FIXTURE_NAME = "clip.bin";

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
  });

  const buildApp = async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "range-"));
    tempDirs.push(tempDir);
    await fs.writeFile(
      path.join(tempDir, FIXTURE_NAME),
      Buffer.alloc(CONTENT_LENGTH, 7)
    );

    const app = express();
    // Mirrors registerStaticRoutes' media mounts.
    app.use("/videos", express.static(tempDir, { fallthrough: false }));
    // Mirrors videoController's res.sendFile() download path. The filename is
    // fixed rather than taken from the request: production never routes request
    // input into sendFile, it always derives the path server-side.
    app.get("/download", (_req, res, next) => {
      res.sendFile(FIXTURE_NAME, { root: tempDir }, (err) => {
        if (err) {
          next(err);
        }
      });
    });
    app.use(errorHandler);
    return app;
  };

  it.each([
    ["static mount", "/videos/clip.bin"],
    ["res.sendFile", "/download"],
  ])(
    "answers an unsatisfiable range on the %s with 416 and a Content-Range",
    async (_label, url) => {
      const response = await request(await buildApp())
        .get(url)
        .set("Range", "bytes=99999999999-");

      expect(response.status).toBe(416);
      expect(response.headers["content-range"]).toBe(`bytes */${CONTENT_LENGTH}`);
    }
  );

  it("still serves a satisfiable range as a 206", async () => {
    const response = await request(await buildApp())
      .get("/videos/clip.bin")
      .set("Range", "bytes=0-1023");

    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe(`bytes 0-1023/${CONTENT_LENGTH}`);
    expect(response.body.length).toBe(1024);
  });

  it("serves the whole file when no range is requested", async () => {
    const response = await request(await buildApp()).get("/videos/clip.bin");

    expect(response.status).toBe(200);
    expect(response.headers["content-range"]).toBeUndefined();
  });
});
