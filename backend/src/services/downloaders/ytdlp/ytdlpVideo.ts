import fs from "fs-extra";
import { getErrorMessage } from "../../../utils/errors";
import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import {
  cleanupSubtitleFiles,
  cleanupVideoArtifacts,
} from "../../../utils/downloadUtils";
import {
  extractTwitchVideoId,
  isYouTubeUrl,
} from "../../../utils/helpers";
import { resolveManagedWebPath } from "../../filenameTemplate/pathHelpers";
import { applySubscriptionFilenameTemplateOverride } from "../../filenameTemplate";
import { FilenameTemplateSourceOptions } from "../../filenameTemplate/types";
import { planDownloadPaths } from "./downloadPathPlanner";
import { logger } from "../../../utils/logger";
import { ProgressTracker } from "../../../utils/progressTracker";
import { resolvePlayableMediaFilePath } from "../../../utils/videoFileResolver";
import {
  executeYtDlpJson,
  executeYtDlpSpawn,
  getAxiosProxyConfig,
  getChannelUrlFromVideo,
  getEffectiveUserYtDlpConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
} from "../../../utils/ytDlpUtils";
import {
  pathExistsSafeSync,
  removeSafe,
  resolveSafeChildPath,
  statSafeSync,
  unlinkSafeSync,
} from "../../../utils/security";
import {
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "../../mediaServerExport";
import * as storageService from "../../storageService";
import { Video } from "../../storageService";
import { deleteSmallThumbnailMirrorSync } from "../../thumbnailMirrorService";
import { twitchApiService } from "../../twitchService";
import { BaseDownloader, DownloadModeOptions } from "../BaseDownloader";
import {
  prepareAudioDownloadFlags,
  prepareDownloadFlags,
  resolveDownloadAudioMode,
} from "./ytdlpConfig";
import { getProviderScript } from "./ytdlpHelpers";
import { extractVideoMetadata } from "./ytdlpMetadata";
import { processSubtitles } from "./ytdlpSubtitle";
import { YtDlpDownloaderHelper } from "./ytdlpDownloaderHelper";
import { downloadVideoAvatar } from "./avatarDownload";
import {
  createYtDlpOutputTemplate,
  isExpectedTwitchMetadataError,
} from "./ytdlpVideoHelpers";

/**
 * Core video download function using yt-dlp
 */
export async function downloadVideo(
  videoUrl: string,
  optionsOrDownloadId?: DownloadModeOptions | string,
  legacyOnStart?: (cancel: () => void) => void,
  legacyFilenameTemplateSourceOptions?: import("../../filenameTemplate/types").FilenameTemplateSourceOptions
): Promise<Video> {
  const options: DownloadModeOptions =
    typeof optionsOrDownloadId === "object" && optionsOrDownloadId !== null
      ? optionsOrDownloadId
      : {
          downloadId: optionsOrDownloadId,
          onStart: legacyOnStart,
          filenameTemplateSourceOptions: legacyFilenameTemplateSourceOptions,
        };
  const downloadId = options.downloadId;
  const onStart = options.onStart;
  const filenameTemplateSourceOptions = options.filenameTemplateSourceOptions;
  const subscriptionYtdlpConfig = options.subscriptionYtdlpConfig;
  const subscriptionFilenameTemplate = options.subscriptionFilenameTemplate;
  const effectiveUserConfig = getEffectiveUserYtDlpConfig(
    videoUrl,
    subscriptionYtdlpConfig
  );
  const { audioOnly, audioFormat } = resolveDownloadAudioMode({
    explicitAudioOnly: options.audioOnly,
    explicitAudioFormat: options.audioFormat,
    userConfig: effectiveUserConfig,
  });
  logger.info("Detected URL:", videoUrl);

  // Create a safe base filename (without extension)
  const timestamp = Date.now();
  const safeBaseFilename = `video_${timestamp}`;

  // Add extensions for video and thumbnail
  const videoFilename = `${safeBaseFilename}.${audioOnly ? audioFormat : "mp4"}`;
  const thumbnailFilename = `${safeBaseFilename}.jpg`;

  let videoTitle: string,
    videoAuthor: string,
    videoDate: string,
    videoDescription: string,
    thumbnailUrl: string | null,
    thumbnailSaved: boolean,
    source: string,
    channelUrl: string | null = null,
    authorAvatarUrl: string | null = null,
    authorAvatarSaved: boolean = false;
  let finalVideoFilename = videoFilename;
  let finalThumbnailFilename = thumbnailFilename;
  let finalAuthorAvatarFilename: string | undefined = undefined;
  let subtitles: Array<{ language: string; filename: string; path: string }> =
    [];
  let rawSourceInfo: Record<string, unknown> | null = null;
  // These are set inside the try block but also referenced after it
  let newVideoPathWithFormat = resolveSafeChildPath(VIDEOS_DIR, videoFilename);
  let newThumbnailPath = resolveSafeChildPath(IMAGES_DIR, thumbnailFilename);
  let newSafeBaseFilename = safeBaseFilename;

  const downloader = new YtDlpDownloaderHelper();

  try {
    const PROVIDER_SCRIPT = getProviderScript();

    // Get user's yt-dlp configuration for network options (including proxy),
    // layering any per-subscription override on top of the global config (#345).
    const userConfig = effectiveUserConfig;
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    // Get video info first
    const info = await executeYtDlpJson(videoUrl, {
      ...networkConfig,
      noWarnings: true,
      skipDownload: true,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    rawSourceInfo = info as Record<string, unknown>;

    logger.info("Video info:", {
      title: info.title,
      uploader: info.uploader,
      upload_date: info.upload_date,
      extractor: info.extractor,
    });

    // Extract metadata
    const metadata = await extractVideoMetadata(videoUrl, info);
    videoTitle = metadata.videoTitle;
    videoAuthor = metadata.videoAuthor;
    videoDate = metadata.videoDate;
    videoDescription = metadata.videoDescription;
    thumbnailUrl = metadata.thumbnailUrl;
    source = metadata.source;

    // Extract channel URL from info if available
    channelUrl = info.channel_url || info.uploader_url || null;

    // When extractor metadata omits the channel URL, ask yt-dlp directly.
    if (!channelUrl && (isYouTubeUrl(videoUrl) || source === "twitch")) {
      logger.info("Channel URL not in info, fetching using yt-dlp...");
      channelUrl = await getChannelUrlFromVideo(videoUrl, networkConfig);
      logger.info("Channel URL fetched", { channelUrl });
    }

    if (source === "twitch" && twitchApiService.isConfigured()) {
      const twitchVideoId = extractTwitchVideoId(videoUrl);
      if (twitchVideoId) {
        try {
          const twitchVideo = await twitchApiService.getVideoById(twitchVideoId);
          if (twitchVideo) {
            channelUrl =
              channelUrl || `https://www.twitch.tv/${twitchVideo.userLogin}`;

            if (!videoAuthor || videoAuthor === "Unknown") {
              videoAuthor = twitchVideo.userName || twitchVideo.userLogin;
            }

            const twitchChannel = await twitchApiService.getChannelById(
              twitchVideo.userId
            );
            if (twitchChannel) {
              channelUrl = channelUrl || twitchChannel.url;
              authorAvatarUrl = twitchChannel.profileImageUrl;
            }
          }
        } catch (error) {
          if (isExpectedTwitchMetadataError(error)) {
            logger.debug("Skipping Twitch Helix metadata enrichment:", error);
          } else {
            logger.warn("Failed to enrich Twitch metadata via Helix:", error);
          }
        }
      }
    }

    // Update paths. Overlay any per-subscription filename-template override
    // onto the global naming settings so path planning uses it consistently
    // (issue #368). When no override is present the original object is returned
    // unchanged, preserving existing behavior and identity.
    const globalSettings = storageService.getSettings();
    const settings = applySubscriptionFilenameTemplateOverride(
      globalSettings,
      subscriptionFilenameTemplate
    );
    const moveThumbnailsToVideoFolder =
      settings.moveThumbnailsToVideoFolder || false;
    const moveSubtitlesToVideoFolder =
      settings.moveSubtitlesToVideoFolder || false;
    const downloadFilenamePresetId = settings.downloadFilenamePresetId || "legacy";

    logger.info("File location settings:", {
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder,
      downloadFilenamePresetId,
      videoDir: VIDEOS_DIR,
      imageDir: IMAGES_DIR,
    });

    if (downloadId) {
      storageService.updateActiveDownload(downloadId, {
        title: videoTitle,
        filename: videoTitle,
        progress: 0,
      });
    }

    // Get user's yt-dlp configuration (reuse from above if available, otherwise fetch again)
    const downloadUserConfig = userConfig || getUserYtDlpConfig(videoUrl);

    if (downloadUserConfig.proxy) {
      logger.info("Using proxy for download:", downloadUserConfig.proxy);
    }

    // Prepare download flags with a temp path to determine mergeOutputFormat
    const tempVideoPath = resolveSafeChildPath(
      VIDEOS_DIR,
      `${safeBaseFilename}.${audioOnly ? audioFormat : "mp4"}`
    );
    const preparedFlags = audioOnly
      ? prepareAudioDownloadFlags(
          videoUrl,
          tempVideoPath,
          audioFormat,
          downloadUserConfig,
        )
      : prepareDownloadFlags(videoUrl, tempVideoPath, downloadUserConfig);
    const flags = preparedFlags.flags;
    const mergeOutputFormat = audioOnly
      ? audioFormat
      : (preparedFlags as ReturnType<typeof prepareDownloadFlags>).mergeOutputFormat;
    const videoExtension = audioOnly
      ? audioFormat
      : (preparedFlags as ReturnType<typeof prepareDownloadFlags>).videoExtension;

    if (flags.proxy) {
      logger.info("Proxy included in download flags:", flags.proxy);
    } else {
      logger.warn(
        "Proxy not found in download flags. User config proxy:",
        downloadUserConfig.proxy
      );
    }

    // Plan output paths (template planner or legacy naming, with collision
    // dedup). Extracted to downloadPathPlanner for unit-testability (M-2).
    const plannedPaths = planDownloadPaths({
      videoUrl,
      info,
      settings,
      filenameTemplateSourceOptions,
      videoTitle,
      videoAuthor,
      videoDate,
      videoExtension,
      moveThumbnailsToVideoFolder,
      moveSubtitlesToVideoFolder,
    });
    newVideoPathWithFormat = plannedPaths.videoAbsolutePath;
    finalVideoFilename = plannedPaths.videoFilename;
    newThumbnailPath = plannedPaths.thumbnailAbsolutePath;
    finalThumbnailFilename = plannedPaths.thumbnailFilename;
    newSafeBaseFilename = plannedPaths.safeBaseFilename;

    // Update output path in flags
    flags.output = createYtDlpOutputTemplate(newVideoPathWithFormat);

    logger.info(
      `Using merge output format: ${mergeOutputFormat}, downloading to: ${newVideoPathWithFormat}`
    );

    // Use spawn to capture stdout for progress
    const subprocess = executeYtDlpSpawn(videoUrl, flags);

    if (onStart) {
      onStart(async () => {
        logger.info("Killing subprocess for download:", downloadId);
        subprocess.kill();

        // Clean up partial files
        logger.info("Cleaning up partial files...");
        await cleanupVideoArtifacts(newSafeBaseFilename);

        // Use fresh cleanup based on settings
        const currentSettings = storageService.getSettings();
        if (!currentSettings.moveThumbnailsToVideoFolder) {
          await cleanupVideoArtifacts(newSafeBaseFilename, IMAGES_DIR);
        }

        await removeSafe(newThumbnailPath, [VIDEOS_DIR, IMAGES_DIR]);
        await cleanupSubtitleFiles(newSafeBaseFilename);
      });
    }

    // Use ProgressTracker for centralized progress parsing
    const progressTracker = new ProgressTracker(downloadId);
    subprocess.stdout?.on("data", (data: Buffer) => {
      progressTracker.parseAndUpdate(data.toString());
    });

    // Wait for download to complete
    try {
      await Promise.resolve(subprocess).finally(() => progressTracker.dispose());
    } catch (error: unknown) {
      await downloader.handleCancellationErrorPublic(error, async () => {
        await cleanupVideoArtifacts(newSafeBaseFilename);
        await cleanupSubtitleFiles(newSafeBaseFilename);
      });

      // Check if error is subtitle-related and video file exists
      const stderr = (error as { stderr?: string }).stderr || "";
      const isSubtitleError =
        stderr.includes("Unable to download video subtitles") ||
        stderr.includes("Unable to download subtitles") ||
        (stderr.includes("subtitles") && stderr.includes("429"));

      if (isSubtitleError) {
        // Check if video file was successfully downloaded
        const resolvedVideoPath = resolvePlayableMediaFilePath(
          newVideoPathWithFormat,
          audioOnly ? "audio" : "video",
        );
        if (resolvedVideoPath) {
          logger.warn(
            "Subtitle download failed, but video was downloaded successfully. Continuing...",
            getErrorMessage(error)
          );
          // Log the subtitle error details
          if (stderr) {
            logger.warn("Subtitle error details:", stderr);
          }
          // Continue processing - don't throw
        } else {
          // Video file doesn't exist, this is a real error
          throw error;
        }
      } else {
        // Re-throw other errors
        throw error;
      }
    }

    // Check if download was cancelled (it might have been removed from active downloads)
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      await cleanupVideoArtifacts(newSafeBaseFilename);
      await cleanupSubtitleFiles(newSafeBaseFilename);
      throw error;
    }

    const resolvedVideoPath = resolvePlayableMediaFilePath(
      newVideoPathWithFormat,
      audioOnly ? "audio" : "video",
    );
    if (!resolvedVideoPath) {
      throw new Error(
        `Downloaded video file not found after yt-dlp completed: ${newVideoPathWithFormat}`
      );
    }

    if (path.normalize(resolvedVideoPath) !== path.normalize(newVideoPathWithFormat)) {
      logger.warn(
        "Merged output file missing; falling back to split video artifact. This usually means ffmpeg is not available on the host.",
        {
          expected: newVideoPathWithFormat,
          fallback: resolvedVideoPath,
        }
      );
      newVideoPathWithFormat = resolvedVideoPath;
      finalVideoFilename = path.basename(resolvedVideoPath);
    }

    logger.info("Video downloaded successfully");

    // Check if download was cancelled before processing thumbnails and subtitles
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      await cleanupSubtitleFiles(newSafeBaseFilename);
      throw error;
    }

    // Download and save the thumbnail
    thumbnailSaved = false;

    if (thumbnailUrl) {
      // Prepare axios config with proxy if available
      let axiosConfig = {};

      if (downloadUserConfig.proxy) {
        try {
          axiosConfig = getAxiosProxyConfig(downloadUserConfig.proxy);
        } catch (error) {
          if (error instanceof InvalidProxyError) {
            // Log the error but continue without proxy for thumbnail
            // Video download already succeeded, don't fail for thumbnail proxy issues
            logger.warn(
              "Invalid proxy configuration for thumbnail download, proceeding without proxy:",
              error.message
            );
          } else {
            throw error;
          }
        }
      }

      thumbnailSaved = await downloader.downloadThumbnailPublic(
        thumbnailUrl,
        newThumbnailPath,
        axiosConfig
      );
    }

    // Download and process author avatar
    const avatarResult = await downloadVideoAvatar({
      channelUrl,
      videoUrl,
      videoAuthor,
      source,
      authorAvatarUrl,
      info,
      networkConfig,
      downloadUserConfig,
      downloader,
    });
    authorAvatarUrl = avatarResult.authorAvatarUrl;
    authorAvatarSaved = avatarResult.authorAvatarSaved;
    finalAuthorAvatarFilename = avatarResult.finalAuthorAvatarFilename;

    // Audio downloads keep their thumbnail as album art but do not fetch
    // subtitles, which are a video-only presentation feature.
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      if (!audioOnly) {
        await cleanupSubtitleFiles(newSafeBaseFilename);
      }
      throw error;
    }

    // Process subtitle files — for non-legacy mode subtitles land in the video's subdirectory.
    // videoSubDir is derived from newVideoPathWithFormat (already produced via
    // resolveSafeChildPath, so it's known to be inside VIDEOS_DIR).
    const videoSubDir = path.dirname(newVideoPathWithFormat);
    const isVideoInSubDir = videoSubDir !== VIDEOS_DIR;
    const videoSubRelative = isVideoInSubDir
      ? path.relative(VIDEOS_DIR, videoSubDir)
      : "";
    const subtitleSubDir = isVideoInSubDir
      ? moveSubtitlesToVideoFolder
        ? videoSubDir
        : resolveSafeChildPath(SUBTITLES_DIR, videoSubRelative)
      : undefined;
    if (!audioOnly) {
      subtitles = await processSubtitles(
        newSafeBaseFilename,
        downloadId,
        moveSubtitlesToVideoFolder,
        isVideoInSubDir ? videoSubDir : undefined,
        subtitleSubDir,
        isVideoInSubDir
          ? moveSubtitlesToVideoFolder
            ? `/videos/${videoSubRelative}`
            : `/subtitles/${videoSubRelative}`
          : undefined,
      );
    }
  } catch (error) {
    logger.error(
      "Error in download process:",
      error,
      typeof (error as { stderr?: unknown })?.stderr === "string"
        ? { stderr: (error as { stderr: string }).stderr }
        : undefined,
    );
    throw error;
  }

  // Create metadata for the video. Re-apply the per-subscription filename
  // override so the author-collection movement below sees the same effective
  // naming settings as path planning did (issue #368).
  const settings = applySubscriptionFilenameTemplateOverride(
    storageService.getSettings(),
    subscriptionFilenameTemplate
  );
  const moveThumbnailsToVideoFolder =
    settings.moveThumbnailsToVideoFolder || false;

  // Derive web paths from absolute paths (supports template subdirectories).
  // newVideoPathWithFormat / newThumbnailPath are already absolute paths
  // produced by resolveSafeChildPath, so path.relative() alone is sufficient.
  const finalVideoRelative = path.relative(VIDEOS_DIR, newVideoPathWithFormat);
  const finalVideoWebPath = `/videos/${finalVideoRelative}`;
  let finalThumbnailWebPath: string | null = null;
  if (thumbnailSaved) {
    if (moveThumbnailsToVideoFolder) {
      const relThumb = path.relative(VIDEOS_DIR, newThumbnailPath);
      finalThumbnailWebPath = `/videos/${relThumb}`;
    } else {
      const relThumb = path.relative(IMAGES_DIR, newThumbnailPath);
      finalThumbnailWebPath = `/images/${relThumb}`;
    }
  }

  const videoData: Video = {
    id: timestamp.toString(),
    title: videoTitle || "Video",
    author: videoAuthor || "Unknown",
    description: videoDescription,
    date: videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    source: source, // Use extracted source
    sourceUrl: videoUrl,
    mediaType: audioOnly ? "audio" : "video",
    videoFilename: path.basename(finalVideoRelative),
    thumbnailFilename: thumbnailSaved ? path.basename(finalThumbnailFilename) : undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    videoPath: finalVideoWebPath,
    thumbnailPath: finalThumbnailWebPath,
    subtitles: subtitles.length > 0 ? subtitles : undefined,
    duration: undefined, // Will be populated below
    channelUrl: channelUrl || undefined,
    authorAvatarFilename:
      authorAvatarSaved && finalAuthorAvatarFilename
        ? finalAuthorAvatarFilename
        : undefined,
    authorAvatarPath:
      authorAvatarSaved && finalAuthorAvatarFilename
        ? `/avatars/${finalAuthorAvatarFilename}`
        : undefined,
    addedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  // If duration is missing from info, try to extract it from file
  const finalVideoPath = newVideoPathWithFormat;

  try {
    const { getVideoDuration } = await import(
      "../../../services/metadataService"
    );
    const duration = await getVideoDuration(finalVideoPath);
    if (duration) {
      videoData.duration = duration.toString();
    }
  } catch (e) {
    logger.error("Failed to extract duration from downloaded file:", e);
  }

  try {
    const { getVideoDimensions } = await import(
      "../../../services/metadataService"
    );
    const dimensions = await getVideoDimensions(finalVideoPath);
    if (dimensions) {
      videoData.width = dimensions.width;
      videoData.height = dimensions.height;
    }
  } catch (e) {
    logger.error("Failed to extract dimensions from downloaded file:", e);
  }

  // Get file size
  try {
    if (pathExistsSafeSync(finalVideoPath, VIDEOS_DIR)) {
      const stats = statSafeSync(finalVideoPath, VIDEOS_DIR);
      videoData.fileSize = stats.size.toString();
    }
  } catch (e) {
    logger.error("Failed to get file size:", e);
  }

  // Check if a library item with the same sourceUrl AND media type already
  // exists. Scoping by media type keeps audio-only downloads as their own item
  // instead of overwriting (and deleting the file of) the existing video row.
  const existingVideo = storageService.getVideoBySourceUrl(
    videoUrl,
    audioOnly ? "audio" : "video"
  );

  if (existingVideo) {
    // Update existing video with new subtitle information and file paths
    logger.info(
      "Video with same sourceUrl exists, updating subtitle information"
    );

    // Delete old video file if filename changed.
    // Resolve via existingVideo.videoPath so a templated nested path
    // (e.g. /videos/Channel/Season 2026/file.mp4) is removed correctly;
    // basename-only resolution would target /videos/file.mp4 and miss it.
    if (existingVideo.videoFilename && existingVideo.videoFilename !== finalVideoFilename) {
      const resolved = existingVideo.videoPath
        ? resolveManagedWebPath(existingVideo.videoPath)
        : null;
      const oldVideoPath = resolved
        ? resolved.absolutePath
        : resolveSafeChildPath(VIDEOS_DIR, existingVideo.videoFilename);
      try {
        if (pathExistsSafeSync(oldVideoPath, VIDEOS_DIR)) {
          unlinkSafeSync(oldVideoPath, VIDEOS_DIR);
          logger.info(`Deleted old video file: ${existingVideo.videoPath || existingVideo.videoFilename}`);
        }
      } catch (e) {
        logger.error("Failed to delete old video file:", e);
      }
    }

    // Delete old thumbnail file if being replaced with a new one
    if (thumbnailSaved && existingVideo.thumbnailFilename && existingVideo.thumbnailFilename !== finalThumbnailFilename) {
      const oldThumbnailPath = existingVideo.thumbnailPath?.startsWith("/videos/")
        ? resolveSafeChildPath(
            VIDEOS_DIR,
            existingVideo.thumbnailPath.replace(/^\/videos\//, "")
          )
        : existingVideo.thumbnailPath?.startsWith("/images/")
          ? resolveSafeChildPath(
              IMAGES_DIR,
              existingVideo.thumbnailPath.replace(/^\/images\//, "")
            )
          : resolveSafeChildPath(IMAGES_DIR, existingVideo.thumbnailFilename);
      try {
        if (
          pathExistsSafeSync(oldThumbnailPath, [VIDEOS_DIR, IMAGES_DIR]) &&
          !storageService.isThumbnailReferencedByOtherVideo(
            existingVideo,
            existingVideo.id,
          )
        ) {
          unlinkSafeSync(oldThumbnailPath, [VIDEOS_DIR, IMAGES_DIR]);
          deleteSmallThumbnailMirrorSync(oldThumbnailPath);
          logger.info(`Deleted old thumbnail file: ${existingVideo.thumbnailFilename}`);
        }
      } catch (e) {
        logger.error("Failed to delete old thumbnail file:", e);
      }
    }

    // Use existing video's ID and preserve other fields
    videoData.id = existingVideo.id;
    videoData.createdAt = existingVideo.createdAt;

    const updatedVideo = storageService.updateVideo(existingVideo.id, {
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      videoFilename: path.basename(finalVideoRelative),
      videoPath: finalVideoWebPath,
      thumbnailFilename: thumbnailSaved
        ? path.basename(finalThumbnailFilename)
        : existingVideo.thumbnailFilename,
      thumbnailPath: thumbnailSaved ? finalThumbnailWebPath : existingVideo.thumbnailPath,
      duration: videoData.duration,
      fileSize: videoData.fileSize,
      width: videoData.width,
      height: videoData.height,
      addedAt: new Date().toISOString(), // Update download date
      title: videoData.title, // Update title in case it changed
      description: videoData.description, // Update description in case it changed
      mediaType: videoData.mediaType,
      authorAvatarFilename: authorAvatarSaved
        ? finalAuthorAvatarFilename
        : existingVideo.authorAvatarFilename,
      authorAvatarPath: authorAvatarSaved
        ? `/avatars/${finalAuthorAvatarFilename}`
        : existingVideo.authorAvatarPath,
    });

    if (updatedVideo) {
      logger.info("Video updated in database with new subtitles");

      let finalVideoData = updatedVideo;

      // Add video to author collection if enabled (for existing videos too)
      const authorOrganization = storageService.organizeVideoByAuthor(
        updatedVideo.id,
        videoAuthor,
        settings.authorOrganizationMode,
        settings.downloadFilenamePresetId
      );

      if (authorOrganization) {
        const collectionUpdatedVideo = storageService.getVideoById(updatedVideo.id);
        if (collectionUpdatedVideo) {
          finalVideoData = collectionUpdatedVideo;
        }
      }

      removeMediaServerArtifactsForVideo(existingVideo);
      syncMediaServerArtifactsForRecord(finalVideoData, {
        rawSourceInfo,
      });
      return finalVideoData;
    }
  }

  // Save the video (new video)
  storageService.saveVideo(videoData);

  logger.info("Video added to database");

  // Add video to author collection if enabled
  const authorOrganization = storageService.organizeVideoByAuthor(
    videoData.id,
    videoAuthor,
    settings.authorOrganizationMode,
    settings.downloadFilenamePresetId
  );

  if (authorOrganization) {
    // If video was added to a collection, the file paths might have changed
    // Fetch the updated video from storage
    const updatedVideo = storageService.getVideoById(videoData.id);
    if (updatedVideo) {
      syncMediaServerArtifactsForRecord(updatedVideo, {
        rawSourceInfo,
      });
      return updatedVideo;
    }
  }

  syncMediaServerArtifactsForRecord(videoData, {
    rawSourceInfo,
  });
  return videoData;
}
