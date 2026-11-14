import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import zlib from "zlib";
import request from "supertest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  origin: "",
  enabled: true,
  signedUrl: undefined as string | undefined,
  cachedThumbnail: null as string | null,
}));

// Media roots point at a scratch directory instead of backend/uploads.
vi.mock("../../config/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths")>();
  const nodeFs = await import("fs");
  const nodeOs = await import("os");
  const nodePath = await import("path");
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "federation-cloud-"));
  const dir = (name: string) => {
    const full = nodePath.join(root, name);
    nodeFs.mkdirSync(full, { recursive: true });
    return full;
  };
  return {
    ...actual,
    UPLOADS_DIR: root,
    VIDEOS_DIR: dir("videos"),
    IMAGES_DIR: dir("images"),
    IMAGES_SMALL_DIR: dir("images-small"),
    AVATARS_DIR: dir("avatars"),
    SUBTITLES_DIR: dir("subtitles"),
    CLOUD_THUMBNAIL_CACHE_DIR: dir("cloud-thumbnail-cache"),
  };
});

vi.mock("../../services/cloudStorage/config", () => ({
  getConfig: () => ({
    enabled: state.enabled,
    apiUrl: `${state.origin}/api/fs/put`,
    token: "openlist-token",
    publicUrl: undefined,
    uploadPath: "/",
  }),
  isConfigured: (config: { enabled: boolean; apiUrl: string; token: string }) =>
    config.enabled && !!config.apiUrl && !!config.token,
}));

// Stands in for OpenList signing: a fresh signed link per request.
const getSignedUrl = vi.fn(async (filename: string) =>
  state.signedUrl ?? `${state.origin}/d/${filename}?sign=secret-sign`
);
vi.mock("../../services/CloudStorageService", () => ({
  CloudStorageService: { getSignedUrl: (filename: string) => getSignedUrl(filename) },
}));

vi.mock("../../services/cloudStorage/cloudThumbnailCache", () => ({
  getCachedThumbnail: () => state.cachedThumbnail,
}));

import { CLOUD_THUMBNAIL_CACHE_DIR, UPLOADS_DIR } from "../../config/paths";
import { db, sqlite } from "../../db";
import { videos } from "../../db/schema";
import federationProtocolRoutes from "../../routes/federationProtocolRoutes";
import { countFederationStreams } from "../../services/federation/activeStreams";
import { proxyCloudAsset } from "../../services/federation/cloudAssetProxy";
import {
  mintFederationToken,
  revokeFederationToken,
} from "../../services/federation/tokenService";
import { initializeStorage } from "../../services/storageService/initialization";

const PRIME = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const MEDIA = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 7) % 256));

// --- A fake OpenList storage server on loopback ---------------------------
const upstreamRequests: http.IncomingHttpHeaders[] = [];
const upstreamClosed = vi.fn();
let storage: http.Server;
let mediaFile: string;

const startStorage = async () => {
  const server = express();
  server.use((req, _res, next) => {
    upstreamRequests.push(req.headers);
    next();
  });
  server.get("/d/remote.mp4", (_req, res) => res.sendFile(mediaFile));
  server.get("/d/thumb.jpg", (_req, res) => res.type("image/jpeg").send("remote-thumb"));
  server.get("/d/redirect.mp4", (_req, res) => res.redirect(302, "/d/remote.mp4"));
  server.get("/d/escape.mp4", (req, res) =>
    res.redirect(302, `http://localhost:${(req.socket.address() as AddressInfo).port}/d/remote.mp4`)
  );
  server.get("/d/missing.mp4", (_req, res) => res.status(404).send("no such object"));
  server.get("/d/forbidden.mp4", (_req, res) => res.status(403).send("bad openlist token"));
  server.get("/d/cookie.mp4", (_req, res) => {
    res.setHeader("Set-Cookie", "openlist=session");
    res.setHeader("X-Internal", "leak");
    res.sendFile(mediaFile);
  });
  // Sends headers and a first chunk, then keeps trickling until aborted.
  server.get("/d/stream.mp4", (_req, res) => {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    const tick = setInterval(() => res.write(Buffer.alloc(64 * 1024, 1)), 10);
    res.on("close", () => {
      clearInterval(tick);
      // This response never ends by itself: a close is the proxy aborting it.
      if (!res.writableFinished) upstreamClosed();
    });
  });
  // Encoded although identity was asked for.
  server.get("/d/encoded.mp4", (_req, res) => {
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Encoding": "gzip" });
    res.end(zlib.gzipSync(MEDIA));
  });
  // Sends headers and one chunk, then stalls.
  server.get("/d/stall.mp4", (_req, res) => {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.write("first");
  });
  // Never answers.
  server.get("/d/silent.mp4", () => undefined);

  storage = server.listen(0);
  await new Promise((resolve) => storage.once("listening", resolve));
  state.origin = `http://127.0.0.1:${(storage.address() as AddressInfo).port}`;
};

