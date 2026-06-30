import path from "path";
import { getErrorMessage } from "../../../utils/errors";
import { VIDEOS_DIR } from "../../../config/paths";
import { DownloadCancelledError } from "../../../errors/DownloadErrors";
import { downloadAndProcessAvatar } from "../../../utils/avatarUtils";
import { formatBytes } from "../../../utils/downloadUtils";
import { logger } from "../../../utils/logger";
import { ProgressTracker } from "../../../utils/progressTracker";
import {
  pathExistsSafeSync,
  readdirSafeSync,
  removeSafe,
  resolveSafeChildPath,
  statSafeSync,
} from "../../../utils/security";
import {
  executeYtDlpJson,
  executeYtDlpSpawn,
  getAxiosProxyConfig,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
  InvalidProxyError,
} from "../../../utils/ytDlpUtils";
import * as storageService from "../../storageService";
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
} from "./bilibiliFileManager";
import { getVideoHeight } from "./bilibiliMetadata";
import { BilibiliVideoInfo } from "./types";
import {
  BilibiliDownloaderHelper,
  extractAvailableHeights,
  formatYtDlpFailureMessage,
} from "./bilibiliVideoHelpers";

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
      await Promise.resolve(subprocess).finally(() => progressTracker.dispose());
    } catch (error: unknown) {
      downloadError = error;
      const e = error as { stderr?: string };
      // Only log as warning if it's an expected subtitle-related issue
      // "Invalid data found when processing input" is a real error, not expected
      const stderrMsg = e.stderr || "";
      const isExpectedSubtitleError = stderrMsg.includes(
        "Subtitles are only available when logged in"
      );
      if (isExpectedSubtitleError) {
        logger.warn("yt-dlp subtitle warning (continuing):", getErrorMessage(error));
      } else {
        logger.error("yt-dlp download failed:", getErrorMessage(error));
        if (e.stderr) {
          logger.error("yt-dlp error output:", e.stderr);
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
        `yt-dlp download failed: ${formatYtDlpFailureMessage(downloadError)}`
      );
    }

    // If no file found and no error was caught, something went wrong. With
    // `ignoreErrors: true` yt-dlp can exit 0 after silently skipping a rejected
    // download, so a Bilibili 412/-352 rejection lands here with no
    // downloadError and the risk-control text only in the captured stderr. Fold
    // that stderr into the failure so isLikelyBilibiliAuthFailure can still
    // classify it and drive the collection backoff / cookie-refresh hint
    // (issue #295).
    if (!videoFile) {
      await cleanupTempDir(tempDir);
      const failureSource =
        downloadError ??
        (stderrOutput.trim() ? { stderr: stderrOutput } : null);
      const errorMsg = failureSource
        ? `Downloaded video file not found. yt-dlp error: ${
            formatYtDlpFailureMessage(failureSource)
          }`
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
  } catch (error: unknown) {
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
      error: formatYtDlpFailureMessage(error),
    };
  }
}
