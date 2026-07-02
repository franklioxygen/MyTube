import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  pathExistsSafeSync,
  resolveSafeChildPath,
} from "../../../utils/security";
import { buildContextFromYtDlpInfo } from "../../filenameTemplate/contextBuilder";
import { dedupeRelativePath } from "../../filenameTemplate/dedupe";
import { planVideoOutputPaths } from "../../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../../filenameTemplate/sourceOptions";
import { FilenameTemplateSourceOptions } from "../../filenameTemplate/types";
import {
  pathExistsWithAnyKnownVideoExtension,
  stripTrailingExtension,
} from "./ytdlpVideoHelpers";

export interface PlanDownloadPathsArgs {
  videoUrl: string;
  /** Raw yt-dlp --dump-json info for the video (template context source). */
  info: Record<string, unknown> & { uploader?: string; channel?: string };
  /** Settings snapshot (downloadFilenamePresetId etc. are read from here). */
  settings: Record<string, unknown> & {
    downloadFilenamePresetId?: string;
  };
  filenameTemplateSourceOptions?: FilenameTemplateSourceOptions;
  videoTitle: string;
  videoAuthor: string;
  videoDate: string;
  /** Preferred container extension resolved from the download flags. */
  videoExtension: string;
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
    });
    const planned = planVideoOutputPaths({
      settings,
      context,
      videoExtension,
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder: args.moveSubtitlesToVideoFolder,
    });

    // Deduplicate
    const dedupedRelative = dedupeRelativePath(
      planned.video.relativePath,
      VIDEOS_DIR,
      new Set()
    );
    const stemChanged = dedupedRelative !== planned.video.relativePath;
    const suffix = stemChanged
      ? dedupedRelative.slice(
          planned.video.basenameWithoutExt.length +
            (planned.video.relativePath.lastIndexOf("/") >= 0
              ? planned.video.relativePath.lastIndexOf("/") + 1
              : 0),
          dedupedRelative.lastIndexOf(".")
        )
      : "";
    const preferredVideoExt = path.extname(dedupedRelative);
    const videoBaseRelative = stripTrailingExtension(
      dedupedRelative,
      preferredVideoExt
    );
    let finalVideoRelative = dedupedRelative;
    let collisionSuffix = "";
    let counter = 1;
    while (
      pathExistsWithAnyKnownVideoExtension(
        resolveSafeChildPath(VIDEOS_DIR, `${videoBaseRelative}${collisionSuffix}`)
      )
    ) {
      collisionSuffix = `_${counter}`;
      finalVideoRelative =
        `${videoBaseRelative}${collisionSuffix}${preferredVideoExt}`;
      counter++;
    }

    const videoAbsolutePath = resolveSafeChildPath(
      VIDEOS_DIR,
      finalVideoRelative
    );
    const videoFilename = path.basename(finalVideoRelative);
    const safeBaseFilename =
      `${planned.video.basenameWithoutExt}${suffix}${collisionSuffix}`;

    // Thumbnail
    const thumbBase = planned.thumbnail.filename.replace(
      /\.jpg$/,
      `${suffix}${collisionSuffix}.jpg`
    );
    const thumbDir = path.dirname(planned.thumbnail.relativePath);
    const thumbRelative =
      thumbDir && thumbDir !== "." ? `${thumbDir}/${thumbBase}` : thumbBase;
    const thumbnailAbsolutePath = resolveSafeChildPath(
      moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
      thumbRelative
    );

    logger.info("Preparing video download path (template):", videoAbsolutePath);
    return {
      videoAbsolutePath,
      videoFilename,
      thumbnailAbsolutePath,
      thumbnailFilename: thumbBase,
      safeBaseFilename,
    };
  }

  // Legacy: use formatVideoFilename
  let safeBaseFilename = formatVideoFilename(videoTitle, videoAuthor, videoDate);
  let videoFilename = `${safeBaseFilename}.${videoExtension}`;
  let thumbnailFilename = `${safeBaseFilename}.jpg`;

  let videoAbsolutePath = resolveSafeChildPath(VIDEOS_DIR, videoFilename);
  let thumbnailAbsolutePath = moveThumbnailsToVideoFolder
    ? resolveSafeChildPath(VIDEOS_DIR, thumbnailFilename)
    : resolveSafeChildPath(IMAGES_DIR, thumbnailFilename);

  // If file already exists (e.g. redownload), deduplicate the filename
  if (
    pathExistsSafeSync(videoAbsolutePath, VIDEOS_DIR) ||
    pathExistsWithAnyKnownVideoExtension(
      stripTrailingExtension(videoAbsolutePath, `.${videoExtension}`)
    )
  ) {
    let counter = 1;
    const ext = `.${videoExtension}`;
    const basePath = stripTrailingExtension(videoAbsolutePath, ext);
    const baseName = stripTrailingExtension(videoFilename, ext);
    while (pathExistsWithAnyKnownVideoExtension(`${basePath}_${counter}`)) {
      counter++;
    }
    videoAbsolutePath = `${basePath}_${counter}${ext}`;
    videoFilename = `${baseName}_${counter}${ext}`;
    thumbnailFilename = thumbnailFilename.replace(/\.jpg$/, `_${counter}.jpg`);
    thumbnailAbsolutePath = moveThumbnailsToVideoFolder
      ? resolveSafeChildPath(VIDEOS_DIR, thumbnailFilename)
      : resolveSafeChildPath(IMAGES_DIR, thumbnailFilename);
    logger.info(`File exists, using deduplicated filename: ${videoFilename}`);
    // The cleanup/subtitle stem must carry the collision counter, matching
    // the template branch. Artifact cleanup exact-matches this stem and
    // subtitle processing renames every `startsWith(stem)` match to
    // `<stem>.<lang>.<ext>`, so an un-suffixed stem would target the
    // pre-existing video's files: cancel-time cleanup could delete the
    // original video/subtitles, and subtitle processing would overwrite the
    // original's subtitle with the new download's.
    safeBaseFilename = `${baseName}_${counter}`;
  }

  logger.info("Preparing video download path:", videoAbsolutePath);
  return {
    videoAbsolutePath,
    videoFilename,
    thumbnailAbsolutePath,
    thumbnailFilename,
    safeBaseFilename,
  };
}
