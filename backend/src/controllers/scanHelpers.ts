import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../config/paths";
import { scrapeMetadataFromTMDB } from "../services/tmdbService";
import { regenerateSmallThumbnailForThumbnailPath } from "../services/thumbnailMirrorService";
import { logger } from "../utils/logger";
import { resolveSafeChildPath, validateImagePath } from "../utils/security";

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

  const tmdbThumbnailFilename = (tmdbMetadata as Record<string, unknown>).thumbnailFilename as
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
        resolveSafeChildPath(
          IMAGES_DIR,
          tmdbThumbnailFilename.split("/").join(path.sep)
        )
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
  tempThumbnailPath: string | null,
  targetThumbnailFilename: string
): Promise<ThumbnailResolution> => {
  const safeTargetThumbnailPath = validateImagePath(
    resolveSafeChildPath(IMAGES_DIR, targetThumbnailFilename)
  );
  const safeTempThumbnailPath = tempThumbnailPath
    ? validateImagePath(tempThumbnailPath)
    : null;

  const finalizeThumbnail = async (
    absoluteThumbnailPath: string
  ): Promise<ThumbnailResolution> => {
    const finalThumbnailFilename = path.basename(absoluteThumbnailPath);

    try {
      await regenerateSmallThumbnailForThumbnailPath(
        `/images/${finalThumbnailFilename}`,
      );
    } catch (error) {
      logger.warn(
        `Failed to regenerate small thumbnail mirror for "${finalThumbnailFilename}", continuing with original thumbnail`,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return {
      filename: finalThumbnailFilename,
      path: `/images/${finalThumbnailFilename}`,
      url: `/images/${finalThumbnailFilename}`,
    };
  };

  try {
    if (safeTempThumbnailPath && await fs.pathExists(safeTempThumbnailPath)) {
      if (
        (await fs.pathExists(safeTargetThumbnailPath)) &&
        safeTempThumbnailPath !== safeTargetThumbnailPath
      ) {
        await fs.remove(safeTempThumbnailPath);
        logger.warn(
          `Thumbnail filename already exists: ${targetThumbnailFilename}, using existing`
        );
      } else if (safeTempThumbnailPath !== safeTargetThumbnailPath) {
        await fs.move(safeTempThumbnailPath, safeTargetThumbnailPath);
        logger.info(`Renamed thumbnail file to "${targetThumbnailFilename}"`);
      }

      return finalizeThumbnail(safeTargetThumbnailPath);
    }
  } catch (error) {
    logger.error(`Error resolving thumbnail file: ${error}`);
  }

  if (await fs.pathExists(safeTargetThumbnailPath)) {
    return finalizeThumbnail(safeTargetThumbnailPath);
  }

  if (safeTempThumbnailPath && await fs.pathExists(safeTempThumbnailPath)) {
    return finalizeThumbnail(safeTempThumbnailPath);
  }

  return {};
};

export const resolveThumbnail = async (
  filename: string,
  tmdbMetadata: TmdbMetadata,
  tempThumbnailPath: string | null,
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
