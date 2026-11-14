import { Request, Response } from "express";
import {
  listPeers,
  PeerRequestError,
  registerPeer,
  removePeer,
  replacePeerCredential,
  updatePeer,
} from "../services/federation/peerService";
import { syncPeer } from "../services/federation/peerSync";
import {
  isGatewayKind,
  isGatewayTrack,
  listRemoteItems,
  readRemoteDetail,
  streamRemoteAsset,
  type GatewayFailure,
} from "../services/federation/remoteLibrary";
import { logger } from "../utils/logger";
import { getStringParam } from "../utils/paramUtils";

/**
 * Prime-side federation management, library and media gateway. Every route
 * is owner-only (requireAdmin); visitors are refused until the per-request
 * freshness checks of design §6.2 exist.
 */

const sendError = (res: Response, status: number, code: string, error: string): void => {
  res.status(status).json({ success: false, code, error });
};

const handle = async (res: Response, work: () => Promise<void> | void): Promise<void> => {
  try {
    await work();
  } catch (error) {
    if (error instanceof PeerRequestError) {
      sendError(res, error.status, error.code, error.message);
      return;
    }
    throw error;
  }
};

const peerId = (req: Request): string => getStringParam(req.params.id) ?? "";

/** Sync in the background; the status is visible on the peer afterwards. */
const syncInBackground = (id: string): void => {
  void syncPeer(id).catch((error) =>
    logger.warn("[Federation] Background sync failed", {
      peerId: id,
      error: error instanceof Error ? error.message : String(error),
    })
  );
};

/** GET /api/federation/peers */
export function getPeers(_req: Request, res: Response): void {
  res.json({ peers: listPeers() });
}

/** POST /api/federation/peers { name, baseUrl, credential } */
export async function postPeer(req: Request, res: Response): Promise<void> {
  await handle(res, async () => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const peer = await registerPeer({ name: body.name, baseUrl: body.baseUrl, credential: body.credential });
    syncInBackground(peer.id);
    res.status(201).json({ peer });
  });
}

/** PATCH /api/federation/peers/:id { name?, enabled? } */
export async function patchPeer(req: Request, res: Response): Promise<void> {
  await handle(res, () => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const peer = updatePeer(peerId(req), { name: body.name, enabled: body.enabled });
    if (peer.enabled && peer.status === "pending") syncInBackground(peer.id);
    res.json({ peer });
  });
}

/** PUT /api/federation/peers/:id/credential { credential } */
export async function putPeerCredential(req: Request, res: Response): Promise<void> {
  await handle(res, async () => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const peer = await replacePeerCredential(peerId(req), body.credential);
    if (peer.enabled) syncInBackground(peer.id);
    res.json({ peer });
  });
}

/** POST /api/federation/peers/:id/sync: waits for the sync and reports it. */
export async function postPeerSync(req: Request, res: Response): Promise<void> {
  await handle(res, async () => {
    const id = peerId(req);
    if (!listPeers().some((peer) => peer.id === id)) {
      throw new PeerRequestError(404, "FEDERATION_PEER_NOT_FOUND", "Unknown peer.");
    }
    const result = await syncPeer(id);
    res.json({ result, peer: listPeers().find((peer) => peer.id === id) });
  });
}

/** DELETE /api/federation/peers/:id */
export async function deletePeer(req: Request, res: Response): Promise<void> {
  await handle(res, () => {
    res.json(removePeer(peerId(req)));
  });
}

const MAX_PAGE = 1000;

const readInt = (value: unknown, fallback: number): number | null => {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/** GET /api/federation/library?offset=&limit= */
export function getRemoteLibrary(req: Request, res: Response): void {
  const offset = readInt(req.query.offset, 0);
  const limit = readInt(req.query.limit, 200);
  if (offset === null || limit === null || limit < 1 || limit > MAX_PAGE) {
    sendError(res, 400, "FEDERATION_INVALID_PAGE", `offset must be >= 0 and limit 1-${MAX_PAGE}.`);
    return;
  }
  res.json(listRemoteItems(offset, limit));
}

const readFailureStatus: Record<GatewayFailure, [number, string, string]> = {
  not_found: [404, "FEDERATION_ITEM_NOT_FOUND", "Unknown or unavailable remote item."],
  asset_unavailable: [404, "FEDERATION_ASSET_UNAVAILABLE", "This asset is not available."],
  // Never 401: that would sign the browser out of this instance.
  peer_rejected: [502, "FEDERATION_PEER_REJECTED", "The peer refused this instance's credential."],
  peer_unavailable: [502, "FEDERATION_PEER_UNAVAILABLE", "The peer could not serve this request."],
  peer_timeout: [504, "FEDERATION_PEER_TIMEOUT", "The peer did not respond in time."],
};

const sendFailure = (res: Response, reason: GatewayFailure): void => {
  const [status, code, error] = readFailureStatus[reason];
  sendError(res, status, code, error);
};

/** GET /api/federation/library/:id: fresh detail from the owning peer. */
export async function getRemoteItem(req: Request, res: Response): Promise<void> {
  const result = await readRemoteDetail(getStringParam(req.params.id) ?? "");
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }
  res.json(result.detail);
}

/** GET|HEAD /api/federation/media/:id/:kind?track= */
export async function getRemoteMedia(req: Request, res: Response): Promise<void> {
  const kind = getStringParam(req.params.kind);
  if (!isGatewayKind(kind)) {
    sendError(res, 400, "FEDERATION_INVALID_ASSET_KIND", "Unknown asset kind.");
    return;
  }
  const track = req.query.track;
  if (track !== undefined && !isGatewayTrack(track)) {
    sendError(res, 400, "FEDERATION_INVALID_TRACK", "Invalid track.");
    return;
  }
  await streamRemoteAsset(req, res, getStringParam(req.params.id) ?? "", kind, track, (reason) =>
    sendFailure(res, reason)
  );
}
