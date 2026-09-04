import { isAdminTrustLevelAtLeast } from "../../config/adminTrust";
import * as storageService from "../../services/storageService";
import { isYouTubeUrl } from "../helpers";
import { logger } from "../logger";

/**
 * Parse yt-dlp configuration text into flags object
 * Supports standard yt-dlp config file format (one option per line, # for comments)
 */
export function parseYtDlpConfig(configText: string): Record<string, any> {
  const flags: Record<string, any> = {};

  if (!configText || typeof configText !== "string") {
    return flags;
  }

  const lines = configText.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) {
      continue;
    }

    // Parse the option
    // Options can be:
    // -f value
    // --format value
    // --some-flag (boolean)
    // -x (short boolean)

    let optionName: string | null = null;
    let optionValue: string | boolean = true;

    if (line.startsWith("--")) {
      // Long option
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) {
        // Boolean flag (no value)
        optionName = line.substring(2);
      } else {
        optionName = line.substring(2, spaceIndex);
        optionValue = line.substring(spaceIndex + 1).trim();
        // Remove surrounding quotes if present
        if (
          (optionValue.startsWith('"') && optionValue.endsWith('"')) ||
          (optionValue.startsWith("'") && optionValue.endsWith("'"))
        ) {
          optionValue = optionValue.slice(1, -1);
        }
      }
    } else if (line.startsWith("-") && !line.startsWith("--")) {
      // Short option
      const parts = line.split(/\s+/);
      optionName = parts[0].substring(1);
      if (parts.length > 1) {
        optionValue = parts.slice(1).join(" ");
        // Remove surrounding quotes if present
        if (
          typeof optionValue === "string" &&
          ((optionValue.startsWith('"') && optionValue.endsWith('"')) ||
            (optionValue.startsWith("'") && optionValue.endsWith("'")))
        ) {
          optionValue = optionValue.slice(1, -1);
        }
      }
    }

    if (optionName) {
      // Convert kebab-case to camelCase for flags object
      const camelCaseName = optionName.replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      flags[camelCaseName] = optionValue;
    }
  }

  return flags;
}

/**
 * Get user's yt-dlp configuration from settings
 * @param url - Optional URL to contextually filter settings (e.g. proxy only for YouTube)
 */
export function getUserYtDlpConfig(url?: string): Record<string, any> {
  try {
    if (!isAdminTrustLevelAtLeast("container")) {
      return {};
    }

    const settings = storageService.getSettings();
    const configText = settings.ytDlpConfig;
    const proxyOnlyYoutube = settings.proxyOnlyYoutube === true;

    const parsedConfig = configText ? parseYtDlpConfig(configText) : {};
    if (configText) {
      logger.info("Parsed user yt-dlp config:", parsedConfig);
    }

    // If proxy is restricted to YouTube only, and we have a non-YouTube URL
    if (proxyOnlyYoutube && url && !isYouTubeUrl(url)) {
      logger.info(
        "Proxy restricted to YouTube only. Forcing a direct connection for:",
        url
      );
      // An empty --proxy is yt-dlp's explicit "connect directly" value. Merely
      // dropping the flag is not enough: yt-dlp reads HTTP_PROXY/HTTPS_PROXY
      // from its own environment, which it inherits from this process, so a
      // deployment that sets those kept proxying every non-YouTube download
      // (issue #446). For the same reason this runs even when the user set no
      // yt-dlp config text at all - that is precisely the deployment where the
      // proxy comes from the environment rather than from the config.
      parsedConfig.proxy = "";
    }

    return parsedConfig;
  } catch (error) {
    logger.error("Error reading user yt-dlp config:", error);
  }
  return {};
}

