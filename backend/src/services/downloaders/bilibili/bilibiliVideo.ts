import path from "path";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { DownloadCancelledError } from "../../../errors/DownloadErrors";
import { downloadAndProcessAvatar } from "../../../utils/avatarUtils";
import { formatBytes } from "../../../utils/downloadUtils";
import { formatVideoFilename } from "../../../utils/helpers";
import { FilenameTemplateSourceOptions } from "../../filenameTemplate/types";
import { resolveAuthorOrganizationMode } from "../../../types/settings";
import { logger } from "../../../utils/logger";
import { ProgressTracker } from "../../../utils/progressTracker";
import {
  pathExistsSafeSync,
  readdirSafeSync,
  removeSafe,
  resolveSafeChildPath,
  sanitizePathSegment,
  statSafeSync,
  unlinkSafeSync,
} from "../../../utils/security";
import {
  executeYtDlpJson,
  executeYtDlpSpawn,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
} from "../../../utils/ytDlpUtils";
import {
  removeMediaServerArtifactsForVideo,
  syncMediaServerArtifactsForRecord,
} from "../../mediaServerExport";
import * as storageService from "../../storageService";
import { Video } from "../../storageService";
import {
  deleteSmallThumbnailMirrorSync,
  resolveManagedThumbnailWebPathFromAbsolutePath,
} from "../../thumbnailMirrorService";
import { BaseDownloader } from "../BaseDownloader";
import { buildManagedThumbnailWebPath } from "../thumbnailPathUtils";
import {
  prepareBilibiliDownloadFlags,
  resolveResolutionPreference,
  resolveResolutionRetryTarget,
} from "./bilibiliConfig";
import {
  cleanupFilesOnCancellation,
  cleanupTempDir,
  createTempDir,
  findVideoFileInTemp,
  moveVideoFile,
  prepareFilePaths,
  renameFilesWithMetadata,
} from "./bilibiliFileManager";
import {
  extractPartMetadata,
  getFileSize,
  getVideoDuration,
  getVideoHeight,
} from "./bilibiliMetadata";
import { downloadSubtitles } from "./bilibiliSubtitle";
import { BilibiliVideoInfo, DownloadResult } from "./types";

// Helper class to access BaseDownloader methods without circular dependency
class BilibiliDownloaderHelper extends BaseDownloader {
  async getVideoInfo(): Promise<any> {
    throw new Error("Not implemented");
  }
  async downloadVideo(): Promise<any> {
    throw new Error("Not implemented");
  }

  // Expose protected methods as public for use in module functions
  public handleCancellationErrorPublic(
    error: unknown,
    cleanupFn?: () => void | Promise<void>
  ): Promise<void> {
    return this.handleCancellationError(error, cleanupFn);
  }

  public throwIfCancelledPublic(downloadId?: string): void {
    return this.throwIfCancelled(downloadId);
  }

  public async downloadThumbnailPublic(
    thumbnailUrl: string,
    savePath: string,
    axiosConfig: any = {}
  ): Promise<boolean> {
    return this.downloadThumbnail(thumbnailUrl, savePath, axiosConfig);
  }
}

function resolveSubtitleDirectory(
  collectionName: string | undefined,
  moveSubtitlesToVideoFolder: boolean,
  videoDir: string
): string {
  if (moveSubtitlesToVideoFolder) {
    return videoDir;
  }

  if (!collectionName) {
    return SUBTITLES_DIR;
  }

  const safeCollectionName = sanitizePathSegment(collectionName);
  return safeCollectionName
    ? resolveSafeChildPath(SUBTITLES_DIR, safeCollectionName)
    : SUBTITLES_DIR;
}

function formatLegacyMultipartTitle(
  partNumber: number,
  totalParts: number,
  partTitle: string,
): string {
  if (totalParts <= 1) {
    return partTitle;
  }

  const width = String(totalParts).length;
  return `${String(partNumber).padStart(width, "0")} ${partTitle}`;
}

