import {
  ContinuousDownloadTask,
  DownloadOrder,
  FrozenDownloadPlanV2,
  OrderingMetadataStats,
  VideoEntry,
} from "./types";

export interface LegacyFrozenDownloadPlan {
  version: 1;
  entries: string[];
}

export type ParsedFrozenDownloadPlan =
  | LegacyFrozenDownloadPlan
  | FrozenDownloadPlanV2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeLegacyUrls(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const urls = value.filter((entry): entry is string => typeof entry === "string");
  return urls.length === value.length ? urls : null;
}

function normalizeVideoEntry(value: unknown, sourceIndex: number): VideoEntry | null {
  if (!isRecord(value) || typeof value.url !== "string") {
    return null;
  }

  return {
    url: value.url,
    sourceVideoId:
      typeof value.sourceVideoId === "string" && value.sourceVideoId
        ? value.sourceVideoId
        : value.url,
    publishedAtMs:
      typeof value.publishedAtMs === "number" && Number.isFinite(value.publishedAtMs)
        ? value.publishedAtMs
        : null,
    publishedDatePrecision:
      value.publishedDatePrecision === "day" ||
      value.publishedDatePrecision === "second"
        ? value.publishedDatePrecision
        : "unknown",
    viewCount:
      typeof value.viewCount === "number" && Number.isFinite(value.viewCount)
        ? value.viewCount
        : null,
    sourceIndex:
      typeof value.sourceIndex === "number" && Number.isFinite(value.sourceIndex)
        ? value.sourceIndex
        : sourceIndex,
  };
}

function normalizeStats(
  value: unknown,
  entries: VideoEntry[]
): OrderingMetadataStats {
  if (isRecord(value)) {
    return {
      entryCount:
        typeof value.entryCount === "number" ? value.entryCount : entries.length,
      knownDates:
        typeof value.knownDates === "number"
          ? value.knownDates
          : entries.filter((entry) => entry.publishedAtMs !== null).length,
      unknownDates:
        typeof value.unknownDates === "number"
          ? value.unknownDates
          : entries.filter((entry) => entry.publishedAtMs === null).length,
      knownViewCounts:
        typeof value.knownViewCounts === "number"
          ? value.knownViewCounts
          : entries.filter((entry) => entry.viewCount !== null).length,
      unknownViewCounts:
        typeof value.unknownViewCounts === "number"
          ? value.unknownViewCounts
          : entries.filter((entry) => entry.viewCount === null).length,
    };
  }

  return buildOrderingMetadataStats(entries);
}

export function buildOrderingMetadataStats(
  entries: VideoEntry[]
): OrderingMetadataStats {
  return {
    entryCount: entries.length,
    knownDates: entries.filter((entry) => entry.publishedAtMs !== null).length,
    unknownDates: entries.filter((entry) => entry.publishedAtMs === null).length,
    knownViewCounts: entries.filter((entry) => entry.viewCount !== null).length,
    unknownViewCounts: entries.filter((entry) => entry.viewCount === null).length,
  };
}

export function parseFrozenDownloadPlan(raw: string): ParsedFrozenDownloadPlan {
  const parsed = JSON.parse(raw) as unknown;
  const legacyUrls = normalizeLegacyUrls(parsed);
  if (legacyUrls) {
    return { version: 1, entries: legacyUrls };
  }

  if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.entries)) {
    throw new Error("Unsupported frozen download plan format");
  }

  const entries = parsed.entries.map(normalizeVideoEntry);
  if (entries.some((entry) => entry === null)) {
    throw new Error("Invalid frozen download plan entries");
  }

  return {
    version: 2,
    taskId: typeof parsed.taskId === "string" ? parsed.taskId : "",
    sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : "",
    platform: typeof parsed.platform === "string" ? parsed.platform : "",
    downloadOrder: parsed.downloadOrder as DownloadOrder,
    createdAt:
      typeof parsed.createdAt === "string"
        ? parsed.createdAt
        : new Date(0).toISOString(),
    entries: entries as VideoEntry[],
    metadataStats: normalizeStats(parsed.metadataStats, entries as VideoEntry[]),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

export function getFrozenPlanUrls(plan: ParsedFrozenDownloadPlan): string[] {
  return plan.version === 1
    ? plan.entries
    : plan.entries.map((entry) => entry.url);
}

export function validateFrozenPlanForTask(
  plan: ParsedFrozenDownloadPlan,
  task: ContinuousDownloadTask,
  downloadOrder: DownloadOrder
): boolean {
  if (plan.version === 1) {
    return true;
  }

  return (
    plan.taskId === task.id &&
    plan.sourceUrl === task.authorUrl &&
    plan.platform === task.platform &&
    plan.downloadOrder === downloadOrder
  );
}

export function createFrozenDownloadPlanV2(input: {
  task: ContinuousDownloadTask;
  downloadOrder: DownloadOrder;
  entries: VideoEntry[];
  warnings?: string[];
}): FrozenDownloadPlanV2 {
  return {
    version: 2,
    taskId: input.task.id,
    sourceUrl: input.task.authorUrl,
    platform: input.task.platform,
    downloadOrder: input.downloadOrder,
    createdAt: new Date().toISOString(),
    entries: input.entries,
    metadataStats: buildOrderingMetadataStats(input.entries),
    warnings: input.warnings ?? [],
  };
}
