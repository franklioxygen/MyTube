import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "../../db";
import federationProtocolRoutes from "../../routes/federationProtocolRoutes";
import { ensureFederationTables } from "../../services/storageService/migrations/schemaMigrations";
import { getInstanceId } from "../../services/federation/instanceIdentity";
import {
  mintFederationToken,
  revokeFederationToken,
} from "../../services/federation/tokenService";

const PRIME = "6f9619ff-8b86-4011-b42d-00c04fc964ff";

// Stands in for the legacy session/API-key stack mounted after the protocol
// router: reaching it would mean a protocol request fell through.
const legacyStack = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(418).json({ reachedLegacyStack: true });
});

const app = () => {
  const server = express();
  server.use("/api/federation/v1", federationProtocolRoutes);
  server.use("/api", legacyStack);
  return server;
};

const mint = () =>
  mintFederationToken({
    label: "prime",
    scopes: ["library:read"],
    visibilityCeiling: "public",
    expiresAt: null,
  });

beforeAll(() => {
  ensureFederationTables();
});

beforeEach(() => {
  legacyStack.mockClear();
  sqlite.exec("DELETE FROM federation_tokens;");
});

describe("federation protocol router", () => {
  it("answers the handshake for a valid credential", async () => {
    const { token, credential } = mint();

    const response = await request(app())
      .get("/api/federation/v1/capabilities")
      .set("Authorization", `Federation ${credential}`)
      .set("X-MyTube-Instance-Id", PRIME);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      protocol: "mytube-federation",
      protocolVersions: [1],
      instanceId: getInstanceId(),
      credential: {
        id: token.id,
        scopes: ["library:read"],
        visibilityCeiling: "public",
        policyRevision: 1,
        expiresAt: null,
      },
      features: [],
    });
  });

  it.each([
    ["no credential", {}],
    ["a legacy API key", { "X-API-Key": "legacy-key", Authorization: "ApiKey legacy-key" }],
    ["a session cookie", { Cookie: "mytube_auth=session-id" }],
  ])("rejects %s without falling through to the legacy stack", async (_name, headers) => {
    const response = await request(app())
      .get("/api/federation/v1/capabilities")
      .set({ ...headers, "X-MyTube-Instance-Id": PRIME });

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Federation");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ success: false, code: "FEDERATION_UNAUTHORIZED" });
    expect(legacyStack).not.toHaveBeenCalled();
  });

  it("authenticates before revealing which endpoints exist", async () => {
    const response = await request(app()).get("/api/federation/v1/snapshots");

    expect(response.status).toBe(401);
    expect(legacyStack).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown path", "get", "/api/federation/v1/snapshots"],
    ["an unsupported method", "post", "/api/federation/v1/capabilities"],
  ] as const)("ends %s inside the router", async (_name, method, path) => {
    const { credential } = mint();

    const response = await request(app())
      [method](path)
      .set("Authorization", `Federation ${credential}`)
      .set("X-MyTube-Instance-Id", PRIME);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "FEDERATION_NOT_FOUND" });
    expect(legacyStack).not.toHaveBeenCalled();
  });

  it("reports the consumer and credential failures a prime must act on", async () => {
    const { credential } = mint();
    const call = (consumer?: string) => {
      const pending = request(app())
        .get("/api/federation/v1/capabilities")
        .set("Authorization", `Federation ${credential}`);
      return consumer ? pending.set("X-MyTube-Instance-Id", consumer) : pending;
    };

    expect((await call()).body.code).toBe("FEDERATION_CONSUMER_REQUIRED");
    expect((await call(getInstanceId())).status).toBe(409);

    expect((await call(PRIME)).status).toBe(200);
    const other = await call("0b6b3f0e-3a2b-4c1d-9e8f-7a6b5c4d3e2f");
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("FEDERATION_CONSUMER_MISMATCH");
  });

  it("stops accepting a credential as soon as it is revoked", async () => {
    const { token, credential } = mint();
    revokeFederationToken(token.id);

    const response = await request(app())
      .get("/api/federation/v1/capabilities")
      .set("Authorization", `Federation ${credential}`)
      .set("X-MyTube-Instance-Id", PRIME);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("FEDERATION_TOKEN_REVOKED");
  });
});
