import { EventEmitter } from "events";
import type { Response } from "express";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "../../db";
import { ensureFederationTables } from "../../services/storageService/migrations/schemaMigrations";
import { getInstanceId, isInstanceId } from "../../services/federation/instanceIdentity";
import {
  countFederationStreams,
  trackFederationStream,
} from "../../services/federation/activeStreams";
import {
  authenticateFederationRequest,
  deleteFederationToken,
  listFederationTokens,
  mintFederationToken,
  resetFederationIdentity,
  resumeFederationToken,
  revokeFederationToken,
  rotateFederationToken,
  suspendUsableFederationTokens,
  type MintFederationTokenInput,
} from "../../services/federation/tokenService";

// A real SQLite file in this test file's private data directory (setupDataDir).
const PRIME = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const OTHER_PRIME = "0b6b3f0e-3a2b-4c1d-9e8f-7a6b5c4d3e2f";
const NOW = 1_800_000_000_000;

const input = (overrides: Partial<MintFederationTokenInput> = {}): MintFederationTokenInput => ({
  label: "living-room NAS",
  scopes: ["library:read", "media:read"],
  visibilityCeiling: "public",
  expiresAt: null,
  ...overrides,
});

const auth = (credential: string) => `Federation ${credential}`;

beforeAll(() => {
  ensureFederationTables();
});

beforeEach(() => {
  sqlite.exec("DELETE FROM federation_tokens; DELETE FROM federation_instance;");
});

describe("instance identity", () => {
  it("is created once as a UUID and then stays the same", () => {
    const first = getInstanceId();
    expect(isInstanceId(first)).toBe(true);
    expect(getInstanceId()).toBe(first);
    expect(sqlite.prepare("SELECT COUNT(*) AS c FROM federation_instance").get()).toEqual({ c: 1 });
  });

  it("follows the database rather than a process cache", () => {
    const first = getInstanceId();
    sqlite.exec("DELETE FROM federation_instance;");
    expect(getInstanceId()).not.toBe(first);
  });

  it("allows only a single identity row", () => {
    getInstanceId();
    expect(() =>
      sqlite
        .prepare("INSERT INTO federation_instance (id, instance_id, created_at) VALUES (2, ?, 0)")
        .run(PRIME)
    ).toThrow(/CHECK constraint/);
  });
});

