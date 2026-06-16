import type { BilibiliCollectionCheckResult } from "./downloaders/BilibiliDownloader";

type BilibiliRetryBase = {
  normalizedSourceUrl?: string;
  linkedCollectionId?: string;
  expectedCount?: number;
  lastAttemptedAt?: number;
};

export type DownloadRetryMetadata =
  | (BilibiliRetryBase & {
      shape: "bilibili_all_parts";
      collectionName?: string;
      completedPartNumbers?: number[];
      failedPartNumbers?: number[];
    })
  | (BilibiliRetryBase & {
      shape: "bilibili_collection";
      collectionName?: string;
      collectionInfo: BilibiliCollectionCheckResult;
      expectedVideoBvids?: string[];
      completedVideoBvids?: string[];
      failedVideoBvids?: string[];
    });

export function createBilibiliRetryMetadata(options: {
  downloadAllParts?: boolean;
  downloadCollection?: boolean;
  collectionName?: string;
  collectionInfo?: BilibiliCollectionCheckResult;
  normalizedSourceUrl?: string;
}): DownloadRetryMetadata | undefined {
  if (options.downloadCollection && options.collectionInfo) {
    return {
      shape: "bilibili_collection",
      collectionName: options.collectionName,
      collectionInfo: options.collectionInfo,
      normalizedSourceUrl: options.normalizedSourceUrl,
    };
  }

  if (options.downloadAllParts) {
    return {
      shape: "bilibili_all_parts",
      collectionName: options.collectionName,
      normalizedSourceUrl: options.normalizedSourceUrl,
    };
  }

  return undefined;
}

export function serializeRetryMetadata(
  metadata: DownloadRetryMetadata,
): string {
  return JSON.stringify(metadata);
}

export function parseRetryMetadata(
  raw: string | null | undefined,
): DownloadRetryMetadata | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as DownloadRetryMetadata;
    if (
      parsed.shape === "bilibili_all_parts" ||
      (parsed.shape === "bilibili_collection" && parsed.collectionInfo)
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function dedupeNumbers(values: number[] | undefined): number[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function dedupeStrings(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return Array.from(new Set(values));
}

function sameCollectionIdentity(
  left: BilibiliCollectionCheckResult | undefined,
  right: BilibiliCollectionCheckResult | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.type === right.type &&
    left.id === right.id &&
    left.mid === right.mid
  );
}

export function mergeBilibiliRetryMetadata(
  current: DownloadRetryMetadata | undefined,
  previous: DownloadRetryMetadata | undefined,
): DownloadRetryMetadata | undefined {
  if (!current || !previous || current.shape !== previous.shape) {
    return current;
  }

  if (
    current.shape === "bilibili_collection" &&
    previous.shape === "bilibili_collection" &&
    !sameCollectionIdentity(current.collectionInfo, previous.collectionInfo)
  ) {
    return current;
  }

  if (current.shape === "bilibili_all_parts") {
    const currentParts = current as Extract<
      DownloadRetryMetadata,
      { shape: "bilibili_all_parts" }
    >;
    const previousParts = previous as Extract<
      DownloadRetryMetadata,
      { shape: "bilibili_all_parts" }
    >;
    return {
      ...previousParts,
      ...currentParts,
      collectionName: currentParts.collectionName ?? previousParts.collectionName,
      normalizedSourceUrl:
        currentParts.normalizedSourceUrl ?? previousParts.normalizedSourceUrl,
      completedPartNumbers: dedupeNumbers([
        ...(previousParts.completedPartNumbers ?? []),
        ...(currentParts.completedPartNumbers ?? []),
      ]),
      failedPartNumbers: dedupeNumbers([
        ...(previousParts.failedPartNumbers ?? []),
        ...(currentParts.failedPartNumbers ?? []),
      ]),
    };
  }

  const currentCollection = current as Extract<
    DownloadRetryMetadata,
    { shape: "bilibili_collection" }
  >;
  const previousCollection = previous as Extract<
    DownloadRetryMetadata,
    { shape: "bilibili_collection" }
  >;
  return {
    ...previousCollection,
    ...currentCollection,
    collectionName:
      currentCollection.collectionName ?? previousCollection.collectionName,
    normalizedSourceUrl:
      currentCollection.normalizedSourceUrl ??
      previousCollection.normalizedSourceUrl,
    expectedVideoBvids: dedupeStrings([
      ...(previousCollection.expectedVideoBvids ?? []),
      ...(currentCollection.expectedVideoBvids ?? []),
    ]),
    completedVideoBvids: dedupeStrings([
      ...(previousCollection.completedVideoBvids ?? []),
      ...(currentCollection.completedVideoBvids ?? []),
    ]),
    failedVideoBvids: dedupeStrings([
      ...(previousCollection.failedVideoBvids ?? []),
      ...(currentCollection.failedVideoBvids ?? []),
    ]),
  };
}

export function requiresRetryMetadata(
  metadata: DownloadRetryMetadata | undefined,
): boolean {
  return (
    metadata?.shape === "bilibili_all_parts" ||
    metadata?.shape === "bilibili_collection"
  );
}

export function canRestoreDetachedTask(
  type: string | undefined,
  rawMetadata: string | null | undefined,
): boolean {
  if (type !== "bilibili" || !rawMetadata) {
    return true;
  }

  return parseRetryMetadata(rawMetadata) !== undefined;
}
