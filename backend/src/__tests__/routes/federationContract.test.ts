import express from "express";
import request from "supertest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db";
import { videos } from "../../db/schema";
import federationProtocolRoutes from "../../routes/federationProtocolRoutes";
import { mintFederationToken } from "../../services/federation/tokenService";
import {
  parseCapabilities,
  parseDetail,
  parseLibraryRevision,
  parseSnapshotDescriptor,
  parseSnapshotPage,
} from "../../services/federation/protocolSchema";
import { initializeStorage } from "../../services/storageService/initialization";

/**
 * Layer-2 contract: the real peer router's responses must pass the prime's
 * validators unchanged. If the peer starts exporting a field the prime does
 * not understand (or stops sending one it needs), this fails.
 */

const PRIME = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
let credential: string;

const app = express();
app.use(express.json());
app.use("/api/federation/v1", federationProtocolRoutes);

const call = (method: "get" | "post", path: string, body?: object) => {
  const pending = request(app)[method](`/api/federation/v1${path}`).set({
    Authorization: `Federation ${credential}`,
    "X-MyTube-Instance-Id": PRIME,
  });
  return body ? pending.send(body) : pending;
};

beforeAll(() => {
  migrate(db, { migrationsFolder: "drizzle" });
  initializeStorage();
  credential = mintFederationToken({
    label: "contract",
    scopes: ["library:read", "media:read"],
    visibilityCeiling: "owner",
    expiresAt: null,
  }).credential;

  db.insert(videos)
    .values([
      {
        id: "full",
        title: "Every field",
        author: "Alice",
        date: "20260101",
        source: "youtube",
        sourceUrl: "https://www.youtube.com/watch?v=abc",
        sourceVideoId: "abc",
        channelUrl: "https://www.youtube.com/@alice",
        addedAt: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        partNumber: 2,
        totalParts: 3,
        seriesTitle: "Series",
        rating: 4,
        duration: "125",
        width: 1920,
        height: 1080,
        fileSize: "123456",
        mediaType: "video",
        // A legacy non-string tag is dropped by the peer, not passed on.
        tags: JSON.stringify(["music", 7, "live"]),
        visibility: 0,
        description: "Long description",
        videoPath: "/videos/full.mp4",
        thumbnailPath: "/images/full.jpg",
        authorAvatarPath: "/avatars/alice.jpg",
        subtitles: JSON.stringify([{ path: "/subtitles/full.en.vtt", language: "en" }]),
      },
      { id: "sparse", title: "Mostly empty", createdAt: "2026-01-01T00:00:00.000Z" },
      {
        // Downloads, imports and merges can store values past the protocol
        // limits; one such row must not fail the whole snapshot.
        id: "oversized",
        title: "t".repeat(5000),
        author: "a".repeat(3000),
        sourceUrl: `https://example.com/${"p".repeat(3000)}`,
        duration: "d".repeat(100),
        tags: JSON.stringify(["ok", "x".repeat(600)]),
        description: "long",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    .run();
});

describe("peer responses satisfy the prime's validators", () => {
  it("capabilities and revision", async () => {
    const capabilities = (await call("get", "/capabilities")).body;
    expect(parseCapabilities(capabilities)).toMatchObject({
      protocolVersions: [1],
      features: expect.arrayContaining(["snapshots"]),
      credential: { visibilityCeiling: "owner", scopes: ["library:read", "media:read"] },
    });
    expect(parseLibraryRevision((await call("get", "/library/revision?audience=owner")).body)).toBeTruthy();
  });

  it("snapshots and their items, field for field", async () => {
    const created = (await call("post", "/snapshots", { audience: "owner" })).body;
    const descriptor = parseSnapshotDescriptor(created);
    const pageBody = (await call("get", `/snapshots/${descriptor.snapshotId}/videos`)).body;
    const page = parseSnapshotPage(pageBody, descriptor.pageSize);

    expect(page.items).toHaveLength(3);
    // Nothing the peer sends is lost or altered by validation.
    expect(page.items).toEqual(pageBody.items);
    expect(page.items.find((item) => item.id === "full")?.tags).toEqual(["music", "live"]);
    // Oversized text is cut, oversized short fields and URLs are dropped.
    expect(page.items.find((item) => item.id === "oversized")).toMatchObject({
      title: "t".repeat(4000),
      author: "a".repeat(2000),
      sourceUrl: null,
      duration: null,
      tags: ["ok"],
    });
  });

  it("details, field for field", async () => {
    for (const id of ["full", "sparse", "oversized"]) {
      const body = (await call("get", `/videos/${id}?audience=owner`)).body;
      expect(parseDetail(body)).toEqual(body);
    }
  });
});
