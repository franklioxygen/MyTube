import fs from "fs";
import os from "os";
import path from "path";
import { DATA_DIR } from "../../../config/paths";
import {
  YT_DLP_MANAGED_STORE_DIRNAME,
  YT_DLP_WINDOWS_RENAME_ATTEMPTS,
} from "../constants";
import {
  ensureDirSafeSync,
  fsyncFileSafeSync,
  lstatSafeSync,
  normalizeSafeAbsolutePath,
  pathExistsSafeSync,
  readFileSafeSync,
  readdirSafeSync,
  renameSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "../../security";
import { createTempBasename, isValidReleaseId } from "./ids";
import {
  CURRENT_JSON_FILENAME,
  GC_MARKERS_DIRNAME,
  GENERATIONS_DIRNAME,
  TRASH_DIRNAME,
  LEASES_DIRNAME,
  PUBLISH_LOCK_DIRNAME,
  PUBLISH_LOCK_OWNER_FILENAME,
  PUBLISHED_JSON_FILENAME,
  RELEASE_JSON_FILENAME,
  RELEASES_DIRNAME,
  SITE_PACKAGES_DIRNAME,
  STAGING_DIRNAME,
  type ManagedStoreLayout,
} from "./types";

let rootOverride: string | null = null;

export function setManagedStoreRootForTests(root: string | null): void {
  rootOverride = root ? path.resolve(root) : null;
}

export function getManagedStoreRoot(): string {
  if (rootOverride) {
    return rootOverride;
  }
  // Unit tests must not consume a developer DATA_DIR/ytdlp store.
  if (process.env.VITEST) {
    return path.join(os.tmpdir(), "mytube-vitest-ytdlp-store-absent");
  }
  return path.join(DATA_DIR, YT_DLP_MANAGED_STORE_DIRNAME);
}

export function getManagedStoreLayout(
  root: string = getManagedStoreRoot()
): ManagedStoreLayout {
  const resolvedRoot = normalizeSafeAbsolutePath(root);
  return {
    root: resolvedRoot,
    currentPath: resolveSafeChildPath(resolvedRoot, CURRENT_JSON_FILENAME),
    releasesDir: resolveSafeChildPath(resolvedRoot, RELEASES_DIRNAME),
    stagingDir: resolveSafeChildPath(resolvedRoot, STAGING_DIRNAME),
    leasesDir: resolveSafeChildPath(resolvedRoot, LEASES_DIRNAME),
    gcMarkersDir: resolveSafeChildPath(resolvedRoot, GC_MARKERS_DIRNAME),
    generationsDir: resolveSafeChildPath(resolvedRoot, GENERATIONS_DIRNAME),
    trashDir: resolveSafeChildPath(resolvedRoot, TRASH_DIRNAME),
    publishLockDir: resolveSafeChildPath(resolvedRoot, PUBLISH_LOCK_DIRNAME),
  };
}

export function ensureManagedStoreLayout(
  layout: ManagedStoreLayout = getManagedStoreLayout()
): ManagedStoreLayout {
  ensurePrivateDir(layout.root, layout.root);
  ensurePrivateDir(layout.releasesDir, layout.root);
  ensurePrivateDir(layout.stagingDir, layout.root);
  ensurePrivateDir(layout.leasesDir, layout.root);
  ensurePrivateDir(layout.gcMarkersDir, layout.root);
  ensurePrivateDir(layout.generationsDir, layout.root);
  ensurePrivateDir(layout.trashDir, layout.root);
  return layout;
}

function ensurePrivateDir(dirPath: string, root: string): void {
  // ensureDirSafeSync validates the lexical path but follows an existing
  // symlink. Without this check a symlinked `staging` or store root would let
  // `pip --target` write outside the managed store, and staging cleanup would
  // delete through the link. A malformed store must be unusable, not obeyed.
  assertNotSymlink(dirPath, root);
  ensureDirSafeSync(dirPath, root);
  chmodQuiet(dirPath, 0o700);
}

export function chmodQuiet(targetPath: string, mode: number): void {
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // Windows and some network filesystems do not honor POSIX modes.
  }
}

