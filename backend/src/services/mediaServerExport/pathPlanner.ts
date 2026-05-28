import path from "path";
import { VIDEOS_DIR } from "../../config/paths";
import { resolveSafeChildPath } from "../../utils/security";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import type { Video } from "../storageService";
import type { MediaServerExportPlan, ParsedTvLayout } from "./types";

const TV_EPISODE_TOKEN_PATTERN =
  /^s(?<season>\d{1,4})e(?<episode>\d{2,8})(?:[^0-9].*)?$/i;

function parseSeasonDirectory(
  seasonDirectoryName: string
): number | undefined {
  if (/^specials$/i.test(seasonDirectoryName)) {
    return 0;
  }

  const match = /^season\s+(\d+)$/i.exec(seasonDirectoryName);
  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[1], 10);
}

export function parseTvLayoutFromRelativeVideoPath(
  relativeVideoPath: string
): ParsedTvLayout {
  const parts = relativeVideoPath.split("/").filter(Boolean);
  if (parts.length < 3) {
    return { isTvCompatible: false };
  }

  const showRootName = parts[0];
  const showRootRelativeDir = showRootName;
  const seasonDirectoryName = parts[1];
  const filenameStem = path.parse(parts[parts.length - 1]).name;
  const seasonNumberFromFolder = parseSeasonDirectory(seasonDirectoryName);
  const episodeTokenMatch = TV_EPISODE_TOKEN_PATTERN.exec(filenameStem);
  const seasonNumberFromToken = episodeTokenMatch?.groups?.season
    ? Number.parseInt(episodeTokenMatch.groups.season, 10)
    : undefined;
  const episodeNumber = episodeTokenMatch?.groups?.episode
    ? Number.parseInt(episodeTokenMatch.groups.episode, 10)
    : undefined;

  return {
    isTvCompatible: seasonNumberFromFolder !== undefined,
    showRootName,
    showRootRelativeDir,
    seasonDirectoryName,
    seasonNumber:
      seasonNumberFromFolder !== undefined
        ? seasonNumberFromFolder
        : seasonNumberFromToken,
    episodeToken: episodeTokenMatch?.[0],
    episodeNumber,
  };
}

export function planMediaServerExportPaths(
  video: Video
): MediaServerExportPlan | null {
  const resolvedVideoPath = video.videoPath
    ? resolveManagedWebPath(video.videoPath)
    : null;
  if (!resolvedVideoPath || resolvedVideoPath.prefix !== "/videos") {
    return null;
  }

  const lastSlashIndex = resolvedVideoPath.absolutePath.lastIndexOf("/");
  const videoDirectory =
    lastSlashIndex >= 0
      ? resolvedVideoPath.absolutePath.slice(0, lastSlashIndex)
      : resolvedVideoPath.absolutePath;
  const filename = resolvedVideoPath.absolutePath.slice(lastSlashIndex + 1);
  const lastDotIndex = filename.lastIndexOf(".");
  const basenameWithoutExt =
    lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;
  const tvLayout = parseTvLayoutFromRelativeVideoPath(resolvedVideoPath.relativePath);
  const showRootAbsolutePath =
    tvLayout.isTvCompatible && tvLayout.showRootRelativeDir
      ? resolveSafeChildPath(VIDEOS_DIR, tvLayout.showRootRelativeDir)
      : undefined;

  return {
    videoAbsolutePath: resolvedVideoPath.absolutePath,
    videoRelativePath: resolvedVideoPath.relativePath,
    basenameWithoutExt,
    episodeNfoAbsolutePath: resolveSafeChildPath(
      videoDirectory,
      `${basenameWithoutExt}.nfo`
    ),
    episodeSourceJsonAbsolutePath: resolveSafeChildPath(
      videoDirectory,
      `${basenameWithoutExt}.info.json`
    ),
    episodeThumbAliasAbsolutePath: resolveSafeChildPath(
      videoDirectory,
      `${basenameWithoutExt}-thumb.jpg`
    ),
    showNfoAbsolutePath: showRootAbsolutePath
      ? resolveSafeChildPath(showRootAbsolutePath, "tvshow.nfo")
      : undefined,
    showPosterAbsolutePaths: showRootAbsolutePath
      ? ["show.jpg", "poster.jpg", "folder.jpg"].map((filename) =>
          resolveSafeChildPath(showRootAbsolutePath, filename)
        )
      : [],
    tvLayout,
  };
}
