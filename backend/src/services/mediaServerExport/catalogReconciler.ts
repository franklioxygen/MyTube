import { db } from "../../db";
import { logger } from "../../utils/logger";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import type { Collection, Video } from "../storageService";
import {
  allocateSeasonNumber,
  createEpisodeAssignment,
  createMediaServerShow,
  deleteEpisodeAssignment,
  getMediaServerEpisodeAssignments,
  getMediaServerShows,
  updateEpisodeSourcePosition,
  updateMediaServerShow,
  type MediaServerShowPatch,
} from "./catalogRepository";
import {
  buildExportStem,
  buildShowDirectoryName,
  extractRawChannelMetadata,
  getIdentityKeyQuality,
  isStrongerIdentity,
  normalizeAuthorIdentity,
  normalizeDescription,
  resolveShowIdentity,
  UNKNOWN_SHOW_TITLE,
  type ResolvedShowIdentity,
} from "./identity";
import type {
  MediaServerEpisodeAssignment,
  MediaServerExportSkip,
  MediaServerShow,
} from "./types";

/**
 * Converges the persisted export catalog — shows, season attachments, and
 * per-occurrence episode assignments — with the current library (issue #411).
 *
 * Numbering is allocated here and nowhere else, and once allocated it is
 * immutable: an upstream playlist reorder only moves `sourcePosition`. The whole
 * pass runs in one transaction, so two concurrent downloads can never be handed
 * the same season or episode number.
 */

/** Subscription fields the catalog needs; queried narrowly by the caller. */
export interface PlaylistSubscriptionRef {
  collectionId: string;
  channelName?: string;
  author?: string;
  platform?: string;
}

export interface ReconcileCatalogInput {
  videos: Video[];
  collections: Collection[];
  playlistSubscriptions: PlaylistSubscriptionRef[];
  /** Raw yt-dlp info per video, available only right after a download. */
  rawInfoByVideoId?: Map<string, unknown>;
}

export interface ReconcileCatalogResult {
  issues: MediaServerExportSkip[];
}

const SOURCE_BACKED_COLLECTION_TYPES = new Set([
  "playlist",
  "collection",
  "series",
]);

/**
 * A video can be mirrored when its media is a local, non-audio file. Existence
 * on disk is checked later by the planner, so a temporarily missing file never
 * costs the occurrence its stable episode number.
 */
function isMirrorEligibleVideo(video: Video): boolean {
  if (video.mediaType === "audio" || !video.videoPath) {
    return false;
  }
  return resolveManagedWebPath(video.videoPath)?.prefix === "/videos";
}

function occurrenceKey(
  showId: string,
  seasonNumber: number,
  videoId: string
): string {
  return `${showId}|${seasonNumber}|${videoId}`;
}

function isSourceBackedCollection(
  collection: Collection,
  subscriptionsByCollectionId: Map<string, PlaylistSubscriptionRef>
): boolean {
  return (
    subscriptionsByCollectionId.has(collection.id) ||
    SOURCE_BACKED_COLLECTION_TYPES.has(collection.sourceType ?? "")
  );
}

function resolveVideoIdentity(
  video: Video,
  rawSourceInfo: unknown
): ResolvedShowIdentity | null {
  const raw = extractRawChannelMetadata(rawSourceInfo);
  return resolveShowIdentity({
    platform: video.source,
    channelId: raw.channelId,
    channelUrl: raw.channelUrl || video.channelUrl,
    author: raw.channelName || video.author,
  });
}

/**
 * Derive a collection's channel identity from its own captured metadata, its
 * playlist subscription, and finally its members. Members only count when they
 * agree: guessing a show for a mixed playlist would file episodes under the
 * wrong author permanently.
 */
