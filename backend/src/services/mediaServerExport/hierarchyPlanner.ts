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
import type { Video } from "../storageService";
import {
  buildEpisodeNfo,
  buildEpisodeOccurrenceId,
  buildSeasonNfo,
  buildSeasonUniqueId,
  buildShowNfo,
  buildShowUniqueId,
  normalizeVideoDateToDay,
} from "./nfoBuilders";
import { buildSeasonDirectoryName } from "./identity";
import { buildSourceInfoEnvelope } from "./sourceInfoEnvelope";
import type {
  HierarchyEpisodePlan,
  HierarchyPlan,
  HierarchySeasonPlan,
  HierarchyShowPlan,
  MediaServerCatalogSnapshot,
  MediaServerEpisodeAssignment,
  MediaServerExportMode,
  MediaServerExportSkip,
  MediaServerShow,
  PlannedArtifact,
} from "./types";

/**
 * Turns a catalog snapshot into the exact set of files the mirror should
 * contain (issue #411). Pure apart from an injectable existence probe: it never
 * touches the database and never writes anything, so the whole directory
 * contract is testable without a filesystem.
 */

export interface PlanHierarchyOptions {
  snapshot: MediaServerCatalogSnapshot;
  mode: Exclude<MediaServerExportMode, "off">;
  /** Limits the plan to a subset of shows for incremental runs. */
  showIds?: readonly string[];
  fileExists?: (absolutePath: string, allowedRoot: string) => boolean;
}

const SUBTITLE_LANGUAGE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const SUBTITLE_EXTENSIONS = new Set([
  ".vtt",
  ".srt",
  ".ass",
  ".ssa",
  ".sub",
  ".smi",
]);
const ARTWORK_ROOTS = [
  { webPrefix: "/images/", rootDir: IMAGES_DIR },
  { webPrefix: "/avatars/", rootDir: AVATARS_DIR },
  { webPrefix: "/videos/", rootDir: VIDEOS_DIR },
] as const;

function defaultFileExists(absolutePath: string, allowedRoot: string): boolean {
  try {
    return pathExistsSafeSync(absolutePath, allowedRoot);
  } catch {
    return false;
  }
}

/** Reject any planned path that would escape the managed mirror root. */
function isPathInsideMirror(relativePath: string): boolean {
  try {
    resolveSafeChildPath(MEDIA_SERVER_LIBRARY_DIR, relativePath);
    return true;
  } catch {
    return false;
  }
}

