import type { BilibiliCollectionCheckResult } from "./downloaders/BilibiliDownloader";

export type DownloadRetryMetadata =
  | {
      shape: "bilibili_all_parts";
      collectionName?: string;
    }
  | {
      shape: "bilibili_collection";
      collectionName?: string;
      collectionInfo: BilibiliCollectionCheckResult;
    };

export function createBilibiliRetryMetadata(options: {
  downloadAllParts?: boolean;
  downloadCollection?: boolean;
  collectionName?: string;
  collectionInfo?: BilibiliCollectionCheckResult;
}): DownloadRetryMetadata | undefined {
  if (options.downloadCollection && options.collectionInfo) {
    return {
      shape: "bilibili_collection",
      collectionName: options.collectionName,
      collectionInfo: options.collectionInfo,
    };
  }

  if (options.downloadAllParts) {
    return {
      shape: "bilibili_all_parts",
      collectionName: options.collectionName,
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
