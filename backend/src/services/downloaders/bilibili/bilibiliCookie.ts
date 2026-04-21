import { DATA_DIR } from "../../../config/paths";
import { logger } from "../../../utils/logger";
import {
  pathExistsSafeSync,
  readFileSafeSync,
  resolveSafeChildPath,
} from "../../../utils/security";

/**
 * Get cookies from cookies.txt file (Netscape format)
 * @returns Cookie header string or empty string if not found
 */
export function getCookieHeader(): string {
  try {
    const cookiesPath = resolveSafeChildPath(DATA_DIR, "cookies.txt");
    if (pathExistsSafeSync(cookiesPath, DATA_DIR)) {
      const content = readFileSafeSync(cookiesPath, DATA_DIR, "utf8");
      const lines = content.split("\n");
      const cookies = [];
      for (const line of lines) {
        if (line.startsWith("#") || !line.trim()) continue;
        const parts = line.split("\t");
        if (parts.length >= 7) {
          const name = parts[5];
          const value = parts[6].trim();
          cookies.push(`${name}=${value}`);
        }
      }
      return cookies.join("; ");
    }
  } catch (e) {
    logger.error("Error reading cookies.txt:", e);
  }
  return "";
}
