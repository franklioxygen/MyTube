import { Request, Response } from "express";
import {
    createAdminTrustLevelError,
    isAdminTrustLevelAtLeast,
} from "../config/adminTrust";
import { getErrorMessage } from "../utils/errors";
import { DuplicateError, NotFoundError, ValidationError } from "../errors/DownloadErrors";
import { continuousDownloadService } from "../services/continuousDownloadService";
import { DownloadOrder } from "../services/continuousDownload/types";
import { checkPlaylist } from "../services/downloadService";
import * as storageService from "../services/storageService";
import { subscriptionService } from "../services/subscriptionService";
import {
    isBilibiliUrl,
    isTwitchChannelUrl,
    isYouTubeUrl,
    normalizeTwitchChannelUrl,
    normalizeYouTubeAuthorUrl,
} from "../utils/helpers";
import { logger } from "../utils/logger";
import { successMessage } from "../utils/response";
import {
    executeYtDlpJson,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
} from "../utils/ytDlpUtils";
import { getPositiveIntegerParam, getStringParam } from "../utils/paramUtils";
import { runWithConcurrencyLimit } from "../utils/concurrency";
import {
    detectPlaylistPlatform,
    deriveChannelName,
    deleteCreatedCollectionIfUnused,
    extractYouTubePlaylistId,
    resolveBilibiliPlaylistCollectionWithStatus,
    resolveChannelPlaylistCollectionWithStatus,
    resolvePlaylistCollectionWithStatus,
    sanitizePlaylistTitle,
    toPlaylistsTabUrl,
} from "../services/subscription/playlistResolution";
import { normalizeSubscriptionFilenameTemplate } from "../services/subscription/filenameTemplate";
import {
    getPlaylistHeadSnapshot,
    inspectBilibiliCollectionPlaylist,
    inspectPlaylist,
} from "../services/subscription/playlistFeed";
import type { BilibiliCollectionSource } from "../services/subscription/playlistFeed";
import type { SubscribePlaylistOptions } from "../services/subscriptionService";

// Per-subscription yt-dlp config override (issue #345). Same free-text format
// and trust requirement ("container") as the global ytDlpConfig setting.
const MAX_YTDLP_CONFIG_LENGTH = 4096;

/**
 * Validate and normalize a raw ytdlp_config value from the request body.
 * Accepts a string or null; treats empty/whitespace as "cleared" (null).
 * Throws ValidationError on wrong type or excessive length.
 */
function normalizeYtdlpConfigInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new ValidationError(
      "ytdlpConfig must be a string or null",
      "ytdlpConfig"
    );
  }
  if (raw.length > MAX_YTDLP_CONFIG_LENGTH) {
    throw new ValidationError(
      `ytdlpConfig must be at most ${MAX_YTDLP_CONFIG_LENGTH} characters`,
      "ytdlpConfig"
    );
  }
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Enforce the "container" admin-trust requirement for a ytdlp_config change.
 * Returns true if the request may proceed. When trust is insufficient and the
 * value actually changes, responds 403 and returns false; an unchanged value is
 * treated as a no-op (proceed) — mirroring the global setting's trust gating.
 */
function ensureYtdlpConfigTrust(
  res: Response,
  nextValue: string | null,
  existingValue: string | null
): boolean {
  if (isAdminTrustLevelAtLeast("container")) {
    return true;
  }
  const normalizedExisting = normalizeYtdlpConfigInput(existingValue);
  if (nextValue === normalizedExisting) {
    return true;
  }
  res.status(403).json(createAdminTrustLevelError("container"));
  return false;
}

function canReadYtdlpConfigOverride(req: Request): boolean {
  if (!isAdminTrustLevelAtLeast("container")) {
    return false;
  }
  if (req.apiKeyAuthenticated === true) {
    return false;
  }
  return req.user?.role !== "visitor";
}

/**
 * Backfill outcome for a playlist subscription response (design §7.1).
 * `taskId` alone cannot distinguish an intentionally omitted zero-length
 * backfill from a task-creation failure, so this explicit status lets the UI
 * report each outcome accurately.
 */
export type PlaylistBackfillStatus =
  | "not_requested"
  | "started"
  | "already_exists"
  | "not_needed_empty"
  | "failed";

/**
 * Strictly parse the `downloadAll` request value (design §11.1).
 *
 * The existing boolean already has the exact required API meaning: whether to
 * create a historical task. Normalize once here so:
 * - missing `downloadAll` normalizes to `false` (subscribe-only) for
 *   compatibility (F10);
 * - a non-boolean value (string "false", 0, object, null) is rejected rather
 *   than treated as truthy/falsy.
 */
function parseDownloadAll(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new ValidationError("downloadAll must be a boolean", "downloadAll");
  }
  return value;
}

/**
 * Validate the trusted-looking `collectionInfo` shape for Bilibili
 * collections/series (design §7.1 / §12.2). Returns a normalized object or
 * null. The server uses this for title/count/IDs only; baseline capture still
 * requires a real source probe.
 */
function parseBilibiliCollectionInfo(
  value: unknown
): {
  type: "collection" | "series";
  id: string | number;
  mid?: string | number;
  title: string;
  count: number;
} | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    throw new ValidationError(
      "collectionInfo must be an object",
      "collectionInfo"
    );
  }
  const info = value as Record<string, unknown>;
  if (info.type !== "collection" && info.type !== "series") {
    throw new ValidationError(
      "collectionInfo.type must be collection or series",
      "collectionInfo"
    );
  }
  if (info.id === undefined) {
    throw new ValidationError(
      "collectionInfo.id is required for collection/series",
      "collectionInfo"
    );
  }
  return {
    type: info.type,
    id: info.id as string | number,
    mid: info.mid as string | number | undefined,
    title: typeof info.title === "string" ? info.title : String(info.title ?? ""),
    count:
      typeof info.count === "number"
        ? info.count
        : parseInt(String(info.count ?? "0"), 10) || 0,
  };
}

