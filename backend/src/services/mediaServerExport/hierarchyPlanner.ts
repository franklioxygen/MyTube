import path from "path";
import {
  AVATARS_DIR,
  IMAGES_DIR,
  MEDIA_SERVER_LIBRARY_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { pathExistsSafeSync, resolveSafeChildPath } from "../../utils/security";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import type { Video } from "../storageService/types";
import { padSeasonNumber, sanitizeMirrorSegment } from "./naming";
import {
  buildEpisodeOccurrenceId,
  buildSeasonUniqueId,
  buildShowUniqueId,
  normalizeVideoDateToDay,
} from "./nfoBuilders";
import type {
  HierarchyEpisodePlan,
  HierarchyPlanCollision,
  HierarchyPlanSkip,
  HierarchySeasonPlan,
  HierarchyShowPlan,
  MediaServerCatalogSnapshot,
  MediaServerExportSkipReason,
  MediaServerHierarchyPlan,
  PlanMediaServerHierarchyOptions,
  PlannedSubtitleArtifact,
} from "./types";

/**
 * Pure planner for the playlist-TV mirror (issue #411, design §7.5).
 *
 * Converts a catalog snapshot into the exact set of expected mirror paths. It
 * never reads or mutates the database and never writes to the filesystem. The
 * only filesystem contact is an existence probe, injectable so tests can plan
 * against fixture data.
 *
 * Season and episode numbers come exclusively from persisted assignments. This
 * module never parses a number out of a path — that is adjacent-mode behavior
 * and is deliberately not reused here.
 */

export interface PlannerFileProbe {
  exists(absolutePath: string, allowedRoot: string): boolean;
}

const defaultProbe: PlannerFileProbe = {
  exists: (absolutePath, allowedRoot) => {
    try {
      return pathExistsSafeSync(absolutePath, allowedRoot);
    } catch {
      return false;
    }
  },
};

const SUBTITLE_EXTENSIONS = new Set(["vtt", "srt", "ass", "ssa", "sub", "lrc"]);

interface PlanContext {
  snapshot: MediaServerCatalogSnapshot;
  options: PlanMediaServerHierarchyOptions;
  probe: PlannerFileProbe;
  skipped: HierarchyPlanSkip[];
  collisions: HierarchyPlanCollision[];
  /** relativePath -> assignment ids that claimed it, for collision reporting. */
  claimedPaths: Map<string, string[]>;
}

function toPosixRelative(absolutePath: string): string {
  return path
    .relative(MEDIA_SERVER_LIBRARY_DIR, absolutePath)
    .split(path.sep)
    .join("/");
}

/**
 * Resolves a child of the mirror root and asserts it did not escape. Every
 * target path in a plan goes through here.
 */
function resolveMirrorPath(...segments: string[]): string {
  const relative = segments.filter(Boolean).join("/");
  const absolute = resolveSafeChildPath(MEDIA_SERVER_LIBRARY_DIR, relative);
  if (
    absolute !== MEDIA_SERVER_LIBRARY_DIR &&
    !absolute.startsWith(MEDIA_SERVER_LIBRARY_DIR + path.sep)
  ) {
    throw new Error(`Planned path escapes the media library root: ${relative}`);
  }
  return absolute;
}

function addSkip(
  context: PlanContext,
  video: Video | undefined,
  assignmentId: string | undefined,
  reason: MediaServerExportSkipReason,
  detail?: string
): void {
  context.skipped.push({
    videoId: video?.id ?? "",
    title: video?.title ?? "",
    assignmentId,
    reason,
    detail,
  });
}

/**
 * Records a claim on a target path. A second claim on the same path is a
 * collision, reported with both assignment ids so the failure is diagnosable.
 */
function claimPath(
  context: PlanContext,
  relativePath: string,
  assignmentId: string
): boolean {
  const existing = context.claimedPaths.get(relativePath);
  if (existing) {
    existing.push(assignmentId);
    context.collisions.push({
      relativePath,
      assignmentIds: [...existing],
      detail: `Two episode assignments plan the same mirror path "${relativePath}".`,
    });
    return false;
  }
  context.claimedPaths.set(relativePath, [assignmentId]);
  return true;
}

function resolveArtworkSource(
  webPath: unknown,
  probe: PlannerFileProbe
): string | undefined {
  if (typeof webPath !== "string" || !webPath) {
    return undefined;
  }

  const roots: Array<{ prefix: string; root: string }> = [
    { prefix: "/images/", root: IMAGES_DIR },
    { prefix: "/avatars/", root: AVATARS_DIR },
    { prefix: "/videos/", root: VIDEOS_DIR },
  ];

  for (const { prefix, root } of roots) {
    if (!webPath.startsWith(prefix)) {
      continue;
    }
    try {
      const absolute = resolveSafeChildPath(root, webPath.slice(prefix.length));
      return probe.exists(absolute, root) ? absolute : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Show poster precedence.
 *
 * Author shows: persisted poster → any show video's avatar → any thumbnail. The
 * channel avatar is the natural identity of a channel-as-show.
 *
 * Collection shows: persisted poster → episode thumbnail. The avatar is
 * deliberately skipped — a drama uploaded by a third-party channel would
 * otherwise be posterised with the uploader's selfie, which is the exact
 * complaint this feature exists to fix.
 *
 * Videos are ordered so the choice is deterministic across rebuilds: episode
 * order for a collection show (its first episode is the representative frame),
 * video id for an author show.
 */
function resolveShowPosterSource(
  persistedPath: string | undefined,
  showVideos: Video[],
  probe: PlannerFileProbe,
  isCollectionShow: boolean
): string | undefined {
  const persisted = resolveArtworkSource(persistedPath, probe);
  if (persisted) {
    return persisted;
  }

  // `showVideos` already arrives in season/episode order.
  const ordered = isCollectionShow
    ? showVideos
    : [...showVideos].sort((left, right) => left.id.localeCompare(right.id));

  if (!isCollectionShow) {
    for (const video of ordered) {
      const avatar = resolveArtworkSource(video.authorAvatarPath, probe);
      if (avatar) {
        return avatar;
      }
    }
  }

  for (const video of ordered) {
    const thumbnail = resolveArtworkSource(video.thumbnailPath, probe);
    if (thumbnail) {
      return thumbnail;
    }
  }

  return undefined;
}

function resolveSubtitles(
  video: Video,
  seasonDirectory: string,
  stem: string,
  probe: PlannerFileProbe
): PlannedSubtitleArtifact[] {
  if (!Array.isArray(video.subtitles)) {
    return [];
  }

  const planned: PlannedSubtitleArtifact[] = [];
  const usedTargets = new Set<string>();

  for (const subtitle of video.subtitles) {
    if (!subtitle || typeof subtitle.path !== "string") {
      continue;
    }

    const resolved = resolveManagedWebPath(subtitle.path);
    if (
      !resolved ||
      (resolved.prefix !== "/subtitles" && resolved.prefix !== "/videos")
    ) {
      continue;
    }

    const allowedRoot =
      resolved.prefix === "/subtitles" ? SUBTITLES_DIR : VIDEOS_DIR;
    if (!probe.exists(resolved.absolutePath, allowedRoot)) {
      continue;
    }

    const extension = path
      .extname(subtitle.filename || resolved.relativePath)
      .replace(/^\./, "")
      .toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(extension)) {
      continue;
    }

    // The language becomes a filename component, so it is allowlisted rather
    // than sanitized: an arbitrary language string must never shape a path.
    const language = String(subtitle.language || "und")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    if (!language) {
      continue;
    }

    const filename = `${stem}.${language}.${extension}`;
    if (usedTargets.has(filename)) {
      continue;
    }
    usedTargets.add(filename);

    const targetAbsolutePath = resolveMirrorPath(seasonDirectory, filename);
    planned.push({
      language,
      sourceAbsolutePath: resolved.absolutePath,
      targetAbsolutePath,
      targetRelativePath: toPosixRelative(targetAbsolutePath),
    });
  }

  return planned;
}

function planEpisode(
  context: PlanContext,
  showDirectory: string,
  seasonDirectory: string,
  assignment: MediaServerCatalogSnapshot["assignments"][number]
): HierarchyEpisodePlan | null {
  const video = context.snapshot.videosById.get(assignment.videoId);

  if (!video) {
    addSkip(context, undefined, assignment.id, "invalid_catalog_assignment",
      `Assignment ${assignment.id} references missing video ${assignment.videoId}.`);
    return null;
  }

  if (video.mediaType === "audio") {
    addSkip(context, video, assignment.id, "audio_media");
    return null;
  }

  if (
    !Number.isInteger(assignment.seasonNumber) ||
    assignment.seasonNumber < 0 ||
    !Number.isInteger(assignment.episodeNumber) ||
    assignment.episodeNumber < 1
  ) {
    addSkip(context, video, assignment.id, "invalid_catalog_assignment",
      `Assignment ${assignment.id} has season ${assignment.seasonNumber} / episode ${assignment.episodeNumber}.`);
    return null;
  }

  const videoPath = typeof video.videoPath === "string" ? video.videoPath : "";
  const resolved = videoPath ? resolveManagedWebPath(videoPath) : null;

  if (!resolved || resolved.prefix !== "/videos") {
    let reason: MediaServerExportSkipReason = "no_local_video_path";
    if (videoPath.startsWith("cloud:")) {
      reason = "cloud_path";
    } else if (videoPath.startsWith("mount:")) {
      reason = "mount_path";
    } else if (
      videoPath.startsWith("http://") ||
      videoPath.startsWith("https://")
    ) {
      reason = "external_http_path";
    }
    addSkip(context, video, assignment.id, reason);
    return null;
  }

  if (!context.probe.exists(resolved.absolutePath, VIDEOS_DIR)) {
    addSkip(context, video, assignment.id, "video_file_missing");
    return null;
  }

  const stem = sanitizeMirrorSegment(assignment.exportStem);
  if (!stem) {
    addSkip(context, video, assignment.id, "invalid_catalog_assignment",
      `Assignment ${assignment.id} has an unusable export stem.`);
    return null;
  }

  const extension = path.extname(resolved.absolutePath).toLowerCase();
  const mediaFilename = `${stem}${extension}`;
  const targetMediaAbsolutePath = resolveMirrorPath(
    seasonDirectory,
    mediaFilename
  );
  const targetMediaRelativePath = toPosixRelative(targetMediaAbsolutePath);

  if (!claimPath(context, targetMediaRelativePath, assignment.id)) {
    addSkip(context, video, assignment.id, "artifact_path_collision",
      `Mirror path "${targetMediaRelativePath}" is claimed twice.`);
    return null;
  }

  const targetNfoAbsolutePath = resolveMirrorPath(
    seasonDirectory,
    `${stem}.nfo`
  );
  const targetThumbAbsolutePath = resolveMirrorPath(
    seasonDirectory,
    `${stem}-thumb.jpg`
  );
  const targetSourceJsonAbsolutePath =
    context.options.mode === "nfo_and_source_json"
      ? resolveMirrorPath(seasonDirectory, `${stem}.info.json`)
      : undefined;

  return {
    assignment,
    video,
    sourceMediaAbsolutePath: resolved.absolutePath,
    sourceMediaExtension: extension,
    targetMediaAbsolutePath,
    targetMediaRelativePath,
    targetNfoAbsolutePath,
    targetNfoRelativePath: toPosixRelative(targetNfoAbsolutePath),
    targetThumbAbsolutePath,
    targetThumbRelativePath: toPosixRelative(targetThumbAbsolutePath),
    thumbSourceAbsolutePath: resolveArtworkSource(
      video.thumbnailPath,
      context.probe
    ),
    targetSourceJsonAbsolutePath,
    targetSourceJsonRelativePath: targetSourceJsonAbsolutePath
      ? toPosixRelative(targetSourceJsonAbsolutePath)
      : undefined,
    subtitles: resolveSubtitles(video, seasonDirectory, stem, context.probe),
    occurrenceId: buildEpisodeOccurrenceId({
      showId: assignment.showId,
      seasonNumber: assignment.seasonNumber,
      episodeNumber: assignment.episodeNumber,
      videoId: assignment.videoId,
    }),
  };
}

function collectExpectedPaths(
  plan: HierarchyShowPlan,
  expected: Set<string>
): void {
  expected.add(plan.tvshowNfoRelativePath);
  if (plan.posterSourceAbsolutePath) {
    expected.add(plan.posterRelativePath);
  }

  for (const season of plan.seasons) {
    expected.add(season.seasonNfoRelativePath);
    for (const episode of season.episodes) {
      expected.add(episode.targetMediaRelativePath);
      expected.add(episode.targetNfoRelativePath);
      if (episode.thumbSourceAbsolutePath) {
        expected.add(episode.targetThumbRelativePath);
      }
      if (episode.targetSourceJsonRelativePath) {
        expected.add(episode.targetSourceJsonRelativePath);
      }
      for (const subtitle of episode.subtitles) {
        expected.add(subtitle.targetRelativePath);
      }
    }
  }
}

/**
 * Protects what a skipped-but-still-assigned episode already has on disk.
 *
 * A planner skip means "this run could not place the episode", never "delete
 * what is already published for it". The two are easy to confuse because the
 * ledger sweep treats every path outside `expectedRelativePaths` as stale, so
 * without this a source that is merely unreachable right now - an unmounted
 * drive, a NAS blip, a file being moved - costs the user the mirror they still
 * had. In a copy-fallback deployment that is a second full copy of the video,
 * deleted during an outage that fixes itself.
 *
 * Authority to delete stays exactly where it was: with the reconciler removing
 * the assignment (the ledger's `assignment_id` goes null with it, so nothing
 * below matches any more and the next sweep reclaims the paths) and with the
 * explicit cleanup action, which plans nothing and therefore protects nothing.
 *
 * Show-level artifacts have no assignment of their own, so they are protected
 * for any show that still holds a skipped assignment: a show whose only episode
 * was skipped is dropped from the plan entirely, and its `tvshow.nfo`, poster
 * and `season.nfo` would go with it. A show that is genuinely empty has no
 * skips and is still swept.
 */
function collectSkippedAssignmentPaths(
  snapshot: MediaServerCatalogSnapshot,
  skipped: HierarchyPlanSkip[],
  expected: Set<string>
): void {
  const skippedAssignmentIds = new Set<string>();
  for (const skip of skipped) {
    if (skip.assignmentId) {
      skippedAssignmentIds.add(skip.assignmentId);
    }
  }
  if (skippedAssignmentIds.size === 0) {
    return;
  }

  const showIdsWithSkips = new Set<string>();
  for (const assignment of snapshot.assignments) {
    if (skippedAssignmentIds.has(assignment.id)) {
      showIdsWithSkips.add(assignment.showId);
    }
  }

  for (const artifact of snapshot.artifactsByPath.values()) {
    const protectedByAssignment =
      artifact.assignmentId && skippedAssignmentIds.has(artifact.assignmentId);
    const protectedByShow =
      !artifact.assignmentId &&
      artifact.showId &&
      showIdsWithSkips.has(artifact.showId);
    if (protectedByAssignment || protectedByShow) {
      expected.add(artifact.relativePath);
    }
  }
}

export function planMediaServerHierarchy(
  snapshot: MediaServerCatalogSnapshot,
  options: PlanMediaServerHierarchyOptions,
  probe: PlannerFileProbe = defaultProbe
): MediaServerHierarchyPlan {
  const context: PlanContext = {
    snapshot,
    options,
    probe,
    skipped: [],
    collisions: [],
    claimedPaths: new Map(),
  };

  const showsById = new Map(snapshot.shows.map((show) => [show.id, show]));
  const assignmentsByShow = new Map<string, typeof snapshot.assignments>();
  for (const assignment of snapshot.assignments) {
    const list = assignmentsByShow.get(assignment.showId) ?? [];
    list.push(assignment);
    assignmentsByShow.set(assignment.showId, list);
  }

  const seasonMetadata = new Map<string, (typeof snapshot.seasons)[number]>();
  for (const season of snapshot.seasons) {
    seasonMetadata.set(`${season.showId}:${season.seasonNumber}`, season);
  }

  const shows: HierarchyShowPlan[] = [];

  // Deterministic ordering: shows by directory name, seasons and episodes
  // numerically. Two rebuilds of unchanged input must produce identical plans.
  const orderedShows = [...snapshot.shows].sort((left, right) =>
    left.directoryName.localeCompare(right.directoryName)
  );

  for (const show of orderedShows) {
    if (options.showIds && !options.showIds.has(show.id)) {
      continue;
    }

    const showDirectory = sanitizeMirrorSegment(show.directoryName);
    if (!showDirectory) {
      addSkip(context, undefined, undefined, "unresolved_show_identity",
        `Show ${show.id} has an unusable directory name.`);
      continue;
    }

    const showAssignments = assignmentsByShow.get(show.id) ?? [];
    const bySeason = new Map<number, typeof showAssignments>();
    for (const assignment of showAssignments) {
      const list = bySeason.get(assignment.seasonNumber) ?? [];
      list.push(assignment);
      bySeason.set(assignment.seasonNumber, list);
    }

    const seasons: HierarchySeasonPlan[] = [];
    const showVideos: Video[] = [];

    for (const seasonNumber of [...bySeason.keys()].sort((a, b) => a - b)) {
      const seasonDirectory = `${showDirectory}/Season ${padSeasonNumber(
        seasonNumber
      )}`;
      const metadata = seasonMetadata.get(`${show.id}:${seasonNumber}`);
      const collectionId = metadata?.collectionId;

      const episodes: HierarchyEpisodePlan[] = [];
      const seasonAssignments = (bySeason.get(seasonNumber) ?? []).sort(
        (left, right) => left.episodeNumber - right.episodeNumber
      );

      for (const assignment of seasonAssignments) {
        const episode = planEpisode(
          context,
          showDirectory,
          seasonDirectory,
          assignment
        );
        if (episode) {
          episodes.push(episode);
          showVideos.push(episode.video);
        }
      }

      if (episodes.length === 0) {
        continue;
      }

      const directoryAbsolutePath = resolveMirrorPath(seasonDirectory);
      const seasonNfoAbsolutePath = resolveMirrorPath(
        seasonDirectory,
        "season.nfo"
      );

      seasons.push({
        collectionId,
        seasonNumber,
        title:
          metadata?.title ??
          (seasonNumber === 0
            ? "Specials / Unassigned"
            : `Season ${padSeasonNumber(seasonNumber)}`),
        plot: metadata?.plot ?? "",
        directoryAbsolutePath,
        directoryRelativePath: toPosixRelative(directoryAbsolutePath),
        seasonNfoAbsolutePath,
        seasonNfoRelativePath: toPosixRelative(seasonNfoAbsolutePath),
        seasonUniqueId: buildSeasonUniqueId({
          collectionId,
          showId: show.id,
          seasonNumber,
        }),
        episodes,
      });
    }

    if (seasons.length === 0) {
      continue;
    }

    const rootAbsolutePath = resolveMirrorPath(showDirectory);
    const tvshowNfoAbsolutePath = resolveMirrorPath(
      showDirectory,
      "tvshow.nfo"
    );
    const posterAbsolutePath = resolveMirrorPath(showDirectory, "poster.jpg");
    // A confirmed TMDB premiere date is authoritative for a collection show;
    // the earliest episode upload date is only a stand-in when none exists.
    const premiered =
      normalizeVideoDateToDay(show.premiered) ??
      showVideos
        .map((video) => normalizeVideoDateToDay(video.date))
        .filter((value): value is string => Boolean(value))
        .sort()[0];

    shows.push({
      show,
      rootAbsolutePath,
      rootRelativePath: toPosixRelative(rootAbsolutePath),
      tvshowNfoAbsolutePath,
      tvshowNfoRelativePath: toPosixRelative(tvshowNfoAbsolutePath),
      posterAbsolutePath,
      posterRelativePath: toPosixRelative(posterAbsolutePath),
      posterSourceAbsolutePath: resolveShowPosterSource(
        show.posterSourcePath,
        showVideos,
        probe,
        Boolean(show.sourceCollectionId)
      ),
      showUniqueId: buildShowUniqueId(show.identityKey),
      premiered,
      seasons,
    });
  }

  // Assignments whose show row is gone are catalog corruption, not silent data
  // loss: report them rather than dropping them from the plan unnoticed.
  for (const assignment of snapshot.assignments) {
    if (!showsById.has(assignment.showId)) {
      addSkip(
        context,
        snapshot.videosById.get(assignment.videoId),
        assignment.id,
        "invalid_catalog_assignment",
        `Assignment ${assignment.id} references missing show ${assignment.showId}.`
      );
    }
  }

  const expectedRelativePaths = new Set<string>();
  for (const plan of shows) {
    collectExpectedPaths(plan, expectedRelativePaths);
  }
  collectSkippedAssignmentPaths(
    snapshot,
    context.skipped,
    expectedRelativePaths
  );

  return {
    shows,
    skipped: context.skipped,
    collisions: context.collisions,
    expectedRelativePaths,
  };
}
