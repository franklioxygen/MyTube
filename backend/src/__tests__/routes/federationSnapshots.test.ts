import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sqlite } from "../../db";
import { videos } from "../../db/schema";
import { csrfProtection, csrfTokenProvider } from "../../middleware/csrfMiddleware";
import federationProtocolRoutes from "../../routes/federationProtocolRoutes";
import { saveAuthorAvatar } from "../../services/authorAvatarService";
import {
  clearSnapshotsForTests,
  createSnapshot,
  MAX_SNAPSHOTS,
  readSnapshotPage,
} from "../../services/federation/snapshotService";
import {
  authenticateFederationRequest,
  mintFederationToken,
  resumeFederationToken,
  suspendUsableFederationTokens,
  type MintFederationTokenInput,
} from "../../services/federation/tokenService";
import { currentExportRevision } from "../../services/federation/libraryExport";
import { initializeStorage } from "../../services/storageService/initialization";
import {
  getLibraryExportRevision,
  getVideosListETag,
} from "../../services/storageService/videoListRevision";
import { updateVideo } from "../../services/storageService/videoMutations";

const PRIME = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z");
const PUBLIC_COUNT = 1203;
const HIDDEN_IDS = ["hidden-1", "hidden-2"];

// Stands in for everything mounted after the protocol router.
const legacyStack = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(418).json({ reachedLegacyStack: true });
});

const app = () => {
  const server = express();
  server.use(cookieParser(), express.json());
  server.use(csrfProtection, csrfTokenProvider);
  server.use("/api/federation/v1", federationProtocolRoutes);
  server.use("/api", legacyStack);
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

const client = (credential: string) => {
  const server = app();
  const headers = { Authorization: `Federation ${credential}`, "X-MyTube-Instance-Id": PRIME };
  return {
    get: (path: string) => request(server).get(`/api/federation/v1${path}`).set(headers),
    post: (path: string, body: object) =>
      request(server).post(`/api/federation/v1${path}`).set(headers).send(body),
    delete: (path: string) => request(server).delete(`/api/federation/v1${path}`).set(headers),
  };
};

const insertVideos = (rows: Array<typeof videos.$inferInsert>) => {
  for (let i = 0; i < rows.length; i += 200) {
    db.insert(videos).values(rows.slice(i, i + 200)).run();
  }
};

/** Pages through a snapshot, returning every item and the pages seen. */
const readAll = async (api: ReturnType<typeof client>, snapshotId: string) => {
  const items: Array<Record<string, unknown>> = [];
  const pages: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  do {
    const response = await api.get(
      `/snapshots/${snapshotId}/videos${cursor ? `?cursor=${cursor}` : ""}`
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    pages.push(response.body);
    items.push(...response.body.items);
    cursor = response.body.nextCursor;
  } while (cursor);
  return { items, pages };
};

beforeAll(() => {
  migrate(db, { migrationsFolder: "drizzle" });
  // Some videos columns predate Drizzle and are only added by the self-heal.
  initializeStorage();
});

beforeEach(() => {
  clearSnapshotsForTests();
  legacyStack.mockClear();
  sqlite.exec("DELETE FROM federation_tokens; DELETE FROM videos;");
  insertVideos([
    ...Array.from({ length: PUBLIC_COUNT }, (_, i) => ({
      id: `video-${String(i).padStart(4, "0")}`,
      title: `Video ${i}`,
      author: "Alice",
      createdAt: new Date(BASE_TIME + i * 1000).toISOString(),
      // NULL visibility counts as public, as everywhere else.
      visibility: i % 2 === 0 ? 1 : null,
      videoPath: `/videos/secret-folder/${i}.mp4`,
      thumbnailPath: `/images/${i}.jpg`,
      authorAvatarPath: "/avatars/alice.jpg",
      tags: JSON.stringify(["music"]),
      progress: 42,
      viewCount: 7,
    })),
    ...HIDDEN_IDS.map((id, i) => ({
      id,
      title: `Hidden ${i}`,
      createdAt: new Date(BASE_TIME - (i + 1) * 1000).toISOString(),
      visibility: 0,
      videoPath: `/videos/${id}.mp4`,
    })),
  ]);
});

afterAll(() => {
  clearSnapshotsForTests();
});

describe("library revision", () => {
  it("reports the effective audience and the credential's policy revision", async () => {
    const { token, credential } = mint();

    const response = await client(credential).get("/library/revision?audience=owner");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      audience: "public",
      libraryRevision: currentExportRevision(),
      policyRevision: token.policyRevision,
    });
  });

  it("requires an explicit audience and the library:read scope", async () => {
    const { credential } = mint();
    const missing = await client(credential).get("/library/revision");
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("FEDERATION_INVALID_AUDIENCE");

    const mediaOnly = mint({ scopes: ["media:read"] });
    const denied = await client(mediaOnly.credential).get("/library/revision?audience=public");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FEDERATION_SCOPE_REQUIRED");
  });

  it("ignores private watch state but moves on exported changes", () => {
    const exportBefore = getLibraryExportRevision();
    const listBefore = getVideosListETag("all");

    updateVideo("video-0001", { progress: 99, progressUpdatedAt: Date.now() });
    updateVideo("video-0001", { viewCount: 8, lastPlayedAt: Date.now() });

    // The local list still refreshes (it shows progress); the export does not.
    expect(getVideosListETag("all")).not.toBe(listBefore);
    expect(getLibraryExportRevision()).toBe(exportBefore);

    updateVideo("video-0001", { title: "Renamed" });
    expect(getLibraryExportRevision()).not.toBe(exportBefore);

    const afterTitle = getLibraryExportRevision();
    // An author avatar override changes every exported video by that author.
    saveAuthorAvatar("Alice", null);
    expect(getLibraryExportRevision()).not.toBe(afterTitle);
  });
});