const app = () => {
  const server = express();
  server.use("/api/federation/v1", federationProtocolRoutes);
  return server;
};

const mint = () =>
  mintFederationToken({
    label: "prime",
    scopes: ["library:read", "media:read"],
    visibilityCeiling: "public",
    expiresAt: null,
  });

const headersFor = (credential: string) => ({
  Authorization: `Federation ${credential}`,
  "X-MyTube-Instance-Id": PRIME,
});

const get = (credential: string, url: string) =>
  request(app()).get(`/api/federation/v1${url}`).set(headersFor(credential));

const cloudVideo = (id: string, filename: string, extra: Partial<typeof videos.$inferInsert> = {}) => ({
  id,
  title: id,
  createdAt: new Date().toISOString(),
  videoPath: `cloud:${filename}`,
  ...extra,
});

beforeAll(async () => {
  process.env.NO_PROXY = "127.0.0.1,localhost";
  migrate(db, { migrationsFolder: "drizzle" });
  initializeStorage();
  mediaFile = path.join(UPLOADS_DIR, "upstream-media.mp4");
  fs.writeFileSync(mediaFile, MEDIA);
  await startStorage();
});

beforeEach(() => {
  state.enabled = true;
  state.signedUrl = undefined;
  state.cachedThumbnail = null;
  upstreamRequests.length = 0;
  upstreamClosed.mockClear();
  getSignedUrl.mockClear();
  sqlite.exec("DELETE FROM federation_tokens; DELETE FROM videos;");
  db.insert(videos)
    .values([
      cloudVideo("cloud", "remote.mp4", { thumbnailPath: "cloud:thumb.jpg" }),
      cloudVideo("redirect", "redirect.mp4"),
      cloudVideo("escape", "escape.mp4"),
      cloudVideo("missing", "missing.mp4"),
      cloudVideo("forbidden", "forbidden.mp4"),
      cloudVideo("cookie", "cookie.mp4"),
      cloudVideo("stream", "stream.mp4"),
      cloudVideo("encoded", "encoded.mp4"),
    ])
    .run();
});

afterAll(async () => {
  await new Promise((resolve) => storage.close(resolve));
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
});