function saveBilibiliCollectionSourceIfCompatible(
  collection: storageService.Collection,
  source: { type: "collection" | "series"; id: number; mid: number }
): storageService.Collection | null {
  const sourceKey = {
    sourcePlatform: "bilibili",
    sourceType: source.type,
    sourceMid: String(source.mid),
    sourceId: String(source.id),
  };
  const hasSourceKey = Boolean(
    collection.sourcePlatform ||
      collection.sourceType ||
      collection.sourceMid ||
      collection.sourceId
  );
  const matchesSourceKey =
    collection.sourcePlatform === sourceKey.sourcePlatform &&
    collection.sourceType === sourceKey.sourceType &&
    collection.sourceMid === sourceKey.sourceMid &&
    collection.sourceId === sourceKey.sourceId;

  if (matchesSourceKey) {
    return collection;
  }
  if (!hasSourceKey) {
    const updatedCollection = { ...collection, ...sourceKey };
    storageService.saveCollection(updatedCollection);
    return updatedCollection;
  }
  return null;
}

function hasBilibiliCollectionSource(
  inspection: object
): inspection is { bilibiliSource: BilibiliCollectionSource } {
  const source = (inspection as { bilibiliSource?: unknown }).bilibiliSource;
  if (!source || typeof source !== "object") return false;
  const candidate = source as Partial<BilibiliCollectionSource>;
  return (
    (candidate.type === "collection" || candidate.type === "series") &&
    typeof candidate.id === "number" &&
    typeof candidate.mid === "number"
  );
}

async function refreshExistingPlaylistSubscriptionCursor(
  subscription: Awaited<ReturnType<typeof subscriptionService.listSubscriptions>>[number],
  headVideoUrl: string,
  observedAt: number,
  context: string
): Promise<typeof subscription> {
  try {
    await subscriptionService.updatePlaylistSubscriptionCursor(
      subscription.id,
      headVideoUrl,
      observedAt
    );
    return {
      ...subscription,
      lastVideoLink: headVideoUrl,
      lastCheck: observedAt,
    };
  } catch (error) {
    logger.error(
      `Failed to update playlist subscription cursor after starting ${context}`,
      error instanceof Error ? error : new Error(String(error))
    );
    return subscription;
  }
}

