import crypto from "crypto";
import { sqlite } from "../../db";
import { getInstanceId, isInstanceId } from "./instanceIdentity";

/**
 * Credentials this instance issues to federation consumers.
 *
 * A credential is `<id>.<secret>`, presented as
 * `Authorization: Federation <id>.<secret>`. The secret is 256 random bits and
 * only its SHA-256 digest is stored: for a high-entropy random token a fast
 * digest is the right primitive (there is nothing for a slow password hash to
 * stretch), and lookups stay O(1) by id.
 */

export const FEDERATION_SCOPES = ["library:read", "media:read"] as const;
export type FederationScope = (typeof FEDERATION_SCOPES)[number];

export const FEDERATION_VISIBILITY_CEILINGS = ["public", "owner"] as const;
export type FederationVisibilityCeiling =
  (typeof FEDERATION_VISIBILITY_CEILINGS)[number];

export const MAX_FEDERATION_TOKEN_LABEL_LENGTH = 100;
export const MAX_FEDERATION_TOKEN_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const TOKEN_ID_BYTES = 12; // 16 base64url characters
const TOKEN_SECRET_BYTES = 32; // 43 base64url characters
const CREDENTIAL_PATTERN = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
const AUTHORIZATION_PATTERN = /^Federation +(\S+)$/i;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
// Compared against when the token id is unknown, so a miss costs the same as
// a wrong secret.
const UNKNOWN_TOKEN_DIGEST = crypto.createHash("sha256").update("unknown").digest();

export const isFederationScope = (value: unknown): value is FederationScope =>
  (FEDERATION_SCOPES as readonly unknown[]).includes(value);

export const isFederationVisibilityCeiling = (
  value: unknown
): value is FederationVisibilityCeiling =>
  (FEDERATION_VISIBILITY_CEILINGS as readonly unknown[]).includes(value);

export type FederationTokenStatus = "active" | "expired" | "revoked";

export interface FederationToken {
  id: string;
  label: string;
  scopes: FederationScope[];
  visibilityCeiling: FederationVisibilityCeiling;
  policyRevision: number;
  consumerInstanceId: string | null;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
  status: FederationTokenStatus;
}

export interface IssuedFederationCredential {
  token: FederationToken;
  /** `<id>.<secret>`; returned once and never stored. */
  credential: string;
}

export interface MintFederationTokenInput {
  label: string;
  scopes: FederationScope[];
  visibilityCeiling: FederationVisibilityCeiling;
  expiresAt: number | null;
}

export interface FederationPrincipal {
  tokenId: string;
  scopes: FederationScope[];
  visibilityCeiling: FederationVisibilityCeiling;
  policyRevision: number;
  consumerInstanceId: string;
  expiresAt: number | null;
}

export type FederationAuthFailure =
  | "missing_credential"
  | "invalid_credential"
  | "token_revoked"
  | "token_expired"
  | "consumer_required"
  | "consumer_mismatch"
  | "self_connection";

export type FederationAuthResult =
  | { ok: true; principal: FederationPrincipal }
  | { ok: false; reason: FederationAuthFailure };

interface TokenRow {
  id: string;
  secret_hash: string;
  label: string;
  scopes: string;
  visibility_ceiling: FederationVisibilityCeiling;
  policy_revision: number;
  consumer_instance_id: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

const TOKEN_COLUMNS = `id, label, scopes, visibility_ceiling, policy_revision,
  consumer_instance_id, expires_at, revoked_at, last_used_at, created_at, updated_at`;

const randomToken = (bytes: number): string =>
  crypto.randomBytes(bytes).toString("base64url");

const digestSecret = (secret: string): Buffer =>
  crypto.createHash("sha256").update(secret, "utf8").digest();

/** Unreadable scope data grants nothing rather than failing open. */
const parseScopes = (value: string): FederationScope[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isFederationScope) : [];
  } catch {
    return [];
  }
};

/** Deduplicated and in canonical order, so stored values compare stably. */
export const normalizeScopes = (scopes: readonly FederationScope[]): FederationScope[] =>
  FEDERATION_SCOPES.filter((scope) => scopes.includes(scope));

const statusOf = (
  row: Pick<TokenRow, "expires_at" | "revoked_at">,
  now: number
): FederationTokenStatus => {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && row.expires_at <= now) return "expired";
  return "active";
};

const toToken = (row: Omit<TokenRow, "secret_hash">, now: number): FederationToken => ({
  id: row.id,
  label: row.label,
  scopes: parseScopes(row.scopes),
  visibilityCeiling: row.visibility_ceiling,
  policyRevision: row.policy_revision,
  consumerInstanceId: row.consumer_instance_id,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  status: statusOf(row, now),
});

const readToken = (id: string, now: number): FederationToken | null => {
  const row = sqlite
    .prepare(`SELECT ${TOKEN_COLUMNS} FROM federation_tokens WHERE id = ?`)
    .get(id) as Omit<TokenRow, "secret_hash"> | undefined;
  return row ? toToken(row, now) : null;
};

export function listFederationTokens(now = Date.now()): FederationToken[] {
  const rows = sqlite
    .prepare(
      `SELECT ${TOKEN_COLUMNS} FROM federation_tokens ORDER BY created_at DESC, id ASC`
    )
    .all() as Array<Omit<TokenRow, "secret_hash">>;
  return rows.map((row) => toToken(row, now));
}

