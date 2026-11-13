import { Request, Response } from "express";
import { getInstanceId } from "../services/federation/instanceIdentity";
import {
  createSnapshot,
  effectiveAudience,
  isFederationAudience,
  readSnapshotPage,
  releaseSnapshot,
  SNAPSHOT_PAGE_SIZE,
  SNAPSHOT_TTL_MS,
  type FederationAudience,
} from "../services/federation/snapshotService";
import type { FederationPrincipal } from "../services/federation/tokenService";
import { getLibraryExportRevision } from "../services/storageService/videoListRevision";
import { getStringParam } from "../utils/paramUtils";

export const FEDERATION_PROTOCOL = "mytube-federation";
export const FEDERATION_PROTOCOL_VERSIONS = [1] as const;

/**
 * Optional protocol features this instance serves. Consumers negotiate on
 * this list rather than on the app version.
 */
export const FEDERATION_FEATURES: readonly string[] = ["snapshots"];

const sendError = (res: Response, status: number, code: string, error: string): void => {
  res.status(status).json({ success: false, code, error });
};

/** Unreachable behind federationAuthentication; fails closed regardless. */
const requirePrincipal = (req: Request, res: Response): FederationPrincipal | null => {
  if (req.federationPrincipal) return req.federationPrincipal;
  sendError(res, 401, "FEDERATION_UNAUTHORIZED", "A federation credential is required.");
  return null;
};

const readAudience = (value: unknown, res: Response): FederationAudience | null => {
  if (isFederationAudience(value)) return value;
  sendError(res, 400, "FEDERATION_INVALID_AUDIENCE", 'audience must be "public" or "owner".');
  return null;
};

/** GET /api/federation/v1/capabilities: the authenticated handshake. */
export function getCapabilities(req: Request, res: Response): void {
  const principal = requirePrincipal(req, res);
  if (!principal) return;

  res.json({
    protocol: FEDERATION_PROTOCOL,
    protocolVersions: FEDERATION_PROTOCOL_VERSIONS,
    instanceId: getInstanceId(),
    credential: {
      id: principal.tokenId,
      scopes: principal.scopes,
      visibilityCeiling: principal.visibilityCeiling,
      policyRevision: principal.policyRevision,
      expiresAt: principal.expiresAt,
    },
    features: FEDERATION_FEATURES,
    limits: { snapshotPageSize: SNAPSHOT_PAGE_SIZE, snapshotTtlMs: SNAPSHOT_TTL_MS },
  });
}

/**
 * GET /api/federation/v1/library/revision?audience=public|owner
 * Cheap enough to poll: an unchanged pair means nothing exported changed.
 */
export function getLibraryRevision(req: Request, res: Response): void {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  const requested = readAudience(req.query.audience, res);
  if (!requested) return;

  res.json({
    audience: effectiveAudience(requested, principal.visibilityCeiling),
    libraryRevision: getLibraryExportRevision(),
    policyRevision: principal.policyRevision,
  });
}

/** POST /api/federation/v1/snapshots { audience } */
export function postSnapshot(req: Request, res: Response): void {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  const requested = readAudience((req.body as { audience?: unknown } | undefined)?.audience, res);
  if (!requested) return;

  const result = createSnapshot(principal, requested);
  if (!result.ok) {
    res.set("Retry-After", "60");
    sendError(res, 429, "FEDERATION_SNAPSHOT_CAPACITY", "Too many snapshots are open; retry later.");
    return;
  }
  res.status(201).json({ instanceId: getInstanceId(), ...result.snapshot });
}

/** GET /api/federation/v1/snapshots/:snapshotId/videos?cursor= */
export function getSnapshotPage(req: Request, res: Response): void {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  const cursor = req.query.cursor;
  if (cursor !== undefined && typeof cursor !== "string") {
    sendError(res, 400, "FEDERATION_INVALID_CURSOR", "cursor must be a single value.");
    return;
  }

  const result = readSnapshotPage(principal, getStringParam(req.params.snapshotId) ?? "", cursor);
  if (result.ok) {
    res.json(result.page);
    return;
  }
  if (result.reason === "stale") {
    sendError(res, 409, "FEDERATION_SNAPSHOT_STALE", "The library or credential changed; start a new snapshot.");
  } else if (result.reason === "invalid_cursor") {
    sendError(res, 400, "FEDERATION_INVALID_CURSOR", "The cursor does not belong to this snapshot.");
  } else {
    sendError(res, 404, "FEDERATION_SNAPSHOT_NOT_FOUND", "Unknown or expired snapshot.");
  }
}

/** DELETE /api/federation/v1/snapshots/:snapshotId */
export function deleteSnapshot(req: Request, res: Response): void {
  const principal = requirePrincipal(req, res);
  if (!principal) return;

  if (!releaseSnapshot(principal, getStringParam(req.params.snapshotId) ?? "")) {
    sendError(res, 404, "FEDERATION_SNAPSHOT_NOT_FOUND", "Unknown or expired snapshot.");
    return;
  }
  res.status(204).end();
}