describe("snapshots", () => {
  it("cuts pages short by size and still covers the snapshot exactly once", () => {
    const auth = authenticateFederationRequest(`Federation ${mint().credential}`, PRIME);
    if (!auth.ok) throw new Error(auth.reason);
    const created = createSnapshot(auth.principal, "public");
    if (!created.ok) throw new Error("no snapshot");

    const ids: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 2000; pages += 1) {
      // About a dozen summaries' worth of bytes per page.
      const result = readSnapshotPage(auth.principal, created.snapshot.snapshotId, cursor, Date.now(), 4000);
      if (!result.ok) throw new Error(result.reason);
      expect(result.page.items.length).toBeGreaterThan(0);
      expect(result.page.items.length).toBeLessThan(500);
      ids.push(...result.page.items.map((item) => item.id));
      if (result.page.complete) break;
      cursor = result.page.nextCursor ?? undefined;
    }

    expect(ids).toHaveLength(created.snapshot.totalCount);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pages a public snapshot in stable order without hidden or private data", async () => {
    const api = client(mint().credential);

    const created = await api.post("/snapshots", { audience: "public" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      audience: "public",
      totalCount: PUBLIC_COUNT,
      pageSize: 500,
      libraryRevision: currentExportRevision(),
      instanceId: expect.any(String),
    });

    const { items, pages } = await readAll(api, created.body.snapshotId);

    expect(pages.map((page) => (page.items as unknown[]).length)).toEqual([500, 500, 203]);
    expect(pages.map((page) => page.complete)).toEqual([false, false, true]);
    expect(items).toHaveLength(PUBLIC_COUNT);
    expect(new Set(items.map((item) => item.id)).size).toBe(PUBLIC_COUNT);
    expect(items[0].id).toBe(`video-${PUBLIC_COUNT - 1}`);
    expect(items[items.length - 1].id).toBe("video-0000");
    expect(items.some((item) => HIDDEN_IDS.includes(item.id as string))).toBe(false);

    expect(items[0]).toMatchObject({
      title: `Video ${PUBLIC_COUNT - 1}`,
      tags: ["music"],
      visibility: 1,
      mediaType: "video",
      assets: { media: true, thumbnail: true, avatar: true, subtitles: false },
      assetRevision: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/),
    });
    const serialized = JSON.stringify(items);
    for (const leaked of ["secret-folder", "videoPath", "progress", "viewCount", "lastPlayedAt", "/avatars/"]) {
      expect(serialized, leaked).not.toContain(leaked);
    }
    expect(legacyStack).not.toHaveBeenCalled();
  });

  it("includes hidden items only for an owner audience under an owner ceiling", async () => {
    const owner = client(mint({ visibilityCeiling: "owner" }).credential);
    const ownerSnapshot = await owner.post("/snapshots", { audience: "owner" });
    expect(ownerSnapshot.body).toMatchObject({ audience: "owner", totalCount: PUBLIC_COUNT + 2 });
    const { items } = await readAll(owner, ownerSnapshot.body.snapshotId);
    expect(items.filter((item) => item.visibility === 0).map((item) => item.id).sort()).toEqual(HIDDEN_IDS);

    const capped = client(mint().credential);
    const cappedSnapshot = await capped.post("/snapshots", { audience: "owner" });
    expect(cappedSnapshot.body).toMatchObject({ audience: "public", totalCount: PUBLIC_COUNT });
  });

  it("answers a complete, empty snapshot for an empty library", async () => {
    sqlite.exec("DELETE FROM videos;");
    const api = client(mint().credential);

    const created = await api.post("/snapshots", { audience: "public" });
    const page = await api.get(`/snapshots/${created.body.snapshotId}/videos`);

    expect(created.body.totalCount).toBe(0);
    expect(page.body).toMatchObject({ totalCount: 0, items: [], nextCursor: null, complete: true });
  });

  it("goes stale when an exported field changes mid-snapshot", async () => {
    const api = client(mint().credential);
    const { snapshotId } = (await api.post("/snapshots", { audience: "public" })).body;
    const first = await api.get(`/snapshots/${snapshotId}/videos`);

    updateVideo("video-0003", { title: "Changed while paging" });

    const next = await api.get(`/snapshots/${snapshotId}/videos?cursor=${first.body.nextCursor}`);
    expect(next.status).toBe(409);
    expect(next.body.code).toBe("FEDERATION_SNAPSHOT_STALE");
    // A stale snapshot is discarded; the consumer must start over.
    expect((await api.get(`/snapshots/${snapshotId}/videos`)).status).toBe(404);
  });

  it("stays valid while someone watches videos on this instance", async () => {
    const api = client(mint().credential);
    const { snapshotId } = (await api.post("/snapshots", { audience: "public" })).body;

    updateVideo("video-0003", { progress: 120, progressUpdatedAt: Date.now() });
    updateVideo("video-0003", { viewCount: 9, lastPlayedAt: Date.now() });

    expect((await readAll(api, snapshotId)).items).toHaveLength(PUBLIC_COUNT);
  });

  it("goes stale when the credential's terms change", async () => {
    const { token, credential } = mint();
    const api = client(credential);
    const { snapshotId } = (await api.post("/snapshots", { audience: "public" })).body;

    suspendUsableFederationTokens();
    resumeFederationToken(token.id);

    const page = await api.get(`/snapshots/${snapshotId}/videos`);
    expect(page.status).toBe(409);
    expect(page.body.code).toBe("FEDERATION_SNAPSHOT_STALE");
  });

  it("keeps snapshots private to the credential that created them", async () => {
    const owner = client(mint().credential);
    const other = client(mint().credential);
    const { snapshotId } = (await owner.post("/snapshots", { audience: "public" })).body;

    expect((await other.get(`/snapshots/${snapshotId}/videos`)).status).toBe(404);
    expect((await other.delete(`/snapshots/${snapshotId}`)).status).toBe(404);
    expect((await owner.get(`/snapshots/${snapshotId}/videos`)).status).toBe(200);
  });

  it("rejects cursors that do not belong to the snapshot", async () => {
    const api = client(mint().credential);
    const a = (await api.post("/snapshots", { audience: "public" })).body.snapshotId;
    const b = (await api.post("/snapshots", { audience: "public" })).body.snapshotId;
    const cursorForB = (await api.get(`/snapshots/${b}/videos`)).body.nextCursor;

    for (const cursor of [cursorForB, "garbage", Buffer.from(`${a}:99999`).toString("base64url")]) {
      const response = await api.get(`/snapshots/${a}/videos?cursor=${cursor}`);
      expect(response.status, cursor).toBe(400);
      expect(response.body.code).toBe("FEDERATION_INVALID_CURSOR");
    }
  });

  it("lets a consumer release a snapshot", async () => {
    const api = client(mint().credential);
    const { snapshotId } = (await api.post("/snapshots", { audience: "public" })).body;

    expect((await api.delete(`/snapshots/${snapshotId}`)).status).toBe(204);
    expect((await api.get(`/snapshots/${snapshotId}/videos`)).status).toBe(404);
  });

  it("replaces a consumer's oldest snapshot and bounds the total", async () => {
    const first = client(mint().credential);
    const oldest = (await first.post("/snapshots", { audience: "public" })).body.snapshotId;
    await first.post("/snapshots", { audience: "public" });
    await first.post("/snapshots", { audience: "public" });
    expect((await first.get(`/snapshots/${oldest}/videos`)).status).toBe(404);

    // Fill the remaining global capacity with other consumers.
    for (let open = 2; open < MAX_SNAPSHOTS; open += 2) {
      const other = client(mint().credential);
      expect((await other.post("/snapshots", { audience: "public" })).status).toBe(201);
      expect((await other.post("/snapshots", { audience: "public" })).status).toBe(201);
    }

    const refused = await client(mint().credential).post("/snapshots", { audience: "public" });
    expect(refused.status).toBe(429);
    expect(refused.headers["retry-after"]).toBe("60");
    expect(refused.body.code).toBe("FEDERATION_SNAPSHOT_CAPACITY");
  });

  it("is exempt from CSRF only for a verified federation credential", async () => {
    const forged = await request(app())
      .post("/api/federation/v1/snapshots")
      .set({ Authorization: `Federation ${"A".repeat(16)}.${"B".repeat(43)}`, "X-MyTube-Instance-Id": PRIME })
      .send({ audience: "public" });

    // Rejected by the CSRF guard before the router; nothing reached the
    // legacy stack either.
    expect(forged.status).toBe(403);
    expect(legacyStack).not.toHaveBeenCalled();

    const { token, credential } = mint();
    suspendUsableFederationTokens();
    const suspended = await client(credential).post("/snapshots", { audience: "public" });
    expect(suspended.status).toBe(403);

    resumeFederationToken(token.id);
    expect((await client(credential).post("/snapshots", { audience: "public" })).status).toBe(201);
  });
});
