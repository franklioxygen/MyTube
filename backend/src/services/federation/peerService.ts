import crypto from "crypto";
import { sqlite } from "../../db";
import { endFederationStreams } from "./activeStreams";
import { decryptCredential, encryptCredential } from "./credentialVault";
import { getInstanceId, isInstanceId } from "./instanceIdentity";
import { peerJsonRequest, PeerError, type PeerConnection } from "./peerClient";
import { resolvePeerDestination } from "./peerDestination";
import { parseCapabilities, type PeerCapabilities } from "./protocolSchema";

/**
 * Peers this instance reads from (design §3.1, §4). Credentials are stored
 * encrypted and never returned; the identity a peer reports at registration is
 * pinned, and nothing else may later answer for it.
 */

export type PeerStatus =
  | "pending"
  | "ok"
  | "error"
  | "credential_rejected"
  | "credential_missing"
  | "identity_mismatch"
  | "incompatible";

/** Statuses under which a peer's cached items may be shown (stale or not). */
export const SERVABLE_PEER_STATUSES: readonly PeerStatus[] = ["ok", "error"];

export interface FederationPeer {
  id: string;
  peerInstanceId: string;
  name: string;
  baseUrl: string;
  lanException: boolean;
  audience: "public" | "owner";
  canStreamMedia: boolean;
  enabled: boolean;
  status: PeerStatus;
  lastError: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PeerRow {
  id: string;
  peer_instance_id: string;
  name: string;
  base_url: string;
  lan_origin: string | null;
  credential_ciphertext: string;
  audience: "public" | "owner";
  can_stream_media: number;
  enabled: number;
  status: PeerStatus;
  last_error: string | null;
  library_revision: string | null;
  policy_revision: string | null;
  generation: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  created_at: number;
  updated_at: number;
}

export class PeerRequestError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 502,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PeerRequestError";
  }
}

export const MAX_PEER_NAME_LENGTH = 100;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/;

export const peerStreamKey = (peerId: string): string => `peer:${peerId}`;

