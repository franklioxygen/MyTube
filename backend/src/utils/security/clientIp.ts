/**
 * Validates an IP address (IPv4 or IPv6)
 * @param ip - The IP address to validate
 * @returns true if the IP is valid, false otherwise
 */
function isValidIpAddress(ip: string): boolean {
  if (!ip || typeof ip !== "string") {
    return false;
  }

  // IPv4 regex: matches 0.0.0.0 to 255.255.255.255
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 regex: matches various IPv6 formats including compressed notation
  const ipv6Regex =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^(?:[0-9a-fA-F]{1,4}:)*::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Checks if an IP address is a private/internal IP
 * @param ip - The IP address to check
 * @returns true if the IP is private/internal
 */
function isPrivateIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") {
    return false;
  }

  const cleanIp = ip.replace(/^::ffff:/, "");

  // Check for localhost
  if (
    cleanIp === "localhost" ||
    cleanIp === "0.0.0.0" ||
    cleanIp === "::1" ||
    cleanIp === "[::1]"
  ) {
    return true;
  }

  // Check for 127.x.x.x (loopback)
  if (cleanIp.startsWith("127.")) {
    return true;
  }

  // Check for 192.168.x.x (private network)
  if (cleanIp.startsWith("192.168.")) {
    return true;
  }

  // Check for 10.x.x.x (private network)
  if (cleanIp.startsWith("10.")) {
    return true;
  }

  // Check for 172.16.x.x to 172.31.x.x (private network)
  if (cleanIp.startsWith("172.")) {
    const parts = cleanIp.split(".");
    if (parts.length >= 2) {
      const secondOctet = parseInt(parts[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Safely extracts the client IP address from a request
 * Prevents X-Forwarded-For header spoofing by validating the IP address
 *
 * Security considerations:
 * - Validates all IP addresses before using them
 * - Prioritizes socket IP (cannot be spoofed) over X-Forwarded-For
 * - Validates X-Forwarded-For header format and IP addresses
 * - When behind a proxy, uses X-Forwarded-For but validates it
 *
 * @param req - Express request object
 * @returns The validated client IP address
 */
export function getClientIp(req: any): string {
  // Get socket IP (the actual TCP connection IP - cannot be spoofed)
  const socketIp = req.socket?.remoteAddress;
  let cleanSocketIp: string | null = null;
  if (socketIp && isValidIpAddress(socketIp)) {
    const cleaned = socketIp.replace(/^::ffff:/, "");
    if (isValidIpAddress(cleaned)) {
      cleanSocketIp = cleaned;
    }
  }

  // Check if we're behind a proxy (trust proxy is enabled)
  // When behind a proxy, the socket IP is the proxy's IP, not the client's IP
  const trustProxy = req.app?.get("trust proxy");
  const isBehindProxy = trustProxy !== undefined && trustProxy !== false;

  // If behind a proxy, try to get the client IP from X-Forwarded-For
  // But we must validate it to prevent spoofing
  if (isBehindProxy) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor && typeof forwardedFor === "string") {
      // X-Forwarded-For format: "client, proxy1, proxy2"
      // When trust proxy is set to 1, Express uses the rightmost IP
      // But we need to validate all IPs to prevent spoofing
      const ips = forwardedFor
        .split(",")
        .map((ip) => ip.trim())
        .filter((ip) => ip.length > 0);

      // When trust proxy is 1, we trust only the first proxy
      // So we should use the rightmost IP (original client) or the first IP after the proxy
      // For simplicity and security, we'll validate and use the rightmost valid IP
      for (let i = ips.length - 1; i >= 0; i--) {
        const ip = ips[i].trim();
        const cleanIp = ip.replace(/^::ffff:/, "");

        if (isValidIpAddress(cleanIp)) {
          // Security: Only trust X-Forwarded-For when we're actually behind a proxy
          // If socket IP is public (not behind proxy), ignore X-Forwarded-For to prevent spoofing
          if (cleanSocketIp && isPrivateIp(cleanSocketIp)) {
            // We're behind a proxy (socket IP is private)
            // Trust X-Forwarded-For as it comes from the trusted proxy
            // Use it regardless of whether it's public or private (validated IP)
            return cleanIp;
          } else if (cleanSocketIp && !isPrivateIp(cleanSocketIp)) {
            // Socket IP is public - we're NOT behind a proxy
            // Ignore X-Forwarded-For to prevent spoofing attacks
            // This prevents attackers from bypassing rate limiting by spoofing X-Forwarded-For
            break; // Exit loop, will use socket IP below
          } else if (!cleanSocketIp) {
            // Socket IP is missing or invalid, but we're configured to trust proxy
            // In this case, we can use X-Forwarded-For as fallback
            // But only if it's a valid IP format
            return cleanIp;
          }
        }
      }
    }

    // Fall back to req.ip if available (Express sets this when trust proxy is enabled)
    if (req.ip && isValidIpAddress(req.ip)) {
      const cleanIp = req.ip.replace(/^::ffff:/, "");
      if (isValidIpAddress(cleanIp)) {
        return cleanIp;
      }
    }
  }

  // If not behind a proxy, or X-Forwarded-For is invalid/missing, use socket IP
  if (cleanSocketIp) {
    return cleanSocketIp;
  }

  // Last resort: use socket IP even if validation failed
  if (socketIp) {
    return socketIp.replace(/^::ffff:/, "");
  }

  // If all else fails, return a default (this should rarely happen)
  // Using "unknown" ensures rate limiting still works (all unknown IPs share the same limit)
  return "unknown";
}
