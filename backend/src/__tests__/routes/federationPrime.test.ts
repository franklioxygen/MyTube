import cookieParser from "cookie-parser";
import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import request from "supertest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPayload } from "../../services/authService";

const state = vi.hoisted(() => ({ loginRequired: true }));
vi.mock("../../services/passwordService", () => ({ isLoginRequired: () => state.loginRequired }));

import { db, sqlite } from "../../db";
import { csrfProtection, csrfTokenProvider } from "../../middleware/csrfMiddleware";
import { errorHandler } from "../../middleware/errorHandler";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { buildApiRouter } from "../../routes/api";
import { countFederationStreams } from "../../services/federation/activeStreams";
import {
  FEDERATION_KEY_FILENAME,
  resetCredentialKeyCacheForTests,
} from "../../services/federation/credentialVault";
import { getInstanceId } from "../../services/federation/instanceIdentity";
import type { FederationVideoSummary } from "../../services/federation/libraryExport";
import { invalidateInFlightSyncs, updatePeer } from "../../services/federation/peerService";
import { syncPeer } from "../../services/federation/peerSync";
import { initializeStorage } from "../../services/storageService/initialization";
import { DATA_DIR } from "../../config/paths";

/**
 * Layer 1: the prime side against a scripted fake peer on loopback (a LAN
 * exception). The fake checks this prime's credential and identity headers
 * on every request.
 */

const PEER_ID = "0b6b3f0e-3a2b-4c1d-9e8f-7a6b5c4d3e2f";
const CRED = `${"A".repeat(16)}.${"B".repeat(43)}`;
const NEW_CRED = `${"C".repeat(16)}.${"D".repeat(43)}`;
const MEDIA = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 3) % 256));

const summary = (id: string, createdAt: string, extra: Partial<FederationVideoSummary> = {}): FederationVideoSummary => ({
  id,
  title: `Title ${id}`,
  author: "Alice",
  date: null,
  source: "youtube",
  sourceUrl: null,
  sourceVideoId: null,
  channelUrl: null,
  addedAt: null,
  createdAt,
  updatedAt: null,
  partNumber: null,
  totalParts: null,
  seriesTitle: null,
  rating: null,
  duration: "60",
  width: null,
  height: null,
  fileSize: "1000",
  mediaType: "video",
  tags: [],
  visibility: 1,
  assets: { media: true, thumbnail: true, avatar: false, subtitles: true },
  assetRevision: `rev-${id}`,
  ...extra,
});

const initialItems = () => [
  summary("a", "2026-01-01T00:00:00.000Z"),
  summary("b", "2026-01-03T00:00:00.000Z"),
  summary("c", "2026-01-02T00:00:00.000Z"),
];

// --- A scripted peer --------------------------------------------------------
const peer = {
  instanceId: PEER_ID,
  ceiling: "public" as "public" | "owner",
  scopes: ["library:read", "media:read"],
  features: ["snapshots", "details", "assets"],
  acceptedCredentials: new Set([CRED]),
  libraryRevision: "lib-1",
  policyRevision: "pol-1",
  items: initialItems(),
  failPage: null as number | null,
  malformedPage: false,
  changeRevisionDuringRead: false,
  pageDelayMs: 0,
  /** While set, page requests wait here, after announcing they arrived. */
  pageGate: null as { reached: () => void; open: Promise<void> } | null,
  detailStatus: null as number | null,
  snapshotRequests: 0,
  seenHeaders: [] as http.IncomingHttpHeaders[],
};
const assetClosed = vi.fn();
let peerServer: http.Server;
let peerUrl: string;
let mediaFile: string;

