import { execFile } from "child_process";
import path from "path";
import {
  CLOUD_THUMBNAIL_CACHE_DIR,
  IMAGES_DIR,
  VIDEOS_DIR,
} from "../config/paths";

/**
 * Validates that a file path is within an allowed directory
 * Prevents path traversal attacks
 */
export function validatePathWithinDirectory(
  filePath: string,
  allowedDir: string
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

  // Explicit validation: check for path traversal sequences before any path operations
  // This prevents attacks like ../../../etc/passwd
  if (filePath.includes("..") || allowedDir.includes("..")) {
    return false;
  }

  // Validate path components by splitting and checking each segment
  const filePathParts = filePath
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");
  const allowedDirParts = allowedDir
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");

  // Check each path component for dangerous values and filter them out
  const sanitizedFilePathParts: string[] = [];
  for (const part of filePathParts) {
    if (part === "..") {
      return false; // Path traversal detected
    }
    // Only include safe path components
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

  // Final validation: ensure reconstructed paths don't contain traversal sequences
  if (sanitizedFilePath.includes("..") || sanitizedAllowedDir.includes("..")) {
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

  // Explicit validation: check for path traversal sequences before any path operations
  // This prevents attacks like ../../../etc/passwd
  if (filePath.includes("..") || allowedDir.includes("..")) {
    throw new Error(
      `Path traversal detected: ${filePath} contains invalid path components`
    );
  }

  // Validate path components by splitting and checking each segment
  const filePathParts = filePath
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");
  const allowedDirParts = allowedDir
    .split(path.sep)
    .filter((part) => part !== "" && part !== ".");

  // Check each path component for dangerous values and filter them out
  const sanitizedFilePathParts: string[] = [];
  for (const part of filePathParts) {
    if (part === "..") {
      throw new Error(
        `Path traversal detected: ${filePath} contains invalid path components`
      );
    }
    // Only include safe path components
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

  // Final validation: ensure reconstructed paths don't contain traversal sequences
  if (sanitizedFilePath.includes("..") || sanitizedAllowedDir.includes("..")) {
    throw new Error(
      `Path traversal detected: ${filePath} contains invalid path components`
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
      `Path traversal detected: ${filePath} is outside ${allowedDir}`
    );
  }

  return resolvedPath;
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
  options?: { cwd?: string; timeout?: number }
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
        `Invalid protocol: ${urlObj.protocol}. Only http and https are allowed.`
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
        `SSRF protection: Blocked access to private/internal IP: ${hostname}`
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
 * Validates a redirect URL against an allowlist to prevent open redirect vulnerabilities
 * @param url - The URL to validate
 * @param allowedOrigin - The allowed origin (e.g., "https://example.com")
 * @returns The validated URL
 * @throws Error if the URL is invalid or not in the allowlist
 */
export function validateRedirectUrl(
  url: string,
  allowedOrigin: string
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
      `Invalid protocol: ${urlObj.protocol}. Only http and https are allowed.`
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
      `Redirect URL origin mismatch: ${urlObj.origin} is not allowed. Only ${allowedOriginObj.origin} is permitted.`
    );
  }

  return url;
}
