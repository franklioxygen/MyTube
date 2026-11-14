import { Request, Response } from "express";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { getInstanceId } from "../services/federation/instanceIdentity";
import {
  deleteFederationToken,
  FEDERATION_SCOPES,
  type FederationScope,
  type FederationVisibilityCeiling,
  isFederationScope,
  isFederationVisibilityCeiling,
  listFederationTokens,
  MAX_FEDERATION_TOKEN_LABEL_LENGTH,
  MAX_FEDERATION_TOKEN_LIFETIME_MS,
  mintFederationToken,
  resetFederationIdentity,
  resumeFederationToken,
  revokeFederationToken,
  rotateFederationToken,
} from "../services/federation/tokenService";
import { getStringParam } from "../utils/paramUtils";

const FEDERATION_TOKEN = "Federation token";

const parseLabel = (value: unknown): string => {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new ValidationError("label must be a string", "label");
  }
  const label = value.trim();
  if (label.length > MAX_FEDERATION_TOKEN_LABEL_LENGTH) {
    throw new ValidationError(
      `label must be at most ${MAX_FEDERATION_TOKEN_LABEL_LENGTH} characters`,
      "label"
    );
  }
  return label;
};

const parseScopes = (value: unknown): FederationScope[] => {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isFederationScope)) {
    throw new ValidationError(
      `scopes must be a non-empty array of: ${FEDERATION_SCOPES.join(", ")}`,
      "scopes"
    );
  }
  return value;
};

const parseVisibilityCeiling = (value: unknown): FederationVisibilityCeiling => {
  // Hidden content is shared only by explicit owner delegation.
  if (value === undefined) return "public";
  if (!isFederationVisibilityCeiling(value)) {
    throw new ValidationError(
      'visibilityCeiling must be "public" or "owner"',
      "visibilityCeiling"
    );
  }
  return value;
};

const parseExpiresAt = (value: unknown, now: number): number | null => {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= now ||
    value > now + MAX_FEDERATION_TOKEN_LIFETIME_MS
  ) {
    throw new ValidationError(
      "expiresAt must be a future epoch-millisecond time within ten years",
      "expiresAt"
    );
  }
  return value;
};

const requireTokenId = (req: Request): string => {
  const id = getStringParam(req.params.id);
  if (!id) throw new NotFoundError(FEDERATION_TOKEN);
  return id;
};

/** GET /api/federation/tokens */
export function listTokens(_req: Request, res: Response): void {
  res.json({ instanceId: getInstanceId(), tokens: listFederationTokens() });
}

/** POST /api/federation/tokens: the credential is in this response only. */
export function createToken(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const issued = mintFederationToken(
    {
      label: parseLabel(body.label),
      scopes: parseScopes(body.scopes),
      visibilityCeiling: parseVisibilityCeiling(body.visibilityCeiling),
      expiresAt: parseExpiresAt(body.expiresAt, now),
    },
    now
  );
  res.status(201).json(issued);
}

const sendNotUsable = (res: Response, action: string): void => {
  res.status(409).json({
    success: false,
    error: `A revoked or expired federation token cannot be ${action}.`,
  });
};

/** POST /api/federation/tokens/:id/rotate (also lifts a restore suspension) */
export function rotateToken(req: Request, res: Response): void {
  const result = rotateFederationToken(requireTokenId(req));
  if (!result.ok) {
    if (result.reason === "not_found") throw new NotFoundError(FEDERATION_TOKEN);
    sendNotUsable(res, "rotated");
    return;
  }
  res.json(result.issued);
}

/** POST /api/federation/tokens/:id/resume: confirm a token after a restore. */
export function resumeToken(req: Request, res: Response): void {
  const result = resumeFederationToken(requireTokenId(req));
  if (!result.ok) {
    if (result.reason === "not_found") throw new NotFoundError(FEDERATION_TOKEN);
    sendNotUsable(res, "resumed");
    return;
  }
  res.json({ token: result.token });
}

/**
 * POST /api/federation/identity/reset: for a deployment cloned from another
 * that keeps running. Issues a new instance id and revokes every token.
 */
export function resetIdentity(_req: Request, res: Response): void {
  res.json(resetFederationIdentity());
}

/** POST /api/federation/tokens/:id/revoke */
export function revokeToken(req: Request, res: Response): void {
  const token = revokeFederationToken(requireTokenId(req));
  if (!token) throw new NotFoundError(FEDERATION_TOKEN);
  res.json({ token });
}

/** DELETE /api/federation/tokens/:id */
export function deleteToken(req: Request, res: Response): void {
  if (!deleteFederationToken(requireTokenId(req))) {
    throw new NotFoundError(FEDERATION_TOKEN);
  }
  res.status(204).end();
}
