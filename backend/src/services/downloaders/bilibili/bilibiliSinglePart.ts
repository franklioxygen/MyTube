import { IMAGES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { getErrorMessage } from "../../../utils/errors";
import { DownloadCancelledError } from "../../../errors/DownloadErrors";
import { isCancellationError } from "../../../utils/downloadUtils";
import { formatVideoFilename } from "../../../utils/helpers";
import { FilenameTemplateSourceOptions } from "../../filenameTemplate/types";
import { applySubscriptionFilenameTemplateOverride } from "../../filenameTemplate";
import { resolveAuthorOrganizationMode } from "../../../types/settings";
import { logger } from "../../../utils/logger";
import {
  getAxiosProxyConfig,
  getEffectiveUserYtDlpConfig,
  InvalidProxyError,
} from "../../../utils/ytDlpUtils";
import {
  pathExistsSafeSync,
  unlinkSafeSync,
} from "../../../utils/security";
import {
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "../../mediaServerExport";
import * as storageService from "../../storageService";
import { Video } from "../../storageService";
import { resolveDownloadAudioMode } from "../ytdlp/ytdlpConfig";
import type { DownloadModeOptions } from "../BaseDownloader";
import {
  deleteSmallThumbnailMirrorSync,
  resolveManagedThumbnailWebPathFromAbsolutePath,
} from "../../thumbnailMirrorService";
import { buildManagedThumbnailWebPath } from "../thumbnailPathUtils";
import {
  BILIBILI_COOKIE_REFRESH_HINT,
  isLikelyBilibiliAuthFailure,
  resolveBilibiliMergeOutputFormat,
} from "./bilibiliConfig";
import {
  cleanupFilesOnCancellation,
  prepareFilePaths,
  renameFilesWithMetadata,
} from "./bilibiliFileManager";
import {
  extractPartMetadata,
  getFileSize,
  getVideoDimensions,
  getVideoDuration,
} from "./bilibiliMetadata";
import { downloadSubtitles } from "./bilibiliSubtitle";
import { BilibiliVideoInfo, DownloadResult } from "./types";
import { downloadVideo } from "./bilibiliCoreDownload";
import {
  BilibiliDownloaderHelper,
  formatLegacyMultipartTitle,
  resolveExistingThumbnailAbsolutePath,
  resolveSubtitleDirectory,
} from "./bilibiliVideoHelpers";

/**
 * Download a single Bilibili part (video + metadata + subtitles)
 */
export async function downloadSinglePart(
  url: string,
  partNumber: number,
  totalParts: number,
  seriesTitle: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
  collectionName?: string,
  filenameTemplateSourceOptions?: FilenameTemplateSourceOptions,
  modeOptions?: DownloadModeOptions
): Promise<DownloadResult> {
  try {
    logger.info(
      `Downloading Bilibili part ${partNumber}/${totalParts}: ${url}`
    );

    // Keep destination paths aligned with the Bilibili yt-dlp merge container.
    // Layer any per-subscription override on top of the global config (#345) and
    // infer audio-only mode the same way bilibiliCoreDownload does, so an
    // audio-only override (e.g. --format bestaudio) is reflected in the merge
    // container, mediaType, and duplicate scoping instead of being saved as a
    // video row.
    const userConfig = getEffectiveUserYtDlpConfig(
      url,
      modeOptions?.subscriptionYtdlpConfig
    );
    const { audioOnly, audioFormat } = resolveDownloadAudioMode({
      explicitAudioOnly: modeOptions?.audioOnly,
      explicitAudioFormat: modeOptions?.audioFormat,
      userConfig,
    });
    const mergeOutputFormat = audioOnly
      ? audioFormat
      : resolveBilibiliMergeOutputFormat(userConfig);
    // Overlay any per-subscription filename-template override onto the global
    // naming settings so renameFilesWithMetadata and the legacy/template branch
    // below use it consistently (issue #368). When no override is present the
    // original object is returned unchanged.
    const settings = applySubscriptionFilenameTemplateOverride(
      storageService.getSettings(),
      modeOptions?.subscriptionFilenameTemplate
    );
    const moveThumbnailsToVideoFolder =
      settings.moveThumbnailsToVideoFolder || false;
    const moveSubtitlesToVideoFolder =
      settings.moveSubtitlesToVideoFolder || false;

    // Create a safe base filename (without extension)
    const timestamp = Date.now();

    // Prepare file paths using the file manager
    const { videoPath, thumbnailPath, videoDir, imageDir } = prepareFilePaths(
      mergeOutputFormat,
      collectionName,
      moveThumbnailsToVideoFolder
    );

    let videoTitle,
      videoAuthor,
      videoDate,
      videoDescription,
      thumbnailUrl,
      thumbnailSaved,
      authorAvatarUrl,
      authorAvatarSaved,
      authorAvatarFilename,
      authorAvatarPath;

    // Download Bilibili video
    let bilibiliInfo: BilibiliVideoInfo;
    try {
      bilibiliInfo = await downloadVideo(
        url,
        videoPath,
        thumbnailPath,
        downloadId,
        onStart,
        undefined,
        false,
        modeOptions,
      );
    } catch (error: unknown) {
      // If download was cancelled, re-throw immediately without downloading subtitles or creating video data
      const downloader = new BilibiliDownloaderHelper();
      downloader.handleCancellationErrorPublic(error);
      throw error;
    }

    if (!bilibiliInfo) {
      throw new Error("Failed to get Bilibili video info");
    }

    // downloadVideo only returns its fallback object (error set, no usable file)
    // when the download genuinely failed. Stop here rather than saving a record
    // with generic "Bilibili User" metadata, and surface a cookie-refresh hint
    // when the failure looks like Bilibili risk control (issue #295).
    if (bilibiliInfo.error) {
      // downloadVideo funnels cancellations through its fallback return path
      // (its catch swallows DownloadCancelledError instead of rethrowing), so a
      // cancelled collection part arrives here with a cancellation message.
      // Re-check the download id first and propagate DownloadCancelledError;
      // otherwise downloadCollection would record this as a normal failed
      // episode and keep downloading the rest of the collection (issue #295).
      const downloader = new BilibiliDownloaderHelper();
      downloader.throwIfCancelledPublic(downloadId);

      const failureError = isLikelyBilibiliAuthFailure(bilibiliInfo.error)
        ? `${bilibiliInfo.error} — ${BILIBILI_COOKIE_REFRESH_HINT}`
        : bilibiliInfo.error;
      logger.error(
        `Bilibili download failed for ${url}: ${failureError}`
      );
      return { success: false, error: failureError };
    }

    logger.info("Bilibili download info:", bilibiliInfo);

    // Extract channel URL and part-specific title from Bilibili API using metadata module
    const { channelUrl, partTitle } = await extractPartMetadata(
      url,
      partNumber,
      totalParts,
      seriesTitle,
      bilibiliInfo
    );

    // For multi-part videos, include the part number in the title
    videoTitle = totalParts > 1 ? `${partNumber} ${partTitle}` : partTitle;
    const legacyFilenameTitle = formatLegacyMultipartTitle(
      partNumber,
      totalParts,
      partTitle,
    );

    videoAuthor = bilibiliInfo.author || "Bilibili User";
    videoDate =
      bilibiliInfo.date ||
      new Date().toISOString().slice(0, 10).replace(/-/g, "");
    videoDescription = bilibiliInfo.description || "";
    thumbnailUrl = bilibiliInfo.thumbnailUrl;
    thumbnailSaved = bilibiliInfo.thumbnailSaved;
    authorAvatarUrl = bilibiliInfo.authorAvatarUrl || null;
    authorAvatarSaved = bilibiliInfo.authorAvatarSaved || false;
    authorAvatarFilename = bilibiliInfo.authorAvatarFilename;
    authorAvatarPath = bilibiliInfo.authorAvatarPath;
    const actualVideoPath = bilibiliInfo.downloadedVideoPath || videoPath;
    const actualVideoExtension =
      bilibiliInfo.downloadedVideoExtension || mergeOutputFormat;

    // Check if download was cancelled before processing files
    const downloader = new BilibiliDownloaderHelper();
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      throw error;
    }

    // Rename files based on metadata using file manager
    const renameResult = renameFilesWithMetadata(
      videoTitle,
      videoAuthor,
      videoDate,
      actualVideoExtension,
      actualVideoPath,
      thumbnailPath,
      thumbnailSaved,
      videoDir,
      imageDir,
      {
        settings,
        filenameTemplateSourceOptions,
        legacyTitleOverride: legacyFilenameTitle,
      }
    );
    const {
      newVideoPath,
      newThumbnailPath,
      finalVideoFilename,
      finalThumbnailFilename,
    } = renameResult;

    // Get video duration, dimensions, and file size using metadata module
    const duration = await getVideoDuration(newVideoPath);
    const dimensions = await getVideoDimensions(newVideoPath);
    const fileSize = getFileSize(newVideoPath);
    const thumbnailWebPath = thumbnailSaved
      ? resolveManagedThumbnailWebPathFromAbsolutePath(newThumbnailPath) ||
        buildManagedThumbnailWebPath(
          finalThumbnailFilename,
          moveThumbnailsToVideoFolder,
          collectionName,
        )
      : null;

    // Check if download was cancelled before downloading subtitles
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      throw error;
    }

    // Download subtitles for video media only.
    // For non-legacy mode use planned subtitle paths; for legacy use formatVideoFilename
    const isLegacyMode = (settings.downloadFilenamePresetId || "legacy") === "legacy";
    const newSafeBaseFilename = isLegacyMode
      ? formatVideoFilename(legacyFilenameTitle, videoAuthor, videoDate)
      : (renameResult.subtitleStem || formatVideoFilename(videoTitle, videoAuthor, videoDate));

    let subtitles: Array<{
      language: string;
      filename: string;
      path: string;
    }> = [];
    if (!audioOnly) {
      try {
        logger.info("Attempting to download subtitles...");
        const subtitleDir = isLegacyMode
          ? resolveSubtitleDirectory(collectionName, moveSubtitlesToVideoFolder, videoDir)
          : (renameResult.subtitleBaseDir || resolveSubtitleDirectory(collectionName, moveSubtitlesToVideoFolder, videoDir));
        const subtitlePathPrefix = isLegacyMode
          ? (moveSubtitlesToVideoFolder
              ? collectionName ? `/videos/${collectionName}` : `/videos`
              : collectionName ? `/subtitles/${collectionName}` : `/subtitles`)
          : (renameResult.subtitleWebBaseDir || (moveSubtitlesToVideoFolder ? `/videos` : `/subtitles`));
        let axiosConfig = {};
        if (userConfig.proxy) {
          try {
            axiosConfig = getAxiosProxyConfig(userConfig.proxy);
          } catch (error) {
            if (error instanceof InvalidProxyError) {
              logger.warn(
                "Invalid proxy configuration for subtitle download, proceeding without proxy:",
                error.message
              );
            } else {
              throw error;
            }
          }
        }
        subtitles = await downloadSubtitles(
          url,
          newSafeBaseFilename,
          subtitleDir,
          subtitlePathPrefix,
          axiosConfig
        );
        logger.info(`Downloaded ${subtitles.length} subtitles`);
      } catch (e) {
        // If it's a cancellation error, re-throw it
        downloader.handleCancellationErrorPublic(e);
        logger.error("Error downloading subtitles:", e);
      }
    }

    // Check if download was cancelled before creating video data
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      // Clean up any files that were created
      await cleanupFilesOnCancellation(newVideoPath, newThumbnailPath);
      throw DownloadCancelledError.create();
    }

    // Create metadata for the video
    // For multi-part videos, ensure each part gets a unique ID by including part number
    const uniqueId =
      totalParts > 1 ? `${timestamp}_part${partNumber}` : timestamp.toString();

    const videoData: Video = {
      id: uniqueId,
      title: videoTitle,
      author: videoAuthor,
      description: videoDescription,
      date: videoDate,
      source: "bilibili",
      mediaType: audioOnly ? "audio" : "video",
      sourceUrl: url,
      videoFilename: finalVideoFilename,
      thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      videoPath: renameResult.videoWebPath || (collectionName
        ? `/videos/${collectionName}/${finalVideoFilename}`
        : `/videos/${finalVideoFilename}`),
      thumbnailPath: thumbnailWebPath,
      duration: duration,
      fileSize: fileSize,
      width: dimensions?.width,
      height: dimensions?.height,
      channelUrl: channelUrl || undefined,
      authorAvatarFilename: authorAvatarSaved
        ? authorAvatarFilename
        : undefined,
      authorAvatarPath: authorAvatarSaved ? authorAvatarPath : undefined,
      addedAt: new Date().toISOString(),
      partNumber: partNumber,
      totalParts: totalParts,
      seriesTitle: seriesTitle,
      createdAt: new Date().toISOString(),
    };

    // Under author_folder_only a collection is a logical grouping only: its
    // members (and their thumbnails/subtitles) belong in the author folder, not a
    // collection-named folder. Let organizeVideoByAuthor relocate them so nothing
    // is left behind in the collection directory (issue #295 2-2 / 2-3). Other
    // modes (root, author_collection_linked) keep the collection placement.
    const organizationMode = resolveAuthorOrganizationMode(settings);
    const preserveCollectionPlacement =
      (totalParts > 1 || Boolean(collectionName)) &&
      organizationMode !== "author_folder_only";
    const authorOrganizationOptions = preserveCollectionPlacement
      ? { moveFiles: false }
      : undefined;

    // For multi-part videos, always create a new video entry (each part is separate)
    // For single videos, check if video with same sourceUrl already exists
    if (totalParts === 1) {
      // Scope by media type so an audio-only download becomes its own library
      // item instead of overwriting the existing video row for the same URL.
      const existingVideo = storageService.getVideoBySourceUrl(
        url,
        audioOnly ? "audio" : "video"
      );

      if (existingVideo) {
        // Update existing video with new subtitle information and file paths
        logger.info(
          "Video with same sourceUrl exists, updating subtitle information"
        );

        if (
          thumbnailSaved &&
          existingVideo.thumbnailFilename &&
          existingVideo.thumbnailFilename !== finalThumbnailFilename
        ) {
          const oldThumbnailPath =
            resolveExistingThumbnailAbsolutePath(existingVideo);

          try {
            if (
              oldThumbnailPath &&
              pathExistsSafeSync(oldThumbnailPath, [IMAGES_DIR, VIDEOS_DIR]) &&
              !storageService.isThumbnailReferencedByOtherVideo(
                existingVideo,
                existingVideo.id,
              )
            ) {
              unlinkSafeSync(oldThumbnailPath, [IMAGES_DIR, VIDEOS_DIR]);
              deleteSmallThumbnailMirrorSync(oldThumbnailPath);
            }
          } catch (error) {
            logger.error("Failed to delete old Bilibili thumbnail file:", error);
          }
        }

        // Use existing video's ID and preserve other fields
        videoData.id = existingVideo.id;
        videoData.addedAt = existingVideo.addedAt;
        videoData.createdAt = existingVideo.createdAt;

        const updatedVideo = storageService.updateVideo(existingVideo.id, {
          subtitles: subtitles.length > 0 ? subtitles : undefined,
          videoFilename: finalVideoFilename,
          videoPath: renameResult.videoWebPath || (collectionName
            ? `/videos/${collectionName}/${finalVideoFilename}`
            : `/videos/${finalVideoFilename}`),
          thumbnailFilename: thumbnailSaved
            ? finalThumbnailFilename
            : existingVideo.thumbnailFilename,
          thumbnailPath: thumbnailSaved
            ? thumbnailWebPath
            : existingVideo.thumbnailPath,
          duration: duration,
          fileSize: fileSize,
          width: dimensions?.width,
          height: dimensions?.height,
          title: videoData.title, // Update title in case it changed
          description: videoData.description, // Update description in case it changed
          mediaType: videoData.mediaType,
          authorAvatarFilename: authorAvatarSaved
            ? authorAvatarFilename
            : existingVideo.authorAvatarFilename,
          authorAvatarPath: authorAvatarSaved
            ? authorAvatarPath
            : existingVideo.authorAvatarPath,
        });

        if (updatedVideo) {
          logger.info(`Video updated in database with new subtitles`);

          let finalVideoData = updatedVideo;

          // Add video to author collection if enabled (for existing videos too)
          const authorOrganization = storageService.organizeVideoByAuthor(
            updatedVideo.id,
            videoAuthor,
            settings.authorOrganizationMode,
            settings.downloadFilenamePresetId,
            authorOrganizationOptions
          );

          if (authorOrganization) {
            const collectionUpdatedVideo = storageService.getVideoById(updatedVideo.id);
            if (collectionUpdatedVideo) {
              finalVideoData = collectionUpdatedVideo;
            }
          }

          removeMediaServerArtifactsForVideo(existingVideo);
          syncMediaServerArtifactsForRecord(finalVideoData, {
            rawSourceInfo: bilibiliInfo,
          });
          return { success: true, videoData: finalVideoData };
        }
      }
    }

    // Save the video (new video)
    storageService.saveVideo(videoData);

    logger.info(`Part ${partNumber}/${totalParts} added to database`);

    // Add video to author collection if enabled
    const authorOrganization = storageService.organizeVideoByAuthor(
      videoData.id,
      videoAuthor,
      settings.authorOrganizationMode,
      settings.downloadFilenamePresetId,
      authorOrganizationOptions
    );

    if (authorOrganization) {
      // If video was added to a collection, the file paths might have changed
      // Fetch the updated video from storage
      const updatedVideo = storageService.getVideoById(videoData.id);
      if (updatedVideo) {
        syncMediaServerArtifactsForRecord(updatedVideo, {
          rawSourceInfo: bilibiliInfo,
        });
        return { success: true, videoData: updatedVideo };
      }
    }

    syncMediaServerArtifactsForRecord(videoData, {
      rawSourceInfo: bilibiliInfo,
    });
    return { success: true, videoData };
  } catch (error: unknown) {
    // A cancelled part must abort the whole download, not be recorded as a
    // failed episode. downloadCollection relies on a thrown DownloadCancelledError
    // to stop its loop, so let cancellations propagate instead of swallowing
    // them into a { success: false } result (issue #295).
    if (isCancellationError(error)) {
      throw error;
    }
    logger.error(
      `Error downloading Bilibili part ${partNumber}/${totalParts}:`,
      error
    );
    return { success: false, error: getErrorMessage(error) };
  }
}
