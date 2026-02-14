import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../config/paths";
import { scrapeMetadataFromTMDB } from "../services/tmdbService";
import { logger } from "../utils/logger";
import { validateImagePath } from "../utils/security";

export type TmdbMetadata = Awaited<ReturnType<typeof scrapeMetadataFromTMDB>>;

export type ThumbnailResolution = {
  filename?: string;
  path?: string;
  url?: string;
};

const resolveTmdbThumbnailHelper = async (
  filename: string,
  tmdbMetadata: TmdbMetadata
): Promise<ThumbnailResolution | null> => {
  if (!tmdbMetadata) {
    return null;
  }

  const tmdbThumbnailFilename = (tmdbMetadata as Record<string, unknown>)?.thumbnailFilename as
    | string
    | undefined;
  const tmdbThumbnailPath = tmdbMetadata.thumbnailPath;
  const tmdbThumbnailUrl = tmdbMetadata.thumbnailUrl;

  if (
    tmdbThumbnailPath &&
    tmdbThumbnailPath.startsWith("/images/")
  ) {
    if (tmdbThumbnailFilename) {
      const tmdbFilePath = validateImagePath(
        path.join(IMAGES_DIR, tmdbThumbnailFilename.split("/").join(path.sep))
      );

      if (await fs.pathExists(tmdbFilePath)) {
        logger.info(
          `Using TMDB poster for "${filename}" (saved as: ${tmdbThumbnailFilename})`
        );
      } else {
        logger.warn(
          `TMDB poster path doesn't exist, using metadata path: ${tmdbThumbnailPath}`
        );
      }

      return {
        filename: path.basename(tmdbThumbnailFilename),
        path: tmdbThumbnailPath,
        url: tmdbThumbnailUrl || tmdbThumbnailPath,
      };
    }

    const pathFromMetadata = tmdbThumbnailPath.replace("/images/", "");
    return {
      filename: path.basename(pathFromMetadata),
      path: tmdbThumbnailPath,
      url: tmdbThumbnailUrl || tmdbThumbnailPath,
    };
  }
  return null;
};

const resolveLocalThumbnail = async (
  tempThumbnailPath: string,
  targetThumbnailFilename: string
): Promise<ThumbnailResolution> => {
  let finalThumbnailFilename = targetThumbnailFilename;

  try {
    const safeTargetThumbnailPath = validateImagePath(
      path.join(IMAGES_DIR, finalThumbnailFilename)
    );
    const safeTempThumbnailPath = validateImagePath(tempThumbnailPath);

    if (await fs.pathExists(safeTempThumbnailPath)) {
      if (
        (await fs.pathExists(safeTargetThumbnailPath)) &&
        safeTempThumbnailPath !== safeTargetThumbnailPath
      ) {
        await fs.remove(safeTempThumbnailPath);
        logger.warn(
          `Thumbnail filename already exists: ${finalThumbnailFilename}, using existing`
        );
      } else if (safeTempThumbnailPath !== safeTargetThumbnailPath) {
        await fs.move(safeTempThumbnailPath, safeTargetThumbnailPath);
        logger.info(`Renamed thumbnail file to "${finalThumbnailFilename}"`);
      }

      return {
        filename: finalThumbnailFilename,
        path: `/images/${finalThumbnailFilename}`,
        url: `/images/${finalThumbnailFilename}`,
      };
    }
  } catch (error) {
    logger.error(`Error resolving thumbnail file: ${error}`);
  }

  if (await fs.pathExists(tempThumbnailPath)) {
    finalThumbnailFilename = path.basename(tempThumbnailPath);
    return {
      filename: finalThumbnailFilename,
      path: `/images/${finalThumbnailFilename}`,
      url: `/images/${finalThumbnailFilename}`,
    };
  }

  return {};
};

export const resolveThumbnail = async (
  filename: string,
  tmdbMetadata: TmdbMetadata,
  tempThumbnailPath: string,
  fallbackThumbnailFilename: string
): Promise<ThumbnailResolution> => {
  // 1. Try TMDB thumbnail
  const tmdbResolution = await resolveTmdbThumbnailHelper(filename, tmdbMetadata);
  if (tmdbResolution) {
    return tmdbResolution;
  }

  // 2. Fallback to local processing
  return resolveLocalThumbnail(tempThumbnailPath, fallbackThumbnailFilename);
};
