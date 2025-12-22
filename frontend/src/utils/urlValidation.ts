/**
 * Validates a URL to prevent open redirect attacks
 * Only allows http/https protocols
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Only allow http and https protocols
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates and sanitizes a URL for safe use in window.open
 * Returns null if URL is invalid
 */
export function validateUrlForOpen(
  url: string | null | undefined
): string | null {
  if (!url) return null;

  if (!isValidUrl(url)) {
    console.warn(`Invalid URL blocked: ${url}`);
    return null;
  }

  return url;
}
