import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { csrfProtection, csrfTokenProvider } from "../../middleware/csrfMiddleware";
import { errorHandler } from "../../middleware/errorHandler";
import { requireAdmin } from "../../middleware/requireAdmin";
import { rssManagementNoStoreHeaders } from "../../middleware/rssManagementNoStoreHeaders";

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const buildApp = () => {
  const app = express();
  app.use(cookieParser());
  app.use(rssManagementNoStoreHeaders);
  app.use(express.json());
  app.use(csrfTokenProvider);
  app.use(csrfProtection);
  app.use((req, _res, next) => {
    req.user = { role: "admin" } as any;
    next();
  });

  app.get("/api/csrf", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/rss/tokens", requireAdmin, (_req, res) => {
    res.json({ tokens: [] });
  });
  app.post("/api/rss/tokens", requireAdmin, (_req, res) => {
    res.status(201).json({ token: { id: "token-id" } });
  });
  app.use(errorHandler);

  return app;
};

describe("RSS management route security", () => {
  it("requires CSRF for RSS management even when an API-key header is present", async () => {
    const response = await request(buildApp())
      .post("/api/rss/tokens")
      .set("X-API-Key", "automation-key")
      .send({ label: "Feed" });

    expect(response.status).toBe(403);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(
      expect.objectContaining({
        type: "csrf",
      })
    );
  });

  it("rejects API-key credentials at the admin guard after CSRF passes", async () => {
    const agent = request.agent(buildApp());
    const csrfResponse = await agent.get("/api/csrf");
    const csrfToken = csrfResponse.headers["x-csrf-token"];

    const response = await agent
      .post("/api/rss/tokens")
      .set("X-CSRF-Token", csrfToken)
      .set("X-API-Key", "automation-key")
      .send({ label: "Feed" });

    expect(response.status).toBe(403);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      success: false,
      error: "API key authentication cannot manage RSS tokens.",
    });
  });

  it("allows an admin session with a valid CSRF token and no API-key credentials", async () => {
    const agent = request.agent(buildApp());
    const csrfResponse = await agent.get("/api/csrf");
    const csrfToken = csrfResponse.headers["x-csrf-token"];

    const response = await agent
      .post("/api/rss/tokens")
      .set("X-CSRF-Token", csrfToken)
      .send({ label: "Feed" });

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ token: { id: "token-id" } });
  });

  it("rejects API-key credentials on read-only RSS management routes", async () => {
    const response = await request(buildApp())
      .get("/api/rss/tokens")
      .set("Authorization", "ApiKey automation-key");

    expect(response.status).toBe(403);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      success: false,
      error: "API key authentication cannot manage RSS tokens.",
    });
  });
});