export const toPeer = (row: PeerRow): FederationPeer => ({
  id: row.id,
  peerInstanceId: row.peer_instance_id,
  name: row.name,
  baseUrl: row.base_url,
  lanException: row.lan_origin !== null,
  audience: row.audience,
  canStreamMedia: row.can_stream_media === 1,
  enabled: row.enabled === 1,
  status: row.status,
  lastError: row.last_error,
  lastAttemptAt: row.last_attempt_at,
  lastSuccessAt: row.last_success_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const readPeerRow = (id: string): PeerRow | undefined =>
  sqlite.prepare("SELECT * FROM federation_peers WHERE id = ?").get(id) as PeerRow | undefined;

export function listPeers(): FederationPeer[] {
  return (
    sqlite.prepare("SELECT * FROM federation_peers ORDER BY created_at ASC, id ASC").all() as PeerRow[]
  ).map(toPeer);
}

/** The decrypted connection, or null when the credential key is unavailable. */
export function connectionFor(row: PeerRow): PeerConnection | null {
  const credential = decryptCredential(row.credential_ciphertext);
  return credential ? { baseUrl: row.base_url, lanOrigin: row.lan_origin, credential } : null;
}

export class HandshakeError extends Error {
  constructor(
    public readonly status: Extract<PeerStatus, "incompatible" | "identity_mismatch">,
    message: string
  ) {
    super(message);
    this.name = "HandshakeError";
  }
}

/** Authenticate to the peer and check it speaks what a sync needs. */
export async function handshake(connection: PeerConnection): Promise<PeerCapabilities> {
  const capabilities = parseCapabilities(await peerJsonRequest(connection, "get", "/capabilities"));
  if (!isInstanceId(capabilities.instanceId)) {
    throw new HandshakeError("incompatible", "The peer reported an invalid instance id.");
  }
  if (capabilities.instanceId === getInstanceId()) {
    throw new HandshakeError("identity_mismatch", "The peer is this instance.");
  }
  if (!capabilities.protocolVersions.includes(1) || !capabilities.features.includes("snapshots")) {
    throw new HandshakeError("incompatible", "The peer does not support this protocol version; upgrade it first.");
  }
  if (!capabilities.credential.scopes.includes("library:read")) {
    throw new HandshakeError("incompatible", "The credential lacks the library:read scope.");
  }
  return capabilities;
}

const parseName = (value: unknown): string => {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_PEER_NAME_LENGTH) {
    throw new PeerRequestError(400, "FEDERATION_INVALID_NAME", `name must be 1-${MAX_PEER_NAME_LENGTH} characters.`);
  }
  return name;
};

const parseCredential = (value: unknown): string => {
  const credential = typeof value === "string" ? value.trim() : "";
  if (!CREDENTIAL_PATTERN.test(credential)) {
    throw new PeerRequestError(400, "FEDERATION_INVALID_CREDENTIAL", "credential must be a federation credential (<id>.<secret>).");
  }
  return credential;
};

/** Maps handshake failures at registration time to an API error. */
const registrationFailure = (error: unknown): PeerRequestError => {
  if (error instanceof PeerRequestError) return error;
  if (error instanceof HandshakeError) {
    return new PeerRequestError(
      error.status === "identity_mismatch" ? 409 : 400,
      error.status === "identity_mismatch" ? "FEDERATION_SELF_CONNECTION" : "FEDERATION_PEER_INCOMPATIBLE",
      error.message
    );
  }
  if (error instanceof PeerError) {
    if (error.kind === "self_connection") {
      return new PeerRequestError(409, "FEDERATION_SELF_CONNECTION", "The peer is this instance.");
    }
    if (error.kind === "credential_rejected") {
      return new PeerRequestError(400, "FEDERATION_CREDENTIAL_REJECTED", error.message);
    }
    return new PeerRequestError(502, "FEDERATION_PEER_UNREACHABLE", error.message);
  }
  return new PeerRequestError(502, "FEDERATION_PEER_UNREACHABLE", error instanceof Error ? error.message : String(error));
};

export async function registerPeer(input: {
  name: unknown;
  baseUrl: unknown;
  credential: unknown;
}): Promise<FederationPeer> {
  const name = parseName(input.name);
  const credential = parseCredential(input.credential);
  if (typeof input.baseUrl !== "string") {
    throw new PeerRequestError(400, "FEDERATION_INVALID_URL", "baseUrl must be a string.");
  }

  let destination;
  try {
    destination = await resolvePeerDestination(input.baseUrl);
  } catch (error) {
    throw new PeerRequestError(400, "FEDERATION_INVALID_URL", error instanceof Error ? error.message : String(error));
  }

  let capabilities: PeerCapabilities;
  try {
    capabilities = await handshake({ ...destination, credential });
  } catch (error) {
    throw registrationFailure(error);
  }

  const existing = sqlite
    .prepare("SELECT id FROM federation_peers WHERE peer_instance_id = ?")
    .get(capabilities.instanceId) as { id: string } | undefined;
  if (existing) {
    throw new PeerRequestError(409, "FEDERATION_PEER_EXISTS", "This instance is already registered, possibly under another URL.");
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    sqlite
      .prepare(
        `INSERT INTO federation_peers
          (id, peer_instance_id, name, base_url, lan_origin, credential_ciphertext, audience,
           can_stream_media, enabled, status, generation, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', 1, ?, ?)`
      )
      .run(
        id,
        capabilities.instanceId,
        name,
        destination.baseUrl,
        destination.lanOrigin,
        encryptCredential(credential),
        capabilities.credential.visibilityCeiling,
        capabilities.credential.scopes.includes("media:read") ? 1 : 0,
        now,
        now
      );
  } catch (error) {
    // A concurrent registration of the same instance lost the unique race.
    if (String(error).includes("UNIQUE")) {
      throw new PeerRequestError(409, "FEDERATION_PEER_EXISTS", "This instance is already registered.");
    }
    throw error;
  }
  return toPeer(readPeerRow(id)!);
}

const requirePeer = (id: string): PeerRow => {
  const row = readPeerRow(id);
  if (!row) throw new PeerRequestError(404, "FEDERATION_PEER_NOT_FOUND", "Unknown peer.");
  return row;
};

/**
 * Rename or enable/disable. Disabling hides the peer's items at once, ends
 * its transfers, and invalidates any sync in flight. Enabling requires a new
 * sync before anything is served again.
 */
export function updatePeer(id: string, input: { name?: unknown; enabled?: unknown }): FederationPeer {
  const row = requirePeer(id);
  const name = input.name === undefined ? row.name : parseName(input.name);
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new PeerRequestError(400, "FEDERATION_INVALID_ENABLED", "enabled must be a boolean.");
  }
  const enabled = input.enabled === undefined ? row.enabled === 1 : input.enabled;
  const toggled = enabled !== (row.enabled === 1);

  sqlite
    .prepare(
      `UPDATE federation_peers
         SET name = ?, enabled = ?, updated_at = ?,
             generation = generation + ?,
             status = CASE WHEN ? THEN 'pending' ELSE status END
       WHERE id = ?`
    )
    .run(name, enabled ? 1 : 0, Date.now(), toggled ? 1 : 0, toggled && enabled ? 1 : 0, id);
  if (toggled) endFederationStreams([peerStreamKey(id)]);
  return toPeer(readPeerRow(id)!);
}

