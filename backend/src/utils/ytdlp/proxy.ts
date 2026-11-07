import { SocksProxyAgent } from "socks-proxy-agent";
import { logger } from "../logger";

const REDACTED_PROXY_URL = "[redacted]";

/**
 * Reduce a proxy URL to what is safe to log: scheme, host and port.
 *
 * Credentials can only be cut out of a URL that parses. Otherwise there is no
 * telling where they end (`http://user:pa/ss@host` fails on its port, and
 * `user:secret@host` parses as scheme `user:` with no host), so anything without
 * a parsed host gets a placeholder rather than a best-effort guess.
 */
function redactProxyUrl(proxyUrl: string): string {
  try {
    const { protocol, host } = new URL(proxyUrl);
    return host ? `${protocol}//${host}` : REDACTED_PROXY_URL;
  } catch {
    return REDACTED_PROXY_URL;
  }
}

/**
 * Keep only an error's name and message. Node's URL errors hold the raw URL in
 * an enumerable `input` property, which JSON.stringify and util.inspect print.
 */
function withoutErrorDetails(error: Error): Error {
  const safeError = new Error(error.message);
  safeError.name = error.name;
  return safeError;
}

/**
 * Decode a URL credential like Python's urllib.parse.unquote, which is what
 * yt-dlp's proxy handling uses for HTTP proxies.
 *
 * decodeURIComponent throws on a stray `%`, so a password such as `100%` that
 * yt-dlp sends as-is would be rejected here. Instead, valid escapes are decoded
 * and any other `%` is left alone. Runs of escapes decode together so multi-byte
 * UTF-8 survives, and invalid UTF-8 becomes U+FFFD, matching unquote's default
 * errors="replace". yt-dlp's SOCKS handling also turns `+` into a space
 * (unquote_plus); that is not copied here, so `+` stays literal on both routes.
 */
function unquoteCredential(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (escapes) =>
    Buffer.from(escapes.replace(/%/g, ""), "hex").toString("utf8")
  );
}

/**
 * Error thrown when proxy configuration is invalid.
 *
 * The URL may hold credentials and this error's text ends up in logs, so the
 * message and `proxyUrl` only ever carry the redacted form.
 */
export class InvalidProxyError extends Error {
  readonly proxyUrl: string;
  readonly originalError?: Error;

  constructor(proxyUrl: string, originalError?: Error) {
    const redactedProxyUrl = redactProxyUrl(proxyUrl);
    super(`Invalid proxy URL: ${redactedProxyUrl}`);
    this.name = "InvalidProxyError";
    this.proxyUrl = redactedProxyUrl;
    this.originalError = originalError && withoutErrorDetails(originalError);
  }
}

/**
 * Helper to convert a proxy URL string into an Axios config object
 * Supports http/https/socks5 proxies with authentication
 * Format: http://user:pass@host:port or socks5://user:pass@host:port
 *
 * An empty string is yt-dlp's "connect directly" value, which proxyOnlyYoutube
 * sets to override a proxy inherited from the environment. axios reads
 * HTTP_PROXY from the environment on its own, so it has to be told explicitly:
 * returning `{}` would leave the side request on the very proxy the setting
 * just took the download off, and the two would take different egress paths.
 * A missing value stays `{}` - that is "nothing configured", not "go direct".
 *
 * @throws {InvalidProxyError} If the proxy URL is malformed - this prevents
 *         silent fallback to direct connection which could expose user's real IP
 */
export function getAxiosProxyConfig(proxyUrl: string): any {
  if (proxyUrl === "") return { proxy: false };
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
      //
      // socks-proxy-agent decodes credentials with decodeURIComponent, which
      // throws on a stray `%`, so hand it a strictly encoded form of them.
      url.username = encodeURIComponent(unquoteCredential(url.username));
      url.password = encodeURIComponent(unquoteCredential(url.password));
      let agentUrl = url.toString();

      // Convert socks5 to socks5h (remote DNS resolution)
      // If user already specified socks5h, keep it as-is
      if (protocol === "socks5") {
        agentUrl = agentUrl.replace("socks5://", "socks5h://");
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
        username: unquoteCredential(url.username),
        password: unquoteCredential(url.password),
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
    const invalidProxyError = new InvalidProxyError(
      proxyUrl,
      error instanceof Error ? error : new Error(String(error))
    );
    logger.error(
      "Invalid proxy URL:",
      invalidProxyError.proxyUrl,
      invalidProxyError.originalError
    );
    throw invalidProxyError;
  }
}