describe("minting and listing", () => {
  it("returns the secret once and stores only its digest", () => {
    const { token, credential } = mintFederationToken(input(), NOW);
    const [id, secret] = credential.split(".");

    expect(credential).toMatch(/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(token).toMatchObject({
      id,
      label: "living-room NAS",
      scopes: ["library:read", "media:read"],
      visibilityCeiling: "public",
      policyRevision: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
      consumerInstanceId: null,
      suspendedAt: null,
      status: "active",
    });

    const stored = sqlite.prepare("SELECT * FROM federation_tokens WHERE id = ?").get(id) as {
      secret_hash: string;
    };
    expect(stored.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it("never lists secrets or digests", () => {
    const { credential } = mintFederationToken(input(), NOW);
    const listed = JSON.stringify(listFederationTokens(NOW));

    expect(listed).not.toContain(credential.split(".")[1]);
    expect(listed).not.toMatch(/secret|hash/i);
  });

  it("stores scopes deduplicated in canonical order", () => {
    const { token } = mintFederationToken(
      input({ scopes: ["media:read", "library:read", "media:read"] }),
      NOW
    );
    expect(token.scopes).toEqual(["library:read", "media:read"]);
  });

  it("rejects visibility ceilings outside public/owner at the database", () => {
    expect(() =>
      mintFederationToken(input({ visibilityCeiling: "everyone" as never }), NOW)
    ).toThrow(/CHECK constraint/);
  });

  it("reports expired and revoked status", () => {
    const expiring = mintFederationToken(input({ expiresAt: NOW + 1000 }), NOW).token;
    const revoked = mintFederationToken(input(), NOW).token;
    revokeFederationToken(revoked.id, NOW);

    const byId = new Map(listFederationTokens(NOW + 1000).map((t) => [t.id, t.status]));
    expect(byId.get(expiring.id)).toBe("expired");
    expect(byId.get(revoked.id)).toBe("revoked");
  });
});

describe("authenticateFederationRequest", () => {
  it("authenticates a valid credential and pins the first consumer", () => {
    const { token, credential } = mintFederationToken(input({ visibilityCeiling: "owner" }), NOW);

    const result = authenticateFederationRequest(auth(credential), PRIME, NOW);

    expect(result).toEqual({
      ok: true,
      principal: {
        tokenId: token.id,
        scopes: ["library:read", "media:read"],
        visibilityCeiling: "owner",
        policyRevision: token.policyRevision,
        consumerInstanceId: PRIME,
        expiresAt: null,
      },
    });
    expect(listFederationTokens(NOW)[0]).toMatchObject({
      consumerInstanceId: PRIME,
      lastUsedAt: NOW,
    });
  });

  it("accepts the scheme case-insensitively", () => {
    const { credential } = mintFederationToken(input(), NOW);
    expect(authenticateFederationRequest(`federation ${credential}`, PRIME, NOW).ok).toBe(true);
  });

  it.each([
    ["no header", undefined, "missing_credential"],
    ["another scheme", "Bearer abc", "invalid_credential"],
    ["a legacy API key", "ApiKey abc", "invalid_credential"],
    ["a truncated credential", "Federation abc.def", "invalid_credential"],
  ])("rejects %s", (_name, header, reason) => {
    mintFederationToken(input(), NOW);
    expect(authenticateFederationRequest(header, PRIME, NOW)).toEqual({ ok: false, reason });
  });

  it("rejects a wrong secret and an unknown id identically", () => {
    const { credential } = mintFederationToken(input(), NOW);
    const [id] = credential.split(".");
    const wrongSecret = `${id}.${"A".repeat(43)}`;
    const unknownId = `${"B".repeat(16)}.${"A".repeat(43)}`;

    expect(authenticateFederationRequest(auth(wrongSecret), PRIME, NOW)).toEqual({
      ok: false,
      reason: "invalid_credential",
    });
    expect(authenticateFederationRequest(auth(unknownId), PRIME, NOW)).toEqual({
      ok: false,
      reason: "invalid_credential",
    });
  });

  it("reveals revocation and expiry only to the holder of the secret", () => {
    const revoked = mintFederationToken(input(), NOW);
    revokeFederationToken(revoked.token.id, NOW);
    const expired = mintFederationToken(input({ expiresAt: NOW + 10 }), NOW);

    expect(authenticateFederationRequest(auth(revoked.credential), PRIME, NOW)).toEqual({
      ok: false,
      reason: "token_revoked",
    });
    expect(authenticateFederationRequest(auth(expired.credential), PRIME, NOW + 10)).toEqual({
      ok: false,
      reason: "token_expired",
    });
    expect(
      authenticateFederationRequest(auth(`${revoked.token.id}.${"A".repeat(43)}`), PRIME, NOW)
    ).toEqual({ ok: false, reason: "invalid_credential" });
  });

  it("requires a well-formed consumer instance id", () => {
    const { credential } = mintFederationToken(input(), NOW);
    for (const consumer of [undefined, "", "not-a-uuid", PRIME.toUpperCase()]) {
      expect(authenticateFederationRequest(auth(credential), consumer, NOW)).toEqual({
        ok: false,
        reason: "consumer_required",
      });
    }
  });

  it("refuses a second consumer once the token is pinned", () => {
    const { credential } = mintFederationToken(input(), NOW);
    expect(authenticateFederationRequest(auth(credential), PRIME, NOW).ok).toBe(true);

    expect(authenticateFederationRequest(auth(credential), OTHER_PRIME, NOW)).toEqual({
      ok: false,
      reason: "consumer_mismatch",
    });
    expect(listFederationTokens(NOW)[0].consumerInstanceId).toBe(PRIME);
  });

  it("refuses a consumer presenting this instance's own id", () => {
    const { credential } = mintFederationToken(input(), NOW);
    expect(authenticateFederationRequest(auth(credential), getInstanceId(), NOW)).toEqual({
      ok: false,
      reason: "self_connection",
    });
    expect(listFederationTokens(NOW)[0].consumerInstanceId).toBeNull();
  });

  it("grants nothing when stored scopes are unreadable", () => {
    const { token, credential } = mintFederationToken(input(), NOW);
    sqlite.prepare("UPDATE federation_tokens SET scopes = 'not json' WHERE id = ?").run(token.id);

    const result = authenticateFederationRequest(auth(credential), PRIME, NOW);
    expect(result.ok && result.principal.scopes).toEqual([]);
  });

  it("writes last-used time at most once a minute", () => {
    const { credential } = mintFederationToken(input(), NOW);
    authenticateFederationRequest(auth(credential), PRIME, NOW);
    authenticateFederationRequest(auth(credential), PRIME, NOW + 59_999);
    expect(listFederationTokens(NOW)[0].lastUsedAt).toBe(NOW);

    authenticateFederationRequest(auth(credential), PRIME, NOW + 60_000);
    expect(listFederationTokens(NOW)[0].lastUsedAt).toBe(NOW + 60_000);
  });
});

describe("rotation, revocation, deletion", () => {
  it("rotation replaces the secret and moves the policy revision", () => {
    const original = mintFederationToken(input(), NOW);
    const rotated = rotateFederationToken(original.token.id, NOW + 1);

    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.issued.token.id).toBe(original.token.id);
    expect(rotated.issued.token.policyRevision).not.toBe(original.token.policyRevision);
    expect(rotated.issued.credential).not.toBe(original.credential);

    expect(authenticateFederationRequest(auth(original.credential), PRIME, NOW + 2)).toEqual({
      ok: false,
      reason: "invalid_credential",
    });
    expect(authenticateFederationRequest(auth(rotated.issued.credential), PRIME, NOW + 2).ok).toBe(
      true
    );
  });

  it("never rotates revoked or expired tokens", () => {
    const revoked = mintFederationToken(input(), NOW).token;
    revokeFederationToken(revoked.id, NOW);
    const expired = mintFederationToken(input({ expiresAt: NOW + 1 }), NOW).token;

    expect(rotateFederationToken(revoked.id, NOW)).toEqual({ ok: false, reason: "not_usable" });
    expect(rotateFederationToken(expired.id, NOW + 1)).toEqual({ ok: false, reason: "not_usable" });
    expect(rotateFederationToken("missing", NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("revocation is immediate and idempotent", () => {
    const { token, credential } = mintFederationToken(input(), NOW);
    expect(authenticateFederationRequest(auth(credential), PRIME, NOW).ok).toBe(true);

    expect(revokeFederationToken(token.id, NOW + 5)?.revokedAt).toBe(NOW + 5);
    expect(revokeFederationToken(token.id, NOW + 9)?.revokedAt).toBe(NOW + 5);
    expect(authenticateFederationRequest(auth(credential), PRIME, NOW + 10)).toEqual({
      ok: false,
      reason: "token_revoked",
    });
    expect(revokeFederationToken("missing", NOW)).toBeNull();
  });

  it("a restore suspends usable tokens until the owner confirms them", () => {
    const active = mintFederationToken(input(), NOW);
    const revoked = mintFederationToken(input(), NOW).token;
    revokeFederationToken(revoked.id, NOW);
    const expired = mintFederationToken(input({ expiresAt: NOW + 1 }), NOW).token;

    expect(suspendUsableFederationTokens(NOW + 5)).toBe(1);
    expect(suspendUsableFederationTokens(NOW + 6)).toBe(0);

    const byId = new Map(listFederationTokens(NOW + 6).map((t) => [t.id, t]));
    expect(byId.get(active.token.id)).toMatchObject({ status: "suspended", suspendedAt: NOW + 5 });
    expect(byId.get(active.token.id)?.policyRevision).not.toBe(active.token.policyRevision);
    expect(byId.get(revoked.id)?.suspendedAt).toBeNull();
    expect(byId.get(expired.id)?.suspendedAt).toBeNull();

    expect(authenticateFederationRequest(auth(active.credential), PRIME, NOW + 6)).toEqual({
      ok: false,
      reason: "token_suspended",
    });
    // A wrong secret still learns nothing about the suspension.
    expect(
      authenticateFederationRequest(auth(`${active.token.id}.${"A".repeat(43)}`), PRIME, NOW + 6)
    ).toEqual({ ok: false, reason: "invalid_credential" });
  });

  it("resuming re-enables a suspended token under a new policy revision", () => {
    const { token, credential } = mintFederationToken(input(), NOW);
    suspendUsableFederationTokens(NOW + 1);
    const suspendedRevision = listFederationTokens(NOW + 1)[0].policyRevision;

    const resumed = resumeFederationToken(token.id, NOW + 2);

    expect(resumed.ok && resumed.token).toMatchObject({ status: "active", suspendedAt: null });
    expect(resumed.ok && resumed.token.policyRevision).not.toBe(suspendedRevision);
    expect(authenticateFederationRequest(auth(credential), PRIME, NOW + 3).ok).toBe(true);

    // Resuming an already active token changes nothing.
    const before = listFederationTokens(NOW + 4)[0];
    const again = resumeFederationToken(token.id, NOW + 4);
    expect(again.ok && again.token).toEqual(before);
  });

  it("rotation also lifts a suspension", () => {
    const { token } = mintFederationToken(input(), NOW);
    suspendUsableFederationTokens(NOW + 1);

    const rotated = rotateFederationToken(token.id, NOW + 2);

    expect(rotated.ok && rotated.issued.token.status).toBe("active");
    expect(rotated.ok && authenticateFederationRequest(auth(rotated.issued.credential), PRIME, NOW + 3).ok).toBe(true);
  });

  it("never resumes revoked or expired tokens", () => {
    const revoked = mintFederationToken(input(), NOW).token;
    revokeFederationToken(revoked.id, NOW);
    const expired = mintFederationToken(input({ expiresAt: NOW + 1 }), NOW).token;

    expect(resumeFederationToken(revoked.id, NOW)).toEqual({ ok: false, reason: "not_usable" });
    expect(resumeFederationToken(expired.id, NOW + 1)).toEqual({ ok: false, reason: "not_usable" });
    expect(resumeFederationToken("missing", NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("an identity reset gives a clone its own id and revokes inherited tokens", () => {
    const original = getInstanceId();
    const inherited = mintFederationToken(input(), NOW);
    const alreadyRevoked = mintFederationToken(input(), NOW).token;
    revokeFederationToken(alreadyRevoked.id, NOW);

    const result = resetFederationIdentity(NOW + 10);

    expect(result).toEqual({ instanceId: expect.any(String), revokedTokens: 1 });
    expect(isInstanceId(result.instanceId)).toBe(true);
    expect(result.instanceId).not.toBe(original);
    expect(getInstanceId()).toBe(result.instanceId);
    expect(authenticateFederationRequest(auth(inherited.credential), PRIME, NOW + 11)).toEqual({
      ok: false,
      reason: "token_revoked",
    });
    // A token revoked earlier keeps its original revocation time.
    const byId = new Map(listFederationTokens(NOW + 11).map((t) => [t.id, t.revokedAt]));
    expect(byId.get(alreadyRevoked.id)).toBe(NOW);
    expect(byId.get(inherited.token.id)).toBe(NOW + 10);
  });

  it("deletion removes the token and its credential", () => {
    const { token, credential } = mintFederationToken(input(), NOW);
    expect(deleteFederationToken(token.id)).toBe(true);
    expect(deleteFederationToken(token.id)).toBe(false);
    expect(authenticateFederationRequest(auth(credential), PRIME, NOW)).toEqual({
      ok: false,
      reason: "invalid_credential",
    });
  });
});

describe("active transfers", () => {
  /** Stands in for an asset response: destroying it closes it. */
  const transfer = (tokenId: string) => {
    const res = Object.assign(new EventEmitter(), {
      destroy: vi.fn(function (this: EventEmitter) {
        this.emit("close");
      }),
    });
    trackFederationStream(tokenId, res as unknown as Response);
    return res;
  };

  it("end when their token is rotated, revoked or deleted, and only theirs", () => {
    const a = mintFederationToken(input(), NOW).token;
    const b = mintFederationToken(input(), NOW).token;
    const c = mintFederationToken(input(), NOW).token;
    const [fromA, fromB, fromC] = [transfer(a.id), transfer(b.id), transfer(c.id)];

    rotateFederationToken(a.id, NOW + 1);
    expect(fromA.destroy).toHaveBeenCalledOnce();
    expect(fromB.destroy).not.toHaveBeenCalled();

    revokeFederationToken(b.id, NOW + 2);
    expect(fromB.destroy).toHaveBeenCalledOnce();

    deleteFederationToken(c.id);
    expect(fromC.destroy).toHaveBeenCalledOnce();
    expect(countFederationStreams()).toBe(0);
  });

  it("all end when a restore suspends tokens or the identity is reset", () => {
    const a = mintFederationToken(input(), NOW).token;
    const b = mintFederationToken(input(), NOW).token;

    const first = transfer(a.id);
    suspendUsableFederationTokens(NOW + 1);
    expect(first.destroy).toHaveBeenCalledOnce();

    const second = transfer(b.id);
    resetFederationIdentity(NOW + 2);
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(countFederationStreams()).toBe(0);
  });

  it("forget transfers that finish on their own", () => {
    const a = mintFederationToken(input(), NOW).token;
    transfer(a.id).emit("close");
    expect(countFederationStreams()).toBe(0);
  });
});
