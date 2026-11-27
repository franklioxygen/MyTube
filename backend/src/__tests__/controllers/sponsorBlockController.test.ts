import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { initializeStorage } from "../../services/storageService/initialization";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import * as controller from "../../controllers/sponsorBlockController";
import { isLoginRequired } from "../../services/passwordService";
import { getSponsorBlockSegments } from "../../services/sponsorBlock/service";

vi.mock("../../services/passwordService", () => ({ isLoginRequired: vi.fn() }));
vi.mock("../../services/sponsorBlock/service", () => ({ getSponsorBlockSegments: vi.fn() }));

const app = express();
app.use((req, _res, next) => {
  const role = req.get("x-test-role");
  if (role) req.user = { role, id: "test" } as typeof req.user;
  next();
});
app.use(roleBasedAuthMiddleware);
app.get("/videos/:id/sponsorblock", controller.read);

const ready = {
  status: "ready",
  segments: [{ uuid: "u1", category: "sponsor", actionType: "skip", start: 1, end: 2, videoDuration: 0 }],
};

beforeAll(() => {
  migrate(db, { migrationsFolder: "drizzle" });
  initializeStorage();
  db.insert(videos).values([
    { id: "sb-public", title: "Public", visibility: 1, createdAt: "now", source: "youtube", sourceVideoId: "dQw4w9WgXcQ" },
    { id: "sb-hidden", title: "Hidden", visibility: 0, createdAt: "now", source: "youtube", sourceVideoId: "aaaaaaaaaaa" },
  ]).run();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLoginRequired).mockReturnValue(true);
  vi.mocked(getSponsorBlockSegments).mockResolvedValue(ready as never);
});

describe("GET /videos/:id/sponsorblock", () => {
  it("returns the video's segments to a visitor without letting caches keep them", async () => {
    const response = await request(app).get("/videos/sb-public/sponsorblock").set("x-test-role", "visitor").expect(200);
    expect(response.body).toEqual(ready);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(vi.mocked(getSponsorBlockSegments).mock.calls[0][0]).toMatchObject({ source: "youtube", sourceVideoId: "dQw4w9WgXcQ" });
  });

  it("hides a hidden video from visitors and never looks it up", async () => {
    await request(app).get("/videos/sb-hidden/sponsorblock").set("x-test-role", "visitor").expect(404);
    await request(app).get("/videos/missing/sponsorblock").set("x-test-role", "admin").expect(404);
    expect(getSponsorBlockSegments).not.toHaveBeenCalled();
    await request(app).get("/videos/sb-hidden/sponsorblock").set("x-test-role", "admin").expect(200);
  });

  it("requires a session when login is on", async () => {
    await request(app).get("/videos/sb-public/sponsorblock").expect(401);
  });
});

describe("sponsorBlockLimiter", () => {
  it("limits each client to 60 lookups a minute", async () => {
    const limited = express();
    limited.get("/x", controller.sponsorBlockLimiter, (_req, res) => { res.json({}); });
    for (let index = 0; index < 60; index += 1) await request(limited).get("/x").expect(200);
    await request(limited).get("/x").expect(429);
  });
});