export function mintFederationToken(
  input: MintFederationTokenInput,
  now = Date.now()
): IssuedFederationCredential {
  const id = randomToken(TOKEN_ID_BYTES);
  const secret = randomToken(TOKEN_SECRET_BYTES);

  sqlite
    .prepare(
      `INSERT INTO federation_tokens
        (id, secret_hash, label, scopes, visibility_ceiling, policy_revision,
         consumer_instance_id, expires_at, revoked_at, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL, ?, NULL, NULL, ?, ?)`
    )
    .run(
      id,
      digestSecret(secret).toString("hex"),
      input.label,
      JSON.stringify(normalizeScopes(input.scopes)),
      input.visibilityCeiling,
      input.expiresAt,
      now,
      now
    );

  const token = readToken(id, now);
  if (!token) {
    throw new Error("Federation token could not be persisted");
  }
  return { token, credential: `${id}.${secret}` };
}

export type RotateFederationTokenResult =
  | { ok: true; issued: IssuedFederationCredential }
  | { ok: false; reason: "not_found" | "not_active" };

/**
 * Replace a token's secret. The old secret stops working immediately and the
 * policy revision moves, so a consumer re-authorizes anything it cached.
 */
export function rotateFederationToken(
  id: string,
  now = Date.now()
): RotateFederationTokenResult {
  const existing = readToken(id, now);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "active") return { ok: false, reason: "not_active" };

  const secret = randomToken(TOKEN_SECRET_BYTES);
  const changed = sqlite
    .prepare(
      `UPDATE federation_tokens
         SET secret_hash = ?, policy_revision = policy_revision + 1, updated_at = ?
       WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`
    )
    .run(digestSecret(secret).toString("hex"), now, id, now).changes;
  if (changed === 0) return { ok: false, reason: "not_active" };

  const token = readToken(id, now);
  if (!token) return { ok: false, reason: "not_found" };
  return { ok: true, issued: { token, credential: `${id}.${secret}` } };
}

/** Idempotent: revoking a revoked token keeps its original revocation time. */
export function revokeFederationToken(id: string, now = Date.now()): FederationToken | null {
  sqlite
    .prepare(
      `UPDATE federation_tokens
         SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
       WHERE id = ?`
    )
    .run(now, now, id);
  return readToken(id, now);
}

export function deleteFederationToken(id: string): boolean {
  return (
    sqlite.prepare("DELETE FROM federation_tokens WHERE id = ?").run(id).changes > 0
  );
}

/**
 * Authenticate one federation protocol request.
 *
 * Revocation and expiry are reported only after the secret matches, so the
 * responses cannot be used to learn which token ids exist. The consumer
 * instance id is an audit and binding value, not proof of identity: it is
 * pinned on first use so one token cannot silently serve two consumers, and a
 * consumer presenting this instance's own id is a self-connection.
 */
export function authenticateFederationRequest(
  authorization: string | undefined,
  consumerInstanceId: string | undefined,
  now = Date.now()
): FederationAuthResult {
  if (!authorization) {
    return { ok: false, reason: "missing_credential" };
  }

  const credential = AUTHORIZATION_PATTERN.exec(authorization.trim())?.[1];
  const parts = credential ? CREDENTIAL_PATTERN.exec(credential) : null;
  if (!parts) {
    return { ok: false, reason: "invalid_credential" };
  }
  const [, tokenId, secret] = parts;

  const row = sqlite
    .prepare("SELECT * FROM federation_tokens WHERE id = ?")
    .get(tokenId) as TokenRow | undefined;
  const provided = digestSecret(secret);
  const stored = row ? Buffer.from(row.secret_hash, "hex") : UNKNOWN_TOKEN_DIGEST;
  const matches =
    stored.length === provided.length && crypto.timingSafeEqual(stored, provided);
  if (!row || !matches) {
    return { ok: false, reason: "invalid_credential" };
  }

  const status = statusOf(row, now);
  if (status === "revoked") return { ok: false, reason: "token_revoked" };
  if (status === "expired") return { ok: false, reason: "token_expired" };

  if (!isInstanceId(consumerInstanceId)) {
    return { ok: false, reason: "consumer_required" };
  }
  if (consumerInstanceId === getInstanceId()) {
    return { ok: false, reason: "self_connection" };
  }

  let pinnedConsumer = row.consumer_instance_id;
  if (pinnedConsumer === null) {
    sqlite
      .prepare(
        `UPDATE federation_tokens SET consumer_instance_id = ?, updated_at = ?
         WHERE id = ? AND consumer_instance_id IS NULL`
      )
      .run(consumerInstanceId, now, tokenId);
    // Re-read: a concurrent first use may have pinned a different consumer.
    pinnedConsumer =
      (
        sqlite
          .prepare("SELECT consumer_instance_id FROM federation_tokens WHERE id = ?")
          .get(tokenId) as { consumer_instance_id: string | null } | undefined
      )?.consumer_instance_id ?? null;
  }
  if (pinnedConsumer !== consumerInstanceId) {
    return { ok: false, reason: "consumer_mismatch" };
  }

  if (row.last_used_at === null || now - row.last_used_at >= LAST_USED_WRITE_INTERVAL_MS) {
    sqlite
      .prepare("UPDATE federation_tokens SET last_used_at = ? WHERE id = ?")
      .run(now, tokenId);
  }

  return {
    ok: true,
    principal: {
      tokenId,
      scopes: parseScopes(row.scopes),
      visibilityCeiling: row.visibility_ceiling,
      policyRevision: row.policy_revision,
      consumerInstanceId,
      expiresAt: row.expires_at,
    },
  };
}