/**
 * Create a new subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const createSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url, interval, authorName, downloadAllPrevious, downloadShorts: rawDownloadShorts, downloadOrder: rawDownloadOrder } =
    req.body;
  const downloadShorts = Boolean(rawDownloadShorts);

  // Per-subscription yt-dlp override (issue #345). Trust-gated; empty => null.
  const ytdlpConfig = normalizeYtdlpConfigInput(req.body.ytdlpConfig);
  if (!ensureYtdlpConfigTrust(res, ytdlpConfig, null)) {
    return;
  }

  // Per-subscription filename-template override (issue #368). Not secret, not
  // trust-gated. Blank/whitespace => null (inherit global naming). Channels and
  // Twitch subscriptions use the "channel" source-collection type for warnings.
  const filenameTemplate = normalizeSubscriptionFilenameTemplate(
    req.body.filenameTemplate,
    "channel"
  );

  const validDownloadOrders: DownloadOrder[] = ["dateDesc", "dateAsc", "viewsDesc", "viewsAsc"];
  let downloadOrder: DownloadOrder = "dateDesc";
  if (downloadAllPrevious === true) {
    if (rawDownloadOrder !== undefined && rawDownloadOrder !== null) {
      if (!validDownloadOrders.includes(rawDownloadOrder)) {
        throw new ValidationError(`Invalid downloadOrder: must be one of ${validDownloadOrders.join(", ")}`, "downloadOrder");
      }
      downloadOrder = rawDownloadOrder as DownloadOrder;
    }
  }

  logger.info("Creating subscription:", {
    url,
    interval,
    authorName,
    downloadAllPrevious,
    downloadShorts,
    downloadOrder,
  });

  if (!url || !interval) {
    throw new ValidationError("URL and interval are required", "body");
  }

  const normalizedUrl = isTwitchChannelUrl(url)
    ? normalizeTwitchChannelUrl(url)
    : normalizeYouTubeAuthorUrl(url);

  const subscription = await subscriptionService.subscribe(
    normalizedUrl,
    parseInt(interval),
    authorName,
    downloadShorts,
    ytdlpConfig,
    filenameTemplate
  );

  // If user wants to download all previous videos, create a continuous download task
  if (downloadAllPrevious === true) {
    try {
      await continuousDownloadService.createTask(
        normalizedUrl,
        subscription.author,
        subscription.platform,
        subscription.id,
        downloadOrder
      );
      logger.info(
        `Created continuous download task for subscription ${subscription.id}`
      );

      // If user also wants to download previous Shorts (YouTube only)
      if (
        downloadShorts &&
        (subscription.platform === "YouTube" ||
          isYouTubeUrl(normalizedUrl))
      ) {
        // Create a separate task for Shorts with /shorts appended to URL
        let shortsUrl = normalizedUrl;
        if (shortsUrl.endsWith("/")) {
          shortsUrl = `${shortsUrl}shorts`;
        } else {
          shortsUrl = `${shortsUrl}/shorts`;
        }

        await continuousDownloadService.createTask(
          shortsUrl,
          `${subscription.author} (Shorts)`,
          subscription.platform,
          subscription.id,
          downloadOrder
        );
        logger.info(
          `Created continuous download task for Shorts for subscription ${subscription.id}`
        );
      }
    } catch (error) {
      logger.error(
        "Error creating continuous download task:",
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't fail the subscription creation if task creation fails
    }
  }

  // Return subscription object directly for backward compatibility
  res.status(201).json(subscription);
};

/**
 * Get all subscriptions
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getSubscriptions = async (
  req: Request,
  res: Response
): Promise<void> => {
  const subscriptions = await subscriptionService.listSubscriptions();
  if (!canReadYtdlpConfigOverride(req)) {
    const redactedSubscriptions = subscriptions.map(
      ({ ytdlpConfig, ...subscription }) => subscription
    );
    res.json(redactedSubscriptions);
    return;
  }

  // Return array directly for backward compatibility (frontend expects response.data to be Subscription[])
  res.json(subscriptions);
};

/**
 * Delete a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await subscriptionService.unsubscribe(id);
  res.status(200).json(successMessage("Subscription deleted"));
};

/**
 * Pause a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const pauseSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await subscriptionService.pauseSubscription(id);
  res.status(200).json(successMessage("Subscription paused"));
};

export const updateSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  const hasInterval = Object.prototype.hasOwnProperty.call(
    req.body,
    "interval"
  );
  const hasRetentionDays = Object.prototype.hasOwnProperty.call(
    req.body,
    "retentionDays"
  );
  const hasYtdlpConfig = Object.prototype.hasOwnProperty.call(
    req.body,
    "ytdlpConfig"
  );
  const hasFilenameTemplate = Object.prototype.hasOwnProperty.call(
    req.body,
    "filenameTemplate"
  );

  if (
    !hasInterval &&
    !hasRetentionDays &&
    !hasYtdlpConfig &&
    !hasFilenameTemplate
  ) {
    throw new ValidationError(
      "At least one subscription setting is required",
      "body"
    );
  }

  let parsedInterval: number | undefined;
  if (hasInterval) {
    const parsed = getPositiveIntegerParam(req.body.interval);
    if (parsed === undefined) {
      throw new ValidationError(
        "Interval must be a positive integer",
        "interval"
      );
    }
    parsedInterval = parsed;
  }

  let retentionDays: number | null | undefined;
  if (hasRetentionDays) {
    const rawRetentionDays = req.body.retentionDays;
    if (rawRetentionDays === null || rawRetentionDays === "") {
      retentionDays = null;
    } else {
      const parsed = getPositiveIntegerParam(rawRetentionDays);
      if (parsed === undefined) {
        throw new ValidationError(
          "retentionDays must be a positive integer or null",
          "retentionDays"
        );
      }
      retentionDays = parsed;
    }
  }

  const updates: {
    interval?: number;
    retentionDays?: number | null;
    ytdlpConfig?: string | null;
    filenameTemplate?: string | null;
  } = {};
  if (parsedInterval !== undefined) {
    updates.interval = parsedInterval;
  }
  if (retentionDays !== undefined) {
    updates.retentionDays = retentionDays;
  }

  // Resolve the existing subscription once for the ytdlp_config trust check and
  // the filename-template validation source type. Both are skipped when not
  // present in the request body.
  let existingForOverride: Awaited<
    ReturnType<typeof subscriptionService.getSubscriptionById>
  > | undefined;
  if (hasYtdlpConfig || hasFilenameTemplate) {
    existingForOverride = await subscriptionService.getSubscriptionById(id);
    if (!existingForOverride) {
      // Keep the same not-found behavior as updateSubscriptionSettings. The
      // preliminary read is needed only to validate override-specific fields.
      throw NotFoundError.subscription(id);
    }
  }

  if (hasYtdlpConfig) {
    const nextYtdlpConfig = normalizeYtdlpConfigInput(req.body.ytdlpConfig);
    const existing = existingForOverride!;
    if (!ensureYtdlpConfigTrust(res, nextYtdlpConfig, existing.ytdlpConfig ?? null)) {
      return;
    }
    // Only persist when the value actually changes (keeps below-trust no-ops out
    // of the update payload so updateSubscriptionSettings never sees an empty set
    // just because an unchanged override was echoed back).
    if (nextYtdlpConfig !== (existing.ytdlpConfig ?? null)) {
      updates.ytdlpConfig = nextYtdlpConfig;
    }
  }

  if (hasFilenameTemplate) {
    // Not secret and not trust-gated. Warnings depend on the subscription type:
    // playlists and channel-playlists watchers validate as "playlist", others as
    // "channel".
    const existing = existingForOverride!;
    const isPlaylistLike =
      existing.subscriptionType === "playlist" ||
      existing.subscriptionType === "channel_playlists";
    const nextFilenameTemplate = normalizeSubscriptionFilenameTemplate(
      req.body.filenameTemplate,
      isPlaylistLike ? "playlist" : "channel"
    );
    if (nextFilenameTemplate !== (existing.filenameTemplate ?? null)) {
      updates.filenameTemplate = nextFilenameTemplate;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(200).json(successMessage("Subscription updated"));
    return;
  }

  await subscriptionService.updateSubscriptionSettings(id, updates);

  res.status(200).json(successMessage("Subscription updated"));
};

/**
 * Resume a subscription
 * Errors are automatically handled by asyncHandler middleware
 */
export const resumeSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await subscriptionService.resumeSubscription(id);
  res.status(200).json(successMessage("Subscription resumed"));
};

/**
 * Get all continuous download tasks
 * Errors are automatically handled by asyncHandler middleware
 */
export const getContinuousDownloadTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tasks = await continuousDownloadService.getAllTasks();
  res.json(tasks);
};