const startPeer = async () => {
  const app = express();
  app.use(express.json());
  const v1 = express.Router();
  v1.use((req, res, next) => {
    peer.seenHeaders.push(req.headers);
    const credential = (req.headers.authorization ?? "").replace(/^Federation /, "");
    if (!peer.acceptedCredentials.has(credential)) {
      res.status(401).json({ code: "FEDERATION_TOKEN_REVOKED" });
      return;
    }
    if (req.headers["x-mytube-instance-id"] === peer.instanceId) {
      res.status(409).json({ code: "FEDERATION_SELF_CONNECTION" });
      return;
    }
    next();
  });
  v1.get("/capabilities", (_req, res) => {
    res.json({
      protocol: "mytube-federation",
      protocolVersions: [1],
      instanceId: peer.instanceId,
      credential: { id: CRED.slice(0, 16), scopes: peer.scopes, visibilityCeiling: peer.ceiling, policyRevision: peer.policyRevision, expiresAt: null },
      features: peer.features,
      limits: { snapshotPageSize: 2, snapshotTtlMs: 600000 },
    });
  });
  v1.get("/library/revision", (req, res) => {
    res.json({ audience: req.query.audience, libraryRevision: peer.libraryRevision, policyRevision: peer.policyRevision });
  });
  const snapshots = new Map<string, FederationVideoSummary[]>();
  v1.post("/snapshots", (req, res) => {
    peer.snapshotRequests += 1;
    const id = `snap-${peer.snapshotRequests}`;
    snapshots.set(id, [...peer.items]);
    res.status(201).json({
      snapshotId: id,
      instanceId: peer.instanceId,
      audience: req.body.audience,
      libraryRevision: peer.libraryRevision,
      policyRevision: peer.policyRevision,
      totalCount: peer.items.length,
      pageSize: 2,
      expiresAt: Date.now() + 60000,
    });
    if (peer.changeRevisionDuringRead) peer.libraryRevision = `${peer.libraryRevision}+`;
  });
  v1.get("/snapshots/:id/videos", async (req, res) => {
    if (peer.pageGate) {
      peer.pageGate.reached();
      await peer.pageGate.open;
    }
    if (peer.pageDelayMs) await new Promise((resolve) => setTimeout(resolve, peer.pageDelayMs));
    const items = snapshots.get(req.params.id) ?? [];
    const offset = Number(req.query.cursor ?? 0);
    const page = offset / 2;
    if (peer.failPage === page) {
      res.status(503).json({ code: "BUSY" });
      return;
    }
    const slice = items.slice(offset, offset + 2);
    const next = offset + 2 < items.length ? String(offset + 2) : null;
    res.json({
      snapshotId: req.params.id,
      totalCount: items.length,
      items: peer.malformedPage && page === 1 ? [{ ...slice[0], title: 42 }] : slice,
      nextCursor: next,
      complete: next === null,
    });
  });
  v1.delete("/snapshots/:id", (_req, res) => {
    res.status(204).end();
  });
  v1.get("/videos/:id", (req, res) => {
    if (peer.detailStatus) {
      // A 401 refuses the credential; anything else is a transient failure.
      res.status(peer.detailStatus).json({ code: peer.detailStatus === 401 ? "FEDERATION_TOKEN_REVOKED" : "BUSY" });
      return;
    }
    const item = peer.items.find((candidate) => candidate.id === req.params.id);
    if (!item) {
      res.status(404).json({ code: "FEDERATION_VIDEO_NOT_FOUND" });
      return;
    }
    res.json({ ...item, description: `About ${item.id}`, subtitles: [{ trackId: "track-en", language: "en", format: "vtt" }] });
  });
  v1.get("/videos/:id/assets/:kind", (req, res) => {
    if (req.params.kind === "thumbnail") {
      res.status(404).json({ code: "FEDERATION_ASSET_UNAVAILABLE" });
      return;
    }
    if (req.params.id === "b") {
      // Trickles until aborted.
      req.on("close", assetClosed);
      res.writeHead(200, { "Content-Type": "video/mp4" });
      const tick = setInterval(() => res.write(Buffer.alloc(64 * 1024, 1)), 10);
      res.on("close", () => clearInterval(tick));
      return;
    }
    res.setHeader("Set-Cookie", "peer=secret");
    res.sendFile(mediaFile);
  });
  app.use("/api/federation/v1", v1);
  peerServer = app.listen(0);
  await new Promise((resolve) => peerServer.once("listening", resolve));
  peerUrl = `http://127.0.0.1:${(peerServer.address() as AddressInfo).port}`;
};

// --- The prime ----------------------------------------------------------------
let user: UserPayload | undefined = { role: "admin" };
let apiKey = false;
const primeApp = () => {
  const server = express();
  server.use(express.json(), cookieParser());
  server.use((req, _res, next) => {
    req.user = user;
    req.apiKeyAuthenticated = apiKey;
    next();
  });
  server.use(csrfProtection, csrfTokenProvider);
  server.get("/warm", (_req, res) => {
    res.json({});
  });
  server.use("/api", buildApiRouter(true), roleBasedAuthMiddleware, buildApiRouter());
  server.use(errorHandler);
  return server;
};

