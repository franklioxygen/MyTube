import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { extractSourceVideoId, formatVideoFilename } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { ensureDirSafeSync, resolveSafeChildPath } from "../../../utils/security";
import { applyPhysicalOrganization } from "../../filenameTemplate/organizationPath";
import {
  allocateOutputFamilySync,
  type OutputFamilyReservation,
} from "../../filenameTemplate/outputPathAllocator";
import { planVideoOutputPaths } from "../../filenameTemplate/renderer";
import { enrichSourceOptionsForDownload } from "../../filenameTemplate/sourceOptions";
import {
  FilenameTemplateContext,
  FilenameTemplateSourceOptions,
} from "../../filenameTemplate/types";

export interface MissAvOutputPaths {
  finalVideoFilename: string;
  finalThumbnailFilename: string;
  newVideoPath: string;
  newThumbnailPath: string;
  finalVideoWebPath: string;
  finalThumbnailWebPath: string | null;
  releaseOutputReservation: () => void;
}

function subtitleBaseRelativePathFrom(
  videoRelativePath: string,
  basenameWithoutExt: string
): string {
  const dir = path.dirname(videoRelativePath);
  return dir && dir !== "." ? `${dir}/${basenameWithoutExt}` : basenameWithoutExt;
}

function buildPathsFromReservation(
  reservation: OutputFamilyReservation,
  thumbnailBaseDir: string
): Omit<MissAvOutputPaths, "releaseOutputReservation"> {
  const newVideoPath = resolveSafeChildPath(
    VIDEOS_DIR,
    reservation.videoRelativePath
  );
  const newThumbnailPath = resolveSafeChildPath(
    thumbnailBaseDir,
    reservation.thumbnailRelativePath
  );
  const thumbnailWebRoot = thumbnailBaseDir === VIDEOS_DIR ? "/videos" : "/images";

  return {
    finalVideoFilename: path.basename(reservation.videoRelativePath),
    finalThumbnailFilename: path.basename(reservation.thumbnailRelativePath),
    newVideoPath,
    newThumbnailPath,
    finalVideoWebPath: `/videos/${reservation.videoRelativePath}`,
    finalThumbnailWebPath: `${thumbnailWebRoot}/${reservation.thumbnailRelativePath}`,
  };
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
    existingLocalVideoId?: string;
  },
): MissAvOutputPaths {
  const {
    videoTitle,
    videoAuthor,
    videoDate,
    url,
    mergeOutputFormat,
    filenameTemplateSourceOptions,
    existingLocalVideoId,
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
  let reservation: OutputFamilyReservation;

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
    const sourceVideoId = extractSourceVideoId(url).id || "";
    const ctx: FilenameTemplateContext = {
      title: videoTitle,
      sourceVideoId,
      localVideoId: "",
      downloadedAtMs: Date.now(),
      id: sourceVideoId,
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

    const thumbnailDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
    reservation = allocateOutputFamilySync({
      videoRelativePath: planned.video.relativePath,
      thumbnailRelativePath: planned.thumbnail.relativePath,
      subtitleBaseRelativePath: subtitleBaseRelativePathFrom(
        planned.video.relativePath,
        planned.video.basenameWithoutExt
      ),
      thumbnailBaseDir: thumbnailDir,
      identity: {
        platform: "missav",
        sourceVideoId,
        mediaType: "video",
      },
      existingLocalVideoId,
      thumbnailRequired: true,
      subtitleRequired: settings.moveSubtitlesToVideoFolder || false,
    });
    ({
      finalVideoFilename,
      finalThumbnailFilename,
      newVideoPath,
      newThumbnailPath,
      finalVideoWebPath,
      finalThumbnailWebPath,
    } = buildPathsFromReservation(reservation, thumbnailDir));

    ensureDirSafeSync(path.dirname(newVideoPath), VIDEOS_DIR);
    ensureDirSafeSync(path.dirname(newThumbnailPath), [IMAGES_DIR, VIDEOS_DIR]);
  } else {
    // Legacy mode: use formatVideoFilename
    const newSafeBaseFilename = formatVideoFilename(videoTitle, videoAuthor, videoDate);
    const newVideoFilename = `${newSafeBaseFilename}.${mergeOutputFormat}`;
    const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

    const finalVideoRelativePath = applyPhysicalOrganization(newVideoFilename, {
      mode: settings.authorOrganizationMode,
      author: videoAuthor,
    }).relativePath;

    const thumbnailDir = moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR;
    const finalThumbnailRelativePath = finalVideoRelativePath.includes("/")
      ? `${path.dirname(finalVideoRelativePath)}/${newThumbnailFilename}`
      : newThumbnailFilename;
    reservation = allocateOutputFamilySync({
      videoRelativePath: finalVideoRelativePath,
      thumbnailRelativePath: finalThumbnailRelativePath,
      subtitleBaseRelativePath: subtitleBaseRelativePathFrom(
        finalVideoRelativePath,
        newSafeBaseFilename
      ),
      thumbnailBaseDir: thumbnailDir,
      identity: {
        platform: "missav",
        sourceVideoId: extractSourceVideoId(url).id || null,
        mediaType: "video",
      },
      existingLocalVideoId,
      thumbnailRequired: true,
      subtitleRequired: settings.moveSubtitlesToVideoFolder || false,
    });
    ({
      finalVideoFilename,
      finalThumbnailFilename,
      newVideoPath,
      newThumbnailPath,
      finalVideoWebPath,
      finalThumbnailWebPath,
    } = buildPathsFromReservation(reservation, thumbnailDir));
  }

  return {
    finalVideoFilename,
    finalThumbnailFilename,
    newVideoPath,
    newThumbnailPath,
    finalVideoWebPath,
    finalThumbnailWebPath,
    releaseOutputReservation: reservation.release,
  };
}
