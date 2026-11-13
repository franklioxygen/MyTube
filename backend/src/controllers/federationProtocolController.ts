import { Request, Response } from "express";
import path from "path";
import { trackFederationStream } from "../services/federation/activeStreams";
import { proxyCloudAsset } from "../services/federation/cloudAssetProxy";
import {
  FEDERATION_ASSET_KINDS,
  isFederationAssetKind,
  isRegularFile,
  locateFederationAsset,
} from "../services/federation/assetService";
import { getInstanceId } from "../services/federation/instanceIdentity";
import {
  effectiveAudience,
  isCloudStorageAvailable,
  isFederationAudience,
  readExportRow,
  toDetail,
  type FederationAudience,
} from "../services/federation/libraryExport";
import {
  createSnapshot,
  readSnapshotPage,
  releaseSnapshot,
  SNAPSHOT_PAGE_SIZE,
  SNAPSHOT_TTL_MS,
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
export const FEDERATION_FEATURES: readonly string[] = ["snapshots", "details", "assets"];

/** Media storage this instance can stream to consumers. */
export const FEDERATION_MEDIA_STORAGE: readonly string[] = ["local", "mount"];

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
    assets: {
      kinds: FEDERATION_ASSET_KINDS,
      mediaStorage: isCloudStorageAvailable()
        ? [...FEDERATION_MEDIA_STORAGE, "cloud"]
        : FEDERATION_MEDIA_STORAGE,
    },
    limits: { snapshotPageSize: SNAPSHOT_PAGE_SIZE, snapshotTtlMs: SNAPSHOT_TTL_MS },
  });
}

/** Missing and hidden-from-this-audience are deliberately indistinguishable. */
const sendVideoNotFound = (res: Response): void =>
  sendError(res, 404, "FEDERATION_VIDEO_NOT_FOUND", "Unknown video.");

/** GET /api/federation/v1/videos/:nativeId?audience=: fresh, authorized detail. */
export function getVideoDetail(req: Request, res: Response): void {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  const requested = readAudience(req.query.audience, res);
  if (!requested) return;

  const row = readExportRow(
    getStringParam(req.params.nativeId) ?? "",
    effectiveAudience(requested, principal.visibilityCeiling)
  );
  if (!row) {
    sendVideoNotFound(res);
    return;
  }
  res.json(toDetail(row));
}

/**
 * GET|HEAD /api/federation/v1/videos/:nativeId/assets/:kind?audience=&track=
 * Visibility is checked on every request, including Range and conditional
 * ones; send handles Range, If-Range, validators, 206/304/416 and HEAD.
 */
export async function getVideoAsset(req: Request, res: Response): Promise<void> {
  const principal = requirePrincipal(req, res);
  if (!principal) return;
  const kind = getStringParam(req.params.kind);
  if (!isFederationAssetKind(kind)) {
    sendError(res, 400, "FEDERATION_INVALID_ASSET_KIND", `kind must be one of: ${FEDERATION_ASSET_KINDS.join(", ")}.`);
    return;
  }
  const requested = readAudience(req.query.audience, res);
  if (!requested) return;
  const track = req.query.track;
  if (track !== undefined && typeof track !== "string") {
    sendError(res, 400, "FEDERATION_INVALID_TRACK", "track must be a single value.");
    return;
  }

  const row = readExportRow(
    getStringParam(req.params.nativeId) ?? "",
    effectiveAudience(requested, principal.visibilityCeiling)
  );
  if (!row) {
    sendVideoNotFound(res);
    return;
  }

  // Only this asset is unavailable; it says nothing about the video.
  const unavailable = () =>
    sendError(res, 404, "FEDERATION_ASSET_UNAVAILABLE", "This asset is not available.");

  const asset = locateFederationAsset(row, kind, track);
  if (!asset) {
    unavailable();
    return;
  }

  if (asset.type === "cloud") {
    trackFederationStream(principal.tokenId, res);
    await proxyCloudAsset(req, res, asset.filename, asset.fileType, (reason) => {
      if (reason === "unavailable") {
        unavailable();
      } else if (reason === "upstream_timeout") {
        sendError(res, 504, "FEDERATION_UPSTREAM_TIMEOUT", "Cloud storage did not respond in time.");
      } else {
        sendError(res, 502, "FEDERATION_UPSTREAM_ERROR", "Cloud storage could not serve this asset.");
      }
    });
    return;
  }

  if (!(await isRegularFile(asset.absolutePath))) {
    unavailable();
    return;
  }

  const fileName = path.basename(asset.absolutePath);
  const sendOptions = {
    root: path.dirname(asset.absolutePath),
    // Keep the router's no-store; send still emits ETag/Last-Modified.
    cacheControl: false,
    headers: {
      "X-Content-Type-Options": "nosniff",
      ...(asset.contentType ? { "Content-Type": asset.contentType } : {}),
    },
  };
  const onSent = (error?: SendError | null) => {
    if (!error || res.headersSent) return;
    // Precondition and range failures keep their status and headers (e.g.
    // `Content-Range: bytes */size` on 416); anything else means the file
    // could not be read.
    if (error.status === 412 || error.status === 416) {
      res.set(error.headers ?? {}).status(error.status).end();
      return;
    }
    sendError(res, 404, "FEDERATION_ASSET_UNAVAILABLE", "This asset is not available.");
  };

  trackFederationStream(principal.tokenId, res);
  // The path is never consumer input: it comes only from the video's stored
  // reference, confined to the media roots by resolveSafeChildPath or
  // resolveMountFilePath. The consumer picks an allowlisted kind and a track
  // id matched by equality, and send gets a basename under a fixed root.
  // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile
  res.sendFile(fileName, sendOptions, onSent);
}

type SendError = Error & { status?: number; headers?: Record<string, string> };

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
