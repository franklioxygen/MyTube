type BilibiliRetryMetadata =
  | {
      shape: "bilibili_all_parts";
      expectedCount?: number;
      completedPartNumbers?: number[];
      failedPartNumbers?: number[];
    }
  | {
      shape: "bilibili_collection";
      collectionInfo?: {
        type?: "collection" | "series" | "none";
        count?: number;
      };
      expectedVideoBvids?: string[];
      completedVideoBvids?: string[];
      failedVideoBvids?: string[];
    };

export interface BilibiliRetryGapSummary {
  labelKey: "missingEpisodes" | "missingVideos";
  missingCount: number;
  displayValue: string;
}

function dedupeSortedNumbers(values: number[] | undefined): number[] {
  if (!values || values.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      values.filter(
        (value) => Number.isInteger(value) && Number.isFinite(value) && value > 0,
      ),
    ),
  ).sort((left, right) => left - right);
}

function dedupeStrings(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function formatPreview(values: Array<number | string>): string {
  const preview = values.slice(0, 4).join(", ");
  if (values.length <= 4) {
    return preview;
  }

  return `${preview} +${values.length - 4}`;
}

export function parseBilibiliRetryMetadata(
  raw: string | undefined,
): BilibiliRetryMetadata | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as BilibiliRetryMetadata;
    if (parsed?.shape === "bilibili_all_parts") {
      return parsed;
    }

    if (parsed?.shape === "bilibili_collection") {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function getBilibiliRetryGapSummary(
  raw: string | undefined,
): BilibiliRetryGapSummary | undefined {
  const metadata = parseBilibiliRetryMetadata(raw);
  if (!metadata) {
    return undefined;
  }

  if (metadata.shape === "bilibili_all_parts") {
    const completed = new Set(dedupeSortedNumbers(metadata.completedPartNumbers));
    const failed = dedupeSortedNumbers(metadata.failedPartNumbers);
    const expectedCount =
      typeof metadata.expectedCount === "number" && metadata.expectedCount > 0
        ? metadata.expectedCount
        : undefined;

    const inferredMissing = expectedCount
      ? Array.from({ length: expectedCount }, (_, index) => index + 1).filter(
          (partNumber) => !completed.has(partNumber),
        )
      : [];
    const missingNumbers = Array.from(
      new Set([...failed, ...inferredMissing]),
    ).sort((left, right) => left - right);

    if (missingNumbers.length === 0) {
      return undefined;
    }

    return {
      labelKey: "missingEpisodes",
      missingCount: missingNumbers.length,
      displayValue: formatPreview(missingNumbers),
    };
  }

  const expectedVideoBvids = dedupeStrings(metadata.expectedVideoBvids);
  const completedVideoBvids = new Set(dedupeStrings(metadata.completedVideoBvids));
  const failedVideoBvids = dedupeStrings(metadata.failedVideoBvids);
  const inferredMissing = expectedVideoBvids.filter(
    (bvid) => !completedVideoBvids.has(bvid),
  );
  const missingVideoBvids = Array.from(
    new Set([...failedVideoBvids, ...inferredMissing]),
  );
  const expectedCount =
    expectedVideoBvids.length > 0
      ? expectedVideoBvids.length
      : metadata.collectionInfo?.count;
  const missingCount =
    missingVideoBvids.length > 0
      ? missingVideoBvids.length
      : expectedCount && completedVideoBvids.size <= expectedCount
        ? expectedCount - completedVideoBvids.size
        : 0;

  if (missingCount <= 0) {
    return undefined;
  }

  return {
    labelKey:
      metadata.collectionInfo?.type === "series"
        ? "missingEpisodes"
        : "missingVideos",
    missingCount,
    displayValue:
      missingVideoBvids.length > 0 && missingVideoBvids.length <= 3
        ? formatPreview(missingVideoBvids)
        : expectedCount
          ? `${missingCount} / ${expectedCount}`
          : String(missingCount),
  };
}
