const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);
const BLOCKED_PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);
const BLOCKED_PRIVATE_HOST_PREFIXES = [
  "10.",
  "192.168.",
  ...Array.from({ length: 16 }, (_, i) => `172.${i + 16}.`),
];

function isBlockedPrivateHostname(hostname: string): boolean {
  if (BLOCKED_PRIVATE_HOSTNAMES.has(hostname)) {
    return true;
  }
  return BLOCKED_PRIVATE_HOST_PREFIXES.some((prefix) =>
    hostname.startsWith(prefix),
  );
}

/**
 * Validates a URL to prevent SSRF attacks
 * Only allows http/https protocols and validates the hostname
 */
export function validateUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Only allow http and https protocols
    if (!ALLOWED_URL_PROTOCOLS.has(urlObj.protocol)) {
      throw new Error(
        `Invalid protocol: ${urlObj.protocol}. Only http and https are allowed.`,
      );
    }

    // Block private/internal IP addresses
    const hostname = urlObj.hostname;
    if (isBlockedPrivateHostname(hostname)) {
      throw new Error(
        `SSRF protection: Blocked access to private/internal IP: ${hostname}`,
      );
    }

    return url;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid URL format: ${url}`);
    }
    throw error;
  }
}

/**
 * Allowed hostnames are exact (e.g. "missav.com") or subdomains (e.g. "www.missav.com").
 * Comparison is case-insensitive; hostname is normalized to lowercase.
 */
export function isHostnameAllowed(
  hostname: string,
  allowedHostnames: readonly string[],
): boolean {
  const normalized = hostname.toLowerCase();
  for (const allowed of allowedHostnames) {
    const allowedLower = allowed.toLowerCase();
    if (
      normalized === allowedLower ||
      normalized.endsWith("." + allowedLower)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Rejects path traversal: pathname must not contain ".." as a path segment.
 */
function hasPathTraversal(pathname: string): boolean {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  return segments.some((segment) => segment === "..");
}

/**
 * Validates a URL for outgoing requests with an allow-list of hostnames to prevent SSRF.
 * Use this when the request target must be restricted to specific domains (e.g. a downloader for one site).
 * - Enforces http/https and blocks private IPs (same as validateUrl).
 * - Restricts hostname to the allow-list (exact or subdomain match).
 * - Rejects path traversal ("..") in the pathname.
 */
export function validateUrlWithAllowlist(
  url: string,
  allowedHostnames: readonly string[],
): string {
  validateUrl(url);
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;

  if (!isHostnameAllowed(hostname, allowedHostnames)) {
    throw new Error(
      `SSRF protection: Hostname ${hostname} is not in the allow-list.`,
    );
  }

  if (hasPathTraversal(urlObj.pathname)) {
    throw new Error(
      `SSRF protection: Path traversal ("..") is not allowed in the URL path.`,
    );
  }

  return url;
}

/**
 * Builds a normalized http/https URL string after allow-list validation.
 * Result intentionally excludes credentials and explicit ports.
 */
export function buildAllowlistedHttpUrl(
  url: string,
  allowedHostnames: readonly string[],
): string {
  const validatedUrl = validateUrlWithAllowlist(url, allowedHostnames);
  const parsedUrl = new URL(validatedUrl);

  if (!isHostnameAllowed(parsedUrl.hostname, allowedHostnames)) {
    throw new Error(
      `SSRF protection: Hostname ${parsedUrl.hostname} is not in the allow-list.`,
    );
  }

  if (parsedUrl.username || parsedUrl.password || parsedUrl.port) {
    throw new Error(
      "SSRF protection: URLs with credentials or explicit ports are not allowed.",
    );
  }

  return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`;
}

/**
 * Validates a redirect URL against an allowlist to prevent open redirect vulnerabilities
 * @param url - The URL to validate
 * @param allowedOrigin - The allowed origin (e.g., "https://example.com")
 * @returns The validated URL
 * @throws Error if the URL is invalid or not in the allowlist
 */
export function validateRedirectUrl(
  url: string,
  allowedOrigin: string,
): string {
  // Ensure URL is a string and not empty
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("Redirect URL must be a non-empty string");
  }

  // Reject protocol-relative URLs (e.g., "//evil.com")
  if (url.startsWith("//")) {
    throw new Error("Protocol-relative URLs are not allowed");
  }

  // Reject dangerous protocols
  const dangerousProtocols = ["javascript:", "data:", "vbscript:", "file:"];
  const lowerUrl = url.toLowerCase().trim();
  for (const protocol of dangerousProtocols) {
    if (lowerUrl.startsWith(protocol)) {
      throw new Error(`Dangerous protocol detected: ${protocol}`);
    }
  }

  // Parse and validate the URL
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Only allow http and https protocols
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    throw new Error(
      `Invalid protocol: ${urlObj.protocol}. Only http and https are allowed.`,
    );
  }

  // Parse the allowed origin to get its origin
  let allowedOriginObj: URL;
  try {
    allowedOriginObj = new URL(allowedOrigin);
  } catch (error) {
    throw new Error(`Invalid allowed origin format: ${allowedOrigin}`);
  }

  // Validate that the URL's origin matches the allowed origin exactly
  if (urlObj.origin !== allowedOriginObj.origin) {
    throw new Error(
      `Redirect URL origin mismatch: ${urlObj.origin} is not allowed. Only ${allowedOriginObj.origin} is permitted.`,
    );
  }

  return url;
}
