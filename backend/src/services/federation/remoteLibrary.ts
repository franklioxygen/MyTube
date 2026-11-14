import type { Request, Response } from "express";
import { sqlite } from "../../db";
import { trackFederationStream } from "./activeStreams";
import { FEDERATION_ASSET_KINDS, type FederationAssetKind } from "./assetService";
import type { FederationVideoDetail, FederationVideoSummary } from "./libraryExport";
import { peerAuthHeaders, peerJsonRequest, PeerError, peerTrustedOrigin, protocolUrl } from "./peerClient";
import {
  connectionFor,
  peerStreamKey,
  SERVABLE_PEER_STATUSES,
  type PeerRow,
} from "./peerService";
import { parseDetail } from "./protocolSchema";
import { proxyUpstream } from "./upstreamProxy";

/**
 * The prime's read side of federation: synced items, fresh details, and the
 * media gateway (design §7). Owner-only for now; visitor projections need
 * the per-request freshness checks of §6.2 and come later.
 */

export interface RemoteLibraryItem extends Omit<FederationVideoSummary, "id"> {
  id: string;
  origin: { kind: "remote"; instanceId: string; instanceName: string };
  /** `stale`: the last sync failed transiently; metadata may be outdated. */
  availability: "online" | "stale";
  lastSyncedAt: number | null;
}

export interface RemoteLibraryDetail extends Omit<FederationVideoDetail, "id"> {
  id: string;
  origin: RemoteLibraryItem["origin"];
}

interface JoinedRow {
  id: string;
  remote_video_id: string;
  summary: string;
  peer_id: string;
}

const SERVABLE = `p.enabled = 1 AND p.library_revision IS NOT NULL AND p.status IN (${SERVABLE_PEER_STATUSES.map((s) => `'${s}'`).join(", ")})`;

const withOrigin = (row: PeerRow) => ({
  kind: "remote" as const,
  instanceId: row.peer_instance_id,
  instanceName: row.name,
});

/** Assets the gateway cannot stream are reported unavailable. */
const servableAssets = (
  assets: FederationVideoSummary["assets"],
  peer: PeerRow
): FederationVideoSummary["assets"] =>
  peer.can_stream_media === 1 ? assets : { media: false, thumbnail: false, avatar: false, subtitles: false };