const admin = async () => {
  const agent = request.agent(primeApp());
  const token = (await agent.get("/warm")).headers["x-csrf-token"] as string;
  return {
    get: (url: string) => agent.get(url),
    head: (url: string) => agent.head(url),
    post: (url: string, body: object = {}) => agent.post(url).set("X-CSRF-Token", token).send(body),
    patch: (url: string, body: object) => agent.patch(url).set("X-CSRF-Token", token).send(body),
    put: (url: string, body: object) => agent.put(url).set("X-CSRF-Token", token).send(body),
    delete: (url: string) => agent.delete(url).set("X-CSRF-Token", token),
  };
};

const register = async (api: Awaited<ReturnType<typeof admin>>, baseUrl = peerUrl, credential = CRED) =>
  api.post("/api/federation/peers", { name: "Living room NAS", baseUrl, credential });

/** Registers, then waits for the background sync (a manual sync joins it). */
type Api = Awaited<ReturnType<typeof admin>>;

const registerAndSync = async () => {
  const api = await admin();
  const created = await register(api);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.peer.id as string;
  await api.post(`/api/federation/peers/${id}/sync`);
  return { api, id };
};

const library = async (api: Awaited<ReturnType<typeof admin>>) =>
  (await api.get("/api/federation/library")).body as { total: number; items: Array<Record<string, any>> };

beforeAll(async () => {
  migrate(db, { migrationsFolder: "drizzle" });
  initializeStorage();
  mediaFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "federation-prime-")), "clip.mp4");
  fs.writeFileSync(mediaFile, MEDIA);
  await startPeer();
});

beforeEach(async () => {
  // Let any background sync from the previous test settle before clearing.
  await new Promise((resolve) => setTimeout(resolve, 20));
  sqlite.exec("DELETE FROM federation_remote_videos; DELETE FROM federation_peers;");
  Object.assign(peer, {
    instanceId: PEER_ID,
    ceiling: "public",
    scopes: ["library:read", "media:read"],
    features: ["snapshots", "details", "assets"],
    acceptedCredentials: new Set([CRED]),
    libraryRevision: "lib-1",
    policyRevision: "pol-1",
    items: initialItems(),
    failPage: null,
    malformedPage: false,
    changeRevisionDuringRead: false,
    pageDelayMs: 0,
    pageGate: null,
    detailStatus: null,
    snapshotRequests: 0,
    seenHeaders: [],
  });
  assetClosed.mockClear();
  user = { role: "admin" };
  apiKey = false;
  state.loginRequired = true;
});

afterAll(async () => {
  await new Promise((resolve) => peerServer.close(resolve));
  fs.rmSync(path.dirname(mediaFile), { recursive: true, force: true });
});

describe("registering a peer", () => {
  it("pins the peer, stores the credential encrypted, and identifies this prime", async () => {
    const api = await admin();
    const response = await register(api);

    expect(response.status).toBe(201);
    expect(response.body.peer).toMatchObject({
      peerInstanceId: PEER_ID,
      name: "Living room NAS",
      baseUrl: peerUrl,
      lanException: true,
      audience: "public",
      canStreamMedia: true,
      enabled: true,
    });
    expect(JSON.stringify(response.body)).not.toContain(CRED);
    const stored = sqlite.prepare("SELECT credential_ciphertext FROM federation_peers").get() as { credential_ciphertext: string };
    expect(stored.credential_ciphertext).not.toContain(CRED.split(".")[1]);
    expect(fs.existsSync(path.join(DATA_DIR, FEDERATION_KEY_FILENAME))).toBe(true);
    expect(peer.seenHeaders[0]["x-mytube-instance-id"]).toBe(getInstanceId());
    expect(JSON.stringify((await api.get("/api/federation/peers")).body)).not.toContain(CRED);
  });

  it("refuses the same instance under another URL", async () => {
    const api = await admin();
    expect((await register(api)).status).toBe(201);
    const again = await register(api, peerUrl.replace("127.0.0.1", "localhost"));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("FEDERATION_PEER_EXISTS");
  });

  it("refuses this instance itself", async () => {
    peer.instanceId = getInstanceId();
    const response = await register(await admin());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FEDERATION_SELF_CONNECTION");
  });

  it.each([
    ["a peer without snapshots", () => (peer.features = []), 400, "FEDERATION_PEER_INCOMPATIBLE"],
    ["a credential without library:read", () => (peer.scopes = ["media:read"]), 400, "FEDERATION_PEER_INCOMPATIBLE"],
    ["a refused credential", () => peer.acceptedCredentials.clear(), 400, "FEDERATION_CREDENTIAL_REJECTED"],
  ] as const)("refuses %s", async (_name, arrange, status, code) => {
    arrange();
    const response = await register(await admin());
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(sqlite.prepare("SELECT COUNT(*) AS c FROM federation_peers").get()).toEqual({ c: 0 });
  });

  it("validates the URL and credential before contacting anything", async () => {
    const api = await admin();
    expect((await register(api, "http://93.184.216.34")).body.code).toBe("FEDERATION_INVALID_URL");
    expect((await register(api, peerUrl, "not-a-credential")).body.code).toBe("FEDERATION_INVALID_CREDENTIAL");
    expect(peer.seenHeaders).toHaveLength(0);
  });

  it("reports an unreachable peer", async () => {
    const response = await register(await admin(), "http://127.0.0.1:9");
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("FEDERATION_PEER_UNREACHABLE");
  });
});

