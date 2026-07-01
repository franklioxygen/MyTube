import { COOKIES_FILENAME, DATA_DIR } from "../../config/paths";
import {
  readFileSafeSync,
  resolveSafeChildPath,
  statSafeSync,
  writeFileSafeSync,
} from "../security";
import {
  UnsupportedCookieFormatError,
  isValidNetscapeCookiesFile,
  normalizeCookiesFileContent,
} from "../cookieFileFormat";
import { logger } from "../logger";

type CookiesFileSignature = {
  mtimeMs: number;
  size: number;
};
type CookiesFileCache = CookiesFileSignature & {
  path: string | null;
};

let cookiesFileCache: CookiesFileCache | null = null;

function resolveCookiesPath(): string {
  return resolveSafeChildPath(DATA_DIR, COOKIES_FILENAME);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function updateCookiesFileCacheFromDisk(
  cookiesPath: string,
  pathValue: string | null
): void {
  try {
    const stats = statSafeSync(cookiesPath, DATA_DIR);
    cookiesFileCache = {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      path: pathValue,
    };
  } catch {
    cookiesFileCache = null;
  }
}

/**
 * Return the cookies file path after ensuring the file is usable by yt-dlp.
 * Existing Cookie header files are converted in place for backward compatibility.
 */
export function ensureCookiesFileIsNormalized(): string | null {
  const cookiesPath = resolveCookiesPath();
  let signature: CookiesFileSignature | null = null;
  try {
    const stats = statSafeSync(cookiesPath, DATA_DIR);
    signature = { mtimeMs: stats.mtimeMs, size: stats.size };
    if (
      cookiesFileCache &&
      cookiesFileCache.mtimeMs === signature.mtimeMs &&
      cookiesFileCache.size === signature.size
    ) {
      return cookiesFileCache.path;
    }

    const content = readFileSafeSync(cookiesPath, DATA_DIR, "utf8");
    if (isValidNetscapeCookiesFile(content)) {
      cookiesFileCache = { ...signature, path: cookiesPath };
      return cookiesPath;
    }

    const normalizedContent = normalizeCookiesFileContent(content);
    writeFileSafeSync(cookiesPath, DATA_DIR, normalizedContent, "utf8");
    updateCookiesFileCacheFromDisk(cookiesPath, cookiesPath);
    logger.warn(
      "[yt-dlp] Converted cookies.txt from Cookie header format to Netscape format."
    );
    return cookiesPath;
  } catch (error) {
    if (error instanceof UnsupportedCookieFormatError) {
      if (signature) {
        // path=null means this exact file signature is known to be unparseable.
        cookiesFileCache = { ...signature, path: null };
      }
      logger.warn(
        `[yt-dlp] Ignoring invalid cookies.txt: ${error.message}`
      );
      return null;
    }

    if (isMissingFileError(error)) {
      cookiesFileCache = null;
      return null;
    }

    cookiesFileCache = null;
    logger.warn(
      "[yt-dlp] Unable to read cookies.txt; continuing without cookies.",
      error
    );
    return null;
  }
}

export function resetCookiesFileCache(): void {
  cookiesFileCache = null;
}
