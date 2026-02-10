import axios from "axios";
import { logger } from "../../../utils/logger";

const XIAOHONGSHU_PROFILE_ORIGIN = "https://www.xiaohongshu.com";
const XIAOHONGSHU_UPLOADER_ID_PATTERN = /^[a-zA-Z0-9]{16,64}$/;

function getSafeUploaderId(rawUploaderId: unknown): string | null {
  if (typeof rawUploaderId !== "string") {
    return null;
  }
  const normalized = rawUploaderId.trim();
  if (!XIAOHONGSHU_UPLOADER_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEscapedJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }
}

function normalizeNickname(raw: string): string | null {
  const decoded = decodeEscapedJsonString(raw)
    .replace(/\0/g, "")
    .trim();
  if (!decoded || decoded.length > 80) {
    return null;
  }
  return decoded;
}

function extractNicknameFromProfileHtml(
  html: string,
  uploaderId: string,
): string | null {
  const escapedUploaderId = escapeRegex(uploaderId);
  const patterns = [
    new RegExp(
      `"userId":"${escapedUploaderId}"[\\s\\S]{0,500}?"nickname":"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`,
      "i",
    ),
    new RegExp(
      `"userId":"${escapedUploaderId}"[\\s\\S]{0,500}?"nickName":"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`,
      "i",
    ),
    /"nickname":"([^"\\]*(?:\\.[^"\\]*)*)"/i,
    /"nickName":"([^"\\]*(?:\\.[^"\\]*)*)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match || !match[1]) {
      continue;
    }
    const nickname = normalizeNickname(match[1]);
    if (nickname) {
      return nickname;
    }
  }

  return null;
}

/**
 * Helper function to extract author from XiaoHongShu page when yt-dlp doesn't provide it
 */
export async function extractXiaoHongShuAuthor(
  url: string,
  uploaderId?: string | null,
): Promise<string | null> {
  try {
    const safeUploaderId = getSafeUploaderId(uploaderId);
    if (!safeUploaderId) {
      logger.info(
        `Skipping XiaoHongShu author extraction for URL: ${url}. Missing/invalid uploader_id.`,
      );
      return null;
    }

    const profileUrl = `${XIAOHONGSHU_PROFILE_ORIGIN}/user/profile/${safeUploaderId}`;
    logger.info(
      `Attempting XiaoHongShu author extraction from profile for uploader_id: ${safeUploaderId}`,
    );

    const response = await axios.get(profileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: XIAOHONGSHU_PROFILE_ORIGIN,
      },
      timeout: 10000,
    });

    const html = typeof response.data === "string" ? response.data : "";
    if (!html) {
      return null;
    }

    const nickname = extractNicknameFromProfileHtml(html, safeUploaderId);
    if (nickname) {
      logger.info(`Extracted XiaoHongShu author nickname: ${nickname}`);
      return nickname;
    }

    logger.info(
      `Could not extract XiaoHongShu nickname from profile for uploader_id: ${safeUploaderId}`,
    );
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
