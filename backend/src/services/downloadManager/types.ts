import type {
  ActorRole,
  CanonicalSourceKind,
  StatisticsSurface,
} from "../statistics";
import type { DownloadRetryMetadata } from "../downloadRetryMetadata";

export interface StatisticsAttribution {
  actorRole: ActorRole;
  surface: StatisticsSurface;
  sourceKind: CanonicalSourceKind;
  relatedEventId: string | null;
  enqueuedEventId: string | null;
}

export interface DownloadTask {
  downloadFn: (registerCancel: (cancel: () => void) => void) => Promise<any>;
  id: string;
  title: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  cancelFn?: () => void;
  sourceUrl?: string;
  type?: string;
  retryMetadata?: DownloadRetryMetadata;
  cancelled?: boolean;
  cancellationFinalized?: boolean;
  cancellationRejected?: boolean;
  statistics?: StatisticsAttribution;
}

export interface AddDownloadStatisticsOptions {
  actorRole?: ActorRole;
  surface?: StatisticsSurface | string;
  sourceKind?: CanonicalSourceKind | string;
  relatedEventId?: string | null;
  enqueuedEventId?: string | null;
}

export const TASK_FAIL_HOOK_WAIT_TIMEOUT_MS = 5000;
export const CANCEL_TASK_WAIT_TIMEOUT_MS = 5000;

export function isStructuredDownloadResult(
  value: unknown,
): value is {
  success: boolean;
  partial?: boolean;
  error?: string;
} {
  return Boolean(value) && typeof value === "object" && "success" in (value as any);
}

export function getStructuredDownloadResult(
  error: unknown,
): {
  success: boolean;
  partial?: boolean;
  error?: string;
} | undefined {
  if (!error || typeof error !== "object" || !("downloadResult" in error)) {
    return undefined;
  }

  const result = (error as { downloadResult?: unknown }).downloadResult;
  return isStructuredDownloadResult(result) ? result : undefined;
}
