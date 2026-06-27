export type MergeCount = {
  merged: number;
  skipped: number;
};

export type DatabaseMergeSummary = {
  videos: MergeCount;
  collections: MergeCount;
  collectionLinks: MergeCount;
  subscriptions: MergeCount;
  downloadHistory: MergeCount;
  videoDownloads: MergeCount;
  tags: MergeCount;
};

export type MergeRow = Record<string, unknown>;

export type MergeExecutionOptions = {
  applyChanges: boolean;
  persistTagSettings: boolean;
};

export const MERGEABLE_TABLES = [
  "videos",
  "collections",
  "collection_videos",
  "subscriptions",
  "download_history",
  "video_downloads",
  "settings",
] as const;

export function createEmptyMergeSummary(): DatabaseMergeSummary {
  return {
    videos: { merged: 0, skipped: 0 },
    collections: { merged: 0, skipped: 0 },
    collectionLinks: { merged: 0, skipped: 0 },
    subscriptions: { merged: 0, skipped: 0 },
    downloadHistory: { merged: 0, skipped: 0 },
    videoDownloads: { merged: 0, skipped: 0 },
    tags: { merged: 0, skipped: 0 },
  };
}
