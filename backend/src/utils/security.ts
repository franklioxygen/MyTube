import { execFile } from "child_process";
import path from "path";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  VIDEOS_DIR,
} from "../config/paths";

/**
 * Checks if a path is inside (or equal to) an allowed directory.
 * Both inputs are resolved before comparison.
 */
export function isPathWithinDirectory(
  pathToCheck: string,
  allowedDir: string,
): boolean {
  if (
    !pathToCheck ||
    typeof pathToCheck !== "string" ||
    !allowedDir ||
    typeof allowedDir !== "string"
  ) {
    return false;
  }

  const resolvedPath = path.resolve(pathToCheck);
  const resolvedAllowedDir = path.resolve(allowedDir);
  return (
    resolvedPath === resolvedAllowedDir ||
    resolvedPath.startsWith(`${resolvedAllowedDir}${path.sep}`)
  );
}

/**
 * Checks if a path is inside at least one allowed directory.
 */
export function isPathWithinDirectories(
  pathToCheck: string,
  allowedDirs: readonly string[],
): boolean {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    return false;
  }

  const resolvedPath = path.resolve(pathToCheck);
  return allowedDirs.some((allowedDir) =>
    isPathWithinDirectory(resolvedPath, allowedDir),
  );
}

/**
 * Validates that a file path is within an allowed directory
 * Prevents path traversal attacks
 */
export function validatePathWithinDirectory(
  filePath: string,
  allowedDir: string,
): boolean {
  // Sanitize and validate input before resolving to prevent path traversal
  if (
    !filePath ||
    typeof filePath !== "string" ||
    !allowedDir ||
    typeof allowedDir !== "string"
  ) {
    return false;
  }

  // Validate path components by splitting and checking each segment
  // Only check if path components themselves are "..", not if filenames contain ".."
  const filePathParts = filePath
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");
  const allowedDirParts = allowedDir
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");

  // Check each path component for dangerous values
  // Only reject if a path component IS "..", not if it contains ".." as part of a filename
  const sanitizedFilePathParts: string[] = [];
  for (const part of filePathParts) {
    if (part === "..") {
      return false; // Path traversal detected
    }
    // Filenames can contain ".." as part of their name (e.g., "file..mp4"), which is valid
    // Only reject if the entire component is ".."
    sanitizedFilePathParts.push(part);
  }

  const sanitizedAllowedDirParts: string[] = [];
  for (const part of allowedDirParts) {
    if (part === "..") {
      return false; // Invalid allowed directory
    }
    sanitizedAllowedDirParts.push(part);
  }

  // Reconstruct paths from validated components only
  // This ensures no path traversal sequences can exist
  const sanitizedFilePath = path.isAbsolute(filePath)
    ? path.sep + path.join(...sanitizedFilePathParts)
    : path.join(...sanitizedFilePathParts);
  const sanitizedAllowedDir = path.isAbsolute(allowedDir)
    ? path.sep + path.join(...sanitizedAllowedDirParts)
    : path.join(...sanitizedAllowedDirParts);

  // Final validation: check if any path component in the reconstructed path is ".."
  // Split again to check components after reconstruction
  const finalFilePathParts = sanitizedFilePath
    .split(path.sep)
    .filter((part) => part !== "");
  const finalAllowedDirParts = sanitizedAllowedDir
    .split(path.sep)
    .filter((part) => part !== "");

  if (
    finalFilePathParts.some((part) => part === "..") ||
    finalAllowedDirParts.some((part) => part === "..")
  ) {
    return false;
  }

  // Now safe to resolve - paths are constructed from validated components only
  const resolvedPath = path.resolve(sanitizedFilePath);
  const resolvedAllowedDir = path.resolve(sanitizedAllowedDir);

  // Ensure the resolved path starts with the allowed directory
  return (
    resolvedPath.startsWith(resolvedAllowedDir + path.sep) ||
    resolvedPath === resolvedAllowedDir
  );
}

/**
 * Safely resolves a file path within an allowed directory
 * Throws an error if the path is outside the allowed directory
 */