/**
 * Cancel a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const cancelContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await continuousDownloadService.cancelTask(id);
  res.status(200).json(successMessage("Task cancelled"));
};

/**
 * Delete a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await continuousDownloadService.deleteTask(id);
  res.status(200).json(successMessage("Task deleted"));
};

/**
 * Pause a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const pauseContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await continuousDownloadService.pauseTask(id);
  res.status(200).json(successMessage("Task paused"));
};

/**
 * Resume a continuous download task
 * Errors are automatically handled by asyncHandler middleware
 */
export const resumeContinuousDownloadTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = getStringParam(req.params.id) ?? "";
  await continuousDownloadService.resumeTask(id);
  res.status(200).json(successMessage("Task resumed"));
};

/**
 * Clear all finished continuous download tasks
 * Errors are automatically handled by asyncHandler middleware
 */
export const clearFinishedTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  await continuousDownloadService.clearFinishedTasks();
  res.status(200).json(successMessage("Finished tasks cleared"));
};

/**
 * Create a playlist subscription (and optionally download all videos).
 *
 * Baseline-first sequencing (design §7.1 / §7.3 / §7.5):
 *   1. Parse + validate scalar request values.
 *   2. Normalize/detect platform and playlist ID.
 *   3. Reject subscribe-only duplicates before any persistent side effect.
 *   4. Inspect playlist metadata and capture the current head as baseline.
 *   5. Resolve/create the destination collection.
 *   6. Insert the subscription with the captured head + observation time.
 *   7. Optionally create a linked historical task.
 *   8. Return a typed, self-describing response.
 *
 * If the baseline probe fails, no subscription/collection/task is created
 * (fail-closed, design §7.5 / F9).
 *
 * Errors are automatically handled by asyncHandler middleware.
 */