/**
 * Hosts the deployment wants reached directly, even when the container carries
 * an HTTP_PROXY/HTTPS_PROXY.
 *
 * yt-dlp inherits those variables from this process and applies them to every
 * request it makes - including each HLS fragment - and NO_PROXY is the only
 * lever that discriminates per request host, so this list is folded into the
 * child's NO_PROXY rather than turned into a flag (issue #446).
 *
 * Entries are bare host names. Both of yt-dlp's request backends match them by
 * domain suffix, so `surrit.com` already covers every subdomain; neither treats
 * a leading `*.` as a wildcard, so that prefix is stripped instead of being
 * left to silently never match. A lone `*` means "bypass the proxy entirely"
 * and is passed through as-is.
 *
 * This governs yt-dlp's own egress only. MyTube's side requests (thumbnails,
 * API metadata) go out through axios, which reads NO_PROXY from this process's
 * environment rather than from the snapshot handed to the child, and matching a
 * host list is something both request stacks already implement - reproducing
 * those semantics a third time here is how the three drift apart. A host that
 * must be off the proxy for everything MyTube does belongs in the container's
 * own NO_PROXY, which every stack honours.
 *
 * Gated at the same trust level as the yt-dlp config it complements: the value
 * decides which traffic leaves the container unproxied.
 */
export function getProxyBypassHosts(): string[] {
  if (!isAdminTrustLevelAtLeast("container")) {
    return [];
  }

  const raw = storageService.getSettings().ytDlpProxyBypassHosts;
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }

  const hosts = new Set<string>();
  for (const entry of raw.split(/[\s,]+/)) {
    const host = entry.trim().replace(/^\*?\./, "");
    if (host) {
      hosts.add(host);
    }
  }

  return [...hosts];
}

// Short/long spellings of the same yt-dlp option produce different keys after
// parsing (`-f` -> `f`, `--format` -> `format`). When an override uses a
// different spelling than the global config, both keys would survive a naive
// merge and downstream readers could pick the stale global value (e.g.
// `getNetworkConfigFromUserConfig` prefers `r` over `limitRate`), so any key in
// a group supersedes every alias in that group.
const OPTION_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["f", "format"],
  ["S", "formatSort"],
  ["r", "limitRate"],
  ["R", "retries"],
  ["4", "forceIpv4"],
  ["6", "forceIpv6"],
  ["sleepInterval", "minSleepInterval"],
  ["x", "extractAudio"],
];

/**
 * Compute the effective yt-dlp user config for a download, layering an optional
 * per-subscription override on top of the global config (issue #345).
 *
 * Precedence (per-key): subscriptionOverride > global. Keys the override does
 * not set (typically network/proxy) are inherited from the global config, so a
 * per-subscription override changes only what it explicitly mentions.
 *
 * The override carries the same arbitrary-args capability surface as the global
 * ytDlpConfig, so it is gated to the same "container" admin-trust level: below
 * that level the override is dropped entirely and this behaves identically to
 * getUserYtDlpConfig(url). An empty/whitespace override is likewise ignored,
 * preserving today's global-only behaviour (backward compatibility).
 *
 * @param url - URL being downloaded (used for the proxyOnlyYoutube logic).
 * @param subscriptionOverride - Raw override text from subscriptions.ytdlp_config.
 */
