// Re-exported from the storage layer's canonical source so retry-policy callers
// keep a single import surface without redeclaring the status literals.
export {
  PARTIAL_STATUS,
  PENDING_RETRY_STATUS,
} from "../storageService/downloadHistoryStatus";

export const DEFAULT_AUTO_RETRY_TIMES = 3;
export const DEFAULT_AUTO_RETRY_INTERVAL_MINUTES = 5;
export const AUTO_RETRY_INTERVAL_OPTIONS = new Set([1, 5, 10, 30, 60]);

export function normalizeAutoRetryTimes(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_AUTO_RETRY_TIMES;
  }

  return Math.min(10, Math.max(1, Math.floor(numeric)));
}

export function normalizeAutoRetryIntervalMinutes(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_AUTO_RETRY_INTERVAL_MINUTES;
  }

  const normalized = Math.floor(numeric);
  return AUTO_RETRY_INTERVAL_OPTIONS.has(normalized)
    ? normalized
    : DEFAULT_AUTO_RETRY_INTERVAL_MINUTES;
}
