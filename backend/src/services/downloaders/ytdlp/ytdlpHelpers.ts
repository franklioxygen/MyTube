import axios from "axios";
import path from "path";
import { logger } from "../../../utils/logger";
import {
  normalizeSafeAbsolutePath,
  pathExistsTrustedSync,
} from "../../../utils/security";

const XIAOHONGSHU_PROFILE_ORIGIN = "https://www.xiaohongshu.com";
const XIAOHONGSHU_UPLOADER_ID_PATTERN = /^[a-zA-Z0-9]{16,64}$/;
const BGUTIL_SCRIPT_RELATIVE_PATH = path.join(
  "bgutil-ytdlp-pot-provider",
  "server",
  "build",
  "generate_once.js",
);
const BGUTIL_SCRIPT_SEARCH_ROOTS = [
  // Source layout: backend/src/services/downloaders/ytdlp -> backend/
  "../../../..",
  // Build layout: backend/dist/src/services/downloaders/ytdlp -> backend/
  "../../../../..",
];
const warnedMissingProviderScriptPaths = new Set<string>();

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

function extractNicknameFromText(text: string): string | null {
  const patterns = [
    /"nickname":"([^"\\]*(?:\\.[^"\\]*)*)"/i,
    /"nickName":"([^"\\]*(?:\\.[^"\\]*)*)"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
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

function extractNicknameFromProfileHtml(
  html: string,
  uploaderId: string,
): string | null {
  const userIdMarker = `"userId":"${escapeRegex(uploaderId)}"`;
  const userSectionStart = html.indexOf(userIdMarker);
  if (userSectionStart >= 0) {
    const userSection = html.slice(
      userSectionStart,
      userSectionStart + userIdMarker.length + 500,
    );
    const scopedNickname = extractNicknameFromText(userSection);
    if (scopedNickname) {
      return scopedNickname;
    }
  }

  return extractNicknameFromText(html);
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
  const configuredPath = process.env.BGUTIL_SCRIPT_PATH?.trim();
  if (configuredPath) {
    const normalizedConfiguredPath = normalizeSafeAbsolutePath(configuredPath);
    if (!pathExistsTrustedSync(normalizedConfiguredPath)) {
      if (!warnedMissingProviderScriptPaths.has(configuredPath)) {
        warnedMissingProviderScriptPaths.add(configuredPath);
        logger.warn(
          `BGUTIL_SCRIPT_PATH points to a non-existent file: ${configuredPath}`
        );
      }
    }
    return normalizedConfiguredPath;
  }

  const candidatePaths = [
    path.resolve(process.cwd(), BGUTIL_SCRIPT_RELATIVE_PATH),
    ...BGUTIL_SCRIPT_SEARCH_ROOTS.map((searchRoot) =>
      path.resolve(__dirname, searchRoot, BGUTIL_SCRIPT_RELATIVE_PATH)
    ),
  ];

  for (const candidatePath of candidatePaths) {
    const normalizedCandidatePath = normalizeSafeAbsolutePath(candidatePath);
    if (pathExistsTrustedSync(normalizedCandidatePath)) {
      return normalizedCandidatePath;
    }
  }

  return "";
}