export function getEffectiveUserYtDlpConfig(
  url?: string,
  subscriptionOverride?: string | null
): Record<string, any> {
  const globalConfig = getUserYtDlpConfig(url);

  if (
    subscriptionOverride &&
    typeof subscriptionOverride === "string" &&
    subscriptionOverride.trim() &&
    isAdminTrustLevelAtLeast("container")
  ) {
    const overrideConfig = parseYtDlpConfig(subscriptionOverride);
    logger.info("Applying per-subscription yt-dlp override");

    // Start from the global config, then drop any global key that the override
    // supersedes via an *alias* (short/long form of the same option) so the
    // override's value cleanly wins. Without this, e.g. a global `--format X`
    // (key `format`) and an override `-f Y` (key `f`) would both survive the
    // spread, leaving two competing format keys in the flags object.
    const merged: Record<string, any> = { ...globalConfig };
    for (const group of OPTION_ALIAS_GROUPS) {
      if (group.some((key) => key in overrideConfig)) {
        for (const key of group) {
          delete merged[key];
        }
      }
    }

    // An override that sets its own format selector takes full control of the
    // download mode. Without this, a global `--extract-audio`/`-x` would leak
    // into e.g. a `-f bestvideo+bestaudio` override and route the subscription
    // through the audio path, ignoring the requested video format. Overrides
    // that want audio extraction can set `-x` (or an audio-only selector)
    // themselves.
    const overrideSetsFormat = ["f", "format"].some(
      (key) => key in overrideConfig
    );
    const overrideSetsExtractAudio = ["x", "extractAudio"].some(
      (key) => key in overrideConfig
    );
    if (overrideSetsFormat && !overrideSetsExtractAudio) {
      delete merged.x;
      delete merged.extractAudio;
    }

    // Override keys win; everything else inherits from the global config.
    return { ...merged, ...overrideConfig };
  }

  return globalConfig;
}

// Auth/header options that discovery and metadata probes must carry so a
// private/age-gated/authenticated source can be listed with the same identity
// the download will use. Copied through verbatim (camelCase keys as produced
// by parseYtDlpConfig, plus yt-dlp short aliases).
const AUTH_PASSTHROUGH_KEYS = [
  "cookies",
  "cookiesFromBrowser",
  "addHeader",
  "addHeaders",
  "userAgent",
  "referer",
  "username",
  "u",
  "password",
  "p",
  "twofactor",
  "2",
  "netrc",
  "netrcLocation",
  "netrcCmd",
  "videoPassword",
  "apMso",
  "apUsername",
  "apPassword",
  "clientCertificate",
  "clientCertificateKey",
  "clientCertificatePassword",
] as const;

/**
 * Extract network-related options from user config
 * These are safe to apply to all operations (search, info, download)
 */
export function getNetworkConfigFromUserConfig(
  userConfig: Record<string, any>
): Record<string, any> {
  const networkOptions: Record<string, any> = {};

  // Auth/cookies/headers needed to access private or age-gated sources
  for (const key of AUTH_PASSTHROUGH_KEYS) {
    if (userConfig[key] !== undefined) {
      networkOptions[key] = userConfig[key];
    }
  }

  // Proxy settings. An empty string is meaningful, not absent: it is yt-dlp's
  // "connect directly" value, which proxyOnlyYoutube sets to override an
  // environment proxy, so it must be forwarded rather than treated as unset.
  if (typeof userConfig.proxy === "string") {
    networkOptions.proxy = userConfig.proxy;
  }

  // Rate limiting
  if (userConfig.r || userConfig.limitRate) {
    networkOptions.limitRate = userConfig.r || userConfig.limitRate;
  }

  // Socket timeout
  if (userConfig.socketTimeout) {
    networkOptions.socketTimeout = userConfig.socketTimeout;
  }

  // Force IPv4/IPv6
  if (userConfig.forceIpv4 || userConfig["4"]) {
    networkOptions.forceIpv4 = true;
  }
  if (userConfig.forceIpv6 || userConfig["6"]) {
    networkOptions.forceIpv6 = true;
  }

  // Geo bypass
  if (userConfig.xff) {
    networkOptions.xff = userConfig.xff;
  }

  // Sleep/rate limiting
  if (userConfig.sleepRequests) {
    networkOptions.sleepRequests = userConfig.sleepRequests;
  }
  if (userConfig.sleepInterval || userConfig.minSleepInterval) {
    networkOptions.sleepInterval =
      userConfig.sleepInterval || userConfig.minSleepInterval;
  }
  if (userConfig.maxSleepInterval) {
    networkOptions.maxSleepInterval = userConfig.maxSleepInterval;
  }

  // Retries
  if (userConfig.retries || userConfig.R) {
    networkOptions.retries = userConfig.retries || userConfig.R;
  }

  return networkOptions;
}
