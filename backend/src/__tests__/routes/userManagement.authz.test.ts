/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserPayload } from "../../services/authService";

const userControllerMocks = vi.hoisted(() => ({
  listUsers: vi.fn((_req: any, res: any) =>
    res.json({ success: true, users: [] })
  ),
  createUser: vi.fn((_req: any, res: any) =>
    res.status(201).json({ success: true })
  ),
  updateUser: vi.fn((_req: any, res: any) => res.json({ success: true })),
  deleteUser: vi.fn((_req: any, res: any) => res.json({ success: true })),
}));

vi.mock("../../controllers/userController", () => userControllerMocks);

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(() => true),
}));

import { buildApiRouter } from "../../routes/api";

let currentUser: UserPayload | undefined;
let apiKeyAuthenticated = false;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = currentUser;
    if (apiKeyAuthenticated) {
      req.apiKeyAuthenticated = true;
    }
    next();
  });
  // Real route definitions: proves every /users route carries requireAdmin.
  app.use(buildApiRouter(false));
  return app;
};

const userRequests = [
  { method: "get" as const, path: "/users" },
  { method: "post" as const, path: "/users" },
  { method: "patch" as const, path: "/users/user-1" },
  { method: "delete" as const, path: "/users/user-1" },
];

describe("visitor user management route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = undefined;
    apiKeyAuthenticated = false;
  });

  it("rejects visitor sessions on every /users method with 403", async () => {
    currentUser = { role: "visitor", userId: "user-1" };
    const app = buildApp();

    for (const { method, path } of userRequests) {
      const response = await request(app)[method](path).send({});
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        success: false,
        error: "Admin access is required.",
      });
    }
  });

  it("rejects unauthenticated requests on every /users method with 401", async () => {
    const app = buildApp();

    for (const { method, path } of userRequests) {
      const response = await request(app)[method](path).send({});
      expect(response.status).toBe(401);
    }
  });

  it("rejects api-key credentials on every /users method with 403", async () => {
    apiKeyAuthenticated = true;
    const app = buildApp();

    for (const { method, path } of userRequests) {
      const response = await request(app)[method](path).send({});
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        success: false,
        error: "API key authentication cannot access admin management endpoints.",
      });
    }
  });

  it("lets admin sessions reach every /users handler", async () => {
    currentUser = { role: "admin" };
    const app = buildApp();

    expect((await request(app).get("/users")).status).toBe(200);
    expect((await request(app).post("/users").send({})).status).toBe(201);
    expect((await request(app).patch("/users/user-1").send({})).status).toBe(200);
    expect((await request(app).delete("/users/user-1")).status).toBe(200);

    expect(userControllerMocks.listUsers).toHaveBeenCalledTimes(1);
    expect(userControllerMocks.createUser).toHaveBeenCalledTimes(1);
    expect(userControllerMocks.updateUser).toHaveBeenCalledTimes(1);
    expect(userControllerMocks.deleteUser).toHaveBeenCalledTimes(1);
  });
});
