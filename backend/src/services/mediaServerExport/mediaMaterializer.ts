import { randomBytes } from "crypto";
import path from "path";
import { MEDIA_SERVER_LIBRARY_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
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
  unlinkSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import {
  getArtifact,
  isArtifactSourceUnchanged,
  normalizeLedgerRelativePath,
  recordArtifact,
} from "./artifactLedger";
import type {
  MediaServerArtifactType,
  MediaServerMaterialization,
} from "../storageService/types";
import type { MediaServerExportSkipReason } from "./types";

/**
 * Filesystem mechanics for the managed mirror (issue #411, design §7.6/§7.7).
 *
 * Invariants enforced here, not by callers:
 * - every destination resolves under MEDIA_SERVER_LIBRARY_DIR;
 * - an existing destination is replaced only when the ledger proves MyTube owns
 *   it — an untracked file is never overwritten;
 * - publication is a same-directory temp write followed by an atomic rename,
 *   and the ledger row is written only after the rename succeeds;
 * - symlinks are never created and never followed;
 * - a temporary path is always removed, including on failure.
 */

/** Recognizable so a crashed run's leftovers can be identified later. */
const TEMP_PREFIX = ".mytube-mirror-tmp";

export class MediaMaterializationError extends Error {
  readonly code: MediaServerExportSkipReason;

  constructor(code: MediaServerExportSkipReason, message: string) {
    super(message);
    this.name = "MediaMaterializationError";
    this.code = code;
  }
}

export interface MaterializeResult {
  relativePath: string;
  /** False when the target was already correct and nothing was rewritten. */
  changed: boolean;
  materialization: MediaServerMaterialization;
}

export function isMirrorTempFilename(filename: string): boolean {
  return filename.startsWith(TEMP_PREFIX);
}

function toRelative(absolutePath: string): string {
  return normalizeLedgerRelativePath(
    path.relative(MEDIA_SERVER_LIBRARY_DIR, absolutePath).split(path.sep).join("/")
  );
}

function assertInsideMirror(absolutePath: string): void {
  if (!absolutePath.startsWith(MEDIA_SERVER_LIBRARY_DIR + path.sep)) {
    throw new MediaMaterializationError(
      "artifact_path_collision",
      `Destination is outside the media library root: ${absolutePath}`
    );
  }
}

function makeTempPath(targetPath: string): string {
  // Same directory as the target so the final step is a rename within one
  // filesystem, which is what makes publication atomic.
  //
  // The suffix uses a CSPRNG rather than Math.random(): a predictable temp name
  // inside a directory the user can also write to invites a symlink/TOCTOU race
  // between our create and our rename.
  return resolveSafeChildPath(
    path.dirname(targetPath),
    `${TEMP_PREFIX}-${process.pid}-${Date.now()}-${randomBytes(6).toString(
      "hex"
    )}-${path.basename(targetPath)}`
  );
}

function removeTempQuietly(tempPath: string): void {
  try {
    if (pathExistsSafeSync(tempPath, MEDIA_SERVER_LIBRARY_DIR)) {
      unlinkSafeSync(tempPath, MEDIA_SERVER_LIBRARY_DIR);
    }
  } catch {
    // Best effort. A leftover temp file is inert and is swept on a later run.
  }
}

/**
 * Guards replacement of an existing destination.
 *
 * A path that exists on disk but has no ledger row is a user file that happens
 * to sit where MyTube wants to write. Preserving it and reporting a collision is
 * the design's explicit choice over automatic convergence.
 */
function assertDestinationIsReplaceable(
  targetPath: string,
  relativePath: string,
  expectedAssignmentId?: string
): void {
  if (!pathExistsSafeSync(targetPath, MEDIA_SERVER_LIBRARY_DIR)) {
    return;
  }

  const stat = lstatSafeSync(targetPath, MEDIA_SERVER_LIBRARY_DIR);
  if (stat.isSymbolicLink()) {
    throw new MediaMaterializationError(
      "artifact_ownership_mismatch",
      `Refusing to replace a symlink inside the mirror: ${relativePath}`
    );
  }
  if (stat.isDirectory()) {
    throw new MediaMaterializationError(
      "artifact_path_collision",
      `A directory occupies the planned artifact path: ${relativePath}`
    );
  }

  const owned = getArtifact(relativePath);
  if (!owned) {
    throw new MediaMaterializationError(
      "artifact_path_collision",
      `An untracked file occupies the planned artifact path: ${relativePath}`
    );
  }
  if (
    expectedAssignmentId &&
    owned.assignmentId &&
    owned.assignmentId !== expectedAssignmentId
  ) {
    throw new MediaMaterializationError(
      "artifact_ownership_mismatch",
      `Artifact ${relativePath} is owned by assignment ${owned.assignmentId}, not ${expectedAssignmentId}.`
    );
  }
}

export interface WriteMirrorTextInput {
  targetAbsolutePath: string;
  contents: string;
  artifactType: MediaServerArtifactType;
  showId?: string;
  assignmentId?: string;
}

/**
 * Atomically publishes a generated text artifact (NFO, source JSON).
 *
 * Identical content is detected and skipped so a rebuild of an unchanged
 * library performs no writes and leaves file timestamps alone.
 */
/**
 * Moves a staged file onto its final path, keeping whatever is already there
 * until the move actually succeeds.
 *
 * The plain rename is tried first because POSIX `rename(2)` replaces an
 * existing destination atomically - at no point is the path missing. Unlinking
 * first, as this used to, meant a rename that then failed (a transient
 * permission or filesystem error) left the episode gone entirely: the previous
 * file had been removed and the staged replacement is dropped by the caller's
 * `finally`. A reported failure that keeps the old version is strictly better
 * than a silent hole in the library.
 *
 * The two-step fallback survives only for platforms whose rename refuses an
 * existing destination. It moves the old file aside instead of deleting it, so
 * that a failure of the second rename can still put it back: deleting first
 * would reintroduce the very hole the primary path exists to avoid, because the
 * caller's `finally` then drops the staged replacement too.
 */
function publishOverExisting(tempPath: string, targetAbsolutePath: string): void {
  try {
    renameSafeSync(
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR,
      targetAbsolutePath,
      MEDIA_SERVER_LIBRARY_DIR
    );
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // Windows and some network filesystems refuse to rename onto a file that
    // exists. Only then is moving it out of the way justified.
    const replaceRefused =
      code === "EEXIST" || code === "EPERM" || code === "EACCES" || code === "ENOTEMPTY";
    if (
      !replaceRefused ||
      !pathExistsSafeSync(targetAbsolutePath, MEDIA_SERVER_LIBRARY_DIR)
    ) {
      throw error;
    }
  }

  const backupPath = makeTempPath(targetAbsolutePath);
  renameSafeSync(
    targetAbsolutePath,
    MEDIA_SERVER_LIBRARY_DIR,
    backupPath,
    MEDIA_SERVER_LIBRARY_DIR
  );

  try {
    renameSafeSync(
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR,
      targetAbsolutePath,
      MEDIA_SERVER_LIBRARY_DIR
    );
  } catch (error) {
    try {
      renameSafeSync(
        backupPath,
        MEDIA_SERVER_LIBRARY_DIR,
        targetAbsolutePath,
        MEDIA_SERVER_LIBRARY_DIR
      );
    } catch (restoreError) {
      // The old version could not be put back. It is still on disk under the
      // temp name, so report where, rather than letting it look like a plain
      // publication failure: the ledger still points at the target path and
      // the next run republishes there anyway.
      logger.error(
        "Could not restore a media server mirror artifact after a failed publication",
        restoreError,
        {
          layout: "playlist_tv",
          action: "materialize",
          relativePath: toRelative(targetAbsolutePath),
          backupPath: toRelative(backupPath),
        }
      );
    }
    throw error;
  }

  removeTempQuietly(backupPath);
}

/**
 * True when MyTube already published this exact path and the file is still on
 * disk.
 *
 * Used to decide whether an artifact that cannot be regenerated at full
 * fidelity should be left alone rather than overwritten with a weaker version.
 */
export function isArtifactPublished(targetAbsolutePath: string): boolean {
  assertInsideMirror(targetAbsolutePath);
  if (!getArtifact(toRelative(targetAbsolutePath))) {
    return false;
  }
  try {
    return pathExistsSafeSync(targetAbsolutePath, MEDIA_SERVER_LIBRARY_DIR);
  } catch {
    return false;
  }
}

export function writeMirrorTextArtifact(
  input: WriteMirrorTextInput
): MaterializeResult {
  const { targetAbsolutePath, contents } = input;
  assertInsideMirror(targetAbsolutePath);
  const relativePath = toRelative(targetAbsolutePath);

  if (pathExistsSafeSync(targetAbsolutePath, MEDIA_SERVER_LIBRARY_DIR)) {
    assertDestinationIsReplaceable(
      targetAbsolutePath,
      relativePath,
      input.assignmentId
    );
    try {
      const existing = readFileSafeSync(
        targetAbsolutePath,
        MEDIA_SERVER_LIBRARY_DIR,
        "utf8"
      );
      if (existing === contents) {
        return { relativePath, changed: false, materialization: "generated_text" };
      }
    } catch {
      // Unreadable: fall through and republish.
    }
  }

  const tempPath = makeTempPath(targetAbsolutePath);
  try {
    ensureDirSafeSync(
      path.dirname(targetAbsolutePath),
      MEDIA_SERVER_LIBRARY_DIR
    );
    writeFileSafeSync(tempPath, MEDIA_SERVER_LIBRARY_DIR, contents, {
      encoding: "utf8",
    });
    publishOverExisting(tempPath, targetAbsolutePath);
  } finally {
    removeTempQuietly(tempPath);
  }

  recordArtifact({
    relativePath,
    artifactType: input.artifactType,
    materialization: "generated_text",
    showId: input.showId,
    assignmentId: input.assignmentId,
  });

  return { relativePath, changed: true, materialization: "generated_text" };
}

export interface CopyMirrorImageInput {
  sourceAbsolutePath: string;
  sourceAllowedRoot: string;
  targetAbsolutePath: string;
  artifactType: MediaServerArtifactType;
  showId?: string;
  assignmentId?: string;
}

/**
 * Copies artwork bytes into the mirror.
 *
 * Deliberately a copy rather than a hard link: MyTube regenerates thumbnails in
 * place, and a hard link would let that regeneration silently mutate the
 * media-server asset.
 */
export function copyMirrorImageArtifact(
  input: CopyMirrorImageInput
): MaterializeResult {
  const { sourceAbsolutePath, sourceAllowedRoot, targetAbsolutePath } = input;
  assertInsideMirror(targetAbsolutePath);
  const relativePath = toRelative(targetAbsolutePath);

  if (!pathExistsSafeSync(sourceAbsolutePath, sourceAllowedRoot)) {
    throw new MediaMaterializationError(
      "video_file_missing",
      `Artwork source is missing: ${relativePath}`
    );
  }

  const sourceStat = lstatSafeSync(sourceAbsolutePath, sourceAllowedRoot);
  if (!sourceStat.isFile()) {
    throw new MediaMaterializationError(
      "artifact_ownership_mismatch",
      `Artwork source is not a regular file: ${relativePath}`
    );
  }

  const existing = getArtifact(relativePath);

  // Validated BEFORE the unchanged fast path, not after. The fingerprint below
  // describes the SOURCE only, so a destination that was swapped for a symlink
  // - or a directory, or another assignment's artifact - still matches it, and
  // the fast path would report the artifact as unchanged and leave the mirror
  // serving something this module promises never to create.
  assertDestinationIsReplaceable(
    targetAbsolutePath,
    relativePath,
    input.assignmentId
  );

  if (
    pathExistsSafeSync(targetAbsolutePath, MEDIA_SERVER_LIBRARY_DIR) &&
    isArtifactSourceUnchanged(
      existing,
      sourceAbsolutePath,
      sourceStat.size,
      Math.trunc(sourceStat.mtimeMs)
    )
  ) {
    return { relativePath, changed: false, materialization: "copied_image" };
  }

  const tempPath = makeTempPath(targetAbsolutePath);
  try {
    ensureDirSafeSync(
      path.dirname(targetAbsolutePath),
      MEDIA_SERVER_LIBRARY_DIR
    );
    copyFileSafeSync(
      sourceAbsolutePath,
      sourceAllowedRoot,
      tempPath,
      MEDIA_SERVER_LIBRARY_DIR
    );
    publishOverExisting(tempPath, targetAbsolutePath);
  } finally {
    removeTempQuietly(tempPath);
  }

  recordArtifact({
    relativePath,
    artifactType: input.artifactType,
    materialization: "copied_image",
    showId: input.showId,
    assignmentId: input.assignmentId,
    sourceAbsolutePath,
    sourceSize: sourceStat.size,
    sourceMtimeMs: Math.trunc(sourceStat.mtimeMs),
  });

  return { relativePath, changed: true, materialization: "copied_image" };
}

/** Hard-link failures that a copy can reasonably recover from. */
const RECOVERABLE_LINK_ERRORS = new Set([
  "EXDEV",
  "EPERM",
  "EACCES",
  "EMLINK",
  "ENOSYS",
  "EOPNOTSUPP",
  "ENOTSUP",
]);

function isRecoverableLinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && RECOVERABLE_LINK_ERRORS.has(code);
}

