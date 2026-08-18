/* eslint-disable @typescript-eslint/no-explicit-any */
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LEGACY_SECRET = "default_development_secret_do_not_use_in_production";

/**
 * Regression coverage for GHSA-rm8x-hmvr-qgp3: the signing key must never fall
 * back to the publicly known constant that shipped in earlier versions.
 */
describe("authService JWT secret resolution", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it("rejects tokens signed with the historical default when JWT_SECRET is unset", async () => {
    delete process.env.JWT_SECRET;
    const { verifyToken } = await import("../../services/authService");

    const forged = jwt.sign({ role: "admin" }, LEGACY_SECRET, {
      expiresIn: "24h",
    });

    expect(verifyToken(forged)).toBeNull();
  });

  it("rejects tokens signed with the historical default when JWT_SECRET is empty", async () => {
    // An orchestrator-set empty value must fail closed, not select the default.
    process.env.JWT_SECRET = "";
    const { verifyToken } = await import("../../services/authService");

    expect(verifyToken(jwt.sign({ role: "admin" }, LEGACY_SECRET))).toBeNull();
  });

  it("still round-trips its own tokens with a generated key", async () => {
    delete process.env.JWT_SECRET;
    const { generateToken, verifyToken } = await import(
      "../../services/authService"
    );

    const decoded = verifyToken(generateToken({ role: "admin" }));
    expect(decoded?.role).toBe("admin");
  });

  it("uses a configured JWT_SECRET when one is provided", async () => {
    process.env.JWT_SECRET = "a-unique-operator-supplied-key";
    const { verifyToken } = await import("../../services/authService");

    const token = jwt.sign({ role: "admin" }, "a-unique-operator-supplied-key");
    expect(verifyToken(token)?.role).toBe("admin");
  });

  it("refuses to start when JWT_SECRET is pinned to the compromised default", async () => {
    process.env.JWT_SECRET = LEGACY_SECRET;

    await expect(import("../../services/authService")).rejects.toThrow(
      /publicly known default/
    );
  });
});
