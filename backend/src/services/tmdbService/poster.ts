import axios from "axios";
import { createHash } from "crypto";
import path from "path";
import { IMAGES_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import {
  buildAllowlistedHttpUrl,
  ensureDirSafeSync,
  pathExistsSafeSync,
  resolveSafeChildPath,
  resolveSafePath,
  unlinkSafeSync,
  writeFileSafe,
} from "../../utils/security";
import {
  deleteSmallThumbnailMirrorSync,
  regenerateSmallThumbnailForThumbnailPath,
} from "../thumbnailMirrorService";
import { ALLOWED_IMAGE_HOSTS, TMDB_IMAGE_BASE } from "./constants";

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
export async function downloadPoster(
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

    const response = await axios.get(validatedUrl, { // nosemgrep
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

    // Ensure directory exists. Routed through the safe wrapper rather than a
    // raw fs call, matching writeFileSafe on the line below.
    ensureDirSafeSync(path.dirname(normalizedSavePath), IMAGES_DIR);

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
      segment.replace(/[^a-zA-Z0-9.一-鿿_-]/g, "_")
    )
    .filter((segment) => segment.length > 0);

  if (sanitizedSegments.length === 0) {
    return "";
  }

  return path.join(...sanitizedSegments);
}

/**
 * Poster location for a collection exported as its own show.
 *
 * Kept separate from `resolvePosterSaveLocation()`, which derives a directory
 * from a scan-supplied thumbnail filename. Here the directory is a SHA-256
 * digest of the collection id: a collection id is never used as a raw path
 * segment, and the digest keeps one collection's posters together so a later
 * re-resolution can replace them.
 *
 * The filename encodes the validated media type and numeric TMDB id, so
 * switching a collection to a different match writes a new file rather than
 * overwriting the active one before the transaction commits.
 */
export function resolveCollectionPosterSaveLocation(
  collectionId: string,
  mediaType: "tv" | "movie",
  tmdbId: number
): { absolutePath: string; relativePath: string; webPath: string } | null {
  if (!collectionId || (mediaType !== "tv" && mediaType !== "movie")) {
    return null;
  }
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    return null;
  }

  const digest = createHash("sha256").update(collectionId).digest("hex").slice(0, 32);
  const relativePath = `tmdb/collections/${digest}/${mediaType}-${tmdbId}.jpg`;

  try {
    const absolutePath = resolveSafeChildPath(IMAGES_DIR, relativePath);
    return { absolutePath, relativePath, webPath: `/images/${relativePath}` };
  } catch (error) {
    logger.error(
      `Failed to resolve a collection poster path for ${collectionId}`,
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/** Namespace `resolveCollectionPosterSaveLocation` writes into. */
const COLLECTION_POSTER_PREFIX = "tmdb/collections/";

/**
 * Retires a collection poster this module wrote, and its small mirror.
 *
 * Deliberately scoped to the `tmdb/collections/` namespace: the column that
 * holds the path is free-form, so an image the user pointed at themselves must
 * never be deleted by an activation that did not create it. Best effort - a
 * leftover image is inert, and failing the caller over one would turn a
 * successful activation into an error.
 */
export function removeCollectionPoster(
  webPath: string | null | undefined
): void {
  if (typeof webPath !== "string" || !webPath.startsWith("/images/")) {
    return;
  }
  const relativePath = webPath.slice("/images/".length);
  if (!relativePath.startsWith(COLLECTION_POSTER_PREFIX)) {
    return;
  }

  try {
    const absolutePath = resolveSafeChildPath(IMAGES_DIR, relativePath);
    if (pathExistsSafeSync(absolutePath, IMAGES_DIR)) {
      unlinkSafeSync(absolutePath, IMAGES_DIR);
    }
    deleteSmallThumbnailMirrorSync(webPath);
  } catch (error) {
    logger.warn(`Could not remove a collection poster at ${webPath}`, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function resolvePosterSaveLocation(
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
