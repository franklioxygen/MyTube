import fs from "fs-extra";
import path from "path";
import {
  IMAGES_DIR,
  IMAGES_SMALL_DIR,
  VIDEOS_DIR,
} from "../config/paths";
import { logger } from "../utils/logger";
import {
  execFileSafe,
  isPathWithinDirectory,
  resolveSafePath,
} from "../utils/security";

export const SMALL_THUMBNAIL_WIDTH = 480;
export const SMALL_THUMBNAIL_HEIGHT = 270;
export const SMALL_THUMBNAIL_WEB_PREFIX = "/images-small/";

const SMALL_THUMBNAIL_FILTER = `scale=${SMALL_THUMBNAIL_WIDTH}:${SMALL_THUMBNAIL_HEIGHT}:force_original_aspect_ratio=increase,crop=${SMALL_THUMBNAIL_WIDTH}:${SMALL_THUMBNAIL_HEIGHT}`;

const ORIGINAL_THUMBNAIL_LOCATIONS = [
  {
    webPrefix: "/images/",
    absoluteRoot: path.resolve(IMAGES_DIR),
  },
  {
    webPrefix: "/videos/",
    absoluteRoot: path.resolve(VIDEOS_DIR),
  },
] as const;

const SMALL_ROOT_PATH = path.resolve(IMAGES_SMALL_DIR);

const normalizeRelativeThumbnailPath = (
  relativePath: string,
): string | null => {
  if (!relativePath) {
    return null;
  }

  const safeSegments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (
    safeSegments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }

  if (safeSegments.length === 0) {
    return null;
  }

  return path.join(...safeSegments);
};

const resolveSmallThumbnailAbsolutePath = (relativePath: string): string => {
  return resolveSafePath(path.join(IMAGES_SMALL_DIR, relativePath), IMAGES_SMALL_DIR);
};

