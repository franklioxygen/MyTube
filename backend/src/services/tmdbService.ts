import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../config/paths";
import { regenerateSmallThumbnailForThumbnailPath } from "./thumbnailMirrorService";
import { logger } from "../utils/logger";
import {
  buildAllowlistedHttpUrl,
  resolveSafeChildPath,
  resolveSafePath,
  writeFileSafe,
} from "../utils/security";
import { getSettings } from "./storageService/settings";
import { parseFilename } from "./tmdb/filenameParser";
import { normalizeTMDBCredential } from "./tmdb/client";
import { isLikelyGenericCaptureFilename } from "./tmdb/genericCaptureFilename";
import { searchTMDBMultiStrategy } from "./tmdb/multiStrategySearch";

export { parseFilename } from "./tmdb/filenameParser";
export type { ParsedFilename } from "./tmdb/filenameParser";
export { testTMDBCredential } from "./tmdb/client";
export type {
  MultiStrategySearchResult,
  TMDBCredentialAuthType,
  TMDBCredentialMessageKey,
  TMDBCredentialTestResult,
  TMDBMovieResult,
  TMDBSearchResult,
  TMDBTVResult,
} from "./tmdb/types";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
// Whitelist of allowed hosts for image downloads to prevent SSRF
const ALLOWED_IMAGE_HOSTS = ["image.tmdb.org"];

/**
 * Validate URL against whitelist to prevent SSRF (following OWASP pattern)
 * Returns validated URL if it passes all checks, null otherwise
 */
function validateUrlAgainstWhitelist(posterPath: string): string | null {
  // Validate poster path to prevent path traversal
  if (!posterPath || posterPath.includes("..") || !posterPath.startsWith("/")) {
    logger.error(`Invalid poster path: ${posterPath}`);
    return null;
  }

  // Sanitize posterPath to remove dangerous characters
  const safePosterPath = posterPath.replace(/[^a-zA-Z0-9/._-]/g, "");

  // Construct URL from validated components
  const imageUrl = `${TMDB_IMAGE_BASE}${safePosterPath}`;

  // Parse and validate URL structure
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (error) {
    logger.error(`Invalid image URL format: ${imageUrl}`, error);
    return null;
  }

  // Verify protocol is HTTPS
  if (parsedUrl.protocol !== "https:") {
    logger.error(`Invalid protocol (must be HTTPS): ${imageUrl}`);
    return null;
  }

  // Verify path matches expected TMDB image path pattern
  if (!parsedUrl.pathname.startsWith("/t/p/")) {
    logger.error(`Invalid path (not TMDB image path): ${parsedUrl.pathname}`);
    return null;
  }

  let validatedUrl: string;
  try {
    validatedUrl = buildAllowlistedHttpUrl(imageUrl, ALLOWED_IMAGE_HOSTS);
  } catch (error) {
    logger.error(`Invalid image URL: ${imageUrl}`, error);
    return null;
  }

  return validatedUrl;
}

/**
 * Download poster image from TMDB
 * Note: TMDB images are public and don't require authentication
 */
async function downloadPoster(
  posterPath: string,
  savePath: string
): Promise<boolean> {
  try {
    // Validate URL against whitelist to prevent SSRF
    // Following OWASP SSRF prevention pattern: check whitelist before request
    const validatedUrl = validateUrlAgainstWhitelist(posterPath);

    if (!validatedUrl) {
      logger.error(`URL validation failed for poster path: ${posterPath}`);
      return false;
    }

    // Final whitelist check: verify hostname is in whitelist (double-check SSRF protection)
    const urlObj = new URL(validatedUrl);
    if (!ALLOWED_IMAGE_HOSTS.includes(urlObj.hostname)) {
      logger.error(`Hostname not in whitelist: ${urlObj.hostname}`);
      return false;
    }

    const response = await axios.get(validatedUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
    });

    let normalizedSavePath: string;
    try {
      normalizedSavePath = resolveSafePath(savePath, IMAGES_DIR);
    } catch (error) {
      logger.error(
        `Invalid save path (outside IMAGES_DIR): ${savePath}`,
        error
      );
      return false;
    }

    // Ensure directory exists
    await fs.ensureDir(path.dirname(normalizedSavePath));

    // Save image
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    await writeFileSafe(normalizedSavePath, IMAGES_DIR, response.data);
    const relativePath = path.relative(IMAGES_DIR, normalizedSavePath);
    await regenerateSmallThumbnailForThumbnailPath(
      `/images/${relativePath.replace(/\\/g, "/")}`,
    );

    logger.info(`Downloaded poster to ${normalizedSavePath}`);
    return true;
  } catch (error) {
    logger.error(`Error downloading poster from ${posterPath}:`, error);
    return false;
  }
}

