import { logger } from "../../utils/logger";
import { getSettings } from "../storageService/settings";
import { normalizeTMDBCredential } from "./credentials";
import {
  isLikelyGenericCaptureFilename,
  parseFilename,
} from "./filenameParser";
import { searchTMDBMultiStrategy } from "./multiStrategy";
import { downloadPoster, resolvePosterSaveLocation } from "./poster";

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
        .replace(/[^\w\s一-鿿.-]/g, "") // Keep Unicode and basic punctuation
        .replace(/\s+/g, ".")
        .replace(/\.+/g, ".") // Replace multiple dots with single dot
        .replace(/^\.|\.$/g, "") // Remove leading/trailing dots
        .substring(0, 100); // Limit length

      const yearPart = metadata.year ? `.${metadata.year}` : "";
      // Generate safe filename base - ensure no path traversal
      const safeFilenameBase = `${tmdbTitleSafe}${yearPart}`
        .replace(/[^a-zA-Z0-9.一-鿿-_]/g, "_") // Replace unsafe chars
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