const findOriginalThumbnailAbsolutePathByRelativePath = (
  relativePath: string,
): string | null => {
  for (const location of ORIGINAL_THUMBNAIL_LOCATIONS) {
    const candidatePath = resolveSafePath(
      path.join(location.absoluteRoot, relativePath),
      location.absoluteRoot,
    );
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
};

const cleanupEmptyParentDirectoriesSync = (startDir: string): void => {
  let currentDir = path.resolve(startDir);

  while (
    currentDir !== SMALL_ROOT_PATH &&
    currentDir.startsWith(`${SMALL_ROOT_PATH}${path.sep}`)
  ) {
    if (!fs.existsSync(currentDir)) {
      currentDir = path.dirname(currentDir);
      continue;
    }

    if (fs.readdirSync(currentDir).length > 0) {
      break;
    }

    fs.rmdirSync(currentDir);
    currentDir = path.dirname(currentDir);
  }
};

const generateSmallThumbnail = async (
  sourceAbsolutePath: string,
  targetAbsolutePath: string,
): Promise<void> => {
  await fs.ensureDir(path.dirname(targetAbsolutePath));

  try {
    await execFileSafe(
      "ffmpeg",
      [
        "-y",
        "-i",
        sourceAbsolutePath,
        "-vf",
        SMALL_THUMBNAIL_FILTER,
        "-frames:v",
        "1",
        targetAbsolutePath,
      ],
      { timeout: 60000 },
    );

    const targetExists = await fs.pathExists(targetAbsolutePath);
    if (!targetExists) {
      throw new Error("Small thumbnail was not created");
    }
  } catch (error) {
    logger.warn(
      "Failed to generate small thumbnail with ffmpeg, falling back to source copy",
      {
        sourceAbsolutePath,
        targetAbsolutePath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    await fs.copy(sourceAbsolutePath, targetAbsolutePath, { overwrite: true });
  }
};

export const getThumbnailRelativePath = (
  thumbnailPath: string | null | undefined,
): string | null => {
  if (!thumbnailPath) {
    return null;
  }

  const rawPath = thumbnailPath.split("?")[0].trim();
  if (!rawPath) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath) && !path.isAbsolute(rawPath)) {
    return null;
  }

  for (const location of ORIGINAL_THUMBNAIL_LOCATIONS) {
    if (rawPath.startsWith(location.webPrefix)) {
      return normalizeRelativeThumbnailPath(
        rawPath.slice(location.webPrefix.length),
      );
    }
  }

  if (path.isAbsolute(rawPath)) {
    const resolvedPath = path.resolve(rawPath);
    for (const location of ORIGINAL_THUMBNAIL_LOCATIONS) {
      if (isPathWithinDirectory(resolvedPath, location.absoluteRoot)) {
        return normalizeRelativeThumbnailPath(
          path.relative(location.absoluteRoot, resolvedPath),
        );
      }
    }

    return null;
  }

  return normalizeRelativeThumbnailPath(rawPath);
};

export const deriveSmallThumbnailWebPath = (
  thumbnailPath: string | null | undefined,
): string | null => {
  const relativePath = getThumbnailRelativePath(thumbnailPath);
  if (!relativePath) {
    return null;
  }

  return `${SMALL_THUMBNAIL_WEB_PREFIX}${relativePath.replace(/\\/g, "/")}`;
};

export const resolveManagedThumbnailTarget = (
  video: Record<string, any>,
  thumbnailFilename: string,
  moveThumbnailsToVideoFolder: boolean,
): {
  absolutePath: string;
  webPath: string;
  relativePath: string;
} => {
  const safeThumbnailFilename = path.basename(thumbnailFilename).trim();
  const relativeDirectoryCandidates = [
    video.videoPath?.startsWith("/videos/")
      ? path.dirname(video.videoPath.replace(/^\/videos\//, ""))
      : null,
    video.thumbnailPath
      ? path.dirname(
          video.thumbnailPath
            .replace(/^\/images\//, "")
            .replace(/^\/videos\//, ""),
        )
      : null,
  ];

  const relativeDirectory =
    relativeDirectoryCandidates.find(
      (candidate) => candidate && candidate !== "." && candidate !== "/",
    ) || "";

  const shouldStoreAlongsideVideo =
    moveThumbnailsToVideoFolder &&
    Boolean(video.videoPath?.startsWith("/videos/"));

  const baseAbsolutePath = shouldStoreAlongsideVideo ? VIDEOS_DIR : IMAGES_DIR;
  const baseWebPath = shouldStoreAlongsideVideo ? "/videos" : "/images";
  const relativePath = relativeDirectory
    ? path.join(relativeDirectory, safeThumbnailFilename)
    : safeThumbnailFilename;

  return {
    absolutePath: resolveSafePath(
      path.join(baseAbsolutePath, relativePath),
      baseAbsolutePath,
    ),
    webPath: `${baseWebPath}/${relativePath.replace(/\\/g, "/")}`,
    relativePath: relativePath.replace(/\\/g, "/"),
  };
};

export const resolveManagedThumbnailWebPathFromAbsolutePath = (
  absolutePath: string,
): string | null => {
  const resolvedPath = path.resolve(absolutePath);

  for (const location of ORIGINAL_THUMBNAIL_LOCATIONS) {
    if (isPathWithinDirectory(resolvedPath, location.absoluteRoot)) {
      const relativePath = path.relative(location.absoluteRoot, resolvedPath);
      const normalizedRelativePath = normalizeRelativeThumbnailPath(relativePath);
      if (!normalizedRelativePath) {
        return null;
      }

      return `${location.webPrefix}${normalizedRelativePath.replace(/\\/g, "/")}`;
    }
  }

  return null;
};

export const ensureSmallThumbnailForRelativePath = async (
  relativePath: string,
  options: { force?: boolean } = {},
): Promise<string | null> => {
  const normalizedRelativePath = normalizeRelativeThumbnailPath(relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const targetAbsolutePath = resolveSmallThumbnailAbsolutePath(
    normalizedRelativePath,
  );

  if (!options.force && (await fs.pathExists(targetAbsolutePath))) {
    return targetAbsolutePath;
  }

  const sourceAbsolutePath = findOriginalThumbnailAbsolutePathByRelativePath(
    normalizedRelativePath,
  );
  if (!sourceAbsolutePath) {
    return null;
  }

  await generateSmallThumbnail(sourceAbsolutePath, targetAbsolutePath);
  return targetAbsolutePath;
};

export const ensureSmallThumbnailForThumbnailPath = async (
  thumbnailPath: string | null | undefined,
): Promise<string | null> => {
  const relativePath = getThumbnailRelativePath(thumbnailPath);
  if (!relativePath) {
    return null;
  }

  return ensureSmallThumbnailForRelativePath(relativePath);
};

export const regenerateSmallThumbnailForThumbnailPath = async (
  thumbnailPath: string | null | undefined,
): Promise<string | null> => {
  const relativePath = getThumbnailRelativePath(thumbnailPath);
  if (!relativePath) {
    return null;
  }

  return ensureSmallThumbnailForRelativePath(relativePath, { force: true });
};

export const moveSmallThumbnailMirrorSync = (
  oldThumbnailPath: string | null | undefined,
  newThumbnailPath: string | null | undefined,
): void => {
  const oldRelativePath = getThumbnailRelativePath(oldThumbnailPath);
  const newRelativePath = getThumbnailRelativePath(newThumbnailPath);

  if (!oldRelativePath && !newRelativePath) {
    return;
  }

  if (!newRelativePath) {
    deleteSmallThumbnailMirrorSync(oldThumbnailPath);
    return;
  }

  if (!oldRelativePath || oldRelativePath === newRelativePath) {
    return;
  }

  const oldAbsolutePath = resolveSmallThumbnailAbsolutePath(oldRelativePath);
  if (!fs.existsSync(oldAbsolutePath)) {
    return;
  }

  const newAbsolutePath = resolveSmallThumbnailAbsolutePath(newRelativePath);
  fs.ensureDirSync(path.dirname(newAbsolutePath));
  fs.moveSync(oldAbsolutePath, newAbsolutePath, { overwrite: true });
  cleanupEmptyParentDirectoriesSync(path.dirname(oldAbsolutePath));
};

export const deleteSmallThumbnailMirrorSync = (
  thumbnailPath: string | null | undefined,
): void => {
  const relativePath = getThumbnailRelativePath(thumbnailPath);
  if (!relativePath) {
    return;
  }

  const absolutePath = resolveSmallThumbnailAbsolutePath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  fs.unlinkSync(absolutePath);
  cleanupEmptyParentDirectoriesSync(path.dirname(absolutePath));
};
