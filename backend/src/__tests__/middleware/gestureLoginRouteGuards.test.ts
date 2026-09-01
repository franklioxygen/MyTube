import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleBasedAuthMiddleware } from "../../middleware/roleBasedAuthMiddleware";
import { roleBasedSettingsMiddleware } from "../../middleware/roleBasedSettingsMiddleware";
import { isLoginRequired } from "../../services/passwordService";

vi.mock("../../services/passwordService", () => ({
  isLoginRequired: vi.fn(() => true),
}));

vi.mock("../../services/storageService", () => ({
  getSettings: () => ({}),
}));

/**
 * Both middlewares see /api/settings traffic: the /api mount runs first and
 * falls through. They normalise the path differently, so each layer is
 * exercised here with the path it actually receives.
 *
 * The case worth guarding is the signed-in visitor. In both files the visitor
 * branch is evaluated BEFORE the public-endpoint check, so listing a path as
 * public is not enough on its own to make it reachable.
 */

type Layer = "auth" | "settings";

const AUTH_PREFIX = "/settings";
const call = (
  layer: Layer,
  method: string,
  path: string,
  user?: { role: "admin" | "visitor" },
  apiKeyAuthenticated = false
) => {
  const fullPath = layer === "auth" ? `${AUTH_PREFIX}${path}` : path;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = {
    method,
    path: fullPath,
    url: fullPath,
    user,
    apiKeyAuthenticated,
  } as unknown as Request;
  const res = { json, status } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;

  const middleware =
    layer === "auth" ? roleBasedAuthMiddleware : roleBasedSettingsMiddleware;
  middleware(req, res, next);

  return {
    allowed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    statusCode: status.mock.calls[0]?.[0],
    body: json.mock.calls[0]?.[0],
  };
};

const layers: Layer[] = ["auth", "settings"];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLoginRequired).mockReturnValue(true);
});

describe.each(layers)("%s middleware", (layer) => {
  it("lets an unauthenticated visitor read gesture status", () => {
    expect(call(layer, "GET", "/gesture-login/status").allowed).toBe(true);
  });

  it("lets an unauthenticated visitor post a gesture", () => {
    expect(call(layer, "POST", "/gesture-login/authenticate").allowed).toBe(true);
  });

  it("lets a signed-in visitor read gesture status", () => {
    // Not covered by the public list: the visitor branch runs first.
    expect(
      call(layer, "GET", "/gesture-login/status", { role: "visitor" }).allowed
    ).toBe(true);
  });

  it("lets a signed-in visitor post a gesture", () => {
    // A visitor may submit an admin gesture exactly as they may submit an
    // admin password; knowing the credential is what upgrades the session.
    expect(
      call(layer, "POST", "/gesture-login/authenticate", { role: "visitor" })
        .allowed
    ).toBe(true);
  });

  it("blocks an unauthenticated caller from the management route", () => {
    for (const method of ["PUT", "DELETE"]) {
      expect(call(layer, method, "/gesture-login").allowed).toBe(false);
    }
  });

  it("blocks a visitor from the management route", () => {
    for (const method of ["PUT", "DELETE"]) {
      const result = call(layer, method, "/gesture-login", { role: "visitor" });
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(403);
    }
  });

  it("allows an admin to manage the credential", () => {
    for (const method of ["PUT", "DELETE"]) {
      expect(call(layer, method, "/gesture-login", { role: "admin" }).allowed).toBe(
        true
      );
    }
  });

  it("blocks an API-key caller outright", () => {
    const result = call(
      layer,
      "GET",
      "/gesture-login/status",
      undefined,
      true
    );
    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("does not treat the management route as public via a prefix match", () => {
    // The visitor GET allowlist uses matchesPathOrSubpath; a bare
    // "/gesture-login" entry there would expose the collection route and
    // anything added under it later.
    expect(call(layer, "GET", "/gesture-login", { role: "visitor" }).allowed).toBe(
      layer === "auth"
    );
    expect(call(layer, "GET", "/gesture-login").allowed).toBe(false);
  });

  it("does not expose invented sibling paths", () => {
    for (const path of [
      "/gesture-login/status/extra",
      "/gesture-login/authenticate/extra",
      "/gesture-login/secrets",
    ]) {
      expect(call(layer, "POST", path).allowed).toBe(false);
    }
  });
});

describe("unauthenticated rejection shape", () => {
  it("uses the platform's existing 401, not a gesture-specific code", () => {
    const result = call("settings", "PUT", "/gesture-login");

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({ errorKey: "settingsAuthRequired" });
    expect(result.body).not.toHaveProperty("code");
  });
});
