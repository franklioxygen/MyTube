/**
 * Type definitions for continuous download tasks
 */

export const DOWNLOAD_ORDERS = [
  "dateDesc",
  "dateAsc",
  "viewsDesc",
  "viewsAsc",
] as const;

export type DownloadOrder = (typeof DOWNLOAD_ORDERS)[number];

export function parseDownloadOrder(value: unknown): DownloadOrder | null {
  return DOWNLOAD_ORDERS.includes(value as DownloadOrder)
    ? (value as DownloadOrder)
    : null;
}

export type PublishedDatePrecision = "day" | "second" | "unknown";

export interface VideoEntry {
  url: string;
  sourceVideoId: string;
  publishedAtMs: number | null;
  publishedDatePrecision: PublishedDatePrecision;
  viewCount: number | null;
  sourceIndex: number;
}

export interface OrderingMetadataStats {
  entryCount: number;
  knownDates: number;
  unknownDates: number;
  knownViewCounts: number;
  unknownViewCounts: number;
}

export interface FrozenDownloadPlanV2 {
  version: 2;
  taskId: string;
  sourceUrl: string;
  platform: string;
  downloadOrder: DownloadOrder;
  createdAt: string;
  entries: VideoEntry[];
  metadataStats: OrderingMetadataStats;
  warnings: string[];
}

export interface OrderingPlanningFailure {
  version: 1;
  code:
    | "ORDERING_METADATA_UNAVAILABLE"
    | "ORDERING_METADATA_HYDRATION_FAILED"
    | "ORDERING_PLAN_PERSIST_FAILED"
    | "ORDERING_PLAN_INVALID"
    | "SOURCE_ENUMERATION_FAILED";
  message: string;
  retryable: boolean;
  platform: string;
  downloadOrder: DownloadOrder;
  entryCount: number;
  knownCount: number;
  unknownCount: number;
  suggestedAction:
    | "check_cookies_or_proxy"
    | "retry_metadata"
    | "check_storage";
}

export interface OrderingMetadataWarning {
  code: "ORDERING_METADATA_PARTIAL";
  message: string;
  knownCount: number;
  unknownCount: number;
}

export interface ContinuousTaskRuntimeState {
  phase: "planning" | "downloading" | "terminal";
  planningProgress?: {
    enumerated: number;
    hydrated: number;
    requiredMetadataKnown: number;
    requiredMetadataUnknown: number;
  };
}

export interface ContinuousDownloadTask {
  id: string;
  subscriptionId?: string;
  collectionId?: string; // For playlist tasks
  playlistName?: string; // Name of the collection (playlist)
  authorUrl: string;
  author: string;
  platform: string;
  status: "active" | "paused" | "completed" | "cancelled";
  totalVideos: number;
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  currentVideoIndex: number;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  error?: string;
  downloadOrder?: DownloadOrder;
  frozenVideoListPath?: string;
  planningError?: OrderingPlanningFailure;
  orderingWarnings?: OrderingMetadataWarning[];
  runtimeState?: ContinuousTaskRuntimeState;
}
