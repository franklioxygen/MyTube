import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const systemControllerMocks = vi.hoisted(() => ({
  getLatestVersion: vi.fn((_req, res) =>
    res.status(200).json({ route: "system/version" })
  ),
}));

vi.mock("../../controllers/systemController", () => ({
  getLatestVersion: systemControllerMocks.getLatestVersion,
}));

import { ApiRouteDefinition, apiKeyRoutes, buildApiRouter } from "../../routes/api";

const testRouteDefinitions: ApiRouteDefinition[] = [
  {
    method: "get",
    path: "/videos",
    allowApiKey: true,
    handlers: [(_req, res) => res.status(200).json({ route: "videos" })],
  },
  {
    method: "get",
    path: "/videos/author-channel-url",
    handlers: [(_req, res) => res.status(200).json({ route: "author-channel-url" })],
  },
  {
    method: "get",
    path: "/videos/:id",
    allowApiKey: true,
    handlers: [(req, res) => res.status(200).json({ route: `video:${req.params.id}` })],
  },
];

describe("buildApiRouter", () => {
  beforeEach(() => {
    systemControllerMocks.getLatestVersion.mockClear();
  });

  it("lets api-key routes reach explicitly allowed handlers", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.apiKeyAuthenticated = true;
      next();
    });
    app.use(buildApiRouter(true, testRouteDefinitions));
    app.use((_req, res) => {
      res.status(403).json({ blocked: true });
    });

    const response = await request(app).get("/videos");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "videos" });
  });

  it("exits the api-key router for disallowed static routes before matching later params", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.apiKeyAuthenticated = true;
      next();
    });
    app.use(buildApiRouter(true, testRouteDefinitions));
    app.use((_req, res) => {
      res.status(403).json({ blocked: true });
    });

    const response = await request(app).get(
      "/videos/author-channel-url?sourceUrl=https://youtube.com/watch?v=1"
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ blocked: true });
  });

  it("still allows parameterized video routes when no earlier static route matches", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.apiKeyAuthenticated = true;
      next();
    });
    app.use(buildApiRouter(true, testRouteDefinitions));
    app.use((_req, res) => {
      res.status(403).json({ blocked: true });
    });

    const response = await request(app).get("/videos/abc123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "video:abc123" });
  });

  it("lets api-key-authenticated requests reach GET /system/version", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.apiKeyAuthenticated = true;
      next();
    });
    app.use(apiKeyRoutes);
    app.use((_req, res) => {
      res.status(403).json({ blocked: true });
    });

    const response = await request(app).get("/system/version");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: "system/version" });
    expect(systemControllerMocks.getLatestVersion).toHaveBeenCalledTimes(1);
  });
});