function resolveCollectionIdentity(
  collection: Collection,
  subscription: PlaylistSubscriptionRef | undefined,
  memberVideos: Video[]
): ResolvedShowIdentity | "ambiguous" | null {
  const memberIdentities = new Map<string, ResolvedShowIdentity>();
  for (const video of memberVideos) {
    const identity = resolveVideoIdentity(video, undefined);
    if (identity) {
      memberIdentities.set(identity.identityKey, identity);
    }
  }
  const firstMemberIdentity = memberIdentities.values().next().value;

  // A Bilibili collection stores the uploader's mid, which is exactly what the
  // uploader's own video records carry as their channel URL.
  const bilibiliSpaceUrl = collection.sourceMid
    ? `https://space.bilibili.com/${collection.sourceMid}`
    : undefined;
  const explicit = resolveShowIdentity({
    platform:
      collection.sourcePlatform ||
      subscription?.platform ||
      firstMemberIdentity?.platform,
    channelId: collection.sourceChannelId,
    channelUrl: collection.sourceChannelUrl || bilibiliSpaceUrl,
    author:
      collection.sourceChannelName ||
      subscription?.channelName ||
      subscription?.author,
  });
  if (explicit) {
    return explicit;
  }
  if (memberIdentities.size === 1) {
    return firstMemberIdentity!;
  }
  return memberIdentities.size > 1 ? "ambiguous" : null;
}

/**
 * Get-or-create shows for the duration of one reconcile pass, keeping the
 * in-memory view and the database in step.
 */
class ShowResolver {
  private readonly byId = new Map<string, MediaServerShow>();
  private readonly byIdentityKey = new Map<string, MediaServerShow>();
  private readonly directoryNames = new Set<string>();

  constructor(private readonly shows: MediaServerShow[]) {
    for (const show of shows) {
      this.byId.set(show.id, show);
      this.byIdentityKey.set(show.identityKey, show);
      this.directoryNames.add(show.directoryName);
    }
  }

  getById(showId: string): MediaServerShow | undefined {
    return this.byId.get(showId);
  }

