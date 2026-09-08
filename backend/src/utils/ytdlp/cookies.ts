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

function cookieLineMatchesHost(
  rawDomain: string,
  includeSubdomains: boolean,
  host: string
): boolean {
  const domain = rawDomain.replace(/^\./, "").toLowerCase();
  if (!domain) {
    return false;
  }
  // A leading dot in the file is the classic "and its subdomains" marker; the
  // include-subdomains column carries the same meaning for exports that omit it.
  if (rawDomain.startsWith(".") || includeSubdomains) {
    return host === domain || host.endsWith(`.${domain}`);
  }
  return host === domain;
}

/**
 * RFC 6265 path-match: the cookie's path is the request path, or a prefix of it
 * that ends at a path segment boundary.
 */
function cookiePathMatches(cookiePath: string, requestPath: string): boolean {
  if (!cookiePath.startsWith("/")) {
    return false;
  }
  if (cookiePath === "/" || cookiePath === requestPath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  return (
    cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"
  );
}

function isExpiredCookie(expires: string): boolean {
  const expiresAt = Number.parseInt(expires, 10);
  // 0 (and anything unparseable) is the session-cookie convention: no expiry.
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return false;
  }
  return expiresAt * 1000 <= Date.now();
}

/**
 * Build a `Cookie` request header for `requestUrl` from the stored cookies.txt.
 *
 * The cookie file was previously only handed to yt-dlp, but the direct site API
 * calls need it too: api.bilibili.com answers 412 (风控) to cookieless requests
 * for x/web-interface/view, which is the preflight every Bilibili collection
 * subscription runs before it can read its feed. Matching is by host *and*
 * path, as a browser would: a jar can hold the same name scoped to several
 * paths, and letting a path-scoped row claim the name would both send it where
 * it does not belong and hide the row that does apply. Returns null when no
 * cookie applies, so callers simply send the request unauthenticated.
 */
export function getCookieHeaderForUrl(requestUrl: string): string | null {
  const cookiesPath = ensureCookiesFileIsNormalized();
  if (!cookiesPath) {
    return null;
  }

  let normalizedHost: string;
  let requestPath: string;
  try {
    const parsed = new URL(requestUrl);
    normalizedHost = parsed.hostname.toLowerCase();
    requestPath = parsed.pathname || "/";
  } catch {
    return null;
  }
  if (!normalizedHost) {
    return null;
  }

  try {
    const content = readFileSafeSync(cookiesPath, DATA_DIR, "utf8");
    const pairs: string[] = [];
    const seenNames = new Set<string>();

    for (const line of String(content).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (
        trimmed === "" ||
        (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_"))
      ) {
        continue;
      }

      const parts = trimmed.replace(/^#HttpOnly_/, "").split("\t");
      if (parts.length < 7) {
        continue;
      }

      const [rawDomain, includeSubdomains, cookiePath, , expires, name, value] =
        parts;
      if (!name || seenNames.has(name)) {
        continue;
      }
      if (
        !cookieLineMatchesHost(
          rawDomain,
          includeSubdomains.toUpperCase() === "TRUE",
          normalizedHost
        ) ||
        !cookiePathMatches(cookiePath, requestPath)
      ) {
        continue;
      }
      // Skipped before the name is claimed, so a stale line cannot suppress a
      // live cookie of the same name further down the file — cookie exports
      // routinely carry both.
      if (isExpiredCookie(expires)) {
        continue;
      }

      seenNames.add(name);
      pairs.push(`${name}=${value}`);
    }

    return pairs.length > 0 ? pairs.join("; ") : null;
  } catch (error) {
    logger.warn(
      `Unable to read cookies.txt for ${normalizedHost}; continuing without cookies.`,
      error
    );
    return null;
  }
}