describe("cloud assets", () => {
  it("advertises cloud storage and reports cloud items available only while configured", async () => {
    const { credential } = mint();
    expect((await get(credential, "/capabilities")).body.assets.mediaStorage).toEqual(["local", "mount", "cloud"]);
    expect((await get(credential, "/videos/cloud?audience=public")).body.assets).toMatchObject({
      media: true,
      thumbnail: true,
    });

    state.enabled = false;
    expect((await get(credential, "/capabilities")).body.assets.mediaStorage).toEqual(["local", "mount"]);
    expect((await get(credential, "/videos/cloud?audience=public")).body.assets).toMatchObject({
      media: false,
      thumbnail: false,
    });
    const media = await get(credential, "/videos/cloud/assets/media?audience=public");
    expect(media.status).toBe(404);
    expect(media.body.code).toBe("FEDERATION_ASSET_UNAVAILABLE");
    expect(upstreamRequests).toHaveLength(0);
  });

  it("streams through this instance without exposing the signed link or credentials", async () => {
    const response = await get(mint().credential, "/videos/cloud/assets/media?audience=public")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body as Buffer, MEDIA)).toBe(0);
    expect(response.headers).toMatchObject({
      "content-type": "video/mp4",
      "content-length": "1000",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    expect(JSON.stringify(response.headers)).not.toContain("sign");

    // Nothing of the consumer's request beyond the allowed headers went upstream.
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]).not.toHaveProperty("authorization");
    expect(upstreamRequests[0]).not.toHaveProperty("x-mytube-instance-id");
    expect(upstreamRequests[0]["accept-encoding"]).toBe("identity");
    expect(countFederationStreams()).toBe(0);
  });

  it("forwards Range, conditional requests and HEAD", async () => {
    const { credential } = mint();
    const url = "/videos/cloud/assets/media?audience=public";

    const range = await get(credential, url).set("Range", "bytes=100-199");
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toBe("bytes 100-199/1000");
    expect(upstreamRequests[upstreamRequests.length - 1].range).toBe("bytes=100-199");

    const head = await request(app()).head(`/api/federation/v1${url}`).set(headersFor(credential));
    expect(head.status).toBe(200);
    expect(head.headers["content-length"]).toBe("1000");

    expect((await get(credential, url).set("If-None-Match", head.headers.etag)).status).toBe(304);

    const unsatisfiable = await get(credential, url).set("Range", "bytes=5000-");
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers["content-range"]).toBe("bytes */1000");
  });

  it("passes only content and validator headers back", async () => {
    const response = await get(mint().credential, "/videos/cookie/assets/media?audience=public");
    expect(response.status).toBe(200);
    expect(response.headers).not.toHaveProperty("set-cookie");
    expect(response.headers).not.toHaveProperty("x-internal");
  });

  it("keeps the encoding of bytes storage encoded anyway", async () => {
    const response = await get(mint().credential, "/videos/encoded/assets/media?audience=public")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    // The client decoded it, so the label matched the bytes.
    expect(Buffer.compare(response.body as Buffer, MEDIA)).toBe(0);
  });

  it("follows redirects within the storage origin but not to other private hosts", async () => {
    const { credential } = mint();
    expect((await get(credential, "/videos/redirect/assets/media?audience=public")).status).toBe(200);

    const escaped = await get(credential, "/videos/escape/assets/media?audience=public");
    expect(escaped.status).toBe(502);
    expect(escaped.body.code).toBe("FEDERATION_UPSTREAM_ERROR");
  });

  it("refuses a signed link outside the configured storage origin", async () => {
    state.signedUrl = "http://attacker.example/d/remote.mp4?sign=x";
    const response = await get(mint().credential, "/videos/cloud/assets/media?audience=public");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("FEDERATION_ASSET_UNAVAILABLE");
  });

  it("maps a missing object to an unavailable asset and storage faults to 502", async () => {
    const { credential } = mint();
    const missing = await get(credential, "/videos/missing/assets/media?audience=public");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("FEDERATION_ASSET_UNAVAILABLE");

    // A storage auth failure must not look like a federation auth failure.
    const forbidden = await get(credential, "/videos/forbidden/assets/media?audience=public");
    expect(forbidden.status).toBe(502);
  });

  it("serves a locally cached cloud thumbnail before asking storage", async () => {
    const { credential } = mint();
    const cached = path.join(CLOUD_THUMBNAIL_CACHE_DIR, "thumb-cache.jpg");
    fs.writeFileSync(cached, "cached-thumb");

    state.cachedThumbnail = cached;
    const local = await get(credential, "/videos/cloud/assets/thumbnail?audience=public");
    expect(local.status).toBe(200);
    expect(local.text ?? local.body.toString()).toContain("cached-thumb");
    expect(upstreamRequests).toHaveLength(0);

    state.cachedThumbnail = null;
    const remote = await get(credential, "/videos/cloud/assets/thumbnail?audience=public");
    expect(remote.status).toBe(200);
    expect(upstreamRequests).toHaveLength(1);
  });

  it("aborts the storage request when the token is revoked mid-transfer", async () => {
    const { token, credential } = mint();
    const server = app().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      let status = 0;
      let abortedBeforeRevoke = -1;
      await new Promise<void>((resolve) => {
        const req = http.get(
          {
            host: "127.0.0.1",
            port,
            path: "/api/federation/v1/videos/stream/assets/media?audience=public",
            headers: headersFor(credential),
          },
          (res) => {
            status = res.statusCode ?? 0;
            res.once("data", () => {
              abortedBeforeRevoke = upstreamClosed.mock.calls.length;
              revokeFederationToken(token.id);
            });
            res.on("data", () => undefined);
            res.on("close", () => resolve());
          }
        );
        req.on("error", () => resolve());
      });
      // The transfer had started and storage was still streaming; only the
      // revocation aborted it.
      expect(status).toBe(200);
      expect(abortedBeforeRevoke).toBe(0);
      await vi.waitFor(() => expect(upstreamClosed).toHaveBeenCalledTimes(1));
      expect(countFederationStreams()).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("cloud proxy timeouts", () => {
  const proxyApp = (filename: string, fail: (reason: string) => void) => {
    const server = express();
    server.get("/", (req, res) => {
      void proxyCloudAsset(req, res, filename, "video", (reason) => {
        fail(reason);
        res.status(reason === "upstream_timeout" ? 504 : 502).end();
      }, { firstByteTimeoutMs: 100, idleTimeoutMs: 100 });
    });
    return server;
  };

  it("does not contact storage for a consumer that is already gone", async () => {
    const fail = vi.fn();
    let proxied!: Promise<void>;
    const server = express();
    server.get("/", (req, res) => {
      res.destroy();
      proxied = proxyCloudAsset(req, res, "remote.mp4", "video", fail);
    });
    await request(server).get("/").catch(() => undefined);
    await proxied;
    expect(upstreamRequests).toHaveLength(0);
    expect(fail).not.toHaveBeenCalled();
  });

  it("gives up when storage sends nothing before the first-byte deadline", async () => {
    const fail = vi.fn();
    const response = await request(proxyApp("silent.mp4", fail)).get("/");
    expect(response.status).toBe(504);
    expect(fail).toHaveBeenCalledWith("upstream_timeout");
  });

  it("cuts a stream that stalls after it started", async () => {
    const fail = vi.fn();
    const outcome = await request(proxyApp("stall.mp4", fail))
      .get("/")
      .then(() => "completed")
      .catch(() => "cut");
    expect(outcome).toBe("cut");
    // Headers were already sent, so this is not reported as a clean failure.
    expect(fail).not.toHaveBeenCalled();
  });
});
