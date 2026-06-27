const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);
const BLOCKED_PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "::1",
  "[::1]",
  "::",
]);
const BLOCKED_PRIVATE_HOST_PREFIXES = [
  "10.", // private (10.0.0.0/8)
  "127.", // loopback (127.0.0.0/8)
  "169.254.", // link-local incl. cloud metadata 169.254.169.254 (169.254.0.0/16)
  "192.168.", // private (192.168.0.0/16)
  ...Array.from({ length: 16 }, (_, i) => `172.${i + 16}.`), // 172.16.0.0/12
  ...Array.from({ length: 64 }, (_, i) => `100.${i + 64}.`), // CGNAT 100.64.0.0/10
];

function normalizeHostnameForBlocklist(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

/**
 * Normalize non-dotted IPv4 encodings (e.g. decimal "2130706433" or hex
 * "0x7f000001", both = 127.0.0.1) to dotted-quad so range checks below cannot
 * be bypassed by an alternate numeric representation. Returns null when the
 * hostname is not a single-integer IPv4 form.
 */
function normalizeNumericIpv4(hostname: string): string | null {
  let value: number | null = null;
  if (/^\d+$/.test(hostname)) {
    value = Number(hostname);
  } else if (/^0x[0-9a-f]+$/i.test(hostname)) {
    value = Number.parseInt(hostname.slice(2), 16);
  }

  if (
    value === null ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  ) {
    return null;
  }

  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

/**
 * Decode the IPv4 address embedded in an IPv4-mapped/compatible IPv6 literal.
 * Handles both the dotted form (`::ffff:169.254.169.254`) and the hex form the
 * WHATWG URL parser canonicalizes it to (`::ffff:a9fe:a9fe`). Returns null when
 * no trailing IPv4 is present.
 */
function decodeEmbeddedIpv4(host: string): string | null {
  const dotted = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    return dotted[1];
  }

  const hexPair = host.match(/:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexPair) {
    const high = Number.parseInt(hexPair[1], 16);
    const low = Number.parseInt(hexPair[2], 16);
    return [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
  }

  return null;
}

/**
 * Detect private/internal IPv6 literals: loopback (::1), unspecified (::),
 * unique-local (fc00::/7), link-local (fe80::/10), and IPv4-mapped/embedded
 * addresses (e.g. ::ffff:169.254.169.254) that wrap a blocked IPv4.
 */
function isBlockedIpv6Hostname(hostname: string): boolean {
  let host = hostname;
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (!host.includes(":")) {
    return false;
  }
  if (host === "::1" || host === "::") {
    return true;
  }

  const firstHextet = host.split(":")[0];
  // fc00::/7 (unique-local) -> first hextet begins fc or fd
  // fe80::/10 (link-local)  -> first hextet begins fe8/fe9/fea/feb
  if (/^f[cd]/.test(firstHextet) || /^fe[89ab]/.test(firstHextet)) {
    return true;
  }

  // IPv4-mapped (e.g. ::ffff:127.0.0.1) embeds a blocked IPv4 address.
  if (host.startsWith("::ffff:") || host.startsWith("::")) {
    const embeddedIpv4 = decodeEmbeddedIpv4(host);
    if (embeddedIpv4) {
      return isBlockedPrivateHostname(embeddedIpv4);
    }
  }

  return false;
}

function isBlockedPrivateHostname(hostname: string): boolean {
  const normalized = normalizeHostnameForBlocklist(hostname);

  if (BLOCKED_PRIVATE_HOSTNAMES.has(normalized)) {
    return true;
  }

  if (isBlockedIpv6Hostname(normalized)) {
    return true;
  }

  // Resolve alternate IPv4 encodings (decimal/hex) before prefix matching.
  const candidate = normalizeNumericIpv4(normalized) ?? normalized;
  if (BLOCKED_PRIVATE_HOSTNAMES.has(candidate)) {
    return true;
  }

  return BLOCKED_PRIVATE_HOST_PREFIXES.some((prefix) =>
    candidate.startsWith(prefix),
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
