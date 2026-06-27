import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  ensureDirSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
} from "../../../utils/security";
import {
  applyDedupeToRelatedPaths,
  dedupeRelativePath,
} from "../../filenameTemplate/dedupe";
import { planVideoOutputPaths } from "../../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../../filenameTemplate/sourceOptions";
import {
  FilenameTemplateContext,
  FilenameTemplateSourceOptions,
} from "../../filenameTemplate/types";

function stripTrailingExtension(value: string, extension: string): string {
  return value.endsWith(extension) ? value.slice(0, -extension.length) : value;
}

export interface MissAvOutputPaths {
  finalVideoFilename: string;
  finalThumbnailFilename: string;
  newVideoPath: string;
  newThumbnailPath: string;
  finalVideoWebPath: string;
  finalThumbnailWebPath: string | null;
}

/**
 * Compute the on-disk and web paths for a MissAV download, honoring the
 * configured filename preset (template planner vs. legacy formatter) and
 * deduplicating against existing files. Creates the destination directories.
 */
export function planMissAvOutputPaths(
  settings: ReturnType<typeof import("../../storageService").getSettings>,
  params: {
    videoTitle: string;
    videoAuthor: string;
    videoDate: string;
    url: string;
    mergeOutputFormat: string;
    filenameTemplateSourceOptions?: FilenameTemplateSourceOptions;
  },
): MissAvOutputPaths {
  const {
    videoTitle,
    videoAuthor,
    videoDate,
    url,
    mergeOutputFormat,
    filenameTemplateSourceOptions,
  } = params;

  const moveThumbnailsToVideoFolder =
    settings.moveThumbnailsToVideoFolder || false;
  const presetId = settings.downloadFilenamePresetId || "legacy";

  let finalVideoFilename: string;
  let finalThumbnailFilename: string;
  let newVideoPath: string;
  let newThumbnailPath: string;
  let finalVideoWebPath: string;
  let finalThumbnailWebPath: string | null;

  if (presetId !== "legacy") {
    // Non-legacy: use path planner
    const uploadDateClean = videoDate.replace(/[^0-9]/g, "").slice(0, 8);
    const year = uploadDateClean.length >= 4 ? uploadDateClean.slice(0, 4) : String(new Date().getFullYear());
    const month = uploadDateClean.length >= 6 ? uploadDateClean.slice(4, 6) : String(new Date().getMonth() + 1).padStart(2, "0");
    const day = uploadDateClean.length >= 8 ? uploadDateClean.slice(6, 8) : String(new Date().getDate()).padStart(2, "0");

    const srcOpts = enrichSourceOptionsForDownload(
      filenameTemplateSourceOptions || {},
      {
        author: videoAuthor,
        uploadDate: videoDate,
      }
    );
    const ctx: FilenameTemplateContext = {
      title: videoTitle,
      id: "",
      ext: "",
      uploader: videoAuthor,
      channel: videoAuthor,
      uploadDate: uploadDateClean,
      uploadYear: year,
      uploadMonth: month,
      uploadDay: day,
      durationSeconds: undefined,
      durationString: "00-00",
      artistName: videoAuthor,
      sourceCustomName: srcOpts.sourceCustomName || videoAuthor,
      sourceCollectionName: srcOpts.sourceCollectionName || videoAuthor,
      sourceCollectionId: srcOpts.sourceCollectionId || "",
      sourceCollectionType: srcOpts.sourceCollectionType || "single",
      mediaPlaylistIndex: srcOpts.mediaPlaylistIndex,
      mediaPlaylistIndexWithinDate: srcOpts.mediaPlaylistIndexWithinDate,
      platform: "missav",
      sourceUrl: url,
    };

    const planned = planVideoOutputPaths({
      settings,
      context: ctx,
      videoExtension: mergeOutputFormat,
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder: settings.moveSubtitlesToVideoFolder || false,
    });

    const reserved = new Set<string>();
    const deduped = dedupeRelativePath(planned.video.relativePath, VIDEOS_DIR, reserved);
    const { thumbnail: dedupedThumb } = applyDedupeToRelatedPaths(
      planned.video.relativePath,
      deduped,
      planned.thumbnail.relativePath,
      planned.subtitle.baseNameWithoutLanguageOrExt,
    );

    finalVideoFilename = path.basename(deduped);
    newVideoPath = resolveSafeChildPath(VIDEOS_DIR, deduped);
    finalThumbnailFilename = path.basename(dedupedThumb);
    finalVideoWebPath = `/videos/${deduped}`;

    const thumbnailDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
    newThumbnailPath = resolveSafeChildPath(thumbnailDir, dedupedThumb);
    finalThumbnailWebPath = moveThumbnailsToVideoFolder
      ? `/videos/${dedupedThumb}`
      : `/images/${dedupedThumb}`;

    ensureDirSafeSync(path.dirname(newVideoPath), VIDEOS_DIR);
    ensureDirSafeSync(path.dirname(newThumbnailPath), [IMAGES_DIR, VIDEOS_DIR]);
  } else {
    // Legacy mode: use formatVideoFilename
    const newSafeBaseFilename = formatVideoFilename(videoTitle, videoAuthor, videoDate);
    const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
    const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

    finalVideoFilename = newVideoFilename;
    finalThumbnailFilename = newThumbnailFilename;
    newVideoPath = resolveSafeChildPath(VIDEOS_DIR, finalVideoFilename);

    const thumbnailDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;

    // If file already exists (e.g. redownload), deduplicate the filename
    if (pathExistsSafeSync(newVideoPath, VIDEOS_DIR)) {
      let counter = 1;
      const ext = `.${mergeOutputFormat}`;
      const basePath = stripTrailingExtension(newVideoPath, ext);
      const baseName = newSafeBaseFilename;
      while (pathExistsSafeSync(`${basePath}_${counter}${ext}`, VIDEOS_DIR)) {
        counter++;
      }
      newVideoPath = `${basePath}_${counter}${ext}`;
      finalVideoFilename = `${baseName}_${counter}${ext}`;
      finalThumbnailFilename = `${baseName}_${counter}.jpg`;
      logger.info(`File exists, using deduplicated filename: ${finalVideoFilename}`);
    }

    newThumbnailPath = resolveSafeChildPath(thumbnailDir, finalThumbnailFilename);
    finalVideoWebPath = `/videos/${finalVideoFilename}`;
    finalThumbnailWebPath = moveThumbnailsToVideoFolder
      ? `/videos/${finalThumbnailFilename}`
      : `/images/${finalThumbnailFilename}`;
  }

  return {
    finalVideoFilename,
    finalThumbnailFilename,
    newVideoPath,
    newThumbnailPath,
    finalVideoWebPath,
    finalThumbnailWebPath,
  };
}
