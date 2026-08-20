import { logger } from "../../utils/logger";
import type {
  Collection,
  MediaServerEpisodeAssignment,
  MediaServerShow,
  Video,
} from "../storageService/types";
import {
  attachCollectionToShow,
  deleteEpisodeAssignment,
  detachCollectionFromShow,
  ensureCollectionShow,
  ensureEpisodeAssignment,
  ensureMediaServerShow,
  getEpisodeAssignmentOccurrence,
  getMediaServerShowByIdentityKey,
  listAssignmentsForCollection,
  listAssignmentsForVideo,
  listMediaServerShows,
  MediaServerCatalogError,
  updateMediaServerShowMetadata,
} from "./catalogRepository";
import {
  canUpgradeShowIdentity,
  collapseCompatibleIdentities,
  normalizeAuthorIdentity,
  normalizeChannelUrl,
  type ResolvedShowIdentity,
} from "./identity";
import {
  normalizeRawSourceMetadata,
  resolveShowMetadata,
} from "./metadataResolver";
import type { MediaServerExportSkipReason } from "./types";

/**
 * Converges the durable catalog from a library snapshot (issue #411, §6.6/§7.3).
 *
 * This is the only place that decides which show a video or collection belongs
 * to, which collections become seasons, and which videos fall to Season 00. It
 * writes catalog rows only — never files. Materialization runs afterwards, and
 * only once every allocation has committed, so a retry can never produce two
 * trees for one playlist.
 */

/**
 * A collection-show holds exactly one season. Season 01 rather than 00 because
 * these are real, ordered episodes — not the unassigned specials bucket.
 */
export const COLLECTION_SHOW_SEASON_NUMBER = 1;

/**
 * Display title for a marked collection, in the order the design fixes:
 * the resolved media-server title (TMDB or manual), then the collection's own.
 */
