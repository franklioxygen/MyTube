import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import request from "supertest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Media roots point at a scratch directory instead of backend/uploads.
vi.mock("../../config/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths")>();
  const nodeFs = await import("fs");
  const nodeOs = await import("os");
  const nodePath = await import("path");
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "federation-assets-"));
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

import {
  AVATARS_DIR,
  IMAGES_DIR,
  SUBTITLES_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { db, sqlite } from "../../db";
import { videos } from "../../db/schema";
import federationProtocolRoutes from "../../routes/federationProtocolRoutes";
import { countFederationStreams } from "../../services/federation/activeStreams";
import { subtitleTrackId } from "../../services/federation/libraryExport";
import {
  mintFederationToken,
  revokeFederationToken,
  type MintFederationTokenInput,
} from "../../services/federation/tokenService";
import { initializeStorage } from "../../services/storageService/initialization";

const PRIME = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const MEDIA = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
const LARGE_SIZE = 16 * 1024 * 1024;

const app = () => {
  const server = express();
  server.use("/api/federation/v1", federationProtocolRoutes);
  return server;
};

const mint = (overrides: Partial<MintFederationTokenInput> = {}) =>
  mintFederationToken({
    label: "prime",
    scopes: ["library:read", "media:read"],
    visibilityCeiling: "public",
    expiresAt: null,
    ...overrides,
  });

const headersFor = (credential: string) => ({
  Authorization: `Federation ${credential}`,
  "X-MyTube-Instance-Id": PRIME,
});

const get = (credential: string, url: string) =>
  request(app()).get(`/api/federation/v1${url}`).set(headersFor(credential));

const write = (file: string, content: Buffer | string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

let mountFile: string;
const vttPath = "/subtitles/clip.en.vtt";

beforeAll(() => {
  migrate(db, { migrationsFolder: "drizzle" });
  initializeStorage();

  write(path.join(VIDEOS_DIR, "sub dir", "clip.mp4"), MEDIA);
  write(path.join(VIDEOS_DIR, "hidden.mp4"), MEDIA);
  write(path.join(VIDEOS_DIR, "large.mp4"), Buffer.alloc(LARGE_SIZE, 7));
  write(path.join(IMAGES_DIR, "clip.jpg"), "jpeg-bytes");
  write(path.join(AVATARS_DIR, "alice.jpg"), "avatar-bytes");
  write(path.join(SUBTITLES_DIR, "clip.en.vtt"), "WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n");
  mountFile = path.join(UPLOADS_DIR, "..", path.basename(UPLOADS_DIR) + "-mount", "movie.mkv");
  write(mountFile, MEDIA);
});

beforeEach(() => {
  sqlite.exec("DELETE FROM federation_tokens; DELETE FROM videos;");
  const now = new Date().toISOString();
  db.insert(videos)
    .values([
      {
        id: "local",
        title: "Local clip",
        author: "Alice",
        description: "A description",
        createdAt: now,
        visibility: 1,
        videoPath: "/videos/sub dir/clip.mp4",
        thumbnailPath: "/images/clip.jpg",
        authorAvatarPath: "/avatars/alice.jpg",
        subtitles: JSON.stringify([
          { path: vttPath, language: "en" },
          { path: "https://subs.example/remote.vtt", language: "fr" },
        ]),
      },
      { id: "mounted", title: "Mounted", createdAt: now, videoPath: `mount:${mountFile}` },
      { id: "hidden", title: "Hidden", createdAt: now, visibility: 0, videoPath: "/videos/hidden.mp4" },
      { id: "large", title: "Large", createdAt: now, videoPath: "/videos/large.mp4" },
      { id: "missing-file", title: "Gone", createdAt: now, videoPath: "/videos/gone.mp4" },
      { id: "cloud", title: "Cloud", createdAt: now, videoPath: "cloud:remote.mp4", thumbnailPath: "cloud:remote.jpg" },
      { id: "traversal", title: "Traversal", createdAt: now, videoPath: "/videos/../../../etc/hosts" },
    ])
    .run();
});

afterAll(() => {
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  fs.rmSync(path.dirname(mountFile), { recursive: true, force: true });
});

describe("video detail", () => {
  it("returns description and local subtitle tracks without any storage paths", async () => {
    const response = await get(mint().credential, "/videos/local?audience=public");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "local",
      description: "A description",
      assets: { media: true, thumbnail: true, avatar: true, subtitles: true },
      subtitles: [{ trackId: subtitleTrackId(vttPath), language: "en", format: "vtt" }],
    });
    for (const leaked of ["/videos/", "/images/", "/avatars/", "/subtitles/", "subs.example"]) {
      expect(JSON.stringify(response.body), leaked).not.toContain(leaked);
    }
  });

  it("reports cloud media as unavailable until it can be streamed", async () => {
    const response = await get(mint().credential, "/videos/cloud?audience=public");
    expect(response.body.assets).toMatchObject({ media: false, thumbnail: false });
  });

  it("makes hidden and unknown videos indistinguishable to the public audience", async () => {
    const { credential } = mint();
    const hidden = await get(credential, "/videos/hidden?audience=owner");
    const unknown = await get(credential, "/videos/nope?audience=public");

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(unknown.body);
    expect((await get(mint({ visibilityCeiling: "owner" }).credential, "/videos/hidden?audience=owner")).status).toBe(200);
  });

  it("requires library:read", async () => {
    const response = await get(mint({ scopes: ["media:read"] }).credential, "/videos/local?audience=public");
    expect(response.status).toBe(403);
  });
});

