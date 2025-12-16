import fs from "fs-extra";
import path from "path";
import { logger } from "../../../utils/logger";

/**
 * Get cookies from cookies.txt file (Netscape format)
 * @returns Cookie header string or empty string if not found
 */
export function getCookieHeader(): string {
  try {
    const { DATA_DIR } = require("../../../config/paths");
    const cookiesPath = path.join(DATA_DIR, "cookies.txt");
    if (fs.existsSync(cookiesPath)) {
      const content = fs.readFileSync(cookiesPath, "utf8");
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