export function resolveSafePath(filePath: string, allowedDir: string): string {
  // Sanitize and validate input before resolving to prevent path traversal
  if (
    !filePath ||
    typeof filePath !== "string" ||
    !allowedDir ||
    typeof allowedDir !== "string"
  ) {
    throw new Error(`Invalid file path: ${filePath}`);
  }

  // Validate path components by splitting and checking each segment
  // Only check if path components themselves are "..", not if filenames contain ".."
  const filePathParts = filePath
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");
  const allowedDirParts = allowedDir
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");

  // Check each path component for dangerous values
  // Only reject if a path component IS "..", not if it contains ".." as part of a filename
  const sanitizedFilePathParts: string[] = [];
  for (const part of filePathParts) {
    if (part === "..") {
      throw new Error(
        `Path traversal detected: ${filePath} contains invalid path components`,
      );
    }
    // Filenames can contain ".." as part of their name (e.g., "file..mp4"), which is valid
    // Only reject if the entire component is ".."
    sanitizedFilePathParts.push(part);
  }

  const sanitizedAllowedDirParts: string[] = [];
  for (const part of allowedDirParts) {
    if (part === "..") {
      throw new Error(`Invalid allowed directory: ${allowedDir}`);
    }
    sanitizedAllowedDirParts.push(part);
  }

  // Reconstruct paths from validated components only
  // This ensures no path traversal sequences can exist
  const sanitizedFilePath = path.isAbsolute(filePath)
    ? path.sep + path.join(...sanitizedFilePathParts)
    : path.join(...sanitizedFilePathParts);
  const sanitizedAllowedDir = path.isAbsolute(allowedDir)
    ? path.sep + path.join(...sanitizedAllowedDirParts)
    : path.join(...sanitizedAllowedDirParts);

  // Final validation: check if any path component in the reconstructed path is ".."
  // Split again to check components after reconstruction
  const finalFilePathParts = sanitizedFilePath
    .split(path.sep)
    .filter((part) => part !== "");
  const finalAllowedDirParts = sanitizedAllowedDir
    .split(path.sep)
    .filter((part) => part !== "");

  if (
    finalFilePathParts.some((part) => part === "..") ||
    finalAllowedDirParts.some((part) => part === "..")
  ) {
    throw new Error(
      `Path traversal detected: ${filePath} contains invalid path components`,
    );
  }

  // Now safe to resolve - paths are constructed from validated components only
  const resolvedPath = path.resolve(sanitizedFilePath);
  const resolvedAllowedDir = path.resolve(sanitizedAllowedDir);

  if (
    !resolvedPath.startsWith(resolvedAllowedDir + path.sep) &&
    resolvedPath !== resolvedAllowedDir
  ) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside ${allowedDir}`,
    );
  }

  return resolvedPath;
}

/**
 * Validates that a file path is within at least one allowed directory
 */
export function validatePathWithinDirectories(
  filePath: string,
  allowedDirs: string[],
): boolean {
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    return false;
  }
  return allowedDirs.some((allowedDir) =>
    validatePathWithinDirectory(filePath, allowedDir),
  );
}

/**
 * Safely resolves a file path within one of the allowed directories
 * Throws an error if the path is outside all allowed directories
 */
export function resolveSafePathInDirectories(
  filePath: string,
  allowedDirs: string[],
): string {
  const resolvedPath = path.resolve(filePath);
  if (!validatePathWithinDirectories(resolvedPath, allowedDirs)) {
    throw new Error(
      `Path traversal detected: ${filePath} is outside allowed directories`,
    );
  }
  return resolvedPath;
}

/**
 * Sanitizes a single path segment (e.g. filename, collection name)
 * by removing traversal sequences and separators.
 */
export function sanitizePathSegment(segment: string): string {
  if (typeof segment !== "string") {
    return "";
  }
  return segment
    .replace(/\0/g, "")
    .replace(/\.\./g, "")
    .replace(/[\/\\]/g, "")
    .trim();
}

/**
 * Validates that a file path is within the videos directory
 */
export function validateVideoPath(filePath: string): string {
  return resolveSafePath(filePath, VIDEOS_DIR);
}

/**
 * Validates that a file path is within the images directory
 */
export function validateImagePath(filePath: string): string {
  return resolveSafePath(filePath, IMAGES_DIR);
}

/**
 * Validates that a file path is within the cloud thumbnail cache directory
 */
export function validateCloudThumbnailCachePath(filePath: string): string {
  return resolveSafePath(filePath, CLOUD_THUMBNAIL_CACHE_DIR);
}

/**
 * Safely execute a command with arguments
 * Prevents command injection by using execFile instead of exec
 */
export function execFileSafe(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

/**
 * Validates a URL to prevent SSRF attacks
 * Only allows http/https protocols and validates the hostname
 */
export function validateUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Only allow http and https protocols
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      throw new Error(
        `Invalid protocol: ${urlObj.protocol}. Only http and https are allowed.`,
      );
    }

    // Block private/internal IP addresses
    const hostname = urlObj.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.") ||
      hostname === "[::1]"
    ) {
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
 * Sanitizes a string for safe use in HTML
 * Prevents XSS attacks
 */
export function sanitizeHtml(str: string): string {
  const map: { [key: string]: string } = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
  };
  return str.replace(/[&<>"'/]/g, (s) => map[s]);
}

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
