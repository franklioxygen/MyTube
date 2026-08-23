export const DEFAULT_YT_DLP_PATH = "yt-dlp";
export const YT_DLP_JS_RUNTIME_ENV = "YT_DLP_JS_RUNTIME";
export const YT_DLP_HELP_PROBE_TIMEOUT_MS = 5000;
export const YT_DLP_STALE_AFTER_DAYS = 90;
// How long an in-place update waits for running yt-dlp processes to finish
// before replacing the installation underneath them.
export const YT_DLP_UPDATE_DRAIN_TIMEOUT_MS = 30000;
export const DEFAULT_YOUTUBE_PLAYER_CLIENT_EXTRACTOR_ARG =
  "youtube:player_client=default,mweb";
export const DEFAULT_YOUTUBE_REMOTE_COMPONENTS = "ejs:github";
export const YOUTUBE_PLAYER_CLIENT_ARG_PREFIX = "youtube:player_client=";
export const PROVIDER_SCRIPT_ARG_PREFIX = "youtubepot-bgutilscript:script_path=";

export type YouTubeJsRuntimeFlag = "--js-runtime" | "--js-runtimes";
