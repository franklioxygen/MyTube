import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../db";
import { subscriptions } from "../../db/schema";
import { ValidationError } from "../../errors/DownloadErrors";
import {
  extractTwitchChannelLogin,
  normalizeTwitchChannelUrl,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";
import { downloadYouTubeVideo } from "../downloadService";
import {
  getTwitchChannelVideos,
  TwitchYtDlpVideoEntry,
} from "../downloaders/ytdlp/ytdlpTwitch";
import { platformFromUrl } from "../statistics";
import * as storageService from "../storageService";
import { TwitchVideoInfo, twitchApiService } from "../twitchService";
import {
  MAX_TWITCH_SUBSCRIPTION_DOWNLOADS_PER_CHECK,
  MAX_TWITCH_SUBSCRIPTION_PAGES_PER_CHECK,
  MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS,
  RETRYABLE_TWITCH_API_ERROR_CODES,
} from "./constants";
import {
  buildFilenameTemplateSourceOptions,
  getErrorMessage,
  getSubscriptionLogContext,
  notifySubscriptionDownloadResult,
} from "./helpers";
import { Subscription } from "./types";

export function shouldFallbackToTwitchYtDlp(error: unknown): boolean {
  if (error instanceof ValidationError) {
    return (
      error.field === "twitchClientId" || error.field === "twitchClientSecret"
    );
  }

  if (error && typeof error === "object") {
    const errorWithResponse = error as {
      code?: unknown;
      message?: unknown;
      request?: unknown;
      response?: { status?: unknown };
    };

    if (typeof errorWithResponse.response?.status === "number") {
      return true;
    }

    if (
      typeof errorWithResponse.code === "string" &&
      RETRYABLE_TWITCH_API_ERROR_CODES.has(errorWithResponse.code)
    ) {
      return true;
    }

    if (errorWithResponse.request !== undefined) {
      return true;
    }
  }

  return (
    error instanceof Error &&
    error.message.includes("Twitch API is temporarily rate limited")
  );
}

export function isEligibleTwitchVideo(video: TwitchVideoInfo): boolean {
  return video.type === "archive" || video.type === "upload";
}

export async function checkTwitchSubscription(sub: Subscription): Promise<number> {
  const now = Date.now();
  const lockResult = await db
    .update(subscriptions)
    .set({ lastCheck: now })
    .where(eq(subscriptions.id, sub.id))
    .returning({ id: subscriptions.id });

  if (lockResult.length === 0) {
    logger.warn(
      "Twitch subscription was deleted before polling",
      getSubscriptionLogContext(sub)
    );
    return 0;
  }

  if (!twitchApiService.isConfigured()) {
    return await checkTwitchSubscriptionWithYtDlp(sub);
  }

  try {
    return await checkTwitchSubscriptionWithApi(sub);
  } catch (error) {
    if (!shouldFallbackToTwitchYtDlp(error)) {
      throw error;
    }

    logger.warn(
      "Falling back to yt-dlp for Twitch subscription after Helix polling failed",
      error instanceof Error ? error : new Error(String(error)),
      getSubscriptionLogContext(sub)
    );
    return await checkTwitchSubscriptionWithYtDlp(sub);
  }
}

async function checkTwitchSubscriptionWithApi(
  sub: Subscription
): Promise<number> {
  twitchApiService.ensureConfigured();

  let channel = sub.twitchBroadcasterId
    ? await twitchApiService.getChannelById(sub.twitchBroadcasterId)
    : null;

  if (!channel) {
    const channelLogin =
      sub.twitchBroadcasterLogin || extractTwitchChannelLogin(sub.authorUrl);
    if (!channelLogin) {
      throw new ValidationError(
        `Invalid Twitch channel URL: ${sub.authorUrl}`,
        "authorUrl"
      );
    }
    channel = await twitchApiService.getChannelByLogin(channelLogin);
  }

  if (!channel) {
    logger.warn(
      `Twitch channel for subscription ${sub.id} could not be resolved`
    );
    return 0;
  }

  await db
    .update(subscriptions)
    .set({
      author: channel.displayName,
      authorUrl: channel.url,
      twitchBroadcasterId: channel.id,
      twitchBroadcasterLogin: channel.login,
    })
    .where(eq(subscriptions.id, sub.id));

  const unseenVideos: TwitchVideoInfo[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let scannedVideos = 0;
  let foundMarker = false;

  while (
    pagesFetched < MAX_TWITCH_SUBSCRIPTION_PAGES_PER_CHECK &&
    scannedVideos < MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
  ) {
    const response = await twitchApiService.listVideosByBroadcaster(
      channel.id,
      {
        after: cursor,
        first: 100,
        type: "all",
      }
    );
    pagesFetched += 1;

    if (response.videos.length === 0) {
      break;
    }

    for (const video of response.videos) {
      scannedVideos += 1;

      if (!isEligibleTwitchVideo(video)) {
        if (scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS) {
          break;
        }
        continue;
      }

      if (sub.lastTwitchVideoId && video.id === sub.lastTwitchVideoId) {
        foundMarker = true;
        break;
      }

      unseenVideos.push(video);
      if (scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS) {
        break;
      }
    }

    if (
      foundMarker ||
      !response.cursor ||
      scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
    ) {
      break;
    }

    cursor = response.cursor;
  }

  if (unseenVideos.length === 0) {
    return 0;
  }

  return await processTwitchSubscriptionVideos(
    sub,
    unseenVideos
      .reverse()
      .slice(0, MAX_TWITCH_SUBSCRIPTION_DOWNLOADS_PER_CHECK)
      .map((video) => ({
      id: video.id,
      url: video.url,
      title: video.title,
      authorName: video.userName || channel.displayName,
    }))
  );
}

async function checkTwitchSubscriptionWithYtDlp(
  sub: Subscription
): Promise<number> {
  const fallbackLogin =
    sub.twitchBroadcasterLogin || extractTwitchChannelLogin(sub.authorUrl);
  if (!fallbackLogin) {
    throw new ValidationError(
      `Invalid Twitch channel URL: ${sub.authorUrl}`,
      "authorUrl"
    );
  }

  const normalizedUrl = normalizeTwitchChannelUrl(sub.authorUrl);
  const unseenVideos: TwitchYtDlpVideoEntry[] = [];
  let pagesFetched = 0;
  let scannedVideos = 0;
  let foundMarker = false;
  let resolvedAuthor = sub.author;
  let resolvedLogin = sub.twitchBroadcasterLogin || fallbackLogin;

  while (
    pagesFetched < MAX_TWITCH_SUBSCRIPTION_PAGES_PER_CHECK &&
    scannedVideos < MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
  ) {
    const response = await getTwitchChannelVideos(normalizedUrl, {
      startIndex: pagesFetched * 100,
      limit: 100,
      subscriptionYtdlpConfig: sub.ytdlpConfig,
    });
    pagesFetched += 1;

    if (response.channelName) {
      resolvedAuthor = response.channelName;
    }
    if (response.channelLogin) {
      resolvedLogin = response.channelLogin;
    }

    if (pagesFetched === 1) {
      await db
        .update(subscriptions)
        .set({
          author: resolvedAuthor,
          authorUrl: normalizedUrl,
          twitchBroadcasterLogin: resolvedLogin,
        })
        .where(eq(subscriptions.id, sub.id));
    }

    if (response.videos.length === 0) {
      break;
    }

    for (const video of response.videos) {
      scannedVideos += 1;

      if (sub.lastTwitchVideoId && video.id === sub.lastTwitchVideoId) {
        foundMarker = true;
        break;
      }

      unseenVideos.push(video);
      if (scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS) {
        break;
      }
    }

    if (
      foundMarker ||
      response.videos.length < 100 ||
      scannedVideos >= MAX_TWITCH_SUBSCRIPTION_SCANNED_VIDEOS
    ) {
      break;
    }
  }

  if (unseenVideos.length === 0) {
    return 0;
  }

  return await processTwitchSubscriptionVideos(
    sub,
    unseenVideos
      .reverse()
      .slice(0, MAX_TWITCH_SUBSCRIPTION_DOWNLOADS_PER_CHECK)
      .map((video) => ({
      id: video.id,
      url: video.url,
      title: video.title,
      authorName: video.author || resolvedAuthor,
    }))
  );
}

export async function processTwitchSubscriptionVideos(
  sub: Subscription,
  videosToProcess: Array<{
    id: string;
    url: string;
    title: string;
    authorName?: string | null;
  }>
): Promise<number> {
  let currentLastVideoLink = sub.lastVideoLink || "";
  let currentLastTwitchVideoId = sub.lastTwitchVideoId;
  let currentDownloadCount = sub.downloadCount || 0;
  let newVideoCount = 0;

  for (const video of videosToProcess) {
    const existingDownload = storageService.checkVideoDownloadBySourceId(
      video.id,
      "twitch"
    );

    if (existingDownload.found) {
      currentLastTwitchVideoId = video.id;
      currentLastVideoLink = video.url;

      await db
        .update(subscriptions)
        .set({
          lastTwitchVideoId: currentLastTwitchVideoId,
          lastVideoLink: currentLastVideoLink,
        })
        .where(eq(subscriptions.id, sub.id));
      continue;
    }

    let twitchVideoDownloaded = false;
    let downloadedTwitchTitle = video.title || `Video from ${sub.author}`;
    try {
      const downloadResult = await downloadYouTubeVideo(video.url, {
        filenameTemplateSourceOptions:
          buildFilenameTemplateSourceOptions(sub),
        subscriptionYtdlpConfig: sub.ytdlpConfig,
        subscriptionFilenameTemplate: sub.filenameTemplate,
      });
      const videoData = downloadResult?.videoData || downloadResult || {};
      downloadedTwitchTitle = videoData.title || video.title;
      twitchVideoDownloaded = true;

      storageService.addDownloadHistoryItem({
        id: uuidv4(),
        title: downloadedTwitchTitle,
        author: videoData.author || video.authorName || sub.author,
        sourceUrl: video.url,
        finishedAt: Date.now(),
        status: "success",
        videoPath: videoData.videoPath,
        thumbnailPath: videoData.thumbnailPath,
        videoId: videoData.id,
        subscriptionId: sub.id,
        platform: platformFromUrl(video.url),
        sourceKind: "subscription",
        totalSize:
          typeof videoData.fileSize === "string" ||
          typeof videoData.fileSize === "number"
            ? String(videoData.fileSize)
            : undefined,
      });
      newVideoCount += 1;

      currentLastTwitchVideoId = video.id;
      currentLastVideoLink = video.url;
      currentDownloadCount += 1;

      const updateResult = await db
        .update(subscriptions)
        .set({
          lastTwitchVideoId: currentLastTwitchVideoId,
          lastVideoLink: currentLastVideoLink,
          downloadCount: currentDownloadCount,
        })
        .where(eq(subscriptions.id, sub.id))
        .returning({ id: subscriptions.id });

      if (updateResult.length === 0) {
        logger.warn(
          "Twitch subscription was deleted after download completed",
          getSubscriptionLogContext(sub, { latestVideoUrl: video.url })
        );
        break;
      }

      notifySubscriptionDownloadResult({
        taskTitle: downloadedTwitchTitle,
        status: "success",
        sourceUrl: video.url,
      });
    } catch (downloadError: unknown) {
      const errorMessage = getErrorMessage(downloadError, "Download failed");

      if (twitchVideoDownloaded) {
        logger.error(
          "Error updating Twitch subscription after video download",
          downloadError,
          getSubscriptionLogContext(sub, { latestVideoUrl: video.url })
        );

        notifySubscriptionDownloadResult({
          taskTitle: downloadedTwitchTitle,
          status: "fail",
          sourceUrl: video.url,
          error: `Subscription processing failed after download: ${errorMessage}`,
        });
        break;
      }

      logger.error(
        "Error downloading Twitch subscription video",
        downloadError,
        getSubscriptionLogContext(sub, { latestVideoUrl: video.url })
      );
      storageService.addDownloadHistoryItem({
        id: uuidv4(),
        title: video.title || `Video from ${sub.author}`,
        author: video.authorName || sub.author,
        sourceUrl: video.url,
        finishedAt: Date.now(),
        status: "failed",
        error: errorMessage,
        subscriptionId: sub.id,
        platform: platformFromUrl(video.url),
        sourceKind: "subscription",
      });
      notifySubscriptionDownloadResult({
        taskTitle: video.title || `Video from ${sub.author}`,
        status: "fail",
        sourceUrl: video.url,
        error: errorMessage,
      });
      break;
    }
  }

  return newVideoCount;
}
