import { pathExistsTrustedSync } from "../../security";
import { YT_DLP_WINDOWS_RENAME_ATTEMPTS } from "../constants";
import { parseYtDlpReleaseTimestamp } from "../versionStamp";
import { isValidReleaseId } from "./ids";
import {
  assertNotSymlink,
  sleepSync,
  getManagedStoreLayout,
  getReleaseDir,
  getReleaseManifestPath,
  getPublishedManifestPath,
  getSitePackagesPath,
  pathExistsInRoot,
  readTextFile,
  unlinkInRoot,
  writeJsonAtomic,
} from "./paths";
import {
  SITE_PACKAGES_DIRNAME,
  type CurrentManifest,
  type LoadedManagedRelease,
  type PublishedManifest,
  type PublishDecision,
  type ReleaseManifest,
} from "./types";

const PYTHON_PREFIX_ARGS_MAX = 8;

let highestGenerationSeen = 0;

export function noteObservedGeneration(generation: number): void {
  if (Number.isInteger(generation) && generation > highestGenerationSeen) {
    highestGenerationSeen = generation;
  }
}

export function getHighestObservedGeneration(): number {
  return highestGenerationSeen;
}

export function resetObservedGenerationForTests(): void {
  highestGenerationSeen = 0;
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!isRecord(value)) {
    throw new Error("release.json is not an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported release.json schemaVersion");
  }
  if (
    typeof value.releaseId !== "string" ||
    !isValidReleaseId(value.releaseId)
  ) {
    throw new Error("Invalid releaseId in release.json");
  }
  if (typeof value.version !== "string" || !value.version.trim()) {
    throw new Error("Invalid version in release.json");
  }
  if (
    typeof value.installedAt !== "string" ||
    Number.isNaN(Date.parse(value.installedAt))
  ) {
    throw new Error("Invalid installedAt in release.json");
  }
  if (
    typeof value.pythonExecutable !== "string" ||
    !value.pythonExecutable.trim()
  ) {
    throw new Error("Invalid pythonExecutable in release.json");
  }
  if (!Array.isArray(value.pythonPrefixArgs)) {
    throw new Error("Invalid pythonPrefixArgs in release.json");
  }
  if (value.pythonPrefixArgs.length > PYTHON_PREFIX_ARGS_MAX) {
    throw new Error("Too many pythonPrefixArgs in release.json");
  }
  const pythonPrefixArgs = value.pythonPrefixArgs.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error("pythonPrefixArgs must be strings");
    }
    return arg;
  });
  if (value.sitePackages !== SITE_PACKAGES_DIRNAME) {
    throw new Error("sitePackages must be the managed relative directory name");
  }
  return {
    schemaVersion: 1,
    releaseId: value.releaseId,
    version: value.version.trim(),
    installedAt: value.installedAt,
    pythonExecutable: value.pythonExecutable,
    pythonPrefixArgs,
    sitePackages: SITE_PACKAGES_DIRNAME,
  };
}

export function parseCurrentManifest(value: unknown): CurrentManifest {
  if (!isRecord(value)) {
    throw new Error("current.json is not an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported current.json schemaVersion");
  }
  if (
    typeof value.generation !== "number" ||
    !Number.isInteger(value.generation) ||
    value.generation < 1
  ) {
    throw new Error("Invalid generation in current.json");
  }
  if (
    typeof value.releaseId !== "string" ||
    !isValidReleaseId(value.releaseId)
  ) {
    throw new Error("Invalid releaseId in current.json");
  }
  if (
    value.previousReleaseId !== null &&
    (typeof value.previousReleaseId !== "string" ||
      !isValidReleaseId(value.previousReleaseId))
  ) {
    throw new Error("Invalid previousReleaseId in current.json");
  }
  if (
    typeof value.publishedAt !== "string" ||
    Number.isNaN(Date.parse(value.publishedAt))
  ) {
    throw new Error("Invalid publishedAt in current.json");
  }
  noteObservedGeneration(value.generation);
  return {
    schemaVersion: 1,
    generation: value.generation,
    releaseId: value.releaseId,
    previousReleaseId: value.previousReleaseId,
    publishedAt: value.publishedAt,
  };
}