export interface LinkMirrorMediaInput {
  sourceAbsolutePath: string;
  sourceAllowedRoot: string;
  targetAbsolutePath: string;
  artifactType: "episode_media" | "episode_subtitle";
  copyFallbackEnabled: boolean;
  showId?: string;
  assignmentId?: string;
}

/**
 * Publishes a media or subtitle file into the mirror as a hard link, falling
 * back to a byte copy when the filesystem cannot link and the user allowed it.
 *
 * Never a symlink: media servers and Docker mount boundaries treat symlinks
 * inconsistently, and a symlink could point outside the intended library root.
 */
export function linkMirrorMediaArtifact(
  input: LinkMirrorMediaInput
): MaterializeResult {
  const {
    sourceAbsolutePath,
    sourceAllowedRoot,
    targetAbsolutePath,
    copyFallbackEnabled,
  } = input;
  assertInsideMirror(targetAbsolutePath);
  const relativePath = toRelative(targetAbsolutePath);

  if (!pathExistsSafeSync(sourceAbsolutePath, sourceAllowedRoot)) {
    throw new MediaMaterializationError(
      "video_file_missing",
      `Source media is missing for ${relativePath}.`
    );
  }

  // lstat, not stat: a symlinked "original" must not be followed out of the
  // managed root.
  const sourceStat = lstatSafeSync(sourceAbsolutePath, sourceAllowedRoot);
  if (!sourceStat.isFile()) {
    throw new MediaMaterializationError(
      "artifact_ownership_mismatch",
      `Source media is not a regular file for ${relativePath}.`
    );
  }

  const sourceSize = sourceStat.size;
  const sourceMtimeMs = Math.trunc(sourceStat.mtimeMs);
  const existing = getArtifact(relativePath);

  // Validated BEFORE the unchanged fast path, not after. The fingerprint below
  // describes the SOURCE only, so a destination that was swapped for a symlink
  // - or a directory, or another assignment's artifact - still matches it, and
  // the fast path would report the artifact as unchanged and leave the mirror
  // serving something this module promises never to create.
  assertDestinationIsReplaceable(
    targetAbsolutePath,
    relativePath,
    input.assignmentId
  );

  if (
    pathExistsSafeSync(targetAbsolutePath, MEDIA_SERVER_LIBRARY_DIR) &&
    isArtifactSourceUnchanged(
      existing,
      sourceAbsolutePath,
      sourceSize,
      sourceMtimeMs
    )
  ) {
    return {
      relativePath,
      changed: false,
      materialization: existing?.materialization ?? "hard_link",
    };
  }

  const tempPath = makeTempPath(targetAbsolutePath);
  let materialization: MediaServerMaterialization;

  try {
    ensureDirSafeSync(
      path.dirname(targetAbsolutePath),
      MEDIA_SERVER_LIBRARY_DIR
    );

    try {
      linkSafeSync(
        sourceAbsolutePath,
        sourceAllowedRoot,
        tempPath,
        MEDIA_SERVER_LIBRARY_DIR
      );
      materialization = "hard_link";
    } catch (linkError) {
      if (!isRecoverableLinkError(linkError)) {
        throw linkError;
      }
      if (!copyFallbackEnabled) {
        throw new MediaMaterializationError(
          "hard_link_failed_copy_disabled",
          `Hard link failed for ${relativePath} and the copy fallback is disabled.`
        );
      }

      logger.info("Falling back to a media copy for the media server mirror", {
        layout: "playlist_tv",
        action: "materialize",
        artifactType: input.artifactType,
        relativePath,
        materialization: "copied_media",
        showId: input.showId,
        assignmentId: input.assignmentId,
      });

      copyFileSafeSync(
        sourceAbsolutePath,
        sourceAllowedRoot,
        tempPath,
        MEDIA_SERVER_LIBRARY_DIR
      );
      materialization =
        input.artifactType === "episode_subtitle"
          ? "copied_subtitle"
          : "copied_media";
    }

    // Size verification catches a source truncated or replaced mid-copy. A
    // partially published media file is worse than a reported failure.
    const publishedStat = lstatSafeSync(tempPath, MEDIA_SERVER_LIBRARY_DIR);
    if (publishedStat.size !== sourceSize) {
      throw new MediaMaterializationError(
        "source_changed_during_materialization",
        `Source size changed while materializing ${relativePath} (${sourceSize} → ${publishedStat.size}).`
      );
    }

    publishOverExisting(tempPath, targetAbsolutePath);
  } finally {
    removeTempQuietly(tempPath);
  }

  recordArtifact({
    relativePath,
    artifactType: input.artifactType,
    materialization,
    showId: input.showId,
    assignmentId: input.assignmentId,
    sourceAbsolutePath,
    sourceSize,
    sourceMtimeMs,
  });

  return { relativePath, changed: true, materialization };
}

