import { SocksProxyAgent } from "socks-proxy-agent";
import { logger } from "../logger";

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
        logger.info("Converted socks5 to socks5h for remote DNS resolution");
      } else if (protocol === "socks5h") {
        // Already using remote DNS, no conversion needed
        logger.info("Using socks5h (remote DNS resolution)");
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
    logger.error("Invalid proxy URL:", proxyUrl, error);
    throw new InvalidProxyError(
      proxyUrl,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
