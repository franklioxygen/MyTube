export const DEFAULT_YT_DLP_PATH = "yt-dlp";
export const YT_DLP_JS_RUNTIME_ENV = "YT_DLP_JS_RUNTIME";
export const YT_DLP_HELP_PROBE_TIMEOUT_MS = 5000;
export const YT_DLP_STALE_AFTER_DAYS = 90;
export const YT_DLP_PIP_PACKAGE = "yt-dlp[default,curl-cffi]";
export const YT_DLP_PIP_PROVIDER_PACKAGE = "bgutil-ytdlp-pot-provider";
export const YT_DLP_PIP_TIMEOUT_MS = 10 * 60 * 1000;
export const YT_DLP_PYTHON_PROBE_TIMEOUT_MS = 15_000;
export const YT_DLP_PUBLISH_LOCK_STALE_MS = 2 * 60 * 1000;
export const YT_DLP_PUBLISH_LOCK_WAIT_MS = 15_000;
export const YT_DLP_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const YT_DLP_GC_KEEP_PREVIOUS_COUNT = 2;
/**
 * A release is finalized before it is published, and an installer can crash in
 * between. Never collect a release younger than this, so a concurrent
 * collection can't delete a candidate a publisher is about to point at.
 */
export const YT_DLP_RELEASE_MIN_RETENTION_MS = 60 * 60 * 1000;
/**
 * How long a lease must sit before collection reports it. Leases are never
 * reclaimed automatically — PID reuse, container namespaces and orphaned
 * subprocesses make that unsafe — so this only controls the warning.
 */
export const YT_DLP_STALE_LEASE_WARN_MS = 24 * 60 * 60 * 1000;
/**
 * Minimum spacing between opportunistic collections. Collection scans the
 * store, so it must not run once per finished download; this bounds it while
 * still reclaiming a release soon after the lease pinning it goes away.
 */
export const YT_DLP_GC_MIN_INTERVAL_MS = 60 * 60 * 1000;
export const YT_DLP_WINDOWS_RENAME_ATTEMPTS = 8;
export const YT_DLP_MANAGED_STORE_DIRNAME = "ytdlp";
export const YT_DLP_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_YOUTUBE_PLAYER_CLIENT_EXTRACTOR_ARG =
  "youtube:player_client=default,mweb";
export const DEFAULT_YOUTUBE_REMOTE_COMPONENTS = "ejs:github";
export const YOUTUBE_PLAYER_CLIENT_ARG_PREFIX = "youtube:player_client=";
export const PROVIDER_SCRIPT_ARG_PREFIX = "youtubepot-bgutilscript:script_path=";

export type YouTubeJsRuntimeFlag = "--js-runtime" | "--js-runtimes";
