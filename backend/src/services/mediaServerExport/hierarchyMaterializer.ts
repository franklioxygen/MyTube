import path from "path";
import {
  AVATARS_DIR,
  IMAGES_DIR,
  MEDIA_SERVER_LIBRARY_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { logger } from "../../utils/logger";
import { resolveSafeChildPath } from "../../utils/security";
import {
  deleteArtifactRecord,
  listArtifacts,
  listArtifactsForShow,
} from "./artifactLedger";
import {
  buildEpisodeNfo,
  buildSeasonNfo,
  buildShowNfo,
} from "./nfoBuilders";
import { buildSourceInfoEnvelope } from "./sourceInfoEnvelope";
import {
  copyMirrorImageArtifact,
  isArtifactPublished,
  linkMirrorMediaArtifact,
  MediaMaterializationError,
  pruneEmptyMirrorDirectories,
  removeOwnedMirrorArtifact,
  writeMirrorTextArtifact,
} from "./mediaMaterializer";
import type {
  HierarchyEpisodePlan,
  HierarchyShowPlan,
  MediaServerExportSkipReason,
  MediaServerHierarchyPlan,
} from "./types";

/**
 * Executes a hierarchy plan against the filesystem (issue #411, design §7.8).
 *
 * One show at a time, so a failure in one show never aborts the others. Stale
 * cleanup is driven exclusively by the artifact ledger: a path on disk with no
 * ledger row is a user file and is preserved, reported, and left alone.
 */

export interface MaterializeCounts {
  shows: number;
  seasons: number;
  episodes: number;
  linkedMedia: number;
  copiedMedia: number;
  unchangedArtifacts: number;
  removedArtifacts: number;
}

export interface MaterializeFailure {
  showId?: string;
  assignmentId?: string;
  videoId?: string;
  title?: string;
  reason: MediaServerExportSkipReason;
  detail: string;
}

export interface MaterializeResultSummary {
  counts: MaterializeCounts;
  failures: MaterializeFailure[];
}

export interface MaterializeOptions {
  copyFallbackEnabled: boolean;
  /** Called between shows and between episodes; true aborts the remaining work. */
  isCancelled?: () => boolean;
  /** Raw yt-dlp info to embed in a source JSON artifact, keyed by video id. */
  sourceJsonByVideoId?: Map<string, string>;
  /**
   * Shows whose stale artifacts may be swept.
   *
   * MUST be supplied by any incremental caller and MUST match the scope the
   * plan was built with. Omitting it sweeps the entire ledger, which is only
   * correct for a whole-library rebuild — an incremental run whose single show
   * happened to plan nothing would otherwise delete every other show's
   * artifacts.
   */
  sweepScopeShowIds?: Set<string>;
}

function emptyCounts(): MaterializeCounts {
  return {
    shows: 0,
    seasons: 0,
    episodes: 0,
    linkedMedia: 0,
    copiedMedia: 0,
    unchangedArtifacts: 0,
    removedArtifacts: 0,
  };
}

function toFailure(
  error: unknown,
  context: Omit<MaterializeFailure, "reason" | "detail">
): MaterializeFailure {
  if (error instanceof MediaMaterializationError) {
    return { ...context, reason: error.code, detail: error.message };
  }
  return {
    ...context,
    reason: "invalid_catalog_assignment",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function artworkRootFor(absolutePath: string): string | null {
  for (const root of [IMAGES_DIR, AVATARS_DIR, VIDEOS_DIR]) {
    if (absolutePath.startsWith(root + path.sep)) {
      return root;
    }
  }
  return null;
}

function subtitleRootFor(absolutePath: string): string | null {
  for (const root of [SUBTITLES_DIR, VIDEOS_DIR]) {
    if (absolutePath.startsWith(root + path.sep)) {
      return root;
    }
  }
  return null;
}

function materializeEpisode(
  showPlan: HierarchyShowPlan,
  seasonNumber: number,
  episode: HierarchyEpisodePlan,
  options: MaterializeOptions,
  counts: MaterializeCounts
): void {
  const showId = showPlan.show.id;
  const assignmentId = episode.assignment.id;

  // Media first: an NFO without its media is a broken episode in every server,
  // while media without an NFO still plays.
  const media = linkMirrorMediaArtifact({
    sourceAbsolutePath: episode.sourceMediaAbsolutePath,
    sourceAllowedRoot: VIDEOS_DIR,
    targetAbsolutePath: episode.targetMediaAbsolutePath,
    artifactType: "episode_media",
    copyFallbackEnabled: options.copyFallbackEnabled,
    showId,
    assignmentId,
  });

  if (!media.changed) {
    counts.unchangedArtifacts += 1;
  } else if (media.materialization === "copied_media") {
    counts.copiedMedia += 1;
  } else {
    counts.linkedMedia += 1;
  }

  if (episode.thumbSourceAbsolutePath) {
    const root = artworkRootFor(episode.thumbSourceAbsolutePath);
    if (root) {
      const thumb = copyMirrorImageArtifact({
        sourceAbsolutePath: episode.thumbSourceAbsolutePath,
        sourceAllowedRoot: root,
        targetAbsolutePath: episode.targetThumbAbsolutePath,
        artifactType: "episode_thumb",
        showId,
        assignmentId,
      });
      if (!thumb.changed) {
        counts.unchangedArtifacts += 1;
      }
    }
  }

  const nfo = writeMirrorTextArtifact({
    targetAbsolutePath: episode.targetNfoAbsolutePath,
    contents: buildEpisodeNfo({
      video: episode.video,
      showTitle: showPlan.show.title,
      seasonNumber,
      episodeNumber: episode.assignment.episodeNumber,
      thumbFilename: episode.thumbSourceAbsolutePath
        ? path.basename(episode.targetThumbAbsolutePath)
        : undefined,
      occurrenceId: episode.occurrenceId,
    }),
    artifactType: "episode_nfo",
    showId,
    assignmentId,
  });
  if (!nfo.changed) {
    counts.unchangedArtifacts += 1;
  }

  if (episode.targetSourceJsonAbsolutePath) {
    const suppliedSourceJson = options.sourceJsonByVideoId?.get(
      episode.video.id
    );

    // Only a run that actually carries fresh extractor output may replace a
    // published source JSON. An ordinary refresh - a title edit, new artwork -
    // and an offline rebuild both have nothing but the stored video record, and
    // the synthesized envelope they would write drops every extractor-only
    // field the downloader captured. Nothing ever re-fetches those, so
    // overwriting is permanent loss; keeping what is there is free.
    if (
      suppliedSourceJson === undefined &&
      isArtifactPublished(episode.targetSourceJsonAbsolutePath)
    ) {
      counts.unchangedArtifacts += 1;
    } else {
      // Nothing published yet, so synthesize from the video record - the same
      // envelope the adjacent exporter writes. Without this, planning would
      // reserve a .info.json path that is never actually written.
      const contents =
        suppliedSourceJson ??
        `${JSON.stringify(buildSourceInfoEnvelope(episode.video), null, 2)}\n`;

      const sourceJson = writeMirrorTextArtifact({
        targetAbsolutePath: episode.targetSourceJsonAbsolutePath,
        contents,
        artifactType: "source_json",
        showId,
        assignmentId,
      });
      if (!sourceJson.changed) {
        counts.unchangedArtifacts += 1;
      }
    }
  }

  for (const subtitle of episode.subtitles) {
    const root = subtitleRootFor(subtitle.sourceAbsolutePath);
    if (!root) {
      continue;
    }
    const published = linkMirrorMediaArtifact({
      sourceAbsolutePath: subtitle.sourceAbsolutePath,
      sourceAllowedRoot: root,
      targetAbsolutePath: subtitle.targetAbsolutePath,
      artifactType: "episode_subtitle",
      copyFallbackEnabled: options.copyFallbackEnabled,
      showId,
      assignmentId,
    });
    if (!published.changed) {
      counts.unchangedArtifacts += 1;
    }
  }

  counts.episodes += 1;
}

/**
 * Materializes one show as a generator that yields before each episode.
 *
 * The yield points are where a driver may pause: the synchronous drivers drain
 * without stopping, while the async driver awaits the event loop at each one so
 * status and cancellation stay observable even inside the longest show — a
 * single show with many episodes, or a copy fallback moving whole video files,
 * would otherwise hold the process for its full duration. Yields sit between
 * episodes rather than between files: one artifact is published through a temp
 * file and a rename that must not be interleaved.
 */
function* materializeShowSteps(
  showPlan: HierarchyShowPlan,
  options: MaterializeOptions,
  counts: MaterializeCounts,
  failures: MaterializeFailure[]
): Generator<void, void, void> {
  const showId = showPlan.show.id;

  const showNfo = writeMirrorTextArtifact({
    targetAbsolutePath: showPlan.tvshowNfoAbsolutePath,
    contents: buildShowNfo({
      showTitle: showPlan.show.title,
      // Never a video description: an empty show plot is more accurate than a
      // misleading episode plot.
      plot: showPlan.show.description,
      premiered: showPlan.premiered,
      studio: showPlan.show.title,
      showUniqueId: showPlan.showUniqueId,
      tmdbId: showPlan.show.tmdbId,
      tmdbMediaType: showPlan.show.tmdbMediaType,
    }),
    artifactType: "show_nfo",
    showId,
  });
  if (!showNfo.changed) {
    counts.unchangedArtifacts += 1;
  }

  if (showPlan.posterSourceAbsolutePath) {
    const root = artworkRootFor(showPlan.posterSourceAbsolutePath);
    if (root) {
      try {
        const poster = copyMirrorImageArtifact({
          sourceAbsolutePath: showPlan.posterSourceAbsolutePath,
          sourceAllowedRoot: root,
          targetAbsolutePath: showPlan.posterAbsolutePath,
          artifactType: "show_poster",
          showId,
        });
        if (!poster.changed) {
          counts.unchangedArtifacts += 1;
        }
      } catch (error) {
        // A missing poster must not cost the user their episodes.
        failures.push(toFailure(error, { showId }));
      }
    }
  }

  for (const season of showPlan.seasons) {
    const seasonNfo = writeMirrorTextArtifact({
      targetAbsolutePath: season.seasonNfoAbsolutePath,
      contents: buildSeasonNfo({
        seasonNumber: season.seasonNumber,
        title: season.title,
        plot: season.plot,
        seasonUniqueId: season.seasonUniqueId,
      }),
      artifactType: "season_nfo",
      showId,
    });
    if (!seasonNfo.changed) {
      counts.unchangedArtifacts += 1;
    }
    counts.seasons += 1;

    for (const episode of season.episodes) {
      yield;
      if (options.isCancelled?.()) {
        return;
      }
      try {
        materializeEpisode(
          showPlan,
          season.seasonNumber,
          episode,
          options,
          counts
        );
      } catch (error) {
        failures.push(
          toFailure(error, {
            showId,
            assignmentId: episode.assignment.id,
            videoId: episode.video.id,
            title: episode.video.title,
          })
        );
      }
    }
  }

  counts.shows += 1;
}

/**
 * Removes ledger-owned artifacts that the plan no longer expects.
 *
 * `scopeShowIds` restricts the sweep to the shows that were just rebuilt, so an
 * incremental run never deletes another show's artifacts on the strength of a
 * partial plan.
 */
function* sweepStaleArtifactSteps(
  plan: MediaServerHierarchyPlan,
  scopeShowIds: Set<string> | undefined,
  counts: MaterializeCounts,
  failures: MaterializeFailure[],
  isCancelled?: () => boolean
): Generator<void, void, void> {
  const candidates = scopeShowIds
    ? [...scopeShowIds].flatMap((showId) => listArtifactsForShow(showId))
    : listArtifacts();

  const directoriesToPrune = new Set<string>();

  for (const artifact of candidates) {
    // A yield and a check per artifact: a full-library sweep can run for a
    // while, and a cancel that only takes effect at the end is not a cancel.
    // Without the yield the async driver could never let the cancel request be
    // served in the first place.
    yield;
    if (isCancelled?.()) {
      break;
    }
    if (plan.expectedRelativePaths.has(artifact.relativePath)) {
      continue;
    }

    try {
      const absolutePath = resolveSafeChildPath(
        MEDIA_SERVER_LIBRARY_DIR,
        artifact.relativePath
      );
      if (removeOwnedMirrorArtifact(artifact.relativePath)) {
        deleteArtifactRecord(artifact.relativePath);
        counts.removedArtifacts += 1;
        directoriesToPrune.add(path.dirname(absolutePath));
        logger.info("Removed a stale media server mirror artifact", {
          layout: "playlist_tv",
          action: "cleanup",
          showId: artifact.showId,
          assignmentId: artifact.assignmentId,
          artifactType: artifact.artifactType,
          relativePath: artifact.relativePath,
        });
      }
    } catch (error) {
      failures.push(
        toFailure(error, {
          showId: artifact.showId,
          assignmentId: artifact.assignmentId,
        })
      );
    }
  }

  for (const directory of directoriesToPrune) {
    pruneEmptyMirrorDirectories(directory);
  }
}

function sweepStaleArtifacts(
  plan: MediaServerHierarchyPlan,
  scopeShowIds: Set<string> | undefined,
  counts: MaterializeCounts,
  failures: MaterializeFailure[],
  isCancelled?: () => boolean
): void {
  for (const _ of sweepStaleArtifactSteps(
    plan,
    scopeShowIds,
    counts,
    failures,
    isCancelled
  )) {
    // Drained without pausing: the synchronous callers run inside a database
    // mutation and must not yield.
  }
}

function collectCollisionFailures(
  plan: MediaServerHierarchyPlan,
  failures: MaterializeFailure[]
): void {
  for (const collision of plan.collisions) {
    failures.push({
      reason: "artifact_path_collision",
      detail: collision.detail,
      assignmentId: collision.assignmentIds[collision.assignmentIds.length - 1],
    });
  }
}

function materializeShowIsolated(
  showPlan: MediaServerHierarchyPlan["shows"][number],
  options: MaterializeOptions,
  counts: MaterializeCounts,
  failures: MaterializeFailure[]
): void {
  try {
    for (const _ of materializeShowSteps(showPlan, options, counts, failures)) {
      // Drained without pausing: the incremental hooks run inside a database
      // mutation and must stay synchronous.
    }
  } catch (error) {
    // Per-show isolation: one broken show must not stop the rest.
    failures.push(toFailure(error, { showId: showPlan.show.id }));
  }
}

async function materializeShowIsolatedAsync(
  showPlan: MediaServerHierarchyPlan["shows"][number],
  options: MaterializeOptions,
  counts: MaterializeCounts,
  failures: MaterializeFailure[]
): Promise<void> {
  try {
    for (const _ of materializeShowSteps(showPlan, options, counts, failures)) {
      // One event-loop turn per episode, so a cancellation requested while the
      // longest show materializes is observed before its next episode.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } catch (error) {
    // Per-show isolation: one broken show must not stop the rest.
    failures.push(toFailure(error, { showId: showPlan.show.id }));
  }
}

export function materializeMediaServerHierarchy(
  plan: MediaServerHierarchyPlan,
  options: MaterializeOptions
): MaterializeResultSummary {
  const counts = emptyCounts();
  const failures: MaterializeFailure[] = [];

  collectCollisionFailures(plan, failures);

  for (const showPlan of plan.shows) {
    if (options.isCancelled?.()) {
      return { counts, failures };
    }
    materializeShowIsolated(showPlan, options, counts, failures);
  }

  if (options.isCancelled?.()) {
    return { counts, failures };
  }

  sweepStaleArtifacts(plan, options.sweepScopeShowIds, counts, failures);

  return { counts, failures };
}

/**
 * Same work, yielding to the event loop between episodes.
 *
 * The synchronous version is right for the incremental hooks, which touch one
 * video and run inside a database mutation. It is wrong for a full rebuild: a
 * large library, or a copy fallback moving whole video files, occupies the
 * process for as long as it takes, and nothing else is served meanwhile - not
 * the job's own status endpoint, and not the cancel request, which means
 * `cancelRequested` cannot even become true while the run it would stop is in
 * progress. Per-show yielding is not enough either: one show with many
 * episodes still blocks everything for its full duration.
 *
 * The yields sit between episodes and swept artifacts rather than between
 * files: a single artifact is published through a temp file and a rename that
 * must not be interleaved.
 */
export async function materializeMediaServerHierarchyAsync(
  plan: MediaServerHierarchyPlan,
  options: MaterializeOptions
): Promise<MaterializeResultSummary> {
  const counts = emptyCounts();
  const failures: MaterializeFailure[] = [];

  collectCollisionFailures(plan, failures);

  for (const showPlan of plan.shows) {
    if (options.isCancelled?.()) {
      return { counts, failures };
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (options.isCancelled?.()) {
      return { counts, failures };
    }
    await materializeShowIsolatedAsync(showPlan, options, counts, failures);
  }

  if (options.isCancelled?.()) {
    return { counts, failures };
  }

  for (const _ of sweepStaleArtifactSteps(
    plan,
    options.sweepScopeShowIds,
    counts,
    failures,
    options.isCancelled
  )) {
    // One event-loop turn per swept artifact, for the same reason as above: a
    // full-library sweep whose per-artifact cancel check never lets the cancel
    // request be served checks a flag that cannot change.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return { counts, failures };
}

/**
 * Removes every ledger-owned mirror artifact, optionally scoped to some shows.
 *
 * Used by the `playlist_tv` cleanup action and when a show loses its last
 * assignment. Catalog rows are intentionally left in place so a later re-enable
 * reuses the same season and episode numbers.
 */
export function cleanupMediaServerMirror(
  scopeShowIds?: Set<string>,
  isCancelled?: () => boolean
): MaterializeResultSummary {
  const counts = emptyCounts();
  const failures: MaterializeFailure[] = [];

  sweepStaleArtifacts(
    emptySweepPlan(),
    scopeShowIds,
    counts,
    failures,
    isCancelled
  );

  return { counts, failures };
}

/**
 * Same removal, yielding to the event loop between artifacts.
 *
 * The synchronous version is right for the mutation hooks, which sweep one
 * show. It is wrong for the cleanup *action*: that unlinks the whole managed
 * library, and draining it synchronously means nothing else is served while
 * thousands of files go - not the job's status endpoint, and not the cancel
 * request. The `isCancelled` callback it is handed could not change during the
 * call, so a user trying to stop a destructive sweep was only heard once the
 * sweep had already finished.
 */
export async function cleanupMediaServerMirrorAsync(
  scopeShowIds?: Set<string>,
  isCancelled?: () => boolean
): Promise<MaterializeResultSummary> {
  const counts = emptyCounts();
  const failures: MaterializeFailure[] = [];

  for (const _ of sweepStaleArtifactSteps(
    emptySweepPlan(),
    scopeShowIds,
    counts,
    failures,
    isCancelled
  )) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return { counts, failures };
}

/** A plan that expects nothing, so every ledger-owned path is swept. */
function emptySweepPlan(): MediaServerHierarchyPlan {
  return {
    shows: [],
    skipped: [],
    collisions: [],
    expectedRelativePaths: new Set<string>(),
  };
}
