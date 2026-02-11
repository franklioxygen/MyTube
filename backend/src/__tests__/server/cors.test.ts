import cors, { CorsOptions } from "cors";
import express, { Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALLOWED_CORS_ORIGINS,
  buildCorsOptionsDelegate,
  getAllowedCorsOrigins,
  isOriginAllowed,
  normalizeOrigin,
} from "../../server/cors";

function createRequest(
  headers: Record<string, string | undefined>,
  protocol = "http"
): Request {
  const normalizedHeaders = new Map<string, string>();
  Object.entries(headers).forEach(([key, value]) => {
    if (value) {
      normalizedHeaders.set(key.toLowerCase(), value);
    }
  });

  return {
    protocol,
    header: (name: string) => normalizedHeaders.get(name.toLowerCase()),
    get: (name: string) => normalizedHeaders.get(name.toLowerCase()),
  } as unknown as Request;
}

function resolveCorsOptions(
  req: Request,
  delegate = buildCorsOptionsDelegate()
): Promise<{ err: Error | null; options?: CorsOptions }> {
  return new Promise((resolve) => {
    delegate(req, (err, options) => {
      resolve({
        err: (err as Error | null) ?? null,
        options: options as CorsOptions | undefined,
      });
    });
  });
}

describe("server/cors", () => {
  it("normalizeOrigin should keep protocol + host", () => {
    expect(normalizeOrigin("https://example.com/path?x=1")).toBe(
      "https://example.com"
    );
    expect(normalizeOrigin("invalid")).toBeNull();
  });

  it("getAllowedCorsOrigins should parse and normalize env values", () => {
    expect(
      getAllowedCorsOrigins(" https://a.example.com/path, http://b.example.com ")
    ).toEqual(["https://a.example.com", "http://b.example.com"]);
  });

  it("getAllowedCorsOrigins should fall back to defaults when env is empty", () => {
    expect(getAllowedCorsOrigins("")).toEqual([
      ...DEFAULT_ALLOWED_CORS_ORIGINS,
    ]);
  });

  it("isOriginAllowed should allow explicit allowlist origins", () => {
    const req = createRequest({ host: "192.168.1.20:5556" });
    const allowed = new Set(["http://allowed.example.com"]);
    expect(
      isOriginAllowed("http://allowed.example.com", req, allowed)
    ).toBe(true);
  });

  it("isOriginAllowed should allow same-host origins for LAN/domain deployments", () => {
    const req = createRequest({
      origin: "http://192.168.1.20:5556",
      host: "192.168.1.20:5556",
    });
    const allowed = new Set(["http://localhost:5556"]);
    expect(isOriginAllowed("http://192.168.1.20:5556", req, allowed)).toBe(
      true
    );
  });

  it("isOriginAllowed should allow same host even if scheme differs", () => {
    const req = createRequest({
      origin: "https://mytube.example.com",
      host: "mytube.example.com",
    });
    const allowed = new Set<string>();
    expect(
      isOriginAllowed("https://mytube.example.com", req, allowed)
    ).toBe(true);
  });

  it("isOriginAllowed should respect x-forwarded host/proto", () => {
    const req = createRequest({
      origin: "https://mytube.example.com",
      host: "backend:5551",
      "x-forwarded-host": "mytube.example.com",
      "x-forwarded-proto": "https",
    });
    const allowed = new Set<string>();
    expect(
      isOriginAllowed("https://mytube.example.com", req, allowed)
    ).toBe(true);
  });

  it("buildCorsOptionsDelegate should return origin false instead of throwing on blocked origin", async () => {
    const req = createRequest({
      origin: "http://evil.example.com",
      host: "192.168.1.20:5556",
    });
    const delegate = buildCorsOptionsDelegate(["http://localhost:5556"]);
    const result = await resolveCorsOptions(req, delegate);

    expect(result.err).toBeNull();
    expect(result.options?.origin).toBe(false);
    expect(result.options?.credentials).toBe(true);
  });

  it("buildCorsOptionsDelegate should allow missing origin", async () => {
    const req = createRequest({ host: "192.168.1.20:5556" });
    const result = await resolveCorsOptions(req);

    expect(result.err).toBeNull();
    expect(result.options?.origin).toBe(true);
    expect(result.options?.credentials).toBe(true);
  });

  it("blocked origin preflight should not surface as 500", async () => {
    const app = express();
    app.use(cors(buildCorsOptionsDelegate(["http://localhost:5556"])));
    app.options("/api/settings/verify-admin-password", (_req, res) => {
      res.sendStatus(204);
    });

    const response = await request(app)
      .options("/api/settings/verify-admin-password")
      .set("Origin", "http://evil.example.com")
      .set("Host", "192.168.1.20:5556")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).not.toBe(500);
  });
});