/**
 * Replace the credential, e.g. after the peer rotated it. The new credential
 * must authenticate as the same pinned instance.
 */
export async function replacePeerCredential(id: string, credentialInput: unknown): Promise<FederationPeer> {
  const row = requirePeer(id);
  const credential = parseCredential(credentialInput);

  let capabilities: PeerCapabilities;
  try {
    capabilities = await handshake({ baseUrl: row.base_url, lanOrigin: row.lan_origin, credential });
  } catch (error) {
    throw registrationFailure(error);
  }
  if (capabilities.instanceId !== row.peer_instance_id) {
    throw new PeerRequestError(409, "FEDERATION_IDENTITY_MISMATCH", "This credential belongs to a different instance.");
  }

  sqlite
    .prepare(
      `UPDATE federation_peers
         SET credential_ciphertext = ?, audience = ?, can_stream_media = ?,
             status = 'pending', last_error = NULL, generation = generation + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(
      encryptCredential(credential),
      capabilities.credential.visibilityCeiling,
      capabilities.credential.scopes.includes("media:read") ? 1 : 0,
      Date.now(),
      id
    );
  endFederationStreams([peerStreamKey(id)]);
  return toPeer(readPeerRow(id)!);
}

/** Removes the binding and, by cascade, every item synced from it. */
export function removePeer(id: string): { removedItems: number } {
  requirePeer(id);
  const removedItems = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM federation_remote_videos WHERE peer_id = ?").get(id) as { c: number }
  ).c;
  sqlite.prepare("DELETE FROM federation_peers WHERE id = ?").run(id);
  endFederationStreams([peerStreamKey(id)]);
  return { removedItems };
}

/**
 * After a database restore or import (design §9): restored bindings wait for
 * the owner, and nothing in flight may commit into the replaced database.
 */
export function disablePeersAfterRestore(): number {
  const ids = (sqlite.prepare("SELECT id FROM federation_peers WHERE enabled = 1").all() as Array<{ id: string }>).map(
    (row) => row.id
  );
  sqlite
    .prepare("UPDATE federation_peers SET enabled = 0, generation = generation + 1, updated_at = ? WHERE enabled = 1")
    .run(Date.now());
  endFederationStreams(ids.map(peerStreamKey));
  return ids.length;
}