describe("video assets", () => {
  const media = (credential: string, id = "local") =>
    get(credential, `/videos/${id}/assets/media?audience=public`);

  it("streams local media with validators and without caching", async () => {
    const response = await media(mint().credential).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });

    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body as Buffer, MEDIA)).toBe(0);
    expect(response.headers).toMatchObject({
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-length": "1000",
    });
    expect(response.headers.etag).toBeTruthy();
    expect(response.headers["last-modified"]).toBeTruthy();
    expect(countFederationStreams()).toBe(0);
  });

  it("serves byte ranges, HEAD, conditional requests and unsatisfiable ranges", async () => {
    const { credential } = mint();

    const range = await media(credential).set("Range", "bytes=10-19");
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toBe("bytes 10-19/1000");
    expect(range.headers["content-length"]).toBe("10");

    const head = await request(app())
      .head("/api/federation/v1/videos/local/assets/media?audience=public")
      .set(headersFor(credential));
    expect(head.status).toBe(200);
    expect(head.headers["content-length"]).toBe("1000");

    const etag = head.headers.etag;
    expect((await media(credential).set("If-None-Match", etag)).status).toBe(304);
    const unsatisfiable = await media(credential).set("Range", "bytes=5000-");
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers["content-range"]).toBe("bytes */1000");
  });

  it("streams mounted-directory media", async () => {
    const response = await media(mint().credential, "mounted");
    expect(response.status).toBe(200);
    expect(response.headers["content-length"]).toBe("1000");
  });

  it("serves thumbnails, the author's avatar and local subtitle tracks", async () => {
    const { credential } = mint();

    const thumbnail = await get(credential, "/videos/local/assets/thumbnail?audience=public");
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers["content-type"]).toBe("image/jpeg");

    expect((await get(credential, "/videos/local/assets/avatar?audience=public")).status).toBe(200);

    const subtitle = await get(
      credential,
      `/videos/local/assets/subtitle?audience=public&track=${subtitleTrackId(vttPath)}`
    );
    expect(subtitle.status).toBe(200);
    expect(subtitle.headers["content-type"]).toBe("text/vtt; charset=utf-8");
    expect(subtitle.text).toContain("WEBVTT");
  });

  it("checks visibility for the effective audience on every asset request", async () => {
    const { credential } = mint();
    const owner = mint({ visibilityCeiling: "owner" }).credential;

    expect((await media(credential, "hidden")).body.code).toBe("FEDERATION_VIDEO_NOT_FOUND");
    expect((await get(credential, "/videos/hidden/assets/media?audience=owner")).status).toBe(404);
    expect((await get(owner, "/videos/hidden/assets/media?audience=public")).status).toBe(404);
    expect((await get(owner, "/videos/hidden/assets/media?audience=owner")).status).toBe(200);
  });

  it.each([
    ["a missing file", "/videos/missing-file/assets/media"],
    ["cloud media", "/videos/cloud/assets/media"],
    ["cloud thumbnails", "/videos/cloud/assets/thumbnail"],
    ["a stored path that escapes its root", "/videos/traversal/assets/media"],
    ["a subtitle without a track", "/videos/local/assets/subtitle"],
    ["an unknown track", "/videos/local/assets/subtitle?track=unknown"],
    ["a remote subtitle", `/videos/local/assets/subtitle?track=${subtitleTrackId("https://subs.example/remote.vtt")}`],
  ])("reports %s as an unavailable asset", async (_name, url) => {
    const separator = url.includes("?") ? "&" : "?";
    const response = await get(mint().credential, `${url}${separator}audience=public`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("FEDERATION_ASSET_UNAVAILABLE");
  });

  it("rejects unknown asset kinds and credentials without media:read", async () => {
    expect((await get(mint().credential, "/videos/local/assets/description?audience=public")).status).toBe(400);

    const libraryOnly = mint({ scopes: ["library:read"] }).credential;
    const denied = await get(libraryOnly, "/videos/local/assets/media?audience=public");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FEDERATION_SCOPE_REQUIRED");
  });

  it("ends a transfer as soon as its token is revoked", async () => {
    const { token, credential } = mint();
    const server = app().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const received = await new Promise<number>((resolve) => {
        let bytes = 0;
        const req = http.get(
          {
            host: "127.0.0.1",
            port,
            path: "/api/federation/v1/videos/large/assets/media?audience=public",
            headers: headersFor(credential),
          },
          (res) => {
            expect(res.statusCode).toBe(200);
            res.once("data", (chunk: Buffer) => {
              bytes += chunk.length;
              res.pause();
              expect(countFederationStreams()).toBe(1);
              revokeFederationToken(token.id);
              res.on("data", (more: Buffer) => {
                bytes += more.length;
              });
              res.resume();
            });
            res.on("close", () => resolve(bytes));
          }
        );
        req.on("error", () => resolve(bytes));
      });

      expect(received).toBeLessThan(LARGE_SIZE);
      expect(countFederationStreams()).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