describe("syncing", () => {
  it("imports a validated snapshot under prime-generated ids", async () => {
    const { api } = await registerAndSync();
    const listed = await library(api);

    expect(listed.total).toBe(3);
    expect(listed.items.map((item) => item.title)).toEqual(["Title b", "Title c", "Title a"]);
    for (const item of listed.items) {
      expect(item.id).toMatch(/^fed_[0-9a-f-]{36}$/);
      expect(item).toMatchObject({
        origin: { kind: "remote", instanceId: PEER_ID, instanceName: "Living room NAS" },
        availability: "online",
      });
    }
  });

  it("skips reading when the peer's revisions are unchanged", async () => {
    const { api, id } = await registerAndSync();
    const before = peer.snapshotRequests;

    const result = (await api.post(`/api/federation/peers/${id}/sync`)).body.result;

    expect(result).toMatchObject({ status: "ok", changed: false });
    expect(peer.snapshotRequests).toBe(before);
  });

  it("tombstones only from a complete snapshot and reuses ids when items return", async () => {
    const { api, id } = await registerAndSync();
    const idOfA = (await library(api)).items.find((item) => item.title === "Title a")!.id;

    peer.items = peer.items.filter((item) => item.id !== "a");
    peer.libraryRevision = "lib-2";
    expect((await api.post(`/api/federation/peers/${id}/sync`)).body.result).toMatchObject({ tombstoned: 1 });
    expect((await library(api)).total).toBe(2);

    peer.items = initialItems();
    peer.libraryRevision = "lib-3";
    await api.post(`/api/federation/peers/${id}/sync`);
    expect((await library(api)).items.find((item) => item.title === "Title a")?.id).toBe(idOfA);
  });

  it.each([
    ["a page fails", () => (peer.failPage = 1)],
    ["a page is malformed", () => (peer.malformedPage = true)],
    ["the library changes while it is read", () => (peer.changeRevisionDuringRead = true)],
  ])("keeps the last good state when %s", async (_name, arrange) => {
    const { api, id } = await registerAndSync();
    // Two pages, so the second one can fail.
    peer.items = ["x", "y", "z"].map((id, i) => summary(id, `2026-02-0${i + 1}T00:00:00.000Z`));
    peer.libraryRevision = "lib-2";
    arrange();

    const result = (await api.post(`/api/federation/peers/${id}/sync`)).body.result;

    expect(result.status).toBe("error");
    const listed = await library(api);
    expect(listed.total).toBe(3);
    expect(listed.items.every((item) => item.availability === "stale")).toBe(true);
  });

  it.each([
    ["another instance answers at the address", () => (peer.instanceId = "9c1f3b2a-1111-4222-8333-944455556666"), "identity_mismatch"],
    ["the peer refuses the credential", () => peer.acceptedCredentials.clear(), "credential_rejected"],
    ["the credential's visibility changed", () => (peer.ceiling = "owner"), "credential_rejected"],
  ])("quarantines the peer's items when %s", async (_name, arrange, status) => {
    const { api, id } = await registerAndSync();
    arrange();

    expect((await api.post(`/api/federation/peers/${id}/sync`)).body.result.status).toBe(status);
    expect((await library(api)).total).toBe(0);
  });

  it.each([
    [
      "the credential was refused",
      async (api: Api, id: string) => {
        peer.acceptedCredentials.clear();
        expect((await api.post(`/api/federation/peers/${id}/sync`)).body.result.status).toBe("credential_rejected");
        peer.acceptedCredentials.add(CRED);
      },
    ],
    [
      "the credential was replaced",
      async (api: Api, id: string) => {
        peer.acceptedCredentials.add(NEW_CRED);
        expect((await api.put(`/api/federation/peers/${id}/credential`, { credential: NEW_CRED })).status).toBe(200);
      },
    ],
    [
      "the peer was re-enabled",
      async (api: Api, id: string) => {
        await api.patch(`/api/federation/peers/${id}`, { enabled: false });
        await api.patch(`/api/federation/peers/${id}`, { enabled: true });
      },
    ],
  ])("keeps the cache hidden after %s until a sync succeeds", async (_name, arrange) => {
    const { api, id } = await registerAndSync();
    await arrange(api, id);

    // A transient failure must not make the unvalidated cache servable.
    peer.items = ["x", "y", "z"].map((id, i) => summary(id, `2026-02-0${i + 1}T00:00:00.000Z`));
    peer.libraryRevision = "lib-2";
    peer.failPage = 1;
    expect((await api.post(`/api/federation/peers/${id}/sync`)).body.result.status).toBe("error");
    expect((await library(api)).total).toBe(0);

    peer.failPage = null;
    expect((await api.post(`/api/federation/peers/${id}/sync`)).body.result.status).toBe("ok");
    expect((await library(api)).total).toBe(3);
  });

  it("never commits a sync begun before the database was replaced", async () => {
    const { api, id } = await registerAndSync();
    peer.items = [...initialItems(), summary("late", "2026-03-01T00:00:00.000Z")];
    peer.libraryRevision = "lib-2";
    peer.pageDelayMs = 50;

    const running = syncPeer(id);
    await vi.waitFor(() => expect(peer.snapshotRequests).toBeGreaterThan(1));
    // A restore can bring back the very generation the sync captured, so
    // the binding alone cannot tell; the replacement itself must.
    invalidateInFlightSyncs();
    const result = await running;

    expect(result.changed).toBe(false);
    const count = sqlite.prepare("SELECT COUNT(*) AS c FROM federation_remote_videos").get() as { c: number };
    expect(count.c).toBe(3);
    expect((await library(api)).total).toBe(3);
  });

  it("resumes with the same ids after the credential is replaced", async () => {
    const { api, id } = await registerAndSync();
    const ids = (await library(api)).items.map((item) => item.id).sort();
    peer.acceptedCredentials = new Set([NEW_CRED]);
    await api.post(`/api/federation/peers/${id}/sync`);

    const replaced = await api.put(`/api/federation/peers/${id}/credential`, { credential: NEW_CRED });
    expect(replaced.status).toBe(200);
    await api.post(`/api/federation/peers/${id}/sync`);

    expect((await library(api)).items.map((item) => item.id).sort()).toEqual(ids);
  });

  it("refuses a replacement credential for a different instance", async () => {
    const { api, id } = await registerAndSync();
    peer.instanceId = "9c1f3b2a-1111-4222-8333-944455556666";
    peer.acceptedCredentials.add(NEW_CRED);
    const response = await api.put(`/api/federation/peers/${id}/credential`, { credential: NEW_CRED });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("FEDERATION_IDENTITY_MISMATCH");
  });

  it("never commits a sync that a disable overtook", async () => {
    const { api, id } = await registerAndSync();
    peer.items = [...initialItems(), summary("late", "2026-03-01T00:00:00.000Z")];
    peer.libraryRevision = "lib-2";
    peer.pageDelayMs = 50;

    const running = syncPeer(id);
    await vi.waitFor(() => expect(peer.snapshotRequests).toBeGreaterThan(1));
    updatePeer(id, { enabled: false });
    const result = await running;

    expect(result.changed).toBe(false);
    const count = sqlite.prepare("SELECT COUNT(*) AS c FROM federation_remote_videos").get() as { c: number };
    expect(count.c).toBe(3);
    expect((await library(api)).total).toBe(0);
  });

  it("reports a missing credential key instead of using anything", async () => {
    const { api, id } = await registerAndSync();
    fs.rmSync(path.join(DATA_DIR, FEDERATION_KEY_FILENAME));
    resetCredentialKeyCacheForTests();

    expect((await api.post(`/api/federation/peers/${id}/sync`)).body.result.status).toBe("credential_missing");
    expect((await library(api)).total).toBe(0);
  });

  it("removes a peer and everything synced from it", async () => {
    const { api, id } = await registerAndSync();
    expect((await api.delete(`/api/federation/peers/${id}`)).body).toEqual({ removedItems: 3 });
    expect(sqlite.prepare("SELECT COUNT(*) AS c FROM federation_remote_videos").get()).toEqual({ c: 0 });
  });
});