export const createPlaylistSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { playlistUrl, collectionName, collectionInfo: rawCollectionInfo } =
    req.body;

  // 1a. Strict interval validation: positive safe integer (design §7.1).
  const interval = getPositiveIntegerParam(req.body.interval);
  if (interval === undefined) {
    throw new ValidationError(
      "Playlist URL, interval, and collection name are required",
      "body"
    );
  }
  if (!playlistUrl || !collectionName) {
    throw new ValidationError(
      "Playlist URL, interval, and collection name are required",
      "body"
    );
  }

  // 1b. Strict downloadAll parsing (design §11.1). Missing => subscribe-only.
  const downloadAll = parseDownloadAll(req.body.downloadAll);

  // Validate Bilibili collectionInfo shape when provided (design §7.1 / §12.2).
  const collectionInfo = parseBilibiliCollectionInfo(rawCollectionInfo);

  logger.info("Creating playlist subscription:", {
    playlistUrl,
    interval,
    collectionName,
    downloadAll,
    collectionInfo,
  });

  // Per-subscription filename-template override (issue #368). Playlists use the
  // "playlist" source-collection type for validation warnings. Keep omitted
  // distinct from explicit blank/null so duplicate backfill requests do not
  // accidentally clear an existing subscription override.
  const hasFilenameTemplate = Object.prototype.hasOwnProperty.call(
    req.body,
    "filenameTemplate"
  );
  const filenameTemplate = hasFilenameTemplate
    ? normalizeSubscriptionFilenameTemplate(req.body.filenameTemplate, "playlist")
    : null;

  // 2. Detect platform and playlist ID.
  const isBilibili = isBilibiliUrl(playlistUrl);
  const platform = detectPlaylistPlatform(playlistUrl);

  // For Bilibili collection/series, a trusted collectionInfo may supply the ID.
  const isBilibiliCollectionOrSeries =
    isBilibili &&
    !!collectionInfo &&
    (collectionInfo.type === "collection" || collectionInfo.type === "series");

  if (!isBilibili) {
    // YouTube requires a list= parameter.
    if (!extractYouTubePlaylistId(playlistUrl)) {
      throw new ValidationError(
        "YouTube URL must contain a playlist parameter (list=)",
        "playlistUrl"
      );
    }
  }

  // 3. Early subscribe-only duplicate rejection before any persistent side
  //    effect (design §7.3). With downloadAll=true, a duplicate request is a
  //    request to queue historical backfill for the existing subscription.
  const preExisting = await subscriptionService.listSubscriptions();
  const existingSubscription = preExisting.find(
    (sub) => sub.authorUrl === playlistUrl
  );
  if (existingSubscription && !downloadAll) {
    throw DuplicateError.subscription();
  }

  // 4. Inspect playlist metadata and capture the current head as the baseline
  //    (design §6 / §7.1). This single shared probe replaces the former
  //    repeated checkPlaylist / extractBilibiliPlaylistId / extractPlaylistAuthor
  //    probes (design §6.5 / Step 2). Throws on operational failure => the
  //    centralized error handler returns 400/502/500 without side effects.
  const inspection =
    isBilibiliCollectionOrSeries && collectionInfo
      ? await inspectBilibiliCollectionPlaylist(playlistUrl, collectionInfo)
      : await inspectPlaylist(playlistUrl, {
          subscriptionYtdlpConfig: existingSubscription?.ytdlpConfig ?? null,
        });

  let playlistId: string;
  let playlistTitle: string;
  let videoCount: number;
  let author: string;

  if (isBilibiliCollectionOrSeries && collectionInfo) {
    // Use the validated collectionInfo for title/count/IDs (design §12.2), with
    // the head baseline resolved through the Bilibili collection API.
    playlistId = collectionInfo.id?.toString() || inspection.playlistId || "";
    playlistTitle = collectionInfo.title || inspection.title;
    videoCount = inspection.videoCount;
    author = inspection.author;
    logger.info(
      `Using Bilibili ${collectionInfo.type} info: ${playlistTitle} (${videoCount} videos)`
    );
  } else {
    playlistId = inspection.playlistId || "";
    playlistTitle = inspection.title || collectionName;
    videoCount = inspection.videoCount;
    author = inspection.author;
  }

  // 5. Resolve/create the destination collection immediately before inserting
  //    the subscription (design §7.3). Subscribe-only still creates/resolves
  //    one so later scheduled downloads can be grouped (design §3.6).
  const bilibiliSource =
    isBilibiliCollectionOrSeries && hasBilibiliCollectionSource(inspection)
      ? inspection.bilibiliSource
      : null;
  const resolveRequestedCollection = (): ReturnType<
    typeof resolvePlaylistCollectionWithStatus
  > =>
    bilibiliSource
      ? resolveBilibiliPlaylistCollectionWithStatus(
          collectionName,
          bilibiliSource
        )
      : resolvePlaylistCollectionWithStatus(collectionName);

  let collectionResolution: ReturnType<typeof resolvePlaylistCollectionWithStatus>;
  if (existingSubscription?.collectionId) {
    const existingCollection = storageService.getCollectionById(
      existingSubscription.collectionId
    );
    if (existingCollection) {
      if (bilibiliSource) {
        const compatibleCollection = saveBilibiliCollectionSourceIfCompatible(
          existingCollection,
          bilibiliSource
        );
        collectionResolution = compatibleCollection
          ? { collection: compatibleCollection, created: false }
          : resolveRequestedCollection();
      } else {
        collectionResolution = { collection: existingCollection, created: false };
      }
    } else {
      logger.warn(
        `Playlist subscription ${existingSubscription.id} references missing collection ${existingSubscription.collectionId}; resolving "${collectionName}" for backfill`
      );
      collectionResolution = resolveRequestedCollection();
    }
  } else {
    collectionResolution = resolveRequestedCollection();
  }
  const collection = collectionResolution.collection;

  // 6. Insert the subscription with the captured baseline (design §7.2).
  const subscribeOptions: SubscribePlaylistOptions = {
    playlistUrl,
    interval,
    playlistTitle,
    playlistId,
    author,
    platform,
    collectionId: collection.id,
    initialHeadVideoUrl: inspection.headVideoUrl,
    baselineObservedAt: inspection.observedAt,
    filenameTemplate,
  };
  let subscription = existingSubscription;
  if (subscription && subscription.collectionId !== collection.id) {
    try {
      await subscriptionService.updatePlaylistSubscriptionCollection(
        subscription.id,
        collection.id
      );
      subscription = { ...subscription, collectionId: collection.id };
    } catch (error) {
      try {
        await deleteCreatedCollectionIfUnused(
          collectionResolution,
          () => subscriptionService.listSubscriptions()
        );
      } catch (cleanupError) {
        logger.error(
          "Failed to clean up collection after playlist subscription collection update failed",
          cleanupError instanceof Error
            ? cleanupError
            : new Error(String(cleanupError))
        );
      }
      throw error;
    }
  }
  if (
    subscription &&
    hasFilenameTemplate &&
    (subscription.filenameTemplate ?? null) !== filenameTemplate
  ) {
    await subscriptionService.updateSubscriptionSettings(subscription.id, {
      filenameTemplate,
    });
    subscription = { ...subscription, filenameTemplate };
  }
  if (!subscription) {
    try {
      subscription = await subscriptionService.subscribePlaylist(subscribeOptions);
    } catch (error) {
      // The collection write is outside the subscription database transaction.
      // Clean up only a collection that this request created and can still prove
      // is empty and unreferenced (design §7.3).
      try {
        await deleteCreatedCollectionIfUnused(
          collectionResolution,
          () => subscriptionService.listSubscriptions()
        );
      } catch (cleanupError) {
        logger.error(
          "Failed to clean up collection after playlist subscription insertion failed",
          cleanupError instanceof Error
            ? cleanupError
            : new Error(String(cleanupError))
        );
      }
      throw error;
    }
  }

  // 7. Optionally create a linked historical task (design §7.1 / §7.4).
  //    Capturing the baseline here is intentional: it prevents the scheduler
  //    from enqueuing the same latest item while the task processes history
  //    (design §4.4). A verified empty playlist needs no backfill task
  //    (design §4.5).
  let task: { id: string } | null = null;
  let backfillStatus: PlaylistBackfillStatus;
  if (!downloadAll) {
    backfillStatus = "not_requested";
  } else if (videoCount === 0 || inspection.headVideoUrl === null) {
    // Empty playlist: omit the zero-length task (design §4.5).
    backfillStatus = "not_needed_empty";
  } else {
    try {
      const existingTask =
        await continuousDownloadService.getBlockingPlaylistTaskByDestination(
          playlistUrl,
          subscription.id,
          collection.id
        );
      if (existingTask) {
        task = { id: existingTask.id };
        backfillStatus = "already_exists";
        logger.info(
          `Skipping playlist backfill for ${playlistUrl}: task ${existingTask.id} already exists`
        );
      } else {
        task = await continuousDownloadService.createPlaylistTask(
          playlistUrl,
          author,
          platform,
          collection.id,
          subscription.id
        );
        backfillStatus = "started";
        if (existingSubscription) {
          subscription = await refreshExistingPlaylistSubscriptionCursor(
            subscription,
            inspection.headVideoUrl,
            inspection.observedAt,
            `playlist backfill ${task.id}`
          );
        }
        logger.info(
          `Created continuous download task ${task.id} for playlist subscription ${subscription.id}`
        );
      }
    } catch (error) {
      // Failure to create the historical task does NOT roll back a
      // successfully created subscription (design §7.3). Return no task id
      // with a "failed" status so the UI can warn rather than claim history
      // was queued.
      backfillStatus = "failed";
      logger.error(
        "Error creating continuous download task for playlist:",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // 8. Typed, self-describing response (design §7.1).
  res.status(201).json({
    subscription,
    collectionId: collection.id,
    taskId: task?.id ?? null,
    downloadAll,
    backfillStatus,
  });
};

/**
 * Subscribe to all playlists from a channel
 * Errors are automatically handled by asyncHandler middleware
 */
export const subscribeChannelPlaylists = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { url, interval, downloadAllPrevious } = req.body;
  logger.info("Subscribing to channel playlists:", {
    url,
    interval,
    downloadAllPrevious,
  });

  if (!url || !interval) {
    throw new ValidationError("URL and interval are required", "body");
  }

  // Per-subscription filename-template override (issue #368). Copied to every
  // new playlist subscription created in this request and to the watcher. Uses
  // the "playlist" source-collection type because the watcher copies its
  // template to child playlists.
  const hasFilenameTemplate = Object.prototype.hasOwnProperty.call(
    req.body,
    "filenameTemplate"
  );
  const filenameTemplate = hasFilenameTemplate
    ? normalizeSubscriptionFilenameTemplate(
        req.body.filenameTemplate,
        "playlist"
      )
    : null;
  const watcherFilenameTemplate = hasFilenameTemplate
    ? filenameTemplate
    : undefined;

  // Adjust URL to ensure we target playlists tab
  const targetUrl = toPlaylistsTabUrl(url);

  const userConfig = getUserYtDlpConfig(targetUrl);
  const networkConfig = getNetworkConfigFromUserConfig(userConfig);
  const { getProviderScript } = await import(
    "../services/downloaders/ytdlp/ytdlpHelpers"
  );
  const PROVIDER_SCRIPT = getProviderScript();

  // Use yt-dlp to get all playlists
  const result = await executeYtDlpJson(targetUrl, {
    ...networkConfig,
    noWarnings: true,
    flatPlaylist: true,
    dumpSingleJson: true,
    playlistEnd: 100, // Limit to 100 playlists for safety
    ...(PROVIDER_SCRIPT
      ? {
          extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
        }
      : {}),
  });

  if (!result.entries || result.entries.length === 0) {
    throw new ValidationError("No playlists found on this channel", "body");
  }

  // Extract channel name from result (with URL-handle fallback)
  const channelName = deriveChannelName(result, url);

  logger.info(
    `Found ${result.entries.length} playlists for channel: ${channelName}`
  );

  const platform = detectPlaylistPlatform(targetUrl);
  let subscribedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  // --- Phase 1 (design §8.1): build the candidate list. Already-subscribed
  // playlists are skipped for insertion, but remain candidates when the caller
  // requested historical backfill so subscribe-only rows can be backfilled later.
  // A single listSubscriptions call feeds every candidate's duplicate check.
  const existingSubs = await subscriptionService.listSubscriptions();
  const existingSubByUrl = new Map(existingSubs.map((sub) => [sub.authorUrl, sub]));

  type ExistingPlaylistSubscription = {
    id: string;
    collectionId?: string | null;
    ytdlpConfig?: string | null;
    filenameTemplate?: string | null;
  };
  const applyFilenameTemplateToExistingPlaylist = async (
    subscription: ExistingPlaylistSubscription,
    title: string
  ): Promise<boolean> => {
    if (
      !hasFilenameTemplate ||
      (subscription.filenameTemplate ?? null) === filenameTemplate
    ) {
      return true;
    }

    try {
      await subscriptionService.updateSubscriptionSettings(subscription.id, {
        filenameTemplate,
      });
      subscription.filenameTemplate = filenameTemplate;
      return true;
    } catch (error) {
      const message = getErrorMessage(error, "Unknown error");
      errors.push(`${title}: ${message}`);
      logger.error(
        `Failed to update filename template for playlist "${title}":`,
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  };

  type Candidate = {
    playlistUrl: string;
    title: string;
    playlistId: string;
    existingSubscription?: ExistingPlaylistSubscription;
  };
  const candidates: Candidate[] = [];
  for (const entry of result.entries) {
    if (!entry.url && !entry.id) continue;
    const playlistUrl =
      entry.url || `https://www.youtube.com/playlist?list=${entry.id}`;
    const title = sanitizePlaylistTitle(entry.title);
    const playlistId = entry.id ?? extractYouTubePlaylistId(playlistUrl) ?? "";

    const existingSubscription = existingSubByUrl.get(playlistUrl);

    if (existingSubscription) {
      logger.info(`Skipping playlist "${title}": already subscribed`);
      skippedCount++;
      const existingTemplateUpdated =
        await applyFilenameTemplateToExistingPlaylist(existingSubscription, title);
      if (downloadAllPrevious === true) {
        if (existingTemplateUpdated) {
          candidates.push({
            playlistUrl,
            title,
            playlistId,
            existingSubscription,
          });
        }
      }
      continue;
    }
    candidates.push({ playlistUrl, title, playlistId });
  }

  // --- Phase 2: resolve head snapshots concurrently with a conservative
  // limit of 3 (design §8.1). Each worker catches internally and writes an
  // indexed preflight result so one failed probe does not abort the remaining
  // candidates. A failed baseline counts as an error, not a skip.
  type Preflight =
    | { ok: true; candidate: Candidate; headVideoUrl: string | null; observedAt: number }
    | { ok: false; candidate: Candidate; error: string };
  const preflight: Preflight[] = new Array(candidates.length);

  await runWithConcurrencyLimit(candidates, 3, async (candidate) => {
    const idx = candidates.indexOf(candidate);
    try {
      const snapshot = await getPlaylistHeadSnapshot(
        candidate.playlistUrl,
        platform,
        {
          subscriptionYtdlpConfig:
            candidate.existingSubscription?.ytdlpConfig ?? null,
        }
      );
      preflight[idx] = {
        ok: true,
        candidate,
        headVideoUrl: snapshot.headVideoUrl,
        observedAt: snapshot.observedAt,
      };
    } catch (error) {
      const message = getErrorMessage(error, "Unknown error");
      errors.push(`${candidate.title}: ${message}`);
      preflight[idx] = { ok: false, candidate, error: message };
      logger.error(
        `Baseline probe failed for playlist "${candidate.title}":`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  });

  // --- Phase 3: sequentially resolve collections, insert new subscriptions,
  // and create requested backfill tasks for successful snapshots (design §8.1).
  // Sequential mutation avoids Date.now() collection-ID collisions and keeps
  // counters deterministic.
  const wantBackfill = downloadAllPrevious === true;

  for (const result_item of preflight) {
    if (!result_item || !result_item.ok) continue;
    const { candidate, headVideoUrl, observedAt } = result_item;

    let createdSubscriptionId = candidate.existingSubscription?.id;
    let subscriptionWasCreatedByThisRequest = false;
    let taskCollectionId = candidate.existingSubscription?.collectionId;
    let taskCollectionResolution: ReturnType<
      typeof resolveChannelPlaylistCollectionWithStatus
    > | null = null;
    const resolveTaskCollection = (): ReturnType<
      typeof resolveChannelPlaylistCollectionWithStatus
    > => {
      taskCollectionResolution ??= resolveChannelPlaylistCollectionWithStatus(
        candidate.title,
        channelName
      );
      return taskCollectionResolution;
    };
    const ensureTaskCollectionId = async (): Promise<string> => {
      if (taskCollectionId) {
        return taskCollectionId;
      }

      const collectionResolution = resolveTaskCollection();
      taskCollectionId = collectionResolution.collection.id;

      if (candidate.existingSubscription?.id) {
        try {
          await subscriptionService.updatePlaylistSubscriptionCollection(
            candidate.existingSubscription.id,
            taskCollectionId
          );
          candidate.existingSubscription.collectionId = taskCollectionId;
        } catch (error) {
          try {
            await deleteCreatedCollectionIfUnused(
              collectionResolution,
              () => subscriptionService.listSubscriptions()
            );
          } catch (cleanupError) {
            logger.error(
              `Failed to clean up collection for playlist "${candidate.title}" after subscription collection update failed:`,
              cleanupError instanceof Error
                ? cleanupError
                : new Error(String(cleanupError))
            );
          }
          throw error;
        }
      }

      return taskCollectionId;
    };

    if (!candidate.existingSubscription) {
      // Resolve/create collection only after a successful baseline.
      const collectionResolution = resolveChannelPlaylistCollectionWithStatus(
        candidate.title,
        channelName
      );
      const collection = collectionResolution.collection;
      const collectionId = collection.id;
      taskCollectionId = collectionId;

      try {
        const subscription = await subscriptionService.subscribePlaylist({
          playlistUrl: candidate.playlistUrl,
          interval: parseInt(interval),
          playlistTitle: candidate.title,
          playlistId: candidate.playlistId,
          author: channelName,
          platform,
          collectionId,
          initialHeadVideoUrl: headVideoUrl,
          baselineObservedAt: observedAt,
          filenameTemplate,
        });
        createdSubscriptionId = subscription.id;
        subscriptionWasCreatedByThisRequest = true;
        subscribedCount++;
        existingSubByUrl.set(candidate.playlistUrl, subscription);
      } catch (error: unknown) {
        logger.error(`Error subscribing to playlist "${candidate.title}":`, error);
        try {
          await deleteCreatedCollectionIfUnused(
            collectionResolution,
            () => subscriptionService.listSubscriptions()
          );
        } catch (cleanupError) {
          logger.error(
            `Failed to clean up collection for playlist "${candidate.title}" after subscription insertion failed:`,
            cleanupError instanceof Error
              ? cleanupError
              : new Error(String(cleanupError))
          );
        }
        if (error instanceof Error && error.name === "DuplicateError") {
          skippedCount++;
          // A concurrent request may have inserted the subscription after the
          // phase-one list. Resolve that exact row before creating a requested
          // backfill task; never attach the task to this request's now-cleaned
          // collection (design §11.3).
          const concurrentSub = (await subscriptionService.listSubscriptions()).find(
            (sub) => sub.authorUrl === candidate.playlistUrl
          );
          if (!concurrentSub) {
            errors.push(
              `${candidate.title}: concurrent subscription could not be resolved`
            );
            continue;
          }
          const concurrentTemplateUpdated =
            await applyFilenameTemplateToExistingPlaylist(
              concurrentSub,
              candidate.title
            );
          if (!concurrentTemplateUpdated) {
            continue;
          }
          createdSubscriptionId = concurrentSub.id;
          taskCollectionId = concurrentSub.collectionId;
          existingSubByUrl.set(candidate.playlistUrl, concurrentSub);
        } else {
          errors.push(
            `${candidate.title}: ${getErrorMessage(error, "Unknown error")}`
          );
          // A real insertion failure must not turn into an unlinked historical
          // task. The next bulk request can retry the subscription cleanly.
          continue;
        }
      }
    }

    // Historical task only when requested. For a bulk duplicate (already
    // subscribed), link the task to the existing subscription id when
    // available (design §11.3).
    if (wantBackfill) {
      // A verified empty playlist needs no backfill task (design §4.5).
      if (headVideoUrl === null) {
        continue;
      }
      try {
        const resolvedTaskCollectionId = await ensureTaskCollectionId();
        const existingTask = createdSubscriptionId
          ? await continuousDownloadService.getBlockingPlaylistTaskByDestination(
              candidate.playlistUrl,
              createdSubscriptionId,
              resolvedTaskCollectionId
            )
          : null;
        if (existingTask) {
          logger.info(
            `Skipping download task creation for playlist "${candidate.title}": task already exists`
          );
        } else {
          // Link to the subscription created/known by this request. An existing
          // candidate came from phase one, and a raced duplicate above resolved
          // its exact current row.
          const task = await continuousDownloadService.createPlaylistTask(
            candidate.playlistUrl,
            channelName,
            platform,
            resolvedTaskCollectionId,
            createdSubscriptionId
          );
          logger.info(
            `Created continuous download task ${task.id} for playlist: ${candidate.title}`
          );
          if (!subscriptionWasCreatedByThisRequest && createdSubscriptionId) {
            try {
              await subscriptionService.updatePlaylistSubscriptionCursor(
                createdSubscriptionId,
                headVideoUrl,
                observedAt
              );
            } catch (error) {
              logger.error(
                `Failed to update playlist subscription cursor after starting bulk backfill for "${candidate.title}"`,
                error instanceof Error ? error : new Error(String(error))
              );
            }
          }
        }
      } catch (error) {
        logger.error(
          `Error creating continuous download task for playlist "${candidate.title}":`,
          error instanceof Error ? error : new Error(String(error))
        );
        // Don't fail the subscription if task creation fails
      }
    }
  }

  // Log message for debugging (not sent to frontend - frontend will construct from translations)
  const logMessage =
    subscribedCount > 0
      ? `Successfully subscribed to ${subscribedCount} playlist${
          subscribedCount > 1 ? "s" : ""
        }.${
          skippedCount > 0
            ? ` ${skippedCount} playlist${
                skippedCount > 1 ? "s were" : " was"
              } already subscribed.`
            : ""
        }${
          errors.length > 0
            ? ` ${errors.length} error${errors.length > 1 ? "s" : ""} occurred.`
            : ""
        }`
      : `No new playlists subscribed.${
          skippedCount > 0
            ? ` ${skippedCount} playlist${
                skippedCount > 1 ? "s were" : " was"
              } already subscribed.`
            : ""
        }${
          errors.length > 0
            ? ` ${errors.length} error${errors.length > 1 ? "s" : ""} occurred.`
            : ""
        }`;
  logger.info(logMessage);

  // Create persistent watcher for future playlists
  try {
    const watcher = await subscriptionService.subscribeChannelPlaylistsWatcher(
      targetUrl,
      parseInt(interval),
      channelName,
      platform,
      watcherFilenameTemplate
    );
    logger.info("Created channel playlists watcher", {
      subscriptionId: watcher.id,
      platform: watcher.platform,
    });
  } catch (error) {
    logger.error("Error creating channel playlists watcher", error, {
      platform,
    });
    // Don't fail the request if watcher creation fails, main task succeeded
  }

  res.status(201).json({
    subscribedCount,
    skippedCount,
    errorCount: errors.length,
    errors: errors.length > 0 ? errors : undefined,
  });
};

/**
 * Create a continuous download task for a playlist
 * Errors are automatically handled by asyncHandler middleware
 */
export const createPlaylistTask = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { playlistUrl, collectionName } = req.body;
  logger.info("Creating playlist task:", {
    playlistUrl,
    collectionName,
  });

  if (!playlistUrl || !collectionName) {
    throw new ValidationError(
      "Playlist URL and collection name are required",
      "body"
    );
  }

  // Detect platform
  const isBilibili = isBilibiliUrl(playlistUrl);
  const platform = detectPlaylistPlatform(playlistUrl);

  // Validate playlist URL format based on platform
  if (!isBilibili) {
    // For YouTube, check for list parameter
    if (!extractYouTubePlaylistId(playlistUrl)) {
      throw new ValidationError(
        "YouTube URL must contain a playlist parameter (list=)",
        "playlistUrl"
      );
    }
  }
  // For Bilibili, we'll rely on checkPlaylist to validate

  // Get playlist info to determine author and platform
  const playlistInfo = await checkPlaylist(playlistUrl);

  if (!playlistInfo.success) {
    throw new ValidationError(
      playlistInfo.error || "Failed to get playlist information",
      "playlistUrl"
    );
  }

  // Create collection first - ensure unique name
  const uniqueCollectionName =
    storageService.generateUniqueCollectionName(collectionName);
  const newCollection = {
    id: Date.now().toString(),
    name: uniqueCollectionName,
    videos: [],
    createdAt: new Date().toISOString(),
    title: uniqueCollectionName,
  };
  storageService.saveCollection(newCollection);
  logger.info(
    `Created collection "${uniqueCollectionName}" with ID ${newCollection.id}`
  );

  // Extract author from playlist (try to get from first video or use default)
  let author = "Playlist Author";

  try {
    const { getProviderScript } = await import(
      "../services/downloaders/ytdlp/ytdlpHelpers"
    );

    const userConfig = getUserYtDlpConfig(playlistUrl);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Get first video info to extract author
    const info = await executeYtDlpJson(playlistUrl, {
      ...networkConfig,
      noWarnings: true,
      flatPlaylist: true,
      playlistEnd: 1,
      ...(PROVIDER_SCRIPT
        ? {
            extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
          }
        : {}),
    });

    if (info.entries && info.entries.length > 0) {
      const firstEntry = info.entries[0];
      if (firstEntry.uploader) {
        author = firstEntry.uploader;
      }
    } else if (info.uploader) {
      author = info.uploader;
    }
  } catch (error) {
    logger.warn(
      "Could not extract author from playlist, using default:",
      error
    );
  }

  // Create continuous download task with collection ID
  const task = await continuousDownloadService.createPlaylistTask(
    playlistUrl,
    author,
    platform,
    newCollection.id
  );

  logger.info(
    `Created playlist download task ${task.id} for collection ${newCollection.id}`
  );

  res.status(201).json({
    taskId: task.id,
    collectionId: newCollection.id,
    task,
  });
};