export function parsePublishedManifest(value: unknown): PublishedManifest {
  if (!isRecord(value)) {
    throw new Error("published.json is not an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported published.json schemaVersion");
  }
  if (
    typeof value.releaseId !== "string" ||
    !isValidReleaseId(value.releaseId)
  ) {
    throw new Error("Invalid releaseId in published.json");
  }
  if (
    typeof value.generation !== "number" ||
    !Number.isInteger(value.generation) ||
    value.generation < 1
  ) {
    throw new Error("Invalid generation in published.json");
  }
  if (
    value.previousReleaseId !== null &&
    (typeof value.previousReleaseId !== "string" ||
      !isValidReleaseId(value.previousReleaseId))
  ) {
    throw new Error("Invalid previousReleaseId in published.json");
  }
  if (
    typeof value.publishedAt !== "string" ||
    Number.isNaN(Date.parse(value.publishedAt))
  ) {
    throw new Error("Invalid publishedAt in published.json");
  }
  noteObservedGeneration(value.generation);
  return {
    schemaVersion: 1,
    releaseId: value.releaseId,
    generation: value.generation,
    previousReleaseId: value.previousReleaseId,
    publishedAt: value.publishedAt,
  };
}

export function readCurrentManifest(
  root = getManagedStoreLayout().root
): CurrentManifest | null {
  const layout = getManagedStoreLayout(root);
  for (
    let attempt = 1;
    attempt <= YT_DLP_WINDOWS_RENAME_ATTEMPTS;
    attempt += 1
  ) {
    if (!pathExistsInRoot(layout.currentPath, layout.root)) {
      return null;
    }
    try {
      return parseCurrentManifest(
        JSON.parse(readTextFile(layout.currentPath, layout.root))
      );
    } catch (error: unknown) {
      // On Windows a read can fail transiently while the publisher renames a
      // new manifest over this one. Anywhere else — and after the last retry —
      // an unreadable manifest really is invalid and recovery takes over.
      if (
        !isTransientWindowsReadError(error) ||
        attempt === YT_DLP_WINDOWS_RENAME_ATTEMPTS
      ) {
        return null;
      }
      sleepSync(20 * attempt);
    }
  }
  return null;
}

function isTransientWindowsReadError(error: unknown): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

export function readReleaseManifest(
  releaseId: string,
  root = getManagedStoreLayout().root
): ReleaseManifest | null {
  const layout = getManagedStoreLayout(root);
  const manifestPath = getReleaseManifestPath(layout, releaseId);
  if (!pathExistsInRoot(manifestPath, layout.root)) {
    return null;
  }
  try {
    const manifest = parseReleaseManifest(
      JSON.parse(readTextFile(manifestPath, layout.root))
    );
    return manifest.releaseId === releaseId ? manifest : null;
  } catch {
    return null;
  }
}

export function readPublishedManifest(
  releaseId: string,
  root = getManagedStoreLayout().root
): PublishedManifest | null {
  const layout = getManagedStoreLayout(root);
  const manifestPath = getPublishedManifestPath(layout, releaseId);
  if (!pathExistsInRoot(manifestPath, layout.root)) {
    return null;
  }
  try {
    const manifest = parsePublishedManifest(
      JSON.parse(readTextFile(manifestPath, layout.root))
    );
    return manifest.releaseId === releaseId ? manifest : null;
  } catch {
    return null;
  }
}

