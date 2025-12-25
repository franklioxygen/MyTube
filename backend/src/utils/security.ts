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
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);

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
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);

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
