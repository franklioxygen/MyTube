import fs from "fs-extra";
import path from "path";
import {
  AVATARS_DIR,
  IMAGES_DIR,
  MEDIA_SERVER_LIBRARY_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import {
  copyFileSafeSync,
  ensureDirSafeSync,
  linkSafeSync,
  lstatSafeSync,
  pathExistsSafeSync,
  readFileSafeSync,
  readdirSafeSync,
  removeEmptyDirSafeSync,
  renameSafeSync,
  resolveSafeChildPath,
  statSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import { deleteArtifact, getArtifact, upsertArtifact } from "./artifactLedger";
import type {
  MediaServerExportArtifact,
  MediaServerExportSkipReason,
  MediaServerMaterialization,
  PlannedArtifact,
} from "./types";

/**
 * Filesystem mechanics for one mirror artifact (issue #411).
 *
 * Two invariants drive everything here: a destination is only ever replaced
 * when the artifact ledger proves MyTube owns it, and the ledger row is only
 * written after the file is durably in place.
 */

/** A per-artifact failure that must not abort the rest of the run. */
export class ArtifactError extends Error {
  constructor(
    readonly reason: MediaServerExportSkipReason,
    message: string
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

export interface MaterializeArtifactResult {
  changed: boolean;
  materialization: MediaServerMaterialization;
}

const SOURCE_ROOTS = [
  VIDEOS_DIR,
  IMAGES_DIR,
  AVATARS_DIR,
  SUBTITLES_DIR,
] as const;

/**
 * Hard links legitimately fail across filesystems, on filesystems that do not
 * implement them, and when the link count limit is reached. Anything else is a
 * real error and must not silently become a copy.
 */
const HARD_LINK_FALLBACK_CODES = new Set([
  "EXDEV",
  "EPERM",
  "EACCES",
  "EMLINK",
  "ENOSYS",
  "EOPNOTSUPP",
  "ENOTSUP",
]);

function resolveMirrorPath(relativePath: string): string {
  return resolveSafeChildPath(MEDIA_SERVER_LIBRARY_DIR, relativePath);
}

function resolveSourceRoot(absolutePath: string): string {
  const root = SOURCE_ROOTS.find((candidate) =>
    absolutePath.startsWith(candidate + path.sep)
  );
  if (!root) {
    throw new ArtifactError(
      "invalid_catalog_assignment",
      `Source path is outside every managed root: ${path.basename(absolutePath)}`
    );
  }
  return root;
}

function mirrorPathExists(absolutePath: string): boolean {
  return pathExistsSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR);
}

/**
 * Refuse to touch a destination MyTube does not own. A file the user placed
 * there is preserved and reported, and a symlink is never followed — it could
 * redirect a write or a delete outside the mirror.
 */
function assertDestinationIsOwned(
  relativePath: string,
  absolutePath: string,
  tracked: MediaServerExportArtifact | undefined
): void {
  if (!mirrorPathExists(absolutePath)) {
    return;
  }
  if (lstatSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR).isSymbolicLink()) {
    throw new ArtifactError(
      "artifact_ownership_mismatch",
      `Refusing to replace symlink ${relativePath} inside the media library.`
    );
  }
  if (!tracked) {
    throw new ArtifactError(
      "artifact_path_collision",
      `${relativePath} already exists and is not tracked as a MyTube artifact.`
    );
  }
}

function buildTempPath(absolutePath: string): string {
  return resolveSafeChildPath(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.tmp-${process.pid}-${Date.now()}`
  );
}

function removeTempPath(tempPath: string): void {
  try {
    if (mirrorPathExists(tempPath)) {
      fs.removeSync(tempPath);
    }
  } catch {
    // A leftover temp file is swept by the next rebuild; never mask the
    // original failure with a cleanup error.
  }
}

function writeGeneratedText(
  artifact: PlannedArtifact,
  showId: string
): MaterializeArtifactResult {
  const absolutePath = resolveMirrorPath(artifact.relativePath);
  const content = artifact.content ?? "";
  const tracked = getArtifact(artifact.relativePath);

  assertDestinationIsOwned(artifact.relativePath, absolutePath, tracked);
  if (
    tracked &&
    mirrorPathExists(absolutePath) &&
    readFileSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR, "utf8") === content
  ) {
    return { changed: false, materialization: "generated_text" };
  }

  const tempPath = buildTempPath(absolutePath);
  try {
    ensureDirSafeSync(path.dirname(absolutePath), MEDIA_SERVER_LIBRARY_DIR);
    writeFileSafeSync(tempPath, MEDIA_SERVER_LIBRARY_DIR, content, {
      encoding: "utf8",
    });
    renameSafeSync(
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR,
      absolutePath,
      MEDIA_SERVER_LIBRARY_DIR
    );
  } finally {
    removeTempPath(tempPath);
  }

  upsertArtifact({
    relativePath: artifact.relativePath,
    artifactType: artifact.artifactType,
    showId,
    assignmentId: artifact.assignmentId,
    materialization: "generated_text",
  });
  return { changed: true, materialization: "generated_text" };
}

function publishSourceFile(
  artifact: PlannedArtifact,
  showId: string,
  copyFallback: boolean
): MaterializeArtifactResult {
  const sourceAbsolutePath = artifact.sourceAbsolutePath as string;
  const sourceRoot = resolveSourceRoot(sourceAbsolutePath);
  const sourceStats = lstatSafeSync(sourceAbsolutePath, sourceRoot);
  if (!sourceStats.isFile()) {
    throw new ArtifactError(
      "invalid_catalog_assignment",
      `Source for ${artifact.relativePath} is not a regular file.`
    );
  }

  const absolutePath = resolveMirrorPath(artifact.relativePath);
  const tracked = getArtifact(artifact.relativePath);
  assertDestinationIsOwned(artifact.relativePath, absolutePath, tracked);

  if (
    tracked &&
    tracked.sourceAbsolutePath === sourceAbsolutePath &&
    tracked.sourceSize === sourceStats.size &&
    tracked.sourceMtimeMs === Math.floor(sourceStats.mtimeMs) &&
    mirrorPathExists(absolutePath)
  ) {
    return { changed: false, materialization: tracked.materialization };
  }

  const tempPath = buildTempPath(absolutePath);
  let materialization: MediaServerMaterialization = artifact.materialization;
  try {
    ensureDirSafeSync(path.dirname(absolutePath), MEDIA_SERVER_LIBRARY_DIR);
    if (artifact.materialization === "copied_image") {
      // Artwork is copied rather than linked so regenerating a thumbnail can
      // never mutate the file the media server already scanned.
      copyFileSafeSync(
        sourceAbsolutePath,
        sourceRoot,
        tempPath,
        MEDIA_SERVER_LIBRARY_DIR
      );
    } else {
      materialization = linkOrCopy(
        sourceAbsolutePath,
        sourceRoot,
        tempPath,
        artifact,
        copyFallback
      );
    }

    if (
      statSafeSync(tempPath, MEDIA_SERVER_LIBRARY_DIR).size !== sourceStats.size
    ) {
      throw new ArtifactError(
        "source_changed_during_materialization",
        `Source for ${artifact.relativePath} changed size while publishing.`
      );
    }

    renameSafeSync(
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR,
      absolutePath,
      MEDIA_SERVER_LIBRARY_DIR
    );
  } finally {
    removeTempPath(tempPath);
  }

  upsertArtifact({
    relativePath: artifact.relativePath,
    artifactType: artifact.artifactType,
    showId,
    assignmentId: artifact.assignmentId,
    sourceAbsolutePath,
    sourceSize: sourceStats.size,
    sourceMtimeMs: Math.floor(sourceStats.mtimeMs),
    materialization,
  });
  return { changed: true, materialization };
}

function linkOrCopy(
  sourceAbsolutePath: string,
  sourceRoot: string,
  tempPath: string,
  artifact: PlannedArtifact,
  copyFallback: boolean
): MediaServerMaterialization {
  try {
    linkSafeSync(
      sourceAbsolutePath,
      sourceRoot,
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR
    );
    return "hard_link";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !HARD_LINK_FALLBACK_CODES.has(code)) {
      throw error;
    }
    if (!copyFallback) {
      throw new ArtifactError(
        "hard_link_failed_copy_disabled",
        `Hard link failed (${code}) for ${artifact.relativePath} and copy fallback is disabled.`
      );
    }
    copyFileSafeSync(
      sourceAbsolutePath,
      sourceRoot,
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR
    );
    return artifact.artifactType === "episode_subtitle"
      ? "copied_subtitle"
      : "copied_media";
  }
}

export function materializeArtifact(
  artifact: PlannedArtifact,
  showId: string,
  copyFallback: boolean
): MaterializeArtifactResult {
  return artifact.materialization === "generated_text"
    ? writeGeneratedText(artifact, showId)
    : publishSourceFile(artifact, showId, copyFallback);
}

/**
 * Remove a tracked artifact and prune the directories it leaves empty. Only the
 * ledger authorizes the delete, so an original video can never be reached from
 * here.
 */
export function removeTrackedArtifact(relativePath: string): void {
  const absolutePath = resolveMirrorPath(relativePath);
  if (mirrorPathExists(absolutePath)) {
    if (lstatSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR).isSymbolicLink()) {
      throw new ArtifactError(
        "artifact_ownership_mismatch",
        `Refusing to delete symlink ${relativePath} inside the media library.`
      );
    }
    fs.removeSync(absolutePath);
  }
  deleteArtifact(relativePath);
  pruneEmptyMirrorDirectories(path.dirname(absolutePath));
}

/**
 * Walk up from a directory removing the empty ones, stopping at (and never
 * removing) the mirror root. Deliberately scoped to the mirror rather than
 * reusing the storage-root helper, so the adjacent layout's allowed roots stay
 * unreachable from here.
 */
function pruneEmptyMirrorDirectories(startDirectory: string): void {
  let current = startDirectory;
  while (current !== MEDIA_SERVER_LIBRARY_DIR) {
    const relative = path.relative(MEDIA_SERVER_LIBRARY_DIR, current);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return;
    }
    if (!mirrorPathExists(current)) {
      current = path.dirname(current);
      continue;
    }
    if (lstatSafeSync(current, MEDIA_SERVER_LIBRARY_DIR).isSymbolicLink()) {
      return;
    }
    if (readdirSafeSync(current, MEDIA_SERVER_LIBRARY_DIR).length > 0) {
      return;
    }
    removeEmptyDirSafeSync(current, MEDIA_SERVER_LIBRARY_DIR);
    current = path.dirname(current);
  }
}