/**
 * Deletes a mirror path that the ledger proves MyTube owns.
 *
 * Returns false without touching disk when the path is untracked, is a symlink,
 * or is a directory — those are reported by the caller rather than removed.
 */
export function removeOwnedMirrorArtifact(relativePath: string): boolean {
  const normalized = normalizeLedgerRelativePath(relativePath);
  if (!getArtifact(normalized)) {
    return false;
  }

  const absolutePath = resolveSafeChildPath(
    MEDIA_SERVER_LIBRARY_DIR,
    normalized
  );
  assertInsideMirror(absolutePath);

  if (!pathExistsSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR)) {
    // Already gone on disk; the caller still drops the ledger row.
    return true;
  }

  const stat = lstatSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    throw new MediaMaterializationError(
      "artifact_ownership_mismatch",
      `Refusing to delete ${relativePath}: it is not the regular file the ledger recorded.`
    );
  }

  unlinkSafeSync(absolutePath, MEDIA_SERVER_LIBRARY_DIR);
  return true;
}

/**
 * Prunes empty directories upward, stopping at (and never removing) the mirror
 * root itself.
 */
export function pruneEmptyMirrorDirectories(startAbsolutePath: string): void {
  let current = startAbsolutePath;

  while (
    current.startsWith(MEDIA_SERVER_LIBRARY_DIR + path.sep) &&
    current !== MEDIA_SERVER_LIBRARY_DIR
  ) {
    try {
      if (!pathExistsSafeSync(current, MEDIA_SERVER_LIBRARY_DIR)) {
        current = path.dirname(current);
        continue;
      }
      const stat = lstatSafeSync(current, MEDIA_SERVER_LIBRARY_DIR);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return;
      }
      if (readdirSafeSync(current, MEDIA_SERVER_LIBRARY_DIR).length > 0) {
        return;
      }
      removeEmptyDirSafeSync(current, MEDIA_SERVER_LIBRARY_DIR);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