function resolveExistingThumbnailAbsolutePath(
  existingVideo: {
    thumbnailFilename?: string;
    thumbnailPath?: string | null;
  }
): string | null {
  if (existingVideo.thumbnailPath?.startsWith("/videos/")) {
    return resolveSafeChildPath(
      VIDEOS_DIR,
      existingVideo.thumbnailPath.replace(/^\/videos\//, "")
    );
  }

  if (existingVideo.thumbnailPath?.startsWith("/images/")) {
    return resolveSafeChildPath(
      IMAGES_DIR,
      existingVideo.thumbnailPath.replace(/^\/images\//, "")
    );
  }

  if (!existingVideo.thumbnailFilename) {
    return null;
  }

  return resolveSafeChildPath(
    IMAGES_DIR,
    path.basename(existingVideo.thumbnailFilename)
  );
}

/**
 * Collect the pixel heights of the formats yt-dlp reported for a source, used to
 * decide whether an under-resolution download is worth retrying (issue #295 2-1).
 */
function extractAvailableHeights(
  info: Record<string, unknown> | null
): number[] {
  if (!info) {
    return [];
  }

  const heights: number[] = [];
  const formats = Array.isArray(info.formats) ? info.formats : [];
  for (const format of formats) {
    const height = (format as { height?: unknown })?.height;
    if (typeof height === "number" && height > 0) {
      heights.push(height);
    }
  }

  // Some responses only expose a top-level height rather than a formats array.
  if (typeof info.height === "number" && info.height > 0) {
    heights.push(info.height);
  }

  return heights;
}

/**
 * Core video download function using yt-dlp
 */
export async function downloadVideo(
  url: string,
  videoPath: string,
  thumbnailPath: string,
  downloadId?: string,
  onStart?: (cancel: () => void) => void,
  // Internal: set only by the under-resolution retry path to pin a height floor
  // (issue #295 2-1). When set, resolution verification is skipped to bound the
  // retry to a single attempt.
  retryFloorHeight?: number,
  preserveExistingOutputOnCancel = false
): Promise<BilibiliVideoInfo> {
  const tempDir = createTempDir();
  let rawSourceInfo: Record<string, unknown> | null = null;

  try {
    logger.info("Downloading Bilibili video using yt-dlp to:", tempDir);

    // Get video info first
    const userConfig = getUserYtDlpConfig(url);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);

    const info = await executeYtDlpJson(url, {
      ...networkConfig,
      noWarnings: true,
    });

    // A bare multipart Bilibili URL resolves as a playlist: --dump-single-json
    // then returns playlist-level fields where uploader, thumbnail, upload_date
    // and formats live on the per-part entries rather than the top level.
    // Without this, a single-part download of a multipart video loses its author
    // (falls back to "Bilibili User") and thumbnail, and the download spawn pulls
    // every part into one output template, producing an "Invalid data found"
    // merge error. Source metadata from the first entry and pin the spawn to it.
    const playlistEntries = Array.isArray(
      (info as { entries?: unknown }).entries
    )
      ? (info as { entries: Array<Record<string, any>> }).entries
      : null;
    const isMultipartPlaylist =
      playlistEntries != null && playlistEntries.length > 0;
    const metaSource: Record<string, any> = isMultipartPlaylist
      ? { ...info, ...playlistEntries[0] }
      : info;
    rawSourceInfo = metaSource as Record<string, unknown>;

    // Keep the playlist-level title as the video title (it is the overall video
    // name); entry-level title is the part name and gets resolved separately.
    const videoTitle = info.title || metaSource.title || "Bilibili Video";
    const videoAuthor =
      metaSource.uploader || metaSource.channel || "Bilibili User";
    const videoDate =
      metaSource.upload_date ||
      metaSource.release_date ||
      new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const thumbnailUrl = metaSource.thumbnail || null;
    const description = metaSource.description || "";

    if (downloadId) {
      storageService.updateActiveDownload(downloadId, {
        title: videoTitle,
        filename: videoTitle,
        progress: 0,
      });
    }

    // Try to get avatar URL from yt-dlp info first
    let authorAvatarUrl =
      metaSource.channel_avatar || metaSource.uploader_avatar || null;

    // If not in yt-dlp info, get it from Bilibili API
    if (!authorAvatarUrl) {
      try {
        const { extractBilibiliVideoId } = await import(
          "../../../utils/helpers"
        );
        const videoId = extractBilibiliVideoId(url);
        if (videoId) {
          logger.info("Fetching Bilibili avatar from API for video:", videoId);
          const axios = (await import("axios")).default;
          const isBvId = videoId.startsWith("BV");
          const apiUrl = isBvId
            ? `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`
            : `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace(
                "av",
                ""
              )}`;

          const response = await axios.get(apiUrl, {
            headers: {
              Referer: "https://www.bilibili.com",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
          });

          if (response.data?.data?.owner?.face) {
            authorAvatarUrl = response.data.data.owner.face;
            logger.info("Bilibili avatar URL from API:", authorAvatarUrl);
          }
        }
      } catch (apiError) {
        logger.warn("Failed to fetch Bilibili avatar from API:", apiError);
      }
    }

    logger.info("Bilibili avatar info:", {
      channel_avatar: metaSource.channel_avatar,
      uploader_avatar: metaSource.uploader_avatar,
      authorAvatarUrl: authorAvatarUrl,
    });

    // Prepare output path with a safe filename to avoid issues with special characters
    // Use a simple template that yt-dlp will fill in
    const outputTemplate = resolveSafeChildPath(tempDir, "video.%(ext)s");

    // Prepare download flags using the config module
    const { flags } = prepareBilibiliDownloadFlags(
      url,
      outputTemplate,
      retryFloorHeight != null ? { retryFloorHeight } : undefined
    );

    // Restrict the spawn to the first part when the URL resolved as a multipart
    // playlist, so yt-dlp does not merge every part into the single output
    // template (the source of the "Invalid data found" error above).
    if (isMultipartPlaylist) {
      flags.playlistItems = "1";
    }

    // Use spawn to capture stdout for progress
    const subprocess = executeYtDlpSpawn(url, flags);

    if (onStart) {
      onStart(async () => {
        logger.info("Killing subprocess for download:", downloadId);
        subprocess.kill();

        // Clean up partial files
        logger.info("Cleaning up partial files...");
        await cleanupFilesOnCancellation(
          preserveExistingOutputOnCancel ? undefined : videoPath,
          preserveExistingOutputOnCancel ? undefined : thumbnailPath,
          tempDir
        );
      });
    }

    // Track progress from stdout using ProgressTracker
    const progressTracker = new ProgressTracker(downloadId);
    subprocess.stdout?.on("data", (data: Buffer) => {
      progressTracker.parseAndUpdate(data.toString());
    });

    // Capture stderr for better error reporting
    let stderrOutput = "";
    subprocess.stderr?.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
      // Log stderr in real-time for debugging (filter out expected warnings)
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());
      for (const line of lines) {
        // Skip expected/informational messages
        if (
          line.includes("[download]") ||
          line.includes("[info]") ||
          line.includes("[ExtractAudio]") ||
          line.includes("[Merger]") ||
          line.includes("[BiliBili]") ||
          line.includes("Subtitles are only available when logged in") ||
          line.includes("Invalid data found when processing input")
        ) {
          continue;
        }
        logger.warn("yt-dlp stderr:", line);
      }
    });

    // Wait for download to complete
    let downloadError: any = null;
    try {
      await subprocess;
    } catch (error: any) {
      downloadError = error;
      // Only log as warning if it's an expected subtitle-related issue
      // "Invalid data found when processing input" is a real error, not expected
      const stderrMsg = error.stderr || "";
      const isExpectedSubtitleError = stderrMsg.includes(
        "Subtitles are only available when logged in"
      );
      if (isExpectedSubtitleError) {
        logger.warn("yt-dlp subtitle warning (continuing):", error.message);
      } else {
        logger.error("yt-dlp download failed:", error.message);
        if (error.stderr) {
          logger.error("yt-dlp error output:", error.stderr);
        }
      }
    }

    logger.info("Download completed, checking for video file");

    // Check if download was cancelled (it might have been removed from active downloads)
    // But only check this if we don't have a real yt-dlp error
    const downloader = new BilibiliDownloaderHelper();
    let wasCancelled = false;
    try {
      downloader.throwIfCancelledPublic(downloadId);
    } catch (error) {
      wasCancelled = true;
      // If we have a download error, prefer showing that over cancellation
      if (!downloadError) {
        if (pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
          await removeSafe(tempDir, VIDEOS_DIR);
        }
        throw error;
      }
    }

    // Check if file exists first
    const videoFile = findVideoFileInTemp(tempDir);

    // If there was a download error and no file was found, throw the error
    if (downloadError && !videoFile) {
      // Clean up temp directory
      await cleanupTempDir(tempDir);
      // If it was cancelled, throw cancellation error, otherwise throw the yt-dlp error
      if (wasCancelled) {
        throw DownloadCancelledError.create();
      }
      throw new Error(
        `yt-dlp download failed: ${
          downloadError.message || downloadError.stderr || "Unknown error"
        }`
      );
    }

    // If no file found and no error was caught, something went wrong
    if (!videoFile) {
      await cleanupTempDir(tempDir);
      const errorMsg = downloadError
        ? `Downloaded video file not found. yt-dlp error: ${
            downloadError.message
          }. stderr: ${(downloadError.stderr || "").substring(0, 500)}`
        : `Downloaded video file not found.`;
      throw new Error(errorMsg);
    }

    if (pathExistsSafeSync(tempDir, VIDEOS_DIR)) {
      const files = readdirSafeSync(tempDir, VIDEOS_DIR);
      logger.info("Files in temp directory:", files);
    }

    // If there was an error but we found the file, log a warning but continue
    if (downloadError) {
      logger.warn(
        "yt-dlp reported an error but file was downloaded successfully:",
        videoFile
      );
    }

    logger.info("Found video file:", videoFile);

    // Get final file size for progress update
    const tempVideoPath = resolveSafeChildPath(tempDir, videoFile);
    if (downloadId && pathExistsSafeSync(tempVideoPath, tempDir)) {
      const stats = statSafeSync(tempVideoPath, tempDir);
      const finalSize = formatBytes(stats.size);
      storageService.updateActiveDownload(downloadId, {
        downloadedSize: finalSize,
        totalSize: finalSize,
        progress: 100,
        speed: "0 B/s",
      });
    }

    // Move the file to the desired location
    moveVideoFile(tempDir, videoFile, videoPath);

    // Clean up temp directory
    await cleanupTempDir(tempDir);

    // Resolution verification + one bounded retry (issue #295 2-1). When a
    // preferred resolution is configured and the file came in below what the
    // source can offer, re-download once with a height floor before doing the
    // rest of the post-processing. retryFloorHeight is set on the retry itself,
    // which guarantees at most one extra attempt.
    if (retryFloorHeight === undefined) {
      let retryTarget: number | null = null;
      try {
        const preference = resolveResolutionPreference();
        if (preference.height != null) {
          const actualHeight = await getVideoHeight(videoPath);
          const availableHeights = extractAvailableHeights(rawSourceInfo);
          retryTarget = resolveResolutionRetryTarget(
            preference,
            actualHeight,
            availableHeights
          );
          if (retryTarget != null) {
            logger.info(
              `Bilibili download came in at ${
                actualHeight ?? "unknown"
              }p, below the preferred ${preference.height}p; retrying once with a >=${retryTarget}p floor.`
            );
          }
        }
      } catch (verifyError) {
        logger.warn(
          "Resolution verification failed; keeping the downloaded file:",
          verifyError
        );
        retryTarget = null;
      }

      if (retryTarget != null) {
        const retryResult = await downloadVideo(
          url,
          videoPath,
          thumbnailPath,
          downloadId,
          onStart,
          retryTarget,
          true
        );
        // Only adopt the retry when it actually produced a file. On failure the
        // first (lower-resolution but valid) file is still at videoPath, so keep
        // the original real metadata instead of the retry's generic fallback
        // object — otherwise a failed retry would save a mis-titled / mis-authored
        // video (issue #295 2-1 follow-up).
        if (retryResult && !retryResult.error) {
          return retryResult;
        }
        logger.warn(
          `Resolution retry to >=${retryTarget}p did not succeed (${
            retryResult?.error ?? "unknown error"
          }); keeping the original download and its metadata.`
        );
      }
    }

    // Download thumbnail if available
    let thumbnailSaved = false;
    if (thumbnailUrl) {
      // Use base class method via temporary instance
      let axiosConfig = {};
      if (userConfig.proxy) {
        try {
          axiosConfig = getAxiosProxyConfig(userConfig.proxy);
        } catch (error) {
          if (error instanceof InvalidProxyError) {
            logger.warn(
              "Invalid proxy configuration for thumbnail download, proceeding without proxy:",
              error.message
            );
          } else {
            throw error;
          }
        }
      }
      const downloader = new BilibiliDownloaderHelper();
      thumbnailSaved = await downloader.downloadThumbnailPublic(
        thumbnailUrl,
        thumbnailPath,
        axiosConfig
      );
    }

    // Download and process author avatar
    let authorAvatarSaved = false;
    let authorAvatarFilename: string | undefined = undefined;
    let authorAvatarPath: string | undefined = undefined;
    const platform = "bilibili";
    let authorAvatarPathResult: string | null = null;

    if (authorAvatarUrl) {
      logger.info("Downloading Bilibili author avatar from URL:", {
        url: authorAvatarUrl,
        author: videoAuthor,
        platform: platform,
      });

      let axiosConfig = {};
      if (userConfig.proxy) {
        try {
          axiosConfig = getAxiosProxyConfig(userConfig.proxy);
        } catch (error) {
          if (error instanceof InvalidProxyError) {
            logger.warn(
              "Invalid proxy configuration for avatar download, proceeding without proxy:",
              error.message
            );
          } else {
            throw error;
          }
        }
      }

      const downloader = new BilibiliDownloaderHelper();
      authorAvatarPathResult = await downloadAndProcessAvatar(
        authorAvatarUrl,
        platform,
        videoAuthor,
        downloader.downloadThumbnailPublic.bind(downloader),
        axiosConfig
      );
      authorAvatarSaved = authorAvatarPathResult !== null;
    } else {
      logger.info(
        "No Bilibili author avatar URL available, skipping avatar download"
      );
    }

    if (authorAvatarPathResult) {
      authorAvatarFilename = path.basename(authorAvatarPathResult);
      authorAvatarPath = `/avatars/${authorAvatarFilename}`;
    }

    return {
      title: videoTitle,
      author: videoAuthor,
      date: videoDate,
      thumbnailUrl: thumbnailUrl,
      thumbnailSaved,
      description,
      authorAvatarUrl: authorAvatarUrl || null,
      authorAvatarSaved,
      authorAvatarFilename: authorAvatarFilename,
      authorAvatarPath: authorAvatarPath,
    };
  } catch (error: any) {
    logger.error("Error in downloadBilibiliVideo:", error);

    // Make sure we clean up the temp directory if it exists
    await cleanupTempDir(tempDir);

    // Return a default object to prevent undefined errors
    return {
      title: "Bilibili Video",
      author: "Bilibili User",
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: null,
      thumbnailSaved: false,
      error: error.message,
    };
  }
}

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
  filenameTemplateSourceOptions?: FilenameTemplateSourceOptions
): Promise<DownloadResult> {
  try {
    logger.info(
      `Downloading Bilibili part ${partNumber}/${totalParts}: ${url}`
    );

    // Get user's yt-dlp configuration for merge output format
    const userConfig = getUserYtDlpConfig(url);
    const mergeOutputFormat = userConfig.mergeOutputFormat || "mp4";
    const settings = storageService.getSettings();
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
        onStart
      );
    } catch (error: any) {
      // If download was cancelled, re-throw immediately without downloading subtitles or creating video data
      const downloader = new BilibiliDownloaderHelper();
      downloader.handleCancellationErrorPublic(error);
      throw error;
    }

    if (!bilibiliInfo) {
      throw new Error("Failed to get Bilibili video info");
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
      mergeOutputFormat,
      videoPath,
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

    // Get video duration and file size using metadata module
    const duration = await getVideoDuration(newVideoPath);
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

    // Download subtitles
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
      const existingVideo = storageService.getVideoBySourceUrl(url);

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
          title: videoData.title, // Update title in case it changed
          description: videoData.description, // Update description in case it changed
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
  } catch (error: any) {
    logger.error(
      `Error downloading Bilibili part ${partNumber}/${totalParts}:`,
      error
    );
    return { success: false, error: error.message };
  }
}
