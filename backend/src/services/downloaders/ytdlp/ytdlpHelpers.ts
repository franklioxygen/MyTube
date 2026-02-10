import axios from "axios";
import { logger } from "../../../utils/logger";
import {
  isHostnameAllowed,
  validateUrlWithAllowlist,
} from "../../../utils/security";

const ALLOWED_XIAOHONGSHU_HOSTNAMES = ["xiaohongshu.com", "xhslink.com"] as const;

function buildSafeXiaoHongShuRequestUrl(url: string): string {
  const validatedUrl = validateUrlWithAllowlist(
    url,
    ALLOWED_XIAOHONGSHU_HOSTNAMES,
  );
  const parsedUrl = new URL(validatedUrl);

  if (!isHostnameAllowed(parsedUrl.hostname, ALLOWED_XIAOHONGSHU_HOSTNAMES)) {
    throw new Error(
      `SSRF protection: Hostname ${parsedUrl.hostname} is not allowed for XiaoHongShu requests.`,
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
 * Helper function to extract author from XiaoHongShu page when yt-dlp doesn't provide it
 */
export async function extractXiaoHongShuAuthor(
  url: string
): Promise<string | null> {
  try {
    const safeRequestUrl = buildSafeXiaoHongShuRequestUrl(url);
    
    logger.info("Attempting to extract XiaoHongShu author from webpage...");
    const response = await axios.get(safeRequestUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const html = response.data;

    // Try to find author name in the JSON data embedded in the page
    // XiaoHongShu embeds data in window.__INITIAL_STATE__
    const match = html.match(/"nickname":"([^"]+)"/);
    if (match && match[1]) {
      logger.info("Found XiaoHongShu author:", match[1]);
      return match[1];
    }

    // Alternative: try to find in user info
    const userMatch = html.match(/"user":\{[^}]*"nickname":"([^"]+)"/);
    if (userMatch && userMatch[1]) {
      logger.info("Found XiaoHongShu author (user):", userMatch[1]);
      return userMatch[1];
    }

    logger.info("Could not extract XiaoHongShu author from webpage");
    return null;
  } catch (error) {
    logger.error("Error extracting XiaoHongShu author:", error);
    return null;
  }
}

/**
 * Get the PO Token provider script path from environment
 */
export function getProviderScript(): string {
  return process.env.BGUTIL_SCRIPT_PATH || "";
}
