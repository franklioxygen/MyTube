/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Request, Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../../middleware/roleBasedSettingsMiddleware";
import { isLoginRequired } from "../../services/passwordService";
import { recordSecurityAuditEvent } from "../../services/securityAuditService";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(() => false),
}));

vi.mock("../../services/securityAuditService", () => ({
  recordSecurityAuditEvent: vi.fn(),
}));

const createStrictTestApp = () => {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    const roleHeader = req.header("x-test-role");
    if (roleHeader === "admin" || roleHeader === "visitor") {
      (req as any).user = {
        id: `${roleHeader}-id`,
        role: roleHeader,
      };
    }
    next();
  });

  const apiRouter = express.Router();
  apiRouter.post("/tasks", (_req: Request, res: Response) => {
    res.status(200).json({ success: true });
  });
  app.use("/api", roleBasedAuthMiddleware, apiRouter);

  const settingsRouter = express.Router();
  settingsRouter.post("/verify-password", (_req: Request, res: Response) => {
    res.status(200).json({ success: true, path: "verify-password" });
  });
  settingsRouter.post("/bootstrap", (_req: Request, res: Response) => {
    res.status(200).json({ success: true, path: "bootstrap" });
  });
  settingsRouter.post("/passkeys/register", (_req: Request, res: Response) => {
    res.status(200).json({ success: true, path: "passkeys/register" });
  });
  settingsRouter.post("/reset-password", (_req: Request, res: Response) => {
    res.status(200).json({ success: true, path: "reset-password" });
  });
  settingsRouter.post("/update", (_req: Request, res: Response) => {
    res.status(200).json({ success: true, path: "update" });
  });
  app.use("/api/settings", roleBasedSettingsMiddleware, settingsRouter);

  return app;
};

describe("strict security integration", () => {
  const originalSecurityModel = process.env.SECURITY_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SECURITY_MODEL = "strict";
    vi.mocked(isLoginRequired).mockReturnValue(false);
  });

  afterEach(() => {
    process.env.SECURITY_MODEL = originalSecurityModel;
  });

  it("blocks unauthenticated write APIs in strict mode", async () => {
    const app = createStrictTestApp();

    const apiResponse = await request(app).post("/api/tasks").send({});
    expect(apiResponse.status).toBe(401);
    expect(apiResponse.body.error).toContain("Authentication required");

    const settingsResponse = await request(app).post("/api/settings/update").send({});
    expect(settingsResponse.status).toBe(401);
    expect(settingsResponse.body.error).toContain("Authentication required");
    expect(vi.mocked(recordSecurityAuditEvent)).toHaveBeenCalled();
  });

  it("keeps login/bootstrap/recovery-token endpoints reachable in strict mode", async () => {
    const app = createStrictTestApp();

    await request(app)
      .post("/api/settings/verify-password")
      .send({})
      .expect(200);

    await request(app)
      .post("/api/settings/bootstrap")
      .send({})
      .expect(200);

    await request(app)
      .post("/api/settings/reset-password")
      .set("x-mytube-recovery-token", "token-123")
      .send({})
      .expect(200);
  });

  it("blocks non-whitelisted auth writes without recovery token in strict mode", async () => {
    const app = createStrictTestApp();

    await request(app)
      .post("/api/settings/passkeys/register")
      .send({})
      .expect(401);

    await request(app)
      .post("/api/settings/reset-password")
      .send({})
      .expect(401);
  });

  it("allows admin writes and blocks visitor writes", async () => {
    const app = createStrictTestApp();

    await request(app)
      .post("/api/tasks")
      .set("x-test-role", "admin")
      .send({})
      .expect(200);

    await request(app)
      .post("/api/settings/update")
      .set("x-test-role", "admin")
      .send({})
      .expect(200);

    await request(app)
      .post("/api/tasks")
      .set("x-test-role", "visitor")
      .send({})
      .expect(403);

    await request(app)
      .post("/api/settings/update")
      .set("x-test-role", "visitor")
      .send({})
      .expect(403);
  });
});