export function resolveCollectionShowTitle(collection: Collection): string {
  const candidates = [
    collection.mediaServerTitle,
    collection.title,
    collection.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "Untitled Collection";
}

/** Collection source types that carry a durable playlist identity. */
const SOURCE_BACKED_COLLECTION_TYPES = new Set([
  "playlist",
  "collection",
  "series",
]);

export interface CatalogReconcileSubscription {
  id: string;
  collectionId?: string | null;
  playlistId?: string | null;
  playlistTitle?: string | null;
  channelName?: string | null;
  authorUrl?: string | null;
  platform?: string | null;
  subscriptionType?: string | null;
}

export interface CatalogReconcileInput {
  videos: Video[];
  collections: Collection[];
  subscriptions: CatalogReconcileSubscription[];
  /** Per-video normalized yt-dlp metadata, when a download just supplied it. */
  rawMetadataByVideoId?: Map<string, unknown>;
  /** Restrict work to these videos. Absent means the whole library. */
  affectedVideoIds?: Set<string>;
  /** Restrict work to these collections. Absent means all of them. */
  affectedCollectionIds?: Set<string>;
}

export interface CatalogReconcileIssue {
  reason: MediaServerExportSkipReason;
  detail: string;
  videoId?: string;
  collectionId?: string;
}

export interface CatalogReconcileResult {
  /** Shows touched by this run — the materializer's work scope. */
  affectedShowIds: Set<string>;
  createdAssignments: MediaServerEpisodeAssignment[];
  removedAssignmentIds: string[];
  issues: CatalogReconcileIssue[];
}

/**
 * True when a collection has durable source-playlist identity.
 *
 * A manual or `author_auto` collection deliberately does NOT qualify: arbitrary
 * user collections must not silently become media-server seasons.
 */
export function isSourceBackedPlaylistCollection(
  collection: Collection,
  subscriptionsByCollectionId: Map<string, CatalogReconcileSubscription>
): boolean {
  if (collection.origin === "manual" || collection.origin === "author_auto") {
    // A linked playlist subscription still wins: MyTube may have stamped an
    // origin on a collection that a playlist subscription owns.
    const subscription = subscriptionsByCollectionId.get(collection.id);
    return subscription?.subscriptionType === "playlist";
  }

  if (
    collection.sourceType &&
    SOURCE_BACKED_COLLECTION_TYPES.has(collection.sourceType)
  ) {
    return true;
  }

  const subscription = subscriptionsByCollectionId.get(collection.id);
  return subscription?.subscriptionType === "playlist";
}

/**
 * Finds an existing show that this candidate is really the same channel as,
 * even though its identity key differs in strength.
 *
 * This is what makes "one author becomes one show" hold in practice. A playlist
 * usually carries a channel id while a bare video record often carries only a
 * channel URL or an author name; resolving each to its own show would split one
 * channel into two media-server libraries.
 *
 * A match is only accepted when it is UNAMBIGUOUS — exactly one existing show
 * is compatible. Two candidates mean guessing, and because season numbering is
 * immutable a wrong guess is permanent, so the weaker identity gets its own show
 * instead.
 */
function findCompatibleExistingShow(
  identity: ResolvedShowIdentity,
  title: string
): MediaServerShow | undefined {
  const candidateUrl = normalizeChannelUrl(identity.sourceChannelUrl);
  const candidateAuthor = normalizeAuthorIdentity(title);

  const matches = listMediaServerShows().filter((show) => {
    // A collection-show is never a candidate. The `collection:<id>` identity
    // prefix alone is not enough protection, because this function also matches
    // on platform and normalized title — two dramas sharing a name would
    // otherwise be merged into one show, permanently.
    if (show.sourceCollectionId) {
      return false;
    }

    if (show.sourcePlatform !== identity.platform) {
      return false;
    }

    if (identity.sourceChannelId && show.sourceChannelId) {
      // Equal ids settle it, in both directions. This is not redundant with the
      // exact identity-key lookup: a show created from an author fallback keeps
      // its author-based key even after being enriched with a channel id, so
      // the key misses while the ids agree. Without this, a channel that renames
      // itself splits into a second show - and the URL rule below would even
      // reject the match outright once the rename changed the channel URL.
      return show.sourceChannelId === identity.sourceChannelId;
    }

    const showUrl = normalizeChannelUrl(show.sourceChannelUrl);

    if (candidateUrl && showUrl === candidateUrl) {
      return true;
    }

    // Two different durable channel URLs are as conclusive as two different
    // channel ids: same platform, both self-identified, and they disagree. The
    // author fallback must not get a second opinion here - display names are
    // not unique, and a merge is permanent because identity is allocated once.
    if (candidateUrl && showUrl && showUrl !== candidateUrl) {
      return false;
    }

    return Boolean(
      candidateAuthor && normalizeAuthorIdentity(show.title) === candidateAuthor
    );
  });

  return matches.length === 1 ? matches[0] : undefined;
}

function resolveShowForCandidate(
  identity: ResolvedShowIdentity,
  metadata: ReturnType<typeof resolveShowMetadata>
): MediaServerShow {
  const show =
    getMediaServerShowByIdentityKey(identity.identityKey) ??
    findCompatibleExistingShow(identity, metadata.title) ??
    ensureMediaServerShow({
      identityKey: identity.identityKey,
      sourcePlatform: identity.platform,
      sourceChannelId: identity.sourceChannelId,
      sourceChannelUrl: identity.sourceChannelUrl,
      title: metadata.title,
      description: metadata.description,
    });

  if (identity.quality === "author_fallback") {
    logger.warn("Resolved a media server show from an author-name fallback", {
      layout: "playlist_tv",
      action: "reconcile",
      showId: show.id,
      reasonCode: "author_fallback",
    });
  }

  const patch: Parameters<typeof updateMediaServerShowMetadata>[1] = {
    title: metadata.title,
    description: metadata.description || undefined,
    sourceChannelUrl: metadata.sourceChannelUrl,
  };

  // A stronger identity may only enrich one unambiguous author-fallback show.
  // Two existing shows are never merged: that is unrecoverable data loss.
  if (
    metadata.identity &&
    canUpgradeShowIdentity(show, metadata.identity) &&
    metadata.identity.sourceChannelId
  ) {
    patch.sourceChannelId = metadata.identity.sourceChannelId;
    logger.info("Upgraded an author-fallback show with a source channel id", {
      layout: "playlist_tv",
      action: "reconcile",
      showId: show.id,
    });
  }

  return updateMediaServerShowMetadata(show.id, patch) ?? show;
}

/**
 * Derives the single channel identity a collection belongs to.
 *
 * Persisted collection metadata wins; otherwise the linked subscription; only
 * then the member videos. When members disagree the collection is left
 * unassigned and reported as `ambiguous_collection_show` — guessing would put a
 * whole playlist under the wrong show, which the immutable season numbering
 * then makes permanent.
 */
export function resolveCollectionShowCandidate(
  collection: Collection,
  subscription: CatalogReconcileSubscription | undefined,
  memberVideos: Video[]
): { metadata: ReturnType<typeof resolveShowMetadata>; ambiguous: boolean } {
  const fromCollection = resolveShowMetadata({ collection });
  if (fromCollection.identity) {
    return { metadata: fromCollection, ambiguous: false };
  }

  if (subscription?.channelName || subscription?.authorUrl) {
    const fromSubscription = resolveShowMetadata({
      collection: {
        ...collection,
        sourceChannelName: subscription.channelName ?? undefined,
        sourceChannelUrl: subscription.authorUrl ?? undefined,
        sourcePlatform: subscription.platform ?? collection.sourcePlatform,
      } as Collection,
    });
    if (fromSubscription.identity) {
      return { metadata: fromSubscription, ambiguous: false };
    }
  }

  const identities = new Map<string, ReturnType<typeof resolveShowMetadata>>();
  for (const video of memberVideos) {
    const candidate = resolveShowMetadata({ collection, video });
    if (candidate.identity) {
      identities.set(candidate.identity.identityKey, candidate);
    }
  }

  // Members of one channel can resolve at different strengths - one video
  // carrying a channel URL, another only the same author name. Their identity
  // keys differ, but show allocation would merge them, so counting raw keys
  // here declares a false ambiguity and blocks the collection from ever
  // becoming a season (removing an existing season assignment as it goes).
  const distinct = collapseCompatibleIdentities(
    [...identities.values()].map((candidate) => ({
      identityKey: candidate.identity!.identityKey,
      platform: candidate.identity!.platform,
      title: normalizeAuthorIdentity(candidate.title) ?? "",
      strong: candidate.identity!.quality !== "author_fallback",
      value: candidate,
    }))
  );

  if (distinct.length === 1) {
    return { metadata: distinct[0], ambiguous: false };
  }

  return { metadata: fromCollection, ambiguous: distinct.length > 1 };
}

function isEligibleVideo(video: Video): boolean {
  return video.mediaType !== "audio";
}

export function reconcileMediaServerCatalog(
  input: CatalogReconcileInput
): CatalogReconcileResult {
  const result: CatalogReconcileResult = {
    affectedShowIds: new Set<string>(),
    createdAssignments: [],
    removedAssignmentIds: [],
    issues: [],
  };

  const videosById = new Map(input.videos.map((video) => [video.id, video]));
  const subscriptionsByCollectionId = new Map<
    string,
    CatalogReconcileSubscription
  >();
  for (const subscription of input.subscriptions) {
    if (subscription.collectionId) {
      subscriptionsByCollectionId.set(subscription.collectionId, subscription);
    }
  }

  const inScopeVideo = (videoId: string): boolean =>
    !input.affectedVideoIds || input.affectedVideoIds.has(videoId);
  const inScopeCollection = (collectionId: string): boolean =>
    !input.affectedCollectionIds || input.affectedCollectionIds.has(collectionId);

  /** Videos that received at least one playlist assignment in this run. */
  const playlistAssignedVideoIds = new Set<string>();

  /**
   * Collections this run actually walked in the season/show pass. The stale
   * pass may only reason about occurrence keys for these; for any other
   * collection it falls back to the membership check, so an incremental
   * reconcile scoped elsewhere never deletes assignments it did not evaluate.
   */
  const evaluatedCollectionIds = new Set<string>();
  const inScopeCollectionEvaluated = (collectionId: string): boolean =>
    evaluatedCollectionIds.has(collectionId);

  // ---------------------------------------------------------------------
  // 1. Seasons: source-backed playlist collections.
  //
  // Ordered by createdAt, then stable source id, then collection id, so a
  // backfill of an existing library allocates the same season numbers no
  // matter what order the rows come back in.
  // ---------------------------------------------------------------------
  const orderedCollections = [...input.collections].sort((left, right) => {
    const byCreated = String(left.createdAt ?? "").localeCompare(
      String(right.createdAt ?? "")
    );
    if (byCreated !== 0) return byCreated;
    const bySource = String(left.sourceId ?? "").localeCompare(
      String(right.sourceId ?? "")
    );
    if (bySource !== 0) return bySource;
    return left.id.localeCompare(right.id);
  });

  // ---------------------------------------------------------------------
  // 0. Marked collections become shows in their own right.
  //
  // Runs before the author pass so a marked collection is never also treated
  // as a season, and so its assignments already exist when the Season 00 rule
  // decides whether a video still needs a special.
  // ---------------------------------------------------------------------
  for (const collection of orderedCollections) {
    if (!inScopeCollection(collection.id) || !collection.exportAsShow) {
      continue;
    }

    evaluatedCollectionIds.add(collection.id);

    let show: MediaServerShow;
    try {
      show = ensureCollectionShow({
        collectionId: collection.id,
        title: resolveCollectionShowTitle(collection),
        description:
          collection.mediaServerDescription ?? collection.description ?? "",
        posterSourcePath: collection.mediaServerPosterPath,
        tmdbId: collection.tmdbId,
        tmdbMediaType: collection.tmdbMediaType,
        premiered: collection.tmdbPremiereDate,
      });
    } catch (error) {
      result.issues.push({
        reason:
          error instanceof MediaServerCatalogError
            ? (error.code as MediaServerExportSkipReason)
            : "invalid_catalog_assignment",
        detail: error instanceof Error ? error.message : String(error),
        collectionId: collection.id,
      });
      continue;
    }

    result.affectedShowIds.add(show.id);

    // Release the author-season attachment this collection is being promoted
    // out of. The season number itself is never reused - the author show's
    // counter only moves forward - but leaving the attachment behind would make
    // a later attachCollectionToShow hand back the retired number instead of
    // allocating a fresh one, contradicting both the monotonic retirement rule
    // and the warning the UI shows before promotion.
    if (
      collection.mediaServerShowId &&
      collection.mediaServerShowId !== show.id
    ) {
      const retiredShowId = collection.mediaServerShowId;
      detachCollectionFromShow(collection.id);
      // The vacated season still needs its season.nfo and directory reconciled.
      result.affectedShowIds.add(retiredShowId);
    }

    // Numbering to carry across a promotion. When this collection was already a
    // season under an author show, reusing each episode's number and stem keeps
    // the mirror filenames identical across the move, so a media server does not
    // see every episode vanish and reappear renamed.
    const carryOverByVideoId = new Map<
      string,
      { episodeNumber: number; exportStem: string; sourcePosition?: number }
    >();
    for (const previous of listAssignmentsForCollection(collection.id)) {
      if (previous.showId === show.id) {
        continue;
      }
      carryOverByVideoId.set(previous.videoId, {
        episodeNumber: previous.episodeNumber,
        exportStem: previous.exportStem,
        sourcePosition: previous.sourcePosition,
      });
    }

    // A collection-show holds exactly one season.
    let position = 0;
    for (const videoId of collection.videos ?? []) {
      position += 1;
      const video = videosById.get(videoId);
      if (!video || !isEligibleVideo(video) || !inScopeVideo(videoId)) {
        continue;
      }

      try {
        const carryOver = carryOverByVideoId.get(videoId);
        const assignment = ensureEpisodeAssignment({
          showId: show.id,
          collectionId: collection.id,
          videoId,
          seasonNumber: COLLECTION_SHOW_SEASON_NUMBER,
          videoTitle: video.title,
          sourcePosition: carryOver ? undefined : position,
          carryOver,
        });
        playlistAssignedVideoIds.add(videoId);
        result.createdAssignments.push(assignment);
      } catch (error) {
        result.issues.push({
          reason:
            error instanceof MediaServerCatalogError
              ? (error.code as MediaServerExportSkipReason)
              : "invalid_catalog_assignment",
          detail: error instanceof Error ? error.message : String(error),
          collectionId: collection.id,
          videoId,
        });
      }
    }
  }

  for (const collection of orderedCollections) {
    if (!inScopeCollection(collection.id)) {
      continue;
    }

    // A marked collection is a show, never a season under an author show. It is
    // evaluated by the pass above instead.
    if (collection.exportAsShow) {
      continue;
    }

    // Marked evaluated before the eligibility test, not after. A collection that
    // has *stopped* qualifying - the show flag switched off, or a subscription
    // removed - still has assignments from when it did, and its videos are still
    // members. The stale pass preserves assignments for collections this run did
    // not evaluate, so skipping ahead here would keep the retired occurrences
    // alive through every future rebuild and never return the videos to
    // Season 00. Evaluating it produces no desired occurrences, which is exactly
    // the signal the stale pass needs.
    evaluatedCollectionIds.add(collection.id);

    const subscription = subscriptionsByCollectionId.get(collection.id);
    if (!isSourceBackedPlaylistCollection(collection, subscriptionsByCollectionId)) {
      continue;
    }

    const memberVideos = (collection.videos ?? [])
      .map((videoId) => videosById.get(videoId))
      .filter((video): video is Video => Boolean(video) && isEligibleVideo(video!));

    const { metadata, ambiguous } = resolveCollectionShowCandidate(
      collection,
      subscription,
      memberVideos
    );

    if (ambiguous) {
      result.issues.push({
        reason: "ambiguous_collection_show",
        detail: `Collection ${collection.id} resolves to several channel identities; leaving it unassigned.`,
        collectionId: collection.id,
      });
      continue;
    }

    if (!metadata.identity) {
      result.issues.push({
        reason: "unresolved_show_identity",
        detail: `Collection ${collection.id} has no resolvable channel identity.`,
        collectionId: collection.id,
      });
      continue;
    }

    let show: MediaServerShow;
    let seasonNumber: number;
    try {
      show = resolveShowForCandidate(metadata.identity, metadata);
      seasonNumber = attachCollectionToShow(collection.id, show.id).seasonNumber;
    } catch (error) {
      result.issues.push({
        reason:
          error instanceof MediaServerCatalogError
            ? (error.code as MediaServerExportSkipReason)
            : "invalid_catalog_assignment",
        detail: error instanceof Error ? error.message : String(error),
        collectionId: collection.id,
      });
      continue;
    }

    result.affectedShowIds.add(show.id);

    // Episodes, in hydrated collection order. `collection.videos` is already
    // sorted by collection_videos.order, so the index is the observed upstream
    // position — copied into immutable assignment state at first import only.
    let position = 0;
    for (const videoId of collection.videos ?? []) {
      position += 1;
      const video = videosById.get(videoId);
      if (!video || !isEligibleVideo(video) || !inScopeVideo(videoId)) {
        continue;
      }

      try {
        const assignment = ensureEpisodeAssignment({
          showId: show.id,
          collectionId: collection.id,
          videoId,
          seasonNumber,
          videoTitle: video.title,
          sourcePosition: position,
        });
        playlistAssignedVideoIds.add(videoId);
        result.createdAssignments.push(assignment);
      } catch (error) {
        result.issues.push({
          reason:
            error instanceof MediaServerCatalogError
              ? (error.code as MediaServerExportSkipReason)
              : "invalid_catalog_assignment",
          detail: error instanceof Error ? error.message : String(error),
          collectionId: collection.id,
          videoId,
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // 2. Stale occurrences: a video that left a playlist keeps only the
  //    memberships it still has. Other seasons are untouched.
  //
  // This runs BEFORE the Season 00 pass so a video whose last playlist
  // membership just disappeared regains its special occurrence in the same
  // reconcile, rather than being absent from the mirror until the next one.
  // ---------------------------------------------------------------------
  // Keyed on the full occurrence, not just (collection, video).
  //
  // A membership-only key cannot tell an obsolete assignment from the desired
  // one when a collection moves between shows: after a season→show promotion the
  // old author-season row and the new collection-show row reference the same
  // collection and the same video, so the stale row would survive and the mirror
  // would keep a duplicate under the old show.
  const desiredOccurrenceKeys = new Set<string>();
  for (const assignment of result.createdAssignments) {
    desiredOccurrenceKeys.add(
      `${assignment.collectionId ?? ""}:${assignment.showId}:${
        assignment.seasonNumber
      }:${assignment.videoId}`
    );
  }

  const membershipKeys = new Set<string>();
  for (const collection of input.collections) {
    for (const videoId of collection.videos ?? []) {
      membershipKeys.add(`${collection.id}:${videoId}`);
    }
  }

  for (const video of input.videos) {
    if (!inScopeVideo(video.id)) {
      continue;
    }
    for (const assignment of listAssignmentsForVideo(video.id)) {
      if (!assignment.collectionId) {
        continue;
      }
      if (!inScopeCollection(assignment.collectionId)) {
        continue;
      }

      const occurrenceKey = `${assignment.collectionId}:${assignment.showId}:${assignment.seasonNumber}:${assignment.videoId}`;
      if (desiredOccurrenceKeys.has(occurrenceKey)) {
        continue;
      }

      // Fall back to the membership check only when this run did not touch the
      // collection at all, so an incremental reconcile scoped elsewhere never
      // deletes assignments it did not evaluate.
      if (
        !inScopeCollectionEvaluated(assignment.collectionId) &&
        membershipKeys.has(`${assignment.collectionId}:${video.id}`)
      ) {
        continue;
      }

      deleteEpisodeAssignment(assignment.id);
      result.removedAssignmentIds.push(assignment.id);
      result.affectedShowIds.add(assignment.showId);
      playlistAssignedVideoIds.delete(video.id);
    }
  }

  // ---------------------------------------------------------------------
  // 3. Season 00: eligible videos with no playlist assignment.
  //
  // Reserving every positive season for playlists is what stops a loose video
  // from being imported as its own standalone show.
  // ---------------------------------------------------------------------
  for (const video of input.videos) {
    if (!inScopeVideo(video.id) || !isEligibleVideo(video)) {
      continue;
    }

    const existingAssignments = listAssignmentsForVideo(video.id);
    const hasPlaylistAssignment =
      playlistAssignedVideoIds.has(video.id) ||
      existingAssignments.some((assignment) => assignment.collectionId);

    // Use the downloader's envelope when this run carries one. An extractor
    // often supplies a durable channel id that never reaches the video row, and
    // without it identity falls back to the author name - which merges
    // unrelated channels that happen to share a label. Show identity is
    // allocated once and never revised, so that merge would be permanent.
    const rawForVideo = input.rawMetadataByVideoId?.get(video.id);
    const metadata = resolveShowMetadata({
      video,
      raw: rawForVideo ? normalizeRawSourceMetadata(rawForVideo) : undefined,
    });

    if (hasPlaylistAssignment) {
      // Drop the Season 00 occurrence only now that a playlist assignment is
      // durably created, so the video is never briefly absent from the mirror.
      const special = existingAssignments.find(
        (assignment) => assignment.seasonNumber === 0 && !assignment.collectionId
      );
      if (special) {
        deleteEpisodeAssignment(special.id);
        result.removedAssignmentIds.push(special.id);
        result.affectedShowIds.add(special.showId);
      }
      continue;
    }

    if (!metadata.identity) {
      result.issues.push({
        reason: "unresolved_show_identity",
        detail: `Video ${video.id} has no resolvable channel identity.`,
        videoId: video.id,
      });
      continue;
    }

    try {
      const show = resolveShowForCandidate(metadata.identity, metadata);
      result.affectedShowIds.add(show.id);

      const existing = getEpisodeAssignmentOccurrence(show.id, 0, video.id);
      const assignment =
        existing ??
        ensureEpisodeAssignment({
          showId: show.id,
          videoId: video.id,
          seasonNumber: 0,
          videoTitle: video.title,
        });
      result.createdAssignments.push(assignment);
    } catch (error) {
      result.issues.push({
        reason:
          error instanceof MediaServerCatalogError
            ? (error.code as MediaServerExportSkipReason)
            : "invalid_catalog_assignment",
        detail: error instanceof Error ? error.message : String(error),
        videoId: video.id,
      });
    }
  }

  return result;
}
