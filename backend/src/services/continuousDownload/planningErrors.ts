import {
  ContinuousDownloadTask,
  DownloadOrder,
  OrderingPlanningFailure,
} from "./types";
import {
  OrderingMetadataUnavailableError,
  SourceEnumerationFailedError,
} from "./videoUrlFetcher";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlanningFailureCode(
  value: unknown
): value is OrderingPlanningFailure["code"] {
  return (
    value === "ORDERING_METADATA_UNAVAILABLE" ||
    value === "ORDERING_METADATA_HYDRATION_FAILED" ||
    value === "ORDERING_PLAN_PERSIST_FAILED" ||
    value === "ORDERING_PLAN_INVALID" ||
    value === "SOURCE_ENUMERATION_FAILED"
  );
}

function isSuggestedAction(
  value: unknown
): value is OrderingPlanningFailure["suggestedAction"] {
  return (
    value === "check_cookies_or_proxy" ||
    value === "retry_metadata" ||
    value === "check_storage"
  );
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function taskOrder(task: ContinuousDownloadTask): DownloadOrder {
  return task.downloadOrder ?? "dateDesc";
}

function requiredMetadataLabel(order: DownloadOrder): "publication dates" | "view counts" {
  return order === "dateAsc" || order === "dateDesc"
    ? "publication dates"
    : "view counts";
}

export function serializeOrderingPlanningFailure(
  failure: OrderingPlanningFailure
): string {
  return JSON.stringify({
    kind: "ordering_planning_failure",
    ...failure,
  });
}

export function parseOrderingPlanningFailure(
  raw: string | null | undefined
): OrderingPlanningFailure | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const candidate = parsed.kind === "ordering_planning_failure"
      ? parsed
      : isRecord(parsed.orderingPlanningFailure)
        ? parsed.orderingPlanningFailure
        : null;
    if (!candidate || !isPlanningFailureCode(candidate.code)) {
      return null;
    }

    return {
      version: candidate.version === 1 ? 1 : 1,
      code: candidate.code,
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Ordering preparation failed before any videos were downloaded.",
      retryable: candidate.retryable !== false,
      platform:
        typeof candidate.platform === "string" ? candidate.platform : "unknown",
      downloadOrder: candidate.downloadOrder as DownloadOrder,
      entryCount: toCount(candidate.entryCount),
      knownCount: toCount(candidate.knownCount),
      unknownCount: toCount(candidate.unknownCount),
      suggestedAction: isSuggestedAction(candidate.suggestedAction)
        ? candidate.suggestedAction
        : "retry_metadata",
    };
  } catch {
    return null;
  }
}

export function createOrderingMetadataUnavailableFailure(
  error: OrderingMetadataUnavailableError
): OrderingPlanningFailure {
  return {
    version: 1,
    code: "ORDERING_METADATA_UNAVAILABLE",
    message: `No videos were downloaded because MyTube could not prove the requested order. ${error.entryCount} videos had no usable ${requiredMetadataLabel(error.downloadOrder)} after metadata preparation. Check cookies, proxy, and yt-dlp settings, then retry order preparation.`,
    retryable: true,
    platform: error.platform,
    downloadOrder: error.downloadOrder,
    entryCount: error.entryCount,
    knownCount: 0,
    unknownCount: error.entryCount,
    suggestedAction: "check_cookies_or_proxy",
  };
}

export function createSourceEnumerationFailure(
  task: ContinuousDownloadTask,
  error: SourceEnumerationFailedError
): OrderingPlanningFailure {
  return {
    version: 1,
    code: "SOURCE_ENUMERATION_FAILED",
    message: `No videos were downloaded because MyTube could not finish listing this source, so the order plan would have been incomplete. Check cookies, proxy, and yt-dlp settings, then retry order preparation.`,
    retryable: true,
    platform: error.platform || task.platform,
    downloadOrder: taskOrder(task),
    entryCount: error.enumeratedCount,
    knownCount: error.enumeratedCount,
    unknownCount: 0,
    suggestedAction: "check_cookies_or_proxy",
  };
}

export function createOrderingPlanPersistFailure(
  task: ContinuousDownloadTask,
  message: string
): OrderingPlanningFailure {
  return {
    version: 1,
    code: "ORDERING_PLAN_PERSIST_FAILED",
    message: `No videos were downloaded because MyTube could not persist the prepared order plan. Check storage permissions and retry order preparation.`,
    retryable: true,
    platform: task.platform,
    downloadOrder: taskOrder(task),
    entryCount: task.totalVideos,
    knownCount: 0,
    unknownCount: task.totalVideos,
    suggestedAction: "check_storage",
  };
}

export function createOrderingHydrationFailure(
  task: ContinuousDownloadTask,
  message: string
): OrderingPlanningFailure {
  return {
    version: 1,
    code: "ORDERING_METADATA_HYDRATION_FAILED",
    message: `No videos were downloaded because MyTube could not finish metadata preparation for the requested order. Check cookies, proxy, and yt-dlp settings, then retry order preparation.`,
    retryable: true,
    platform: task.platform,
    downloadOrder: taskOrder(task),
    entryCount: task.totalVideos,
    knownCount: 0,
    unknownCount: task.totalVideos,
    suggestedAction: "check_cookies_or_proxy",
  };
}

export function createOrderingPlanInvalidFailure(
  task: ContinuousDownloadTask,
  message: string
): OrderingPlanningFailure {
  return {
    version: 1,
    code: "ORDERING_PLAN_INVALID",
    message: `This task was cancelled because its saved download order plan is invalid after progress was recorded. Recreate the task to avoid skipping or duplicating videos. ${message}`,
    retryable: false,
    platform: task.platform,
    downloadOrder: taskOrder(task),
    entryCount: task.totalVideos,
    knownCount: task.currentVideoIndex,
    unknownCount: Math.max(task.totalVideos - task.currentVideoIndex, 0),
    suggestedAction: "retry_metadata",
  };
}

export class OrderingPlanPersistError extends Error {
  constructor(
    readonly task: ContinuousDownloadTask,
    readonly originalMessage: string
  ) {
    super(originalMessage);
    this.name = "OrderingPlanPersistError";
  }
}

export class OrderingPlanInvalidError extends Error {
  constructor(
    readonly task: ContinuousDownloadTask,
    readonly originalMessage: string
  ) {
    super(originalMessage);
    this.name = "OrderingPlanInvalidError";
  }
}

export function createPlanningFailureFromError(
  error: unknown,
  task: ContinuousDownloadTask
): OrderingPlanningFailure | null {
  if (error instanceof OrderingMetadataUnavailableError) {
    return createOrderingMetadataUnavailableFailure(error);
  }

  if (error instanceof SourceEnumerationFailedError) {
    return createSourceEnumerationFailure(task, error);
  }

  if (error instanceof OrderingPlanPersistError) {
    return createOrderingPlanPersistFailure(task, error.originalMessage);
  }

  if (error instanceof OrderingPlanInvalidError) {
    return createOrderingPlanInvalidFailure(task, error.originalMessage);
  }

  return null;
}