export function assertNotSymlink(targetPath: string, root: string): void {
  if (!pathExistsSafeSync(targetPath, root)) {
    return;
  }
  const stats = lstatSafeSync(targetPath, root);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked path: ${targetPath}`);
  }
}

export function getReleaseDir(
  layout: ManagedStoreLayout,
  releaseId: string
): string {
  if (!isValidReleaseId(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }
  return resolveSafeChildPath(layout.releasesDir, releaseId);
}

export function getReleaseManifestPath(
  layout: ManagedStoreLayout,
  releaseId: string
): string {
  return resolveSafeChildPath(
    getReleaseDir(layout, releaseId),
    RELEASE_JSON_FILENAME
  );
}

export function getPublishedManifestPath(
  layout: ManagedStoreLayout,
  releaseId: string
): string {
  return resolveSafeChildPath(
    getReleaseDir(layout, releaseId),
    PUBLISHED_JSON_FILENAME
  );
}

export function getSitePackagesPath(
  layout: ManagedStoreLayout,
  releaseId: string
): string {
  return resolveSafeChildPath(
    getReleaseDir(layout, releaseId),
    SITE_PACKAGES_DIRNAME
  );
}

export function getStagingDir(
  layout: ManagedStoreLayout,
  operationId: string
): string {
  return resolveSafeChildPath(layout.stagingDir, operationId);
}

export function getLeaseDir(
  layout: ManagedStoreLayout,
  releaseId: string
): string {
  if (!isValidReleaseId(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }
  return resolveSafeChildPath(layout.leasesDir, releaseId);
}

export function getGcMarkerPath(
  layout: ManagedStoreLayout,
  releaseId: string
): string {
  if (!isValidReleaseId(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }
  return resolveSafeChildPath(layout.gcMarkersDir, `${releaseId}.deleting`);
}

/**
 * Where a release is moved before it is deleted. Renaming into here is what
 * makes it unreachable; the deletion itself then has no deadline.
 */
export function getTrashPath(
  layout: ManagedStoreLayout,
  releaseId: string,
  token: string
): string {
  if (!isValidReleaseId(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }
  return resolveSafeChildPath(layout.trashDir, `${releaseId}.${token}`);
}

export function getGenerationClaimPath(
  layout: ManagedStoreLayout,
  generation: number
): string {
  if (!Number.isInteger(generation) || generation < 1) {
    throw new Error(`Invalid generation: ${generation}`);
  }
  return resolveSafeChildPath(layout.generationsDir, `${generation}.json`);
}

/**
 * Drop a generation claim, but only while it is still ours.
 *
 * Claims are reclaimable by age, so a suspended publisher can have its claim
 * taken over. Checking the token and then unlinking would let it delete the
 * replacement's claim in between, and a third publisher could then reserve the
 * same generation. So the claim is moved aside first - a rename is atomic about
 * which process takes a path - and the token confirmed on the copy only we can
 * see. A claim that turns out not to be ours goes straight back.
 */
export function removeGenerationClaim(
  layout: ManagedStoreLayout,
  generation: number,
  token: string
): void {
  const claimPath = getGenerationClaimPath(layout, generation);
  const heldPath = `${claimPath}.${token}.releasing`;
  try {
    fs.renameSync(claimPath, heldPath);
  } catch {
    // Already gone, or another process is mid-reclamation; not ours to delete.
    return;
  }
  if (readClaimToken(heldPath) !== token) {
    try {
      fs.renameSync(heldPath, claimPath);
    } catch {
      // Best effort; an orphaned claim is reclaimed by age.
    }
    return;
  }
  try {
    fs.unlinkSync(heldPath);
  } catch {
    // Harmless: it no longer occupies the claim path.
  }
}

/** The contents of a generation claim, if it is readable. */
export function readClaim(
  claimPath: string
): { token: string | null; releaseId: string | null } {
  try {
    const parsed = JSON.parse(fs.readFileSync(claimPath, "utf8")) as {
      token?: unknown;
      releaseId?: unknown;
    };
    return {
      token: typeof parsed?.token === "string" ? parsed.token : null,
      releaseId:
        typeof parsed?.releaseId === "string" ? parsed.releaseId : null,
    };
  } catch {
    return { token: null, releaseId: null };
  }
}

export function readClaimToken(claimPath: string): string | null {
  return readClaim(claimPath).token;
}

export function getPublishLockOwnerPath(layout: ManagedStoreLayout): string {
  return resolveSafeChildPath(
    layout.publishLockDir,
    PUBLISH_LOCK_OWNER_FILENAME
  );
}

export function listSafeDirNames(dirPath: string, root: string): string[] {
  if (!pathExistsSafeSync(dirPath, root)) {
    return [];
  }
  assertNotSymlink(dirPath, root);
  return readdirSafeSync(dirPath, root);
}

export function readTextFile(filePath: string, root: string): string {
  assertNotSymlink(filePath, root);
  return readFileSafeSync(filePath, root, "utf8");
}

export function writeTextFileFsync(
  filePath: string,
  contents: string,
  mode = 0o600
): void {
  const fd = fs.openSync(filePath, "w", mode);
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  chmodQuiet(filePath, mode);
}

export function atomicReplaceFile(
  targetPath: string,
  root: string,
  contents: string
): void {
  const tmpPath = resolveSafeChildPath(root, createTempBasename("current"));
  writeTextFileFsync(tmpPath, contents, 0o600);
  try {
    renameWithRetry(tmpPath, targetPath, root);
  } catch (error: unknown) {
    // Windows can refuse to replace a file another handle still holds open.
    // The previous manifest stays authoritative; drop our temporary file so a
    // repeatedly failing publisher cannot litter the store.
    try {
      unlinkSafeSync(tmpPath, root);
    } catch {
      // Best effort: a stray uniquely named temp file is ignored by readers.
    }
    throw error;
  }
  try {
    fsyncFileSafeSync(targetPath, root);
  } catch {
    // Best-effort post-rename fsync.
  }
  fsyncDirectory(root);
}

/**
 * Blocking sleep. The publication critical section is synchronous and
 * sub-second by design, so the few short Windows retries below must not yield
 * the loop to another publisher mid-replacement.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(
  fromPath: string,
  toPath: string,
  root: string
): void {
  let delayMs = 20;
  for (let attempt = 1; attempt <= YT_DLP_WINDOWS_RENAME_ATTEMPTS; attempt += 1) {
    try {
      renameSafeSync(fromPath, root, toPath, root);
      return;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      // A concurrent reader holding current.json open makes the replace fail
      // transiently on Windows. Retry the same atomic rename — never fall back
      // to unlink-then-rename, which would expose an empty-current window.
      const transient =
        process.platform === "win32" &&
        (code === "EPERM" || code === "EACCES" || code === "EBUSY");
      if (!transient || attempt === YT_DLP_WINDOWS_RENAME_ATTEMPTS) {
        throw error;
      }
      sleepSync(delayMs);
      delayMs *= 2;
    }
  }
}

export function fsyncDirectory(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Directory fsync is unsupported on some Windows volumes.
  }
}

export function mkdirExclusive(dirPath: string): void {
  fs.mkdirSync(dirPath);
  chmodQuiet(dirPath, 0o700);
}

export function pathExistsInRoot(targetPath: string, root: string): boolean {
  return pathExistsSafeSync(targetPath, root);
}

export function unlinkInRoot(targetPath: string, root: string): void {
  unlinkSafeSync(targetPath, root);
}

export function writeJsonAtomic(
  targetPath: string,
  root: string,
  value: unknown
): void {
  atomicReplaceFile(targetPath, root, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonInPlace(filePath: string, value: unknown): void {
  writeTextFileFsync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Create a file only if it does not exist. Used where the write itself is part
 * of a claim, so a late writer cannot overwrite the file a contender created.
 */
export function writeJsonExclusive(filePath: string, value: unknown): void {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  chmodQuiet(filePath, 0o600);
}

export function statMtimeMs(targetPath: string): number | null {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return null;
  }
}

export function renameInRoot(
  fromPath: string,
  toPath: string,
  root: string
): void {
  renameWithRetry(fromPath, toPath, root);
}
