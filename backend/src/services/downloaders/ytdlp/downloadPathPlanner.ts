import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { extractSourceVideoId, formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { resolveSafeChildPath } from "../../../utils/security";
import { buildContextFromYtDlpInfo } from "../../filenameTemplate/contextBuilder";
import { applyPhysicalOrganization } from "../../filenameTemplate/organizationPath";
import {
  allocateOutputFamilySync,
  type OutputFamilyReservation,
} from "../../filenameTemplate/outputPathAllocator";
import { planVideoOutputPaths } from "../../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../../filenameTemplate/sourceOptions";
import { FilenameTemplateSourceOptions } from "../../filenameTemplate/types";

export interface PlanDownloadPathsArgs {
  videoUrl: string;
  /** Raw yt-dlp --dump-json info for the video (template context source). */
  info: Record<string, unknown> & { uploader?: string; channel?: string };
  /** Settings snapshot (downloadFilenamePresetId etc. are read from here). */
  settings: Record<string, unknown> & {
    downloadFilenamePresetId?: string;
    authorOrganizationMode?: string;
  };
  filenameTemplateSourceOptions?: FilenameTemplateSourceOptions;
  downloadedAtMs?: number;
  videoTitle: string;
  videoAuthor: string;
  videoDate: string;
  /** Preferred container extension resolved from the download flags. */
  videoExtension: string;
  mediaType?: "video" | "audio";
  existingLocalVideoId?: string;
  moveThumbnailsToVideoFolder: boolean;
  moveSubtitlesToVideoFolder: boolean;
}

export interface PlannedDownloadPaths {
  /** Absolute target path yt-dlp downloads/merges into. */
  videoAbsolutePath: string;
  /** Final basename of the video file. */
  videoFilename: string;
  /** Absolute target path for the thumbnail. */
  thumbnailAbsolutePath: string;
  /** Final basename of the thumbnail file. */
  thumbnailFilename: string;
  /** Extension-less base used for artifact/subtitle cleanup matching. */
  safeBaseFilename: string;
  /** Releases the reserved output-family lease after the download is persisted or fails. */
  releaseOutputReservation: () => void;
}

function buildMediaIdentity(args: PlanDownloadPathsArgs) {
  const source = extractSourceVideoId(args.videoUrl);
  const sourceVideoId =
    (typeof args.info.id === "string" && args.info.id) || source.id || null;
  const platform =
    source.platform ||
    (typeof args.info.extractor_key === "string" && args.info.extractor_key) ||
    (typeof args.info.extractor === "string" && args.info.extractor) ||
    "ytdlp";

  return {
    platform,
    sourceVideoId,
    mediaType: args.mediaType ?? "video",
    localVideoId: args.existingLocalVideoId,
  };
}

function subtitleBaseRelativePathFrom(
  videoRelativePath: string,
  basenameWithoutExt: string
): string {
  const dir = path.dirname(videoRelativePath);
  return dir && dir !== "." ? `${dir}/${basenameWithoutExt}` : basenameWithoutExt;
}

function buildPlannedPathsFromReservation(
  reservation: OutputFamilyReservation,
  thumbnailBaseDir: string
): PlannedDownloadPaths {
  const videoAbsolutePath = resolveSafeChildPath(
    VIDEOS_DIR,
    reservation.videoRelativePath
  );
  const thumbnailAbsolutePath = resolveSafeChildPath(
    thumbnailBaseDir,
    reservation.thumbnailRelativePath
  );

  return {
    videoAbsolutePath,
    videoFilename: path.basename(reservation.videoRelativePath),
    thumbnailAbsolutePath,
    thumbnailFilename: path.basename(reservation.thumbnailRelativePath),
    safeBaseFilename: path.basename(reservation.subtitleBaseRelativePath),
    releaseOutputReservation: reservation.release,
  };
}

/**
 * Decide where a download lands on disk: template-planner path (with stem
 * dedupe and on-disk collision suffixing) when a non-legacy filename preset is
 * active, otherwise the legacy Title-Author-Year naming with its own
 * collision counter. Extracted verbatim from downloadVideo (M-2) so the
 * branching finally has a unit-test harness; filesystem access is limited to
 * the existence probes.
 */
export function planDownloadPaths(
  args: PlanDownloadPathsArgs
): PlannedDownloadPaths {
  const {
    videoUrl,
    info,
    settings,
    filenameTemplateSourceOptions,
    videoTitle,
    videoAuthor,
    videoDate,
    videoExtension,
    mediaType,
    moveThumbnailsToVideoFolder,
  } = args;

  const downloadFilenamePresetId =
    (settings.downloadFilenamePresetId as string | undefined) || "legacy";

  if (downloadFilenamePresetId !== "legacy") {
    // Non-legacy: use template planner
    const sourceOptions = enrichSourceOptionsForDownload(
      {
        ...filenameTemplateSourceOptions,
        sourceCollectionType:
          filenameTemplateSourceOptions?.sourceCollectionType ?? "single",
      },
      {
        author: videoAuthor || (info.uploader as string) || (info.channel as string),
        uploadDate: videoDate,
      }
    );
    const context = buildContextFromYtDlpInfo(videoUrl, info, {
      ...sourceOptions,
      downloadedAtMs: args.downloadedAtMs,
    });
    const planned = planVideoOutputPaths({
      settings,
      context,
      videoExtension,
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder: args.moveSubtitlesToVideoFolder,
    });

    const thumbnailBaseDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
    const reservation = allocateOutputFamilySync({
      videoRelativePath: planned.video.relativePath,
      thumbnailRelativePath: planned.thumbnail.relativePath,
      subtitleBaseRelativePath: subtitleBaseRelativePathFrom(
        planned.video.relativePath,
        planned.video.basenameWithoutExt
      ),
      thumbnailBaseDir,
      subtitleBaseDir: args.moveSubtitlesToVideoFolder
        ? VIDEOS_DIR
        : SUBTITLES_DIR,
      identity: buildMediaIdentity({ ...args, mediaType }),
      existingLocalVideoId: args.existingLocalVideoId,
      thumbnailRequired: true,
      // Central subtitles still need a reservation: their destination collides
      // just as readily as one inside the video folder, and an unreserved stem
      // makes processSubtitles drop the downloaded subtitle on promotion.
      subtitleRequired: true,
    });
    const reservedPaths = buildPlannedPathsFromReservation(
      reservation,
      thumbnailBaseDir
    );

    logger.info("Preparing video download path (template):", reservedPaths.videoAbsolutePath);
    return reservedPaths;
  }

  // Legacy: use formatVideoFilename
  const safeBaseFilename = formatVideoFilename(videoTitle, videoAuthor, videoDate);
  const videoFilename = `${safeBaseFilename}.${videoExtension}`;
  const thumbnailFilename = `${safeBaseFilename}.jpg`;
  const videoRelativePath = applyPhysicalOrganization(videoFilename, {
    mode: settings.authorOrganizationMode,
    author: videoAuthor,
  }).relativePath;
  const thumbnailRelativePath = videoRelativePath.includes("/")
    ? `${path.dirname(videoRelativePath)}/${thumbnailFilename}`
    : thumbnailFilename;
  const subtitleBaseRelativePath = subtitleBaseRelativePathFrom(
    videoRelativePath,
    safeBaseFilename
  );
  const thumbnailBaseDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
  const reservation = allocateOutputFamilySync({
    videoRelativePath,
    thumbnailRelativePath,
    subtitleBaseRelativePath,
    thumbnailBaseDir,
    subtitleBaseDir: args.moveSubtitlesToVideoFolder
      ? VIDEOS_DIR
      : SUBTITLES_DIR,
    identity: buildMediaIdentity({ ...args, mediaType }),
    existingLocalVideoId: args.existingLocalVideoId,
    thumbnailRequired: true,
    // See the template branch: central subtitles need reserving too.
    subtitleRequired: true,
  });
  const reservedPaths = buildPlannedPathsFromReservation(
    reservation,
    thumbnailBaseDir
  );

  logger.info("Preparing video download path:", reservedPaths.videoAbsolutePath);
  return reservedPaths;
}
