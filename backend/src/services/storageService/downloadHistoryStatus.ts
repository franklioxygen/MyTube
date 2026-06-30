/**
 * Canonical `download_history.status` string constants.
 *
 * Lives in the storage layer (the lowest layer that owns these values) so both
 * the storage queries and the higher-level download-manager retry logic share a
 * single source of truth instead of redeclaring the literals.
 */
export const PENDING_RETRY_STATUS = "pending_retry";
export const PARTIAL_STATUS = "partial";
