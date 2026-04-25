import { SocksProxyAgent } from "socks-proxy-agent";
import { isAdminTrustLevelAtLeast } from "../../config/adminTrust";
import * as storageService from "../../services/storageService";
import { isYouTubeUrl } from "../helpers";

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
      console.log("Parsed user yt-dlp config:", parsedConfig);

      // If proxy is restricted to YouTube only, and we have a non-YouTube URL
      if (proxyOnlyYoutube && url) {
        const isYoutube = isYouTubeUrl(url);
        if (!isYoutube) {
          console.log(
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
    console.error("Error reading user yt-dlp config:", error);
  }
  return {};
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

/**
 * Error thrown when proxy configuration is invalid
 */
export class InvalidProxyError extends Error {
  readonly proxyUrl: string;
  readonly originalError?: Error;

  constructor(proxyUrl: string, originalError?: Error) {
    super(`Invalid proxy URL: ${proxyUrl}`);
    this.name = "InvalidProxyError";
    this.proxyUrl = proxyUrl;
    this.originalError = originalError;
  }
}

/**
 * Helper to convert a proxy URL string into an Axios config object
 * Supports http/https/socks5 proxies with authentication
 * Format: http://user:pass@host:port or socks5://user:pass@host:port
 *
 * @throws {InvalidProxyError} If the proxy URL is malformed - this prevents
 *         silent fallback to direct connection which could expose user's real IP
 */
export function getAxiosProxyConfig(proxyUrl: string): any {
  if (!proxyUrl) return {};

  try {
    const url = new URL(proxyUrl);
    const protocol = url.protocol.replace(":", "");

    // Validate that we have a hostname
    if (!url.hostname) {
      throw new InvalidProxyError(proxyUrl, new Error("Missing hostname"));
    }

    // Check if this is a SOCKS proxy
    if (protocol.startsWith("socks")) {
      // Force remote DNS resolution by using socks5h for all socks5 variants
      // socks-proxy-agent uses socks5h to indicate remote DNS resolution
      // Remote DNS resolution helps avoid:
      // - DNS pollution/poisoning on the client side
      // - DNS blocking by local network
      // - DNS resolution delays
      let agentUrl = proxyUrl;

      // Convert socks5 to socks5h (remote DNS resolution)
      // If user already specified socks5h, keep it as-is
      if (protocol === "socks5") {
        agentUrl = proxyUrl.replace("socks5://", "socks5h://");
        console.log("Converted socks5 to socks5h for remote DNS resolution");
      } else if (protocol === "socks5h") {
        // Already using remote DNS, no conversion needed
        console.log("Using socks5h (remote DNS resolution)");
      }
      // Note: socks4/socks4a don't support remote DNS, so we leave them as-is

      // Use SocksProxyAgent for SOCKS proxy support
      const agent = new SocksProxyAgent(agentUrl);
      return {
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false, // Disable axios built-in proxy when using custom agents
      };
    }

    // Validate protocol for non-SOCKS proxies
    if (protocol !== "http" && protocol !== "https") {
      throw new InvalidProxyError(
        proxyUrl,
        new Error(`Unsupported proxy protocol: ${protocol}`)
      );
    }

    // Handle HTTP/HTTPS proxies
    const isHttps = protocol === "https";
    const defaultPort = isHttps ? 443 : 80;

    // Axios proxy config structure
    const proxyConfig: any = {
      protocol: protocol,
      host: url.hostname,
      port: parseInt(url.port, 10) || defaultPort,
    };

    if (url.username || url.password) {
      proxyConfig.auth = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    }

    return { proxy: proxyConfig };
  } catch (error) {
    // Re-throw InvalidProxyError as-is
    if (error instanceof InvalidProxyError) {
      throw error;
    }
    // Wrap other errors (like URL parsing errors) in InvalidProxyError
    // This ensures we fail rather than silently falling back to direct connection
    console.error("Invalid proxy URL:", proxyUrl, error);
    throw new InvalidProxyError(
      proxyUrl,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
