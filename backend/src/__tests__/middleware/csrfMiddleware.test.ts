import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  csrfProtection,
  csrfTokenProvider,
  refreshCsrfTokenForSession,
} from "../../middleware/csrfMiddleware";
import { clearAuthCookie, setAuthCookie } from "../../services/authService";

describe("csrfMiddleware", () => {
  const buildApp = () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(csrfTokenProvider);
    app.use(csrfProtection);

    app.get("/api/token", (_req, res) => {
      res.json({ ok: true });
    });

    app.post("/api/login", (req, res) => {
      const sessionId = setAuthCookie(res, "not-a-valid-jwt", "admin");
      refreshCsrfTokenForSession(req, res, sessionId);
      res.json({ success: true });
    });

    app.post("/api/logout", (req, res) => {
      clearAuthCookie(res);
      refreshCsrfTokenForSession(req, res);
      res.json({ success: true });
    });

    app.post("/api/protected", (_req, res) => {
      res.json({ ok: true });
    });

    app.post("/api/rss/tokens", (_req, res) => {
      res.json({ ok: true });
    });

    return app;
  };

  it("rotates the token after login so the next protected request succeeds", async () => {
    const agent = request.agent(buildApp());

    const bootstrapResponse = await agent.get("/api/token");
    const anonymousToken = bootstrapResponse.headers["x-csrf-token"];

    expect(typeof anonymousToken).toBe("string");

    const loginResponse = await agent
      .post("/api/login")
      .set("X-CSRF-Token", anonymousToken)
      .send({});

    expect(loginResponse.status).toBe(200);

    const authenticatedToken = loginResponse.headers["x-csrf-token"];
    expect(typeof authenticatedToken).toBe("string");
    expect(authenticatedToken).not.toBe(anonymousToken);

    const protectedResponse = await agent
      .post("/api/protected")
      .set("X-CSRF-Token", authenticatedToken)
      .send({});

    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.body).toEqual({ ok: true });
  });

  it("rejects the old anonymous token after login rotates the session-bound token", async () => {
    const agent = request.agent(buildApp());

    const bootstrapResponse = await agent.get("/api/token");
    const anonymousToken = bootstrapResponse.headers["x-csrf-token"];

    const loginResponse = await agent
      .post("/api/login")
      .set("X-CSRF-Token", anonymousToken)
      .send({});

    expect(loginResponse.status).toBe(200);

    const staleTokenResponse = await agent
      .post("/api/protected")
      .set("X-CSRF-Token", anonymousToken)
      .send({});

    expect(staleTokenResponse.status).toBe(403);
  });

  it("rotates the token after logout so the next anonymous login can reuse it", async () => {
    const agent = request.agent(buildApp());

    const bootstrapResponse = await agent.get("/api/token");
    const anonymousToken = bootstrapResponse.headers["x-csrf-token"];

    const loginResponse = await agent
      .post("/api/login")
      .set("X-CSRF-Token", anonymousToken)
      .send({});
    const authenticatedToken = loginResponse.headers["x-csrf-token"];

    const logoutResponse = await agent
      .post("/api/logout")
      .set("X-CSRF-Token", authenticatedToken)
      .send({});

    expect(logoutResponse.status).toBe(200);

    const postLogoutToken = logoutResponse.headers["x-csrf-token"];
    expect(typeof postLogoutToken).toBe("string");
    expect(postLogoutToken).not.toBe(authenticatedToken);

    const loginAgainResponse = await agent
      .post("/api/login")
      .set("X-CSRF-Token", postLogoutToken)
      .send({});

    expect(loginAgainResponse.status).toBe(200);
  });

  it("lets non-RSS API-key requests bypass CSRF but still protects RSS management", async () => {
    const agent = request.agent(buildApp());

    const protectedResponse = await agent
      .post("/api/protected")
      .set("X-API-Key", "automation-key")
      .send({});

    expect(protectedResponse.status).toBe(200);

    const rssManagementResponse = await agent
      .post("/api/rss/tokens")
      .set("X-API-Key", "automation-key")
      .send({});

    expect(rssManagementResponse.status).toBe(403);
  });
});
