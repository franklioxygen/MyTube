import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPayload } from "../../services/authService";

const state = vi.hoisted(() => ({ loginRequired: true }));
vi.mock("../../services/passwordService", () => ({
  isLoginRequired: () => state.loginRequired,
}));

import { sqlite } from "../../db";
import { csrfProtection, csrfTokenProvider } from "../../middleware/csrfMiddleware";
import { errorHandler } from "../../middleware/errorHandler";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { buildApiRouter } from "../../routes/api";
import { ensureFederationTables } from "../../services/storageService/migrations/schemaMigrations";

let user: UserPayload | undefined;
let apiKey = false;

const app = () => {
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

/** An agent carrying a CSRF cookie and the matching header. */
const session = async () => {
  const agent = request.agent(app());
  const token = (await agent.get("/warm")).headers["x-csrf-token"] as string;
  return {
    get: (path: string) => agent.get(path),
    post: (path: string, body: object = {}) =>
      agent.post(path).set("X-CSRF-Token", token).send(body),
    delete: (path: string) => agent.delete(path).set("X-CSRF-Token", token),
  };
};

const validBody = { label: "prime", scopes: ["library:read", "media:read"] };

beforeAll(() => {
  ensureFederationTables();
});

beforeEach(() => {
  sqlite.exec("DELETE FROM federation_tokens;");
  state.loginRequired = true;
  user = undefined;
  apiKey = false;
});

describe("federation token management", () => {
  it("lets an admin mint, list, rotate, revoke and delete tokens", async () => {
    user = { role: "admin" };
    const api = await session();

    const created = await api.post("/api/federation/tokens", validBody);
    expect(created.status).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.body.token).toMatchObject({
      label: "prime",
      scopes: ["library:read", "media:read"],
      visibilityCeiling: "public",
      status: "active",
    });
    const { id } = created.body.token;
    expect(created.body.credential).toMatch(new RegExp(`^${id}\\.[A-Za-z0-9_-]{43}$`));

    const listed = await api.get("/api/federation/tokens");
    expect(listed.status).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.body.instanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(listed.body.tokens).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.credential.split(".")[1]);

    const rotated = await api.post(`/api/federation/tokens/${id}/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.body.token.policyRevision).toBe(2);
    expect(rotated.body.credential).not.toBe(created.body.credential);

    const revoked = await api.post(`/api/federation/tokens/${id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.token.status).toBe("revoked");
    expect((await api.post(`/api/federation/tokens/${id}/rotate`)).status).toBe(409);

    expect((await api.delete(`/api/federation/tokens/${id}`)).status).toBe(204);
    expect((await api.delete(`/api/federation/tokens/${id}`)).status).toBe(404);
    expect((await api.post(`/api/federation/tokens/${id}/revoke`)).status).toBe(404);
  });

  it("defaults to the public visibility ceiling and accepts explicit owner delegation", async () => {
    user = { role: "admin" };
    const api = await session();

    const owner = await api.post("/api/federation/tokens", {
      ...validBody,
      visibilityCeiling: "owner",
      expiresAt: Date.now() + 60_000,
    });
    expect(owner.status).toBe(201);
    expect(owner.body.token.visibilityCeiling).toBe("owner");
    expect(owner.body.token.expiresAt).toEqual(expect.any(Number));
  });

  it.each([
    ["missing scopes", { label: "x" }],
    ["empty scopes", { scopes: [] }],
    ["an unknown scope", { scopes: ["library:write"] }],
    ["an unknown visibility ceiling", { ...validBody, visibilityCeiling: "everyone" }],
    ["an over-long label", { ...validBody, label: "x".repeat(101) }],
    ["a non-string label", { ...validBody, label: 7 }],
    ["a past expiry", { ...validBody, expiresAt: Date.now() - 1 }],
    ["a fractional expiry", { ...validBody, expiresAt: Date.now() + 60_000.5 }],
    ["an expiry beyond ten years", { ...validBody, expiresAt: Date.now() + 11 * 365 * 864e5 }],
  ])("rejects %s without minting", async (_name, body) => {
    user = { role: "admin" };
    const api = await session();

    const response = await api.post("/api/federation/tokens", body);

    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS c FROM federation_tokens").get()).toEqual({ c: 0 });
  });

  it("keeps management behind admin sessions", async () => {
    user = { role: "visitor", userId: "visitor-1" };
    const visitor = await session();
    expect((await visitor.get("/api/federation/tokens")).status).toBe(403);
    expect((await visitor.post("/api/federation/tokens", validBody)).status).toBe(403);

    user = undefined;
    const anonymous = await session();
    expect((await anonymous.get("/api/federation/tokens")).status).toBe(401);
    expect((await anonymous.post("/api/federation/tokens", validBody)).status).toBe(401);

    expect(sqlite.prepare("SELECT COUNT(*) AS c FROM federation_tokens").get()).toEqual({ c: 0 });
  });

  it.each([true, false])("rejects legacy API-key callers with loginRequired=%s", async (required) => {
    state.loginRequired = required;
    apiKey = true;
    const api = await session();

    expect((await api.get("/api/federation/tokens")).status).toBe(403);
    expect((await api.post("/api/federation/tokens", validBody)).status).toBe(403);
  });

  it("preserves owner-equivalent access when login is disabled", async () => {
    state.loginRequired = false;
    const api = await session();

    expect((await api.post("/api/federation/tokens", validBody)).status).toBe(201);
  });

  it("requires a CSRF token for state changes", async () => {
    user = { role: "admin" };

    const response = await request(app()).post("/api/federation/tokens").send(validBody);

    expect(response.status).toBe(403);
    expect(sqlite.prepare("SELECT COUNT(*) AS c FROM federation_tokens").get()).toEqual({ c: 0 });
  });
});
