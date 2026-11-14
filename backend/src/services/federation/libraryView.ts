import type { Video } from "../storageService/types";
import type { FederationVideoDetail, FederationVideoSummary } from "./libraryExport";
import type { PeerRow } from "./peerService";
import {
  listServableRemoteRows,
  readRemoteDetail,
  readServableRemoteRow,
  servableAssets,
  withOrigin,
} from "./remoteLibrary";

/**
 * Remote items in this instance's library views (design §3.3, §8.1).
 *
 * A remote item takes the shape of a native video so the existing views can
 * show and play it, with every asset path pointing at this instance's media
 * gateway; the peer's paths and storage links never reach the browser. It
 * also carries its origin, availability and capabilities: what a native
 * video can do but a remote one cannot yet (edit, delete, rate, comments,
 * collections, progress) is switched off rather than sent to a native
 * handler. Owner-only, like the rest of the prime side for now.
 */

export interface LibraryCapabilities {
  canPlay: boolean;
  canSaveProgress: boolean;
  canRecordView: boolean;
  canAddToCollection: boolean;
  canEdit: boolean;
  canRate: boolean;
  canDelete: boolean;
  canReadComments: boolean;
  canUseDanmaku: boolean;
  canManageSubtitles: boolean;
  canRefreshThumbnail: boolean;
  canExport: boolean;
  canShare: boolean;
}

export type RemoteAvailability = "online" | "stale" | "offline";

const GATEWAY = "/api/federation/media";

const gatewayPath = (id: string, ...segments: string[]): string =>
  [GATEWAY, id, ...segments].map((part, index) => (index === 0 ? part : encodeURIComponent(part))).join("/");

const capabilitiesFor = (canPlay: boolean): LibraryCapabilities => ({
  canPlay,
  canSaveProgress: false,
  canRecordView: false,
  canAddToCollection: false,
  canEdit: false,
  canRate: false,
  canDelete: false,
  canReadComments: false,
  canUseDanmaku: false,
  canManageSubtitles: false,
  canRefreshThumbnail: false,
  canExport: false,
  canShare: false,
});

function toRemoteVideo(
  id: string,
  summary: Omit<FederationVideoSummary, "id">,
  peer: PeerRow,
  availability: RemoteAvailability
): Video {
  const assets = servableAssets(summary.assets, peer);
  // Offline means the peer just failed a fresh read: nothing can be played.
  const playable = assets.media && availability !== "offline";
  const optional = <T>(value: T | null): T | undefined => value ?? undefined;
  return {
    id,
    title: summary.title,
    author: optional(summary.author),
    date: optional(summary.date),
    source: optional(summary.source),
    sourceUrl: summary.sourceUrl ?? "",
    sourceVideoId: summary.sourceVideoId,
    channelUrl: optional(summary.channelUrl),
    addedAt: optional(summary.addedAt),
    createdAt: summary.createdAt,
    updatedAt: optional(summary.updatedAt),
    partNumber: optional(summary.partNumber),
    totalParts: optional(summary.totalParts),
    seriesTitle: optional(summary.seriesTitle),
    rating: optional(summary.rating),
    duration: optional(summary.duration),
    width: optional(summary.width),
    height: optional(summary.height),
    fileSize: optional(summary.fileSize),
    mediaType: summary.mediaType === "audio" ? "audio" : "video",
    tags: summary.tags,
    visibility: summary.visibility,
    // No media path when it cannot play, so the player does not try.
    videoPath: playable ? gatewayPath(id, "media") : undefined,
    thumbnailPath: assets.thumbnail ? gatewayPath(id, "thumbnail") : undefined,
    authorAvatarPath: assets.avatar ? gatewayPath(id, "avatar") : undefined,
    origin: withOrigin(peer),
    availability,
    lastSyncedAt: peer.last_success_at,
    capabilities: capabilitiesFor(playable),
  };
}

const availabilityOf = (peer: PeerRow): RemoteAvailability => (peer.status === "ok" ? "online" : "stale");

/** Every servable remote item as a library video, newest first. */
export function listRemoteVideos(): Video[] {
  return listServableRemoteRows().map(({ id, summary, peer }) => {
    const { id: _remoteId, ...rest } = summary;
    return toRemoteVideo(id, rest, peer, availabilityOf(peer));
  });
}

const toSubtitles = (id: string, detail: Pick<FederationVideoDetail, "subtitles">) =>
  detail.subtitles.map((track) => ({
    language: track.language ?? "",
    filename: `${track.trackId}.${track.format}`,
    // A path segment, not a query: the player encodes these paths per segment.
    path: gatewayPath(id, "subtitle", track.trackId),
  }));

/**
 * One remote item with fresh detail from its peer, or null when it does not
 * exist or may no longer be served. If the peer cannot answer right now, the
 * owner sees the last committed summary, marked offline and not playable,
 * never a cached private detail (design §7.1).
 */
export async function readRemoteVideo(id: string): Promise<Video | null> {
  const cached = readServableRemoteRow(id);
  if (!cached) return null;

  const fresh = await readRemoteDetail(id);
  if (fresh.ok) {
    const { description, subtitles, ...summary } = fresh.detail;
    return {
      ...toRemoteVideo(id, summary, cached.peer, availabilityOf(cached.peer)),
      description: description ?? undefined,
      subtitles: toSubtitles(id, { subtitles }),
    };
  }
  if (fresh.reason !== "peer_unavailable") return null;
  const { id: _remoteId, ...summary } = cached.summary;
  return toRemoteVideo(id, summary, cached.peer, "offline");
}

const byNewest = (a: Video, b: Video): number =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

/**
 * Merge native and remote videos into one list, newest first. Both inputs are
 * already in that order; on equal timestamps native videos come first and
 * each side keeps its own order, so the result is deterministic. A page is
 * cut from the merged list, never from each side separately (design §3.3).
 */
export function mergeLibrary(
  native: Video[],
  remote: Video[],
  page?: { limit: number; offset: number }
): Video[] {
  const merged: Video[] = [];
  let n = 0;
  let r = 0;
  while (n < native.length || r < remote.length) {
    if (r >= remote.length || (n < native.length && byNewest(native[n], remote[r]) <= 0)) {
      merged.push(native[n++]);
    } else {
      merged.push(remote[r++]);
    }
  }
  return page ? merged.slice(page.offset, page.offset + page.limit) : merged;
}
