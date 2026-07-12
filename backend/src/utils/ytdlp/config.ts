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

    if (configText) {
      const parsedConfig = parseYtDlpConfig(configText);
      logger.info("Parsed user yt-dlp config:", parsedConfig);

      // If proxy is restricted to YouTube only, and we have a non-YouTube URL
      if (proxyOnlyYoutube && url) {
        const isYoutube = isYouTubeUrl(url);
        if (!isYoutube) {
          logger.info(
            "Proxy restricted to YouTube only. Removing proxy settings for:",
            url
          );
          // Remove proxy-related settings
          delete parsedConfig.proxy;
          // Also remove potentially related network options if they are usually proxy-specific?
          // sticking to just 'proxy' as per request and standard usage.
        }
      }

      return parsedConfig;
    }
  } catch (error) {
    logger.error("Error reading user yt-dlp config:", error);
  }
  return {};
}

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
    logger.info("Applying per-subscription yt-dlp override:", overrideConfig);

    // Start from the global config, then drop any global key that the override
    // supersedes via an *alias* (short/long form of the same option) so the
    // override's value cleanly wins. Without this, e.g. a global `--format X`
    // (key `format`) and an override `-f Y` (key `f`) would both survive the
    // spread, leaving two competing format keys in the flags object.
    const merged: Record<string, any> = { ...globalConfig };
    const ALIAS_GROUPS = [
      ["f", "format"],
      ["S", "formatSort"],
    ];
    for (const group of ALIAS_GROUPS) {
      if (group.some((key) => key in overrideConfig)) {
        for (const key of group) {
          delete merged[key];
        }
      }
    }

    // Override keys win; everything else inherits from the global config.
    return { ...merged, ...overrideConfig };
  }

  return globalConfig;
}

/**
 * Extract network-related options from user config
 * These are safe to apply to all operations (search, info, download)
 */
export function getNetworkConfigFromUserConfig(
  userConfig: Record<string, any>
): Record<string, any> {
  const networkOptions: Record<string, any> = {};

  // Proxy settings
  if (userConfig.proxy) {
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
