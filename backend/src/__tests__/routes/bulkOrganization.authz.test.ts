import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPayload } from "../../services/authService";

const state = vi.hoisted(() => ({ loginRequired: true }));
const handlers = vi.hoisted(() => ({
  addTags: vi.fn(async (_req, res) => { res.json({ success: true }); }),
  addToCollection: vi.fn(async (_req, res) => { res.json({ success: true }); }),
}));
vi.mock("../../controllers/bulkVideoOrganizationController", () => handlers);
vi.mock("../../services/passwordService", () => ({ isLoginRequired: () => state.loginRequired }));

import { buildApiRouter } from "../../routes/api";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { csrfProtection, csrfTokenProvider } from "../../middleware/csrfMiddleware";
import { errorHandler } from "../../middleware/errorHandler";

let user: UserPayload | undefined;
let apiKey = false;
const endpoints = ["/api/videos/batch/tags", "/api/collections/batch-add"];
function app() {
  const server = express();
  server.use(express.json(), cookieParser());
  server.use((req, _res, next) => { req.user = user; req.apiKeyAuthenticated = apiKey; next(); });
  server.use(csrfProtection, csrfTokenProvider);
  server.get("/warm", (_req, res) => { res.json({}); });
  server.use("/api", buildApiRouter(true), roleBasedAuthMiddleware, buildApiRouter());
  server.use(errorHandler);
  return server;
}
async function postBoth(expected: number) {
  const agent = request.agent(app());
  const warm = await agent.get("/warm");
  const token = warm.headers["x-csrf-token"];
  for (const endpoint of endpoints) {
    const response = await agent.post(endpoint).set("X-CSRF-Token", token).send({ videoIds: ["v1"] });
    expect(response.status, `${endpoint}: ${JSON.stringify(response.body)}`).toBe(expected);
  }
}
beforeEach(() => { vi.clearAllMocks(); state.loginRequired = true; user = undefined; apiKey = false; });

describe("bulk routes in the real router and CSRF/role chain", () => {
  it("allows authenticated admins", async () => {
    user = { role: "admin" }; await postBoth(200);
    expect(handlers.addTags).toHaveBeenCalledOnce();
    expect(handlers.addToCollection).toHaveBeenCalledOnce();
  });
  it("rejects visitors", async () => { user = { role: "visitor" }; await postBoth(403); expect(handlers.addTags).not.toHaveBeenCalled(); });
  it("rejects anonymous callers when login is enabled", async () => { await postBoth(401); });
  it("preserves management access when login is disabled", async () => { state.loginRequired = false; await postBoth(200); });
  it.each([true, false])("rejects API-key callers with loginRequired=%s", async (required) => {
    state.loginRequired = required; apiKey = true; await postBoth(403);
    expect(handlers.addTags).not.toHaveBeenCalled(); expect(handlers.addToCollection).not.toHaveBeenCalled();
  });
  it("keeps both new POST routes CSRF-protected", async () => {
    user = { role: "admin" };
    for (const endpoint of endpoints) expect((await request(app()).post(endpoint).send({})).status).toBe(403);
    expect(handlers.addTags).not.toHaveBeenCalled();
  });
});