function resolveExistingArtwork(
  webPath: string | undefined | null,
  fileExists: (absolutePath: string, allowedRoot: string) => boolean
): string | undefined {
  if (!webPath) {
    return undefined;
  }
  for (const { webPrefix, rootDir } of ARTWORK_ROOTS) {
    if (!webPath.startsWith(webPrefix)) {
      continue;
    }
    try {
      const absolutePath = resolveSafeChildPath(
        rootDir,
        webPath.slice(webPrefix.length)
      );
      return fileExists(absolutePath, rootDir) ? absolutePath : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Show artwork prefers the author's avatar and falls back to an episode
 * thumbnail. Both passes iterate videos in id order so a rebuild keeps choosing
 * the same source file.
 */
function chooseShowPosterSource(
  showVideos: Video[],
  fileExists: (absolutePath: string, allowedRoot: string) => boolean
): string | undefined {
  const ordered = [...showVideos].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  for (const video of ordered) {
    const avatar = resolveExistingArtwork(video.authorAvatarPath, fileExists);
    if (avatar) {
      return avatar;
    }
  }
  for (const video of ordered) {
    const thumbnail = resolveExistingArtwork(video.thumbnailPath, fileExists);
    if (thumbnail) {
      return thumbnail;
    }
  }
  return undefined;
}

function planSubtitleArtifacts(
  video: Video,
  seasonDirectory: string,
  stem: string,
  assignmentId: string,
  fileExists: (absolutePath: string, allowedRoot: string) => boolean
): PlannedArtifact[] {
  if (!Array.isArray(video.subtitles)) {
    return [];
  }

  const artifacts: PlannedArtifact[] = [];
  const usedNames = new Set<string>();
  for (const subtitle of video.subtitles) {
    const language = subtitle.language || "";
    const extension = path.extname(subtitle.filename || "").toLowerCase();
    if (
      !SUBTITLE_LANGUAGE_PATTERN.test(language) ||
      !SUBTITLE_EXTENSIONS.has(extension)
    ) {
      continue;
    }
    const resolved = subtitle.path
      ? resolveManagedWebPath(subtitle.path)
      : null;
    // Subtitles can live in the isolated subtitles tree or beside the video,
    // depending on moveSubtitlesToVideoFolder. Both are managed local roots.
    const allowedRoot =
      resolved?.prefix === "/subtitles"
        ? SUBTITLES_DIR
        : resolved?.prefix === "/videos"
          ? VIDEOS_DIR
          : undefined;
    if (
      !resolved ||
      !allowedRoot ||
      !fileExists(resolved.absolutePath, allowedRoot)
    ) {
      continue;
    }
    const filename = `${stem}.${language}${extension}`;
    if (usedNames.has(filename)) {
      continue;
    }
    usedNames.add(filename);
    artifacts.push({
      relativePath: `${seasonDirectory}/${filename}`,
      artifactType: "episode_subtitle",
      materialization: "hard_link",
      sourceAbsolutePath: resolved.absolutePath,
      assignmentId,
    });
  }
  return artifacts;
}

function planEpisode(
  assignment: MediaServerEpisodeAssignment,
  show: MediaServerShow,
  video: Video,
  seasonDirectory: string,
  mode: Exclude<MediaServerExportMode, "off">,
  fileExists: (absolutePath: string, allowedRoot: string) => boolean,
  rawSourceInfo?: unknown
): HierarchyEpisodePlan | MediaServerExportSkip {
  const skip = (
    reason: MediaServerExportSkip["reason"]
  ): MediaServerExportSkip => ({
    videoId: video.id,
    title: video.title,
    reason,
  });

  const resolvedSource = video.videoPath
    ? resolveManagedWebPath(video.videoPath)
    : null;
  if (!resolvedSource || resolvedSource.prefix !== "/videos") {
    return skip("no_local_video_path");
  }
  if (!fileExists(resolvedSource.absolutePath, VIDEOS_DIR)) {
    return skip("video_file_missing");
  }

  const stem = assignment.exportStem;
  const mediaExtension = path.extname(resolvedSource.absolutePath);
  const mediaRelativePath = `${seasonDirectory}/${stem}${mediaExtension}`;
  if (!isPathInsideMirror(mediaRelativePath)) {
    return skip("invalid_catalog_assignment");
  }

  const thumbnailSource = resolveExistingArtwork(
    video.thumbnailPath,
    fileExists
  );
  const thumbFilename = thumbnailSource ? `${stem}-thumb.jpg` : undefined;

  const artifacts: PlannedArtifact[] = [
    {
      relativePath: mediaRelativePath,
      artifactType: "episode_media",
      materialization: "hard_link",
      sourceAbsolutePath: resolvedSource.absolutePath,
      assignmentId: assignment.id,
    },
    {
      relativePath: `${seasonDirectory}/${stem}.nfo`,
      artifactType: "episode_nfo",
      materialization: "generated_text",
      content: buildEpisodeNfo({
        video,
        showTitle: show.title,
        seasonNumber: assignment.seasonNumber,
        episodeNumber: assignment.episodeNumber,
        thumbFilename,
        uniqueId: buildEpisodeOccurrenceId(
          show.id,
          assignment.seasonNumber,
          assignment.episodeNumber,
          video.id
        ),
      }),
      assignmentId: assignment.id,
    },
  ];

  if (thumbnailSource && thumbFilename) {
    artifacts.push({
      relativePath: `${seasonDirectory}/${thumbFilename}`,
      artifactType: "episode_thumb",
      materialization: "copied_image",
      sourceAbsolutePath: thumbnailSource,
      assignmentId: assignment.id,
    });
  }

  if (mode === "nfo_and_source_json") {
    artifacts.push({
      relativePath: `${seasonDirectory}/${stem}.info.json`,
      artifactType: "source_json",
      materialization: "generated_text",
      content: `${JSON.stringify(
        buildSourceInfoEnvelope(video, rawSourceInfo),
        null,
        2
      )}\n`,
      assignmentId: assignment.id,
    });
  }

  artifacts.push(
    ...planSubtitleArtifacts(
      video,
      seasonDirectory,
      stem,
      assignment.id,
      fileExists
    )
  );

  return {
    assignmentId: assignment.id,
    videoId: video.id,
    title: video.title,
    seasonNumber: assignment.seasonNumber,
    episodeNumber: assignment.episodeNumber,
    artifacts,
  };
}

export function planMediaServerHierarchy(
  options: PlanHierarchyOptions
): HierarchyPlan {
  const { snapshot, mode } = options;
  const fileExists = options.fileExists ?? defaultFileExists;
  const scope = options.showIds ? new Set(options.showIds) : undefined;
  const skips: MediaServerExportSkip[] = [];
  const shows: HierarchyShowPlan[] = [];

  const assignmentsByShow = new Map<string, MediaServerEpisodeAssignment[]>();
  for (const assignment of snapshot.assignments) {
    if (scope && !scope.has(assignment.showId)) {
      continue;
    }
    const list = assignmentsByShow.get(assignment.showId) ?? [];
    list.push(assignment);
    assignmentsByShow.set(assignment.showId, list);
  }

  const seasonsByKey = new Map(
    snapshot.seasons.map((season) => [
      `${season.showId}|${season.seasonNumber}`,
      season,
    ])
  );

  const orderedShows = [...snapshot.shows].sort((left, right) =>
    left.directoryName.localeCompare(right.directoryName)
  );

  for (const show of orderedShows) {
    const showAssignments = assignmentsByShow.get(show.id);
    if (!showAssignments || showAssignments.length === 0) {
      continue;
    }
    if (!isPathInsideMirror(show.directoryName)) {
      skips.push({
        title: show.title,
        reason: "invalid_catalog_assignment",
        detail: "show directory escapes the managed mirror root",
      });
      continue;
    }

    const seasonNumbers = Array.from(
      new Set(showAssignments.map((assignment) => assignment.seasonNumber))
    ).sort((left, right) => left - right);

    const seasons: HierarchySeasonPlan[] = [];
    const showVideos: Video[] = [];
    const plannedRelativePaths = new Map<string, string>();

    for (const seasonNumber of seasonNumbers) {
      const seasonMetadata = seasonsByKey.get(`${show.id}|${seasonNumber}`);
      if (!seasonMetadata) {
        skips.push({
          title: show.title,
          reason: "invalid_catalog_assignment",
          detail: `season ${seasonNumber} has no catalog metadata`,
        });
        continue;
      }

      const seasonDirectory = `${show.directoryName}/${buildSeasonDirectoryName(
        seasonNumber
      )}`;
      const episodes: HierarchyEpisodePlan[] = [];

      const seasonAssignments = showAssignments
        .filter((assignment) => assignment.seasonNumber === seasonNumber)
        .sort((left, right) => left.episodeNumber - right.episodeNumber);

      for (const assignment of seasonAssignments) {
        const video = snapshot.videosById.get(assignment.videoId);
        if (!video) {
          skips.push({
            videoId: assignment.videoId,
            title: assignment.exportStem,
            reason: "invalid_catalog_assignment",
          });
          continue;
        }

        const planned = planEpisode(
          assignment,
          show,
          video,
          seasonDirectory,
          mode,
          fileExists,
          snapshot.rawInfoByVideoId?.get(video.id)
        );
        if ("reason" in planned) {
          skips.push(planned);
          continue;
        }

        const collision = planned.artifacts.find((artifact) =>
          plannedRelativePaths.has(artifact.relativePath)
        );
        if (collision) {
          skips.push({
            videoId: video.id,
            title: video.title,
            reason: "artifact_path_collision",
            detail: `${collision.relativePath} is also planned by assignment ${plannedRelativePaths.get(
              collision.relativePath
            )}`,
          });
          continue;
        }
        for (const artifact of planned.artifacts) {
          plannedRelativePaths.set(artifact.relativePath, assignment.id);
        }

        showVideos.push(video);
        episodes.push(planned);
      }

      if (episodes.length === 0) {
        continue;
      }

      seasons.push({
        seasonNumber,
        collectionId: seasonMetadata.collectionId,
        artifacts: [
          {
            relativePath: `${seasonDirectory}/season.nfo`,
            artifactType: "season_nfo",
            materialization: "generated_text",
            content: buildSeasonNfo({
              title: seasonMetadata.title,
              plot: seasonMetadata.description,
              seasonNumber,
              uniqueId: buildSeasonUniqueId(show.id, seasonNumber),
            }),
          },
        ],
        episodes,
      });
    }

    if (seasons.length === 0) {
      continue;
    }

    const premiered = showVideos
      .map((video) => normalizeVideoDateToDay(video.date))
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    const showArtifacts: PlannedArtifact[] = [
      {
        relativePath: `${show.directoryName}/tvshow.nfo`,
        artifactType: "show_nfo",
        materialization: "generated_text",
        content: buildShowNfo({
          showTitle: show.title,
          plot: show.description,
          premiered,
          studio: show.title,
          uniqueId: buildShowUniqueId(show.id),
        }),
      },
    ];

    const posterSource = chooseShowPosterSource(showVideos, fileExists);
    if (posterSource) {
      showArtifacts.push({
        relativePath: `${show.directoryName}/poster.jpg`,
        artifactType: "show_poster",
        materialization: "copied_image",
        sourceAbsolutePath: posterSource,
      });
    }

    shows.push({
      showId: show.id,
      directoryName: show.directoryName,
      artifacts: showArtifacts,
      seasons,
    });
  }

  return { shows, skips };
}

/** Every relative path the plan expects to exist, used to drive stale sweeping. */
export function collectPlannedRelativePaths(plan: HierarchyPlan): Set<string> {
  const paths = new Set<string>();
  for (const show of plan.shows) {
    for (const artifact of show.artifacts) {
      paths.add(artifact.relativePath);
    }
    for (const season of show.seasons) {
      for (const artifact of season.artifacts) {
        paths.add(artifact.relativePath);
      }
      for (const episode of season.episodes) {
        for (const artifact of episode.artifacts) {
          paths.add(artifact.relativePath);
        }
      }
    }
  }
  return paths;
}