export function listRemoteItems(offset: number, limit: number): { total: number; items: RemoteLibraryItem[] } {
  const total = (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM federation_remote_videos rv
         JOIN federation_peers p ON p.id = rv.peer_id
         WHERE rv.deleted_at IS NULL AND ${SERVABLE}`
      )
      .get() as { c: number }
  ).c;

  const rows = sqlite
    .prepare(
      `SELECT p.*, rv.id AS item_id, rv.summary AS summary
       FROM federation_remote_videos rv
       JOIN federation_peers p ON p.id = rv.peer_id
       WHERE rv.deleted_at IS NULL AND ${SERVABLE}
       ORDER BY rv.created_at DESC, rv.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<PeerRow & { item_id: string; summary: string }>;

  return {
    total,
    items: rows.map((row) => {
      const { id: _remoteId, ...summary } = JSON.parse(row.summary) as FederationVideoSummary;
      return {
        ...summary,
        id: row.item_id,
        assets: servableAssets(summary.assets, row),
        origin: withOrigin(row),
        availability: row.status === "ok" ? "online" : "stale",
        lastSyncedAt: row.last_success_at,
      };
    }),
  };
}

/** An item plus its binding, only while that binding may be served. */
function resolveItem(id: string): { item: JoinedRow; peer: PeerRow } | null {
  const item = sqlite
    .prepare(
      `SELECT rv.id, rv.remote_video_id, rv.summary, rv.peer_id
       FROM federation_remote_videos rv
       JOIN federation_peers p ON p.id = rv.peer_id
       WHERE rv.id = ? AND rv.deleted_at IS NULL AND ${SERVABLE}`
    )
    .get(id) as JoinedRow | undefined;
  if (!item) return null;
  const peer = sqlite.prepare("SELECT * FROM federation_peers WHERE id = ?").get(item.peer_id) as PeerRow;
  return { item, peer };
}

export type RemoteReadFailure = "not_found" | "peer_unavailable" | "peer_rejected";

/**
 * The peer refused this instance's credential: hide its items until a sync
 * succeeds again. The generation moves too, so a sync already in flight
 * cannot commit afterwards and make them servable again.
 */
const quarantine = (peer: PeerRow, message: string): void => {
  sqlite
    .prepare(
      `UPDATE federation_peers
         SET status = 'credential_rejected', last_error = ?, library_revision = NULL,
             generation = generation + 1, updated_at = ?
       WHERE id = ? AND generation = ?`
    )
    .run(message, Date.now(), peer.id, peer.generation);
};

/** Fresh, authorized detail from the owning peer (design §5). */
export async function readRemoteDetail(
  id: string
): Promise<{ ok: true; detail: RemoteLibraryDetail } | { ok: false; reason: RemoteReadFailure }> {
  const resolved = resolveItem(id);
  const connection = resolved && connectionFor(resolved.peer);
  if (!resolved || !connection) return { ok: false, reason: "not_found" };

  try {
    const detail = parseDetail(
      await peerJsonRequest(
        connection,
        "get",
        `/videos/${encodeURIComponent(resolved.item.remote_video_id)}?audience=${resolved.peer.audience}`
      )
    );
    const { id: _remoteId, ...rest } = detail;
    return {
      ok: true,
      detail: {
        ...rest,
        id,
        assets: servableAssets(rest.assets, resolved.peer),
        origin: withOrigin(resolved.peer),
      },
    };
  } catch (error) {
    if (error instanceof PeerError && error.kind === "not_found") return { ok: false, reason: "not_found" };
    if (error instanceof PeerError && error.kind === "credential_rejected") {
      quarantine(resolved.peer, error.message);
      return { ok: false, reason: "peer_rejected" };
    }
    return { ok: false, reason: "peer_unavailable" };
  }
}

const TRACK_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isGatewayKind = (value: unknown): value is FederationAssetKind =>
  (FEDERATION_ASSET_KINDS as readonly unknown[]).includes(value);

export const isGatewayTrack = (value: unknown): value is string =>
  typeof value === "string" && TRACK_PATTERN.test(value);

export type GatewayFailure = RemoteReadFailure | "asset_unavailable" | "peer_timeout";

/**
 * Stream one asset of a remote item from its peer (design §7.1). The browser
 * names only the library id, kind and track; the peer, path and credential
 * are resolved here.
 */
export async function streamRemoteAsset(
  req: Request,
  res: Response,
  id: string,
  kind: FederationAssetKind,
  track: string | undefined,
  fail: (reason: GatewayFailure) => void
): Promise<void> {
  const resolved = resolveItem(id);
  const connection = resolved && connectionFor(resolved.peer);
  if (!resolved || !connection) {
    fail("not_found");
    return;
  }
  if (resolved.peer.can_stream_media !== 1) {
    fail("asset_unavailable");
    return;
  }

  const query = new URLSearchParams({ audience: resolved.peer.audience });
  if (track) query.set("track", track);
  const url = protocolUrl(
    connection,
    `/videos/${encodeURIComponent(resolved.item.remote_video_id)}/assets/${kind}?${query.toString()}`
  );

  res.setHeader("Cache-Control", "private, no-store");
  trackFederationStream(peerStreamKey(resolved.peer.id), res);
  await proxyUpstream(
    req,
    res,
    {
      url,
      trustedOrigin: peerTrustedOrigin(connection),
      headers: peerAuthHeaders(connection),
      maxRedirects: 0,
    },
    (reason) => {
      if (reason === "unavailable") {
        fail("asset_unavailable");
      } else if (reason === "upstream_rejected") {
        quarantine(resolved.peer, "The peer refused the credential while streaming.");
        fail("peer_rejected");
      } else {
        fail(reason === "upstream_timeout" ? "peer_timeout" : "peer_unavailable");
      }
    }
  );
}