describe("reading and playing remote items", () => {
  const itemId = async (api: Awaited<ReturnType<typeof admin>>, title: string) =>
    (await library(api)).items.find((item) => item.title === title)!.id as string;

  it("reads fresh detail without exposing the peer's ids", async () => {
    const { api } = await registerAndSync();
    const id = await itemId(api, "Title a");

    const detail = (await api.get(`/api/federation/library/${id}`)).body;

    expect(detail).toMatchObject({ id, description: "About a", subtitles: [{ trackId: "track-en" }] });
    expect(detail.origin.instanceId).toBe(PEER_ID);
  });

  it("streams media through the gateway with ranges and private caching", async () => {
    const { api } = await registerAndSync();
    const id = await itemId(api, "Title a");

    const range = await api.get(`/api/federation/media/${id}/media`).set("Range", "bytes=10-19");
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toBe("bytes 10-19/1000");
    expect(range.headers["cache-control"]).toBe("private, no-store");
    // The peer's own cookie never reaches the browser.
    expect(JSON.stringify(range.headers["set-cookie"] ?? [])).not.toContain("peer=secret");

    const head = await api.head(`/api/federation/media/${id}/media`);
    expect(head.headers["content-length"]).toBe("1000");
    expect(countFederationStreams()).toBe(0);
  });

  it("never lets a sync begun before a quarantine make the items servable again", async () => {
    const { api, id: peerId } = await registerAndSync();
    const id = await itemId(api, "Title a");
    peer.items = [...initialItems(), summary("late", "2026-03-01T00:00:00.000Z")];
    peer.libraryRevision = "lib-2";
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      peer.pageGate = { reached: resolve, open: new Promise<void>((open) => (release = open)) };
    });

    const running = syncPeer(peerId);
    try {
      // The sync is held mid-snapshot while a detail read is refused.
      await reached;
      peer.detailStatus = 401;
      expect((await api.get(`/api/federation/library/${id}`)).status).toBe(502);
      peer.detailStatus = null;
    } finally {
      peer.pageGate = null;
      release();
    }

    expect((await running).changed).toBe(false);
    expect((await library(api)).total).toBe(0);
  });

  it("maps peer failures without ever answering 401", async () => {
    const { api } = await registerAndSync();
    const id = await itemId(api, "Title a");

    const missing = await api.get(`/api/federation/media/${id}/thumbnail`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("FEDERATION_ASSET_UNAVAILABLE");

    expect((await api.get(`/api/federation/media/${id}/poster`)).status).toBe(400);
    expect((await api.get(`/api/federation/media/${id}/subtitle?track=../x`)).status).toBe(400);
    expect((await api.get("/api/federation/media/fed_unknown/media")).status).toBe(404);

    peer.acceptedCredentials.clear();
    const rejected = await api.get(`/api/federation/media/${id}/media`);
    expect(rejected.status).toBe(502);
    expect(rejected.body.code).toBe("FEDERATION_PEER_REJECTED");
    // The binding is quarantined until the owner acts.
    expect((await library(api)).total).toBe(0);
  });

  it("ends an in-flight stream when the peer is disabled", async () => {
    const { api, id: peerId } = await registerAndSync();
    const id = await itemId(api, "Title b");
    const server = primeApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      await new Promise<void>((resolve) => {
        const req = http.get({ host: "127.0.0.1", port, path: `/api/federation/media/${id}/media` }, (res) => {
          res.once("data", () => updatePeer(peerId, { enabled: false }));
          res.on("data", () => undefined);
          res.on("close", () => resolve());
        });
        req.on("error", () => resolve());
      });
      await vi.waitFor(() => expect(assetClosed).toHaveBeenCalled());
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("access", () => {
  it("is owner-only for now", async () => {
    const { id } = await registerAndSync();
    const urls = ["/api/federation/peers", "/api/federation/library", `/api/federation/library/${id}`];

    user = { role: "visitor", userId: "visitor-1" };
    for (const url of urls) expect((await request(primeApp()).get(url)).status, url).toBe(403);

    user = undefined;
    for (const url of urls) expect((await request(primeApp()).get(url)).status, url).toBe(401);

    apiKey = true;
    for (const url of urls) expect((await request(primeApp()).get(url)).status, url).toBe(403);
  });

  it("requires CSRF for changes", async () => {
    const response = await request(primeApp())
      .post("/api/federation/peers")
      .send({ name: "x", baseUrl: peerUrl, credential: CRED });
    expect(response.status).toBe(403);
    expect(peer.seenHeaders).toHaveLength(0);
  });
});