export function loadManagedRelease(
  releaseId: string,
  current: CurrentManifest | null = null,
  root = getManagedStoreLayout().root
): LoadedManagedRelease | null {
  const layout = getManagedStoreLayout(root);
  const releaseDir = getReleaseDir(layout, releaseId);
  const sitePackagesPath = getSitePackagesPath(layout, releaseId);
  try {
    assertNotSymlink(releaseDir, layout.root);
    assertNotSymlink(sitePackagesPath, layout.root);
  } catch {
    return null;
  }
  const release = readReleaseManifest(releaseId, layout.root);
  if (!release || !pathExistsInRoot(sitePackagesPath, layout.root)) {
    return null;
  }
  if (!pathExistsTrustedSync(release.pythonExecutable)) {
    return null;
  }
  return {
    current: current ?? {
      schemaVersion: 1,
      generation: 0,
      releaseId,
      previousReleaseId: null,
      publishedAt: release.installedAt,
    },
    release,
    releaseDir,
    sitePackagesPath,
  };
}

export function writeReleaseManifest(
  root: string,
  manifest: ReleaseManifest
): void {
  const layout = getManagedStoreLayout(root);
  writeJsonAtomic(
    getReleaseManifestPath(layout, manifest.releaseId),
    layout.root,
    manifest
  );
}

export function writeCurrentManifest(
  root: string,
  manifest: CurrentManifest
): void {
  const layout = getManagedStoreLayout(root);
  writeJsonAtomic(layout.currentPath, layout.root, manifest);
  noteObservedGeneration(manifest.generation);
}

export function writePublishedManifest(
  root: string,
  manifest: PublishedManifest
): void {
  const layout = getManagedStoreLayout(root);
  writeJsonAtomic(
    getPublishedManifestPath(layout, manifest.releaseId),
    layout.root,
    manifest
  );
  noteObservedGeneration(manifest.generation);
}

/**
 * Remove a publication record. Used only to undo a record this process wrote
 * moments earlier and could not commit; a committed record is never deleted
 * except with the release directory itself.
 */
export function removePublishedManifest(
  root: string,
  releaseId: string
): boolean {
  const layout = getManagedStoreLayout(root);
  const manifestPath = getPublishedManifestPath(layout, releaseId);
  try {
    if (pathExistsInRoot(manifestPath, layout.root)) {
      unlinkInRoot(manifestPath, layout.root);
    }
    return true;
  } catch {
    // Reported rather than swallowed: the caller has to know, because freeing
    // the generation while its record survives would let two releases claim it.
    return false;
  }
}

export function decidePublication(input: {
  current: CurrentManifest | null;
  currentVersion: string | null;
  candidateVersion: string;
  candidateReleaseId: string;
  generationAtInstallStart: number | null;
  /**
   * False when the current release was found not to run. A same-version
   * candidate is then a repair, not a no-op, and must be allowed to replace it
   * - otherwise a broken release can never be superseded, because pip keeps
   * producing the same latest version.
   */
  currentIsUsable?: boolean;
}): PublishDecision {
  const { current, currentVersion, candidateVersion, generationAtInstallStart } =
    input;

  if (!current) {
    return {
      action: "publish",
      generation: Math.max(getHighestObservedGeneration(), 0) + 1,
      previousReleaseId: null,
    };
  }

  if (current.releaseId === input.candidateReleaseId) {
    return {
      action: "reject",
      kind: "already-current",
      reason: "candidate is already current",
    };
  }

  if (
    currentVersion &&
    currentVersion === candidateVersion &&
    input.currentIsUsable !== false
  ) {
    return {
      action: "reject",
      kind: "already-current",
      reason: "same version is already current",
    };
  }

  const currentTs = parseYtDlpReleaseTimestamp(currentVersion);
  const candidateTs = parseYtDlpReleaseTimestamp(candidateVersion);
  if (currentTs !== null && candidateTs !== null && candidateTs < currentTs) {
    return {
      action: "reject",
      kind: "conflict",
      reason: "candidate is older than the current release",
    };
  }

  if (
    currentTs === null &&
    candidateTs === null &&
    generationAtInstallStart !== null &&
    current.generation !== generationAtInstallStart
  ) {
    return {
      action: "reject",
      kind: "conflict",
      reason: "current generation changed while candidate version is unorderable",
    };
  }

  return {
    action: "publish",
    generation: current.generation + 1,
    previousReleaseId: current.releaseId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