function sanitizeThumbnailDirectory(relativeDirectory: string): string | null {
  const normalizedDirectory = relativeDirectory.replace(/\\/g, "/").trim();
  if (
    !normalizedDirectory ||
    normalizedDirectory === "." ||
    normalizedDirectory === "/"
  ) {
    return "";
  }

  const rawSegments = normalizedDirectory
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (
    rawSegments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("\0")
    )
  ) {
    return null;
  }

  const sanitizedSegments = rawSegments
    .map((segment) =>
      segment.replace(/[^a-zA-Z0-9.\u4e00-\u9fff_-]/g, "_")
    )
    .filter((segment) => segment.length > 0);

  if (sanitizedSegments.length === 0) {
    return "";
  }

  return path.join(...sanitizedSegments);
}

function resolvePosterSaveLocation(
  safeFilenameBase: string,
  thumbnailFilename?: string
): { absolutePath: string; relativePath: string } | null {
  const fallbackRelativePath = `${safeFilenameBase}.jpg`;

  let preferredRelativePath = fallbackRelativePath;
  if (thumbnailFilename) {
    const providedDir = path.dirname(thumbnailFilename);
    const safeDir = sanitizeThumbnailDirectory(providedDir);

    if (safeDir === null) {
      logger.warn(
        `Ignoring unsafe thumbnail directory from "${thumbnailFilename}", using root images directory`
      );
    } else if (safeDir) {
      preferredRelativePath = `${safeDir.replace(/\\/g, "/")}/${fallbackRelativePath}`;
    }
  }

  for (const candidateRelativePath of [
    preferredRelativePath,
    fallbackRelativePath,
  ]) {
    try {
      const absolutePath = resolveSafeChildPath(
        IMAGES_DIR,
        candidateRelativePath
      );

      return {
        absolutePath,
        relativePath: path
          .relative(path.resolve(IMAGES_DIR), absolutePath)
          .replace(/\\/g, "/"),
      };
    } catch (error) {
      logger.error(
        `Invalid thumbnail path candidate: ${candidateRelativePath}`,
        error
      );
    }
  }

  return null;
}

/**
 * Scrape metadata from TMDB based on filename using intelligent multi-strategy search
 * Returns metadata if found, null otherwise
 */
