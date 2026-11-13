import { Request, Response } from "express";
import { getInstanceId } from "../services/federation/instanceIdentity";

export const FEDERATION_PROTOCOL = "mytube-federation";
export const FEDERATION_PROTOCOL_VERSIONS = [1] as const;

/**
 * Optional protocol features this instance serves. Consumers negotiate on
 * this list rather than on the app version; snapshot and asset endpoints add
 * their names here when they ship.
 */
export const FEDERATION_FEATURES: readonly string[] = [];

/** GET /api/federation/v1/capabilities: the authenticated handshake. */
export function getCapabilities(req: Request, res: Response): void {
  const principal = req.federationPrincipal;
  if (!principal) {
    // Unreachable behind federationAuthentication; fail closed regardless.
    res.status(401).json({ success: false, code: "FEDERATION_UNAUTHORIZED" });
    return;
  }

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
  });
}
