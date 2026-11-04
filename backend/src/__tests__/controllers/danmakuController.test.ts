import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { initializeStorage } from "../../services/storageService/initialization";
import { requireAdmin } from "../../middleware/requireAdmin";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import * as controller from "../../controllers/danmakuController";
import { isLoginRequired } from "../../services/passwordService";
import { importDanmaku } from "../../services/danmaku/service";

vi.mock("../../services/passwordService", () => ({ isLoginRequired: vi.fn() }));
const xml = '<i><chatid>123</chatid><d p="1,5,25,16777215">Hello</d></i>';
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const role = req.get("x-test-role");
  if (role) req.user = { role, id: "test" } as typeof req.user;
  next();
});
app.use(roleBasedAuthMiddleware);
app.get("/videos/:id/danmaku", controller.read);
app.get("/videos/:id/danmaku/events", controller.events);
app.post("/videos/:id/danmaku", requireAdmin, controller.uploadDanmaku, controller.importXml);
app.post("/videos/:id/danmaku/refresh", requireAdmin, controller.refresh);
app.delete("/videos/:id/danmaku", requireAdmin, controller.remove);
beforeAll(() => {
  migrate(db, { migrationsFolder: "drizzle" }); initializeStorage();
  db.insert(videos).values([
    { id: "public", title: "Public", visibility: 1, createdAt: "now" },
    { id: "hidden", title: "Hidden", visibility: 0, createdAt: "now" },
  ]).run();
  importDanmaku("public", xml); importDanmaku("hidden", xml);
});
beforeEach(() => { vi.mocked(isLoginRequired).mockReturnValue(true); });
describe("danmaku route permissions and upload", () => {
  it("lets a visitor read only visible video tracks and events", async () => {
    expect((await request(app).get("/videos/public/danmaku/events").set("x-test-role", "visitor")).body.events).toHaveLength(1);
    await request(app).get("/videos/hidden/danmaku").set("x-test-role", "visitor").expect(404);
    await request(app).get("/videos/hidden/danmaku/events").set("x-test-role", "visitor").expect(404);
  });
  it("blocks visitor uploads, refreshes, deletes, and unauthenticated reads", async () => {
    await request(app).post("/videos/public/danmaku").set("x-test-role", "visitor").attach("danmaku", Buffer.from(xml), "file.xml").expect(403);
    await request(app).post("/videos/public/danmaku/refresh").set("x-test-role", "visitor").expect(403);
    await request(app).delete("/videos/public/danmaku").set("x-test-role", "visitor").expect(403);
    await request(app).get("/videos/public/danmaku").expect(401);
  });
  it("allows a validated administrator import and preserves the track when another file is invalid", async () => {
    const result = await request(app).post("/videos/public/danmaku").set("x-test-role", "admin").attach("danmaku", Buffer.from(xml), "new.xml").expect(200);
    await request(app).post("/videos/public/danmaku").set("x-test-role", "admin").attach("danmaku", Buffer.from("<html>bad</html>"), "bad.xml").expect(400);
    expect((await request(app).get("/videos/public/danmaku").set("x-test-role", "admin")).body.revision).toBe(result.body.revision);
  });
  it("keeps owner access in login-disabled deployments even with a stale visitor role", async () => {
    vi.mocked(isLoginRequired).mockReturnValue(false);
    await request(app).get("/videos/hidden/danmaku/events").set("x-test-role", "visitor").expect(200);
    await request(app).post("/videos/hidden/danmaku").set("x-test-role", "visitor").attach("danmaku", Buffer.from(xml), "file.xml").expect(200);
  });
  it("rejects oversized uploads and unsupported file types", async () => {
    await request(app).post("/videos/public/danmaku").set("x-test-role", "admin").attach("danmaku", Buffer.alloc(8 * 1024 * 1024 + 1), "large.xml").expect(400);
    await request(app).post("/videos/public/danmaku").set("x-test-role", "admin").attach("danmaku", Buffer.from(xml), "file.srt").expect(400);
  });
});