export async function scrapeMetadataFromTMDB(
  filename: string,
  thumbnailFilename?: string
): Promise<{
  title: string;
  description?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  year?: string;
  rating?: number;
  director?: string;
} | null> {
  try {
    const settings = getSettings();
    const tmdbApiKey = normalizeTMDBCredential(
      settings.tmdbApiKey || process.env.TMDB_API_KEY || ""
    );

    if (!tmdbApiKey) {
      logger.warn("TMDB API key not configured. Skipping metadata scraping.");
      return null;
    }

    if (isLikelyGenericCaptureFilename(filename)) {
      logger.info(
        `[TMDB Scrape] Skipping TMDB lookup for generic capture filename "${filename}"`
      );
      return null;
    }

    // Get language from settings for localized results
    const language = settings.language || "en";

    // Parse filename with enhanced parser
    const parsed = parseFilename(filename);

    logger.info(
      `[TMDB Scrape] Parsed filename: titles=${parsed.titles.join(
        ", "
      )}, year=${parsed.year || "N/A"}, isTVShow=${
        parsed.isTVShow
      }, language=${language}`
    );

    // Use multi-strategy search with language parameter
    const searchResult = await searchTMDBMultiStrategy(
      parsed,
      tmdbApiKey,
      language
    );

    if (!searchResult.result) {
      if (searchResult.strategy === "auth-failed") {
        logger.warn(
          "TMDB authentication failed. Check whether the configured TMDB credential is a valid API key or Read Access Token."
        );
        return null;
      }
      logger.info(
        `[TMDB Scrape] No TMDB match found for "${filename}" (strategy: ${searchResult.strategy})`
      );
      return null;
    }

    const result = searchResult.result;
    const mediaType = searchResult.mediaType;

    // Build metadata from result
    let metadata: {
      title: string;
      description?: string;
      thumbnailPath?: string;
      thumbnailUrl?: string;
      thumbnailFilename?: string;
      year?: string;
      rating?: number;
      director?: string;
    };

    if (mediaType === "movie" && "title" in result) {
      metadata = {
        title: result.title,
        description: result.overview,
        year: result.release_date
          ? result.release_date.substring(0, 4)
          : undefined,
        rating: result.vote_average,
        director: searchResult.director,
      };
    } else if (mediaType === "tv" && "name" in result) {
      metadata = {
        title: result.name,
        description: result.overview,
        year: result.first_air_date
          ? result.first_air_date.substring(0, 4)
          : undefined,
        rating: result.vote_average,
        director: searchResult.director,
      };
    } else {
      logger.error(`[TMDB Scrape] Unexpected result type: ${mediaType}`);
      return null;
    }

    // Download poster if available
    if (result.poster_path) {
      // Generate filename based on TMDB title instead of sanitized filename
      // This ensures the filename matches the actual movie/TV show title
      // Sanitize TMDB title to create safe filename (prevent path traversal)
      const tmdbTitleSafe = metadata.title
        .replace(/[^\w\s\u4e00-\u9fff.-]/g, "") // Keep Unicode and basic punctuation
        .replace(/\s+/g, ".")
        .replace(/\.+/g, ".") // Replace multiple dots with single dot
        .replace(/^\.|\.$/g, "") // Remove leading/trailing dots
        .substring(0, 100); // Limit length

      const yearPart = metadata.year ? `.${metadata.year}` : "";
      // Generate safe filename base - ensure no path traversal
      const safeFilenameBase = `${tmdbTitleSafe}${yearPart}`
        .replace(/[^a-zA-Z0-9.\u4e00-\u9fff-_]/g, "_") // Replace unsafe chars
        .replace(/[\/\\]/g, "_") // Remove path separators
        .substring(0, 200); // Limit total length

      const posterSaveLocation = resolvePosterSaveLocation(
        safeFilenameBase,
        thumbnailFilename
      );
      if (!posterSaveLocation) {
        logger.error("Unable to resolve a safe poster save location.");
        return metadata;
      }

      const downloaded = await downloadPoster(
        result.poster_path,
        posterSaveLocation.absolutePath
      );

      if (downloaded) {
        const webPath = `/images/${posterSaveLocation.relativePath}`;
        metadata.thumbnailPath = webPath;
        metadata.thumbnailUrl = webPath;
        // Store the actual filename (relative path) used for the scanController
        // This includes subdirectory if the file was saved in one
        metadata.thumbnailFilename = posterSaveLocation.relativePath;
      }
    }

    logger.info(
      `[TMDB Scrape] Successfully scraped metadata for "${filename}" -> "${metadata.title}" (strategy: ${searchResult.strategy})`
    );
    return metadata;
  } catch (error) {
    logger.error(`Error scraping metadata for "${filename}":`, error);
    return null;
  }
}