  /**
   * Join an existing show whose identity is compatible at a different strength —
   * a playlist that carries a channel id and a bare video record that only knows
   * the channel URL must not become two shows. Ambiguous matches never merge.
   */
  private findCompatible(
    identity: ResolvedShowIdentity
  ): MediaServerShow | undefined {
    // Two channels that merely share a display name must never merge, so a
    // known channel id or URL on both sides has to agree before the weaker
    // author-name match is allowed to count.
    const conflicts = (
      candidate: string | undefined,
      persisted: string | undefined
    ): boolean =>
      candidate !== undefined &&
      persisted !== undefined &&
      candidate !== persisted;

    const matches = this.shows.filter(
      (show) =>
        show.sourcePlatform === identity.platform &&
        !conflicts(identity.channelId, show.sourceChannelId) &&
        !conflicts(identity.channelUrl, show.sourceChannelUrl) &&
        ((identity.channelId !== undefined &&
          show.sourceChannelId === identity.channelId) ||
          (identity.channelUrl !== undefined &&
            show.sourceChannelUrl === identity.channelUrl) ||
          (identity.authorKey !== undefined &&
            normalizeAuthorIdentity(show.title) === identity.authorKey))
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  /**
   * Fill in what the show still lacks. The persisted title owns the show's
   * directory and its identity-by-name, so it is only replaced while it is the
   * placeholder; the description improves as richer metadata arrives but is
   * never cleared by a source that simply omitted it.
   */
  enrich(
    show: MediaServerShow,
    title: string | undefined,
    description: string | undefined,
    identity?: ResolvedShowIdentity
  ): MediaServerShow {
    const patch: MediaServerShowPatch = {};
    if (
      identity &&
      isStrongerIdentity(
        identity.quality,
        getIdentityKeyQuality(show.identityKey)
      )
    ) {
      patch.identityKey = identity.identityKey;
    }
    if (identity?.channelId && !show.sourceChannelId) {
      patch.sourceChannelId = identity.channelId;
    }
    if (identity?.channelUrl && !show.sourceChannelUrl) {
      patch.sourceChannelUrl = identity.channelUrl;
    }
    if (show.title === UNKNOWN_SHOW_TITLE && title && title.trim()) {
      patch.title = title.trim();
    }
    const normalizedDescription = normalizeDescription(description);
    if (normalizedDescription && normalizedDescription !== show.description) {
      patch.description = normalizedDescription;
    }

    if (Object.keys(patch).length > 0) {
      updateMediaServerShow(show.id, patch);
      this.byIdentityKey.delete(show.identityKey);
      Object.assign(show, patch);
      this.byIdentityKey.set(show.identityKey, show);
    }
    return show;
  }

  resolve(
    identity: ResolvedShowIdentity,
    title: string | undefined,
    description: string | undefined
  ): MediaServerShow {
    const existing =
      this.byIdentityKey.get(identity.identityKey) ??
      this.findCompatible(identity);
    if (existing) {
      return this.enrich(existing, title, description, identity);
    }

    const resolvedTitle = (title || "").trim() || UNKNOWN_SHOW_TITLE;
    const directoryName = buildShowDirectoryName(
      resolvedTitle,
      identity.identityKey,
      (candidate) => this.directoryNames.has(candidate)
    );
    if (identity.quality === "author_fallback") {
      logger.warn("Media-server show resolved by author name only", {
        layout: "playlist_tv",
        action: "reconcile",
        identityQuality: identity.quality,
      });
    }
    const created = createMediaServerShow({
      identityKey: identity.identityKey,
      sourcePlatform: identity.platform,
      sourceChannelId: identity.channelId,
      sourceChannelUrl: identity.channelUrl,
      title: resolvedTitle,
      description: normalizeDescription(description),
      directoryName,
    });
    this.shows.push(created);
    this.byId.set(created.id, created);
    this.byIdentityKey.set(created.identityKey, created);
    this.directoryNames.add(directoryName);
    return created;
  }
}

interface SeasonEpisodeState {
  used: Set<number>;
  max: number;
}

class EpisodeAllocator {
  private readonly byOccurrence = new Map<string, MediaServerEpisodeAssignment>();
  private readonly bySeason = new Map<string, SeasonEpisodeState>();

  constructor(assignments: MediaServerEpisodeAssignment[]) {
    for (const assignment of assignments) {
      this.track(assignment);
    }
  }

  private static seasonKey(showId: string, seasonNumber: number): string {
    return `${showId}|${seasonNumber}`;
  }

  private track(assignment: MediaServerEpisodeAssignment): void {
    this.byOccurrence.set(
      occurrenceKey(
        assignment.showId,
        assignment.seasonNumber,
        assignment.videoId
      ),
      assignment
    );
    const key = EpisodeAllocator.seasonKey(
      assignment.showId,
      assignment.seasonNumber
    );
    const state = this.bySeason.get(key) ?? { used: new Set<number>(), max: 0 };
    state.used.add(assignment.episodeNumber);
    state.max = Math.max(state.max, assignment.episodeNumber);
    this.bySeason.set(key, state);
  }

  get(
    showId: string,
    seasonNumber: number,
    videoId: string
  ): MediaServerEpisodeAssignment | undefined {
    return this.byOccurrence.get(occurrenceKey(showId, seasonNumber, videoId));
  }

  remove(assignment: MediaServerEpisodeAssignment): void {
    deleteEpisodeAssignment(assignment.id);
    this.byOccurrence.delete(
      occurrenceKey(
        assignment.showId,
        assignment.seasonNumber,
        assignment.videoId
      )
    );
    // The season's used-number set is deliberately not shrunk: a freed episode
    // number must not be handed to a different video later.
  }

  /**
   * Keep the position the membership was first imported at when it is still
   * free; otherwise take the next number after the highest ever used in the
   * season. Numbers are never recycled.
   */
  create(input: {
    showId: string;
    collectionId?: string;
    videoId: string;
    seasonNumber: number;
    sourcePosition?: number;
    title: string;
  }): MediaServerEpisodeAssignment {
    const key = EpisodeAllocator.seasonKey(input.showId, input.seasonNumber);
    const state = this.bySeason.get(key) ?? { used: new Set<number>(), max: 0 };
    const preferred = input.sourcePosition;
    const episodeNumber =
      preferred !== undefined && preferred >= 1 && !state.used.has(preferred)
        ? preferred
        : state.max + 1;

    const assignment = createEpisodeAssignment({
      showId: input.showId,
      collectionId: input.collectionId,
      videoId: input.videoId,
      seasonNumber: input.seasonNumber,
      episodeNumber,
      sourcePosition: input.sourcePosition,
      exportStem: buildExportStem(
        input.seasonNumber,
        episodeNumber,
        input.title
      ),
    });
    this.track(assignment);
    return assignment;
  }

  all(): MediaServerEpisodeAssignment[] {
    return Array.from(this.byOccurrence.values());
  }
}

function compareCollectionsForSeasonAllocation(
  left: Collection,
  right: Collection
): number {
  return (
    (left.createdAt || "").localeCompare(right.createdAt || "") ||
    (left.sourceId || "").localeCompare(right.sourceId || "") ||
    left.id.localeCompare(right.id)
  );
}

function compareVideosForSpecialAllocation(left: Video, right: Video): number {
  return (
    (left.createdAt || "").localeCompare(right.createdAt || "") ||
    left.id.localeCompare(right.id)
  );
}

export function reconcileMediaServerCatalog(
  input: ReconcileCatalogInput
): ReconcileCatalogResult {
  return db.transaction(() => reconcileInTransaction(input));
}

function reconcileInTransaction(
  input: ReconcileCatalogInput
): ReconcileCatalogResult {
  const issues: MediaServerExportSkip[] = [];
  const eligibleVideos = new Map<string, Video>();
  for (const video of input.videos) {
    if (isMirrorEligibleVideo(video)) {
      eligibleVideos.set(video.id, video);
    }
  }

  const subscriptionsByCollectionId = new Map<string, PlaylistSubscriptionRef>();
  for (const subscription of input.playlistSubscriptions) {
    subscriptionsByCollectionId.set(subscription.collectionId, subscription);
  }

  const showResolver = new ShowResolver(getMediaServerShows());
  const allocator = new EpisodeAllocator(getMediaServerEpisodeAssignments());
  const collectionsById = new Map(input.collections.map((c) => [c.id, c]));

  // 1. Drop occurrences whose video or playlist membership is gone. Season 00
  //    rows are handled in step 4, once their replacement can exist.
  for (const assignment of allocator.all()) {
    if (!eligibleVideos.has(assignment.videoId)) {
      allocator.remove(assignment);
      continue;
    }
    if (!assignment.collectionId) {
      continue;
    }
    const collection = collectionsById.get(assignment.collectionId);
    const stillLinked =
      collection !== undefined &&
      isSourceBackedCollection(collection, subscriptionsByCollectionId) &&
      collection.videos.includes(assignment.videoId) &&
      collection.mediaServerShowId === assignment.showId &&
      collection.mediaServerSeasonNumber === assignment.seasonNumber;
    if (!stillLinked) {
      allocator.remove(assignment);
    }
  }

  // 2. Fold freshly downloaded channel metadata into the catalog before any
  //    season is allocated, so a playlist joins the show the download created.
  for (const [videoId, rawSourceInfo] of input.rawInfoByVideoId ?? []) {
    const video = eligibleVideos.get(videoId);
    const identity = video ? resolveVideoIdentity(video, rawSourceInfo) : null;
    if (video && identity) {
      const raw = extractRawChannelMetadata(rawSourceInfo);
      showResolver.resolve(
        identity,
        raw.channelName || video.author,
        raw.channelDescription
      );
    }
  }

  // 3. Playlist seasons, allocated in a deterministic, append-only order.
  for (const collection of [...input.collections].sort(
    compareCollectionsForSeasonAllocation
  )) {
    const subscription = subscriptionsByCollectionId.get(collection.id);
    if (!isSourceBackedCollection(collection, subscriptionsByCollectionId)) {
      if (collection.mediaServerSeasonNumber !== undefined) {
        issues.push({
          collectionId: collection.id,
          title: collection.title || collection.name || collection.id,
          reason: "collection_not_source_playlist",
        });
      }
      continue;
    }

    const memberVideos = collection.videos
      .map((videoId) => eligibleVideos.get(videoId))
      .filter((video): video is Video => video !== undefined);
    const fallbackTitle =
      collection.sourceChannelName ||
      subscription?.channelName ||
      subscription?.author ||
      memberVideos[0]?.author;

    const attachedShow =
      collection.mediaServerShowId !== undefined &&
      collection.mediaServerSeasonNumber !== undefined
        ? showResolver.getById(collection.mediaServerShowId)
        : undefined;

    let show: MediaServerShow;
    let seasonNumber: number;
    if (attachedShow) {
      show = showResolver.enrich(
        attachedShow,
        fallbackTitle,
        collection.sourceChannelDescription
      );
      seasonNumber = collection.mediaServerSeasonNumber as number;
    } else {
      const identity = resolveCollectionIdentity(
        collection,
        subscription,
        memberVideos
      );
      if (identity === null || identity === "ambiguous") {
        issues.push({
          collectionId: collection.id,
          title: collection.title || collection.name || collection.id,
          reason:
            identity === "ambiguous"
              ? "ambiguous_collection_show"
              : "unresolved_show_identity",
        });
        continue;
      }
      show = showResolver.resolve(
        identity,
        fallbackTitle,
        collection.sourceChannelDescription
      );
      seasonNumber = allocateSeasonNumber(show.id, collection.id);
      collection.mediaServerShowId = show.id;
      collection.mediaServerSeasonNumber = seasonNumber;
      logger.info("Assigned a media-server season to a playlist", {
        layout: "playlist_tv",
        action: "reconcile",
        showId: show.id,
        collectionId: collection.id,
        seasonNumber,
      });
    }

    let driftedEpisodes = 0;
    for (const [index, videoId] of collection.videos.entries()) {
      const video = eligibleVideos.get(videoId);
      if (!video) {
        continue;
      }
      const sourcePosition = index + 1;
      const existing = allocator.get(show.id, seasonNumber, videoId);
      if (existing) {
        if (existing.sourcePosition !== sourcePosition) {
          updateEpisodeSourcePosition(existing.id, sourcePosition);
          existing.sourcePosition = sourcePosition;
        }
        if (existing.episodeNumber !== sourcePosition) {
          driftedEpisodes++;
        }
        continue;
      }
      allocator.create({
        showId: show.id,
        collectionId: collection.id,
        videoId,
        seasonNumber,
        sourcePosition,
        title: video.title,
      });
    }

    if (driftedEpisodes > 0) {
      // Episode numbers are deliberately not rewritten to follow the upstream
      // order; a future explicit reindex would use exactly this signal.
      logger.warn("Playlist order differs from the stable episode order", {
        layout: "playlist_tv",
        action: "reconcile",
        showId: show.id,
        collectionId: collection.id,
        seasonNumber,
        driftedEpisodes,
      });
    }
  }

  // 4. A Season 00 occurrence only yields once a real playlist season holds the
  //    video, so a video is never absent from the mirror between passes.
  const playlistVideoIds = new Set(
    allocator
      .all()
      .filter((assignment) => assignment.collectionId !== undefined)
      .map((assignment) => assignment.videoId)
  );
  for (const assignment of allocator.all()) {
    if (!assignment.collectionId && playlistVideoIds.has(assignment.videoId)) {
      allocator.remove(assignment);
    }
  }

  // 5. Remaining eligible videos become specials under their resolved show.
  const assignedVideoIds = new Set(
    allocator.all().map((assignment) => assignment.videoId)
  );
  const unassignedVideos = Array.from(eligibleVideos.values())
    .filter((video) => !assignedVideoIds.has(video.id))
    .sort(compareVideosForSpecialAllocation);

  for (const video of unassignedVideos) {
    const identity = resolveVideoIdentity(
      video,
      input.rawInfoByVideoId?.get(video.id)
    );
    if (!identity) {
      issues.push({
        videoId: video.id,
        title: video.title,
        reason: "unresolved_show_identity",
      });
      continue;
    }
    const show = showResolver.resolve(identity, video.author, undefined);
    allocator.create({
      showId: show.id,
      videoId: video.id,
      seasonNumber: 0,
      title: video.title,
    });
  }

  return { issues };
}
