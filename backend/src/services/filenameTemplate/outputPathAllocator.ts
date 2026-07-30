import crypto from "crypto";
import { constants as fsConstants } from "fs";
import os from "os";
import path from "path";
import { DATA_DIR, IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import {
  copyFileSafeSync,
  ensureDirSafeSync,
  fsyncFileSafeSync,
  isPathWithinDirectory,
  linkSafeSync,
  moveSafeSync,
  normalizeSafeAbsolutePath,
  pathExistsSafeSync,
  readFileSafeSync,
  renameSafeSync,
  resolveSafeChildPath,
  statSafeSync,
  unlinkSafeSync,
  writeFileSafeSync,
} from "../../utils/security";
import type { Video } from "../storageService/types";
import { applyDedupeToRelatedPaths } from "./dedupe";
import { canonicalizeManagedPath } from "./pathHelpers";

export type MediaIdentity = {
  platform: string;
  sourceVideoId: string | null;
  mediaType: "video" | "audio";
  partNumber?: number | null;
  localVideoId?: string;
};

export type OutputFamilyReservation = {
  videoRelativePath: string;
  thumbnailRelativePath: string;
  subtitleBaseRelativePath: string;
  collisionStrategy: "none" | "source_id" | "numeric";
  release: () => void;
};

export type OwnedReplacementStagingPath = {
  finalPath: string;
  stagingPath: string;
  stagingRootDir: string;
  destinationRootDir: string | string[];
};

export type OutputFamilyMove = {
  from: string;
  fromBase: string | string[];
  to: string;
  toBase: string | string[];
  kind?: "video" | "thumbnail" | "subtitle" | "sidecar";
};

export type AllocateOutputFamilyInput = {
  videoRelativePath: string;
  thumbnailRelativePath: string;
  subtitleBaseRelativePath: string;
  subtitleBaseDir?: string;
  subtitleFiles?: Array<{ language: string; extension: string }>;
  thumbnailBaseDir: string;
  identity: MediaIdentity;
  existingLocalVideoId?: string;
  ownedManagedPaths?: string[];
  thumbnailRequired?: boolean;
  subtitleRequired?: boolean;
};

const activeFamilyReservations = new Set<string>();
const RESERVATION_DIR = "output-path-reservations";
const OUTPUT_FAMILY_JOURNAL_DIR = "output-family-journals";
const OUTPUT_STAGING_DIR = ".mytube-staging";
const CLAIM_MARKER_PREFIX = "MYTUBE_OUTPUT_CLAIM_V1";
const REPLACEMENT_BACKUP_SUFFIX = ".mytube-replace-backup";
const HARD_LINK_FALLBACK_ERROR_CODES = new Set([
  "EXDEV",
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EINVAL",
]);
let videoProviderForTests: (() => Video[]) | null = null;
const hardLinkPublishSupportByRoot = new Map<string, boolean>();

function getReservationRoot(): string {
  return resolveSafeChildPath(DATA_DIR, RESERVATION_DIR);
}

function getOutputFamilyJournalRoot(): string {
  return resolveSafeChildPath(DATA_DIR, OUTPUT_FAMILY_JOURNAL_DIR);
}

function outputFamilyJournalPath(allocationId: string): string {
  return resolveSafeChildPath(
    getOutputFamilyJournalRoot(),
    `${allocationId}.json`
  );
}

function writeOutputFamilyJournalSync(
  allocationId: string,
  payload: Record<string, unknown>
): void {
  const journalRoot = getOutputFamilyJournalRoot();
  ensureDirSafeSync(journalRoot, DATA_DIR);
  writeFileSafeSync(
    outputFamilyJournalPath(allocationId),
    journalRoot,
    JSON.stringify(
      {
        version: 1,
        allocationId,
        updatedAtMs: Date.now(),
        ...payload,
      },
      null,
      2
    ),
    { flag: "w" }
  );
}

function removeOutputFamilyJournalSync(allocationId: string): void {
  try {
    unlinkSafeSync(outputFamilyJournalPath(allocationId), getOutputFamilyJournalRoot());
  } catch {
    // Journal cleanup is best-effort after the operation is durably complete.
  }
}

function normalizeRoots(rootDir: string | string[]): string[] {
  return Array.isArray(rootDir) ? rootDir : [rootDir];
}

function resolvePathWithinRoots(
  candidatePath: string,
  roots: string | string[]
): string {
  const normalized = normalizeSafeAbsolutePath(candidatePath);
  if (!normalizeRoots(roots).some((root) => isPathWithinDirectory(normalized, root))) {
    throw new Error(`Path is outside managed roots: ${candidatePath}`);
  }
  return normalized;
}

function findContainingRoot(candidatePath: string, roots: string | string[]): string {
  const normalized = normalizeSafeAbsolutePath(candidatePath);
  const containingRoot = normalizeRoots(roots).find((root) =>
    isPathWithinDirectory(normalized, root)
  );
  if (!containingRoot) {
    throw new Error(`Path is outside managed roots: ${candidatePath}`);
  }
  return containingRoot;
}

function lockPathForFamily(canonicalFamilyStem: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalFamilyStem)
    .digest("hex");
  return resolveSafeChildPath(getReservationRoot(), `${digest}.lock`);
}

function appendSuffixToRelativePath(relativePath: string, suffix: string): string {
  const dotIdx = relativePath.lastIndexOf(".");
  if (dotIdx <= 0) {
    return `${relativePath}${suffix}`;
  }
  return `${relativePath.slice(0, dotIdx)}${suffix}${relativePath.slice(dotIdx)}`;
}

function buildSourceSuffix(identity: MediaIdentity): string | null {
  if (!identity.sourceVideoId) {
    return null;
  }
  const sourceId = identity.sourceVideoId.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const part =
    identity.partNumber && identity.partNumber > 0
      ? `-p${String(identity.partNumber).padStart(2, "0")}`
      : "";
  const media = identity.mediaType === "audio" ? "-audio" : "";
  return ` [${sourceId}${part}${media}]`;
}

function getVideoFamilyStem(relativePath: string): string {
  const dotIdx = relativePath.lastIndexOf(".");
  return dotIdx > 0 ? relativePath.slice(0, dotIdx) : relativePath;
}

function sameLocalRow(video: Video, existingLocalVideoId?: string): boolean {
  return Boolean(existingLocalVideoId && video.id === existingLocalVideoId);
}

function getStoredVideosForAllocation(): Video[] {
  if (videoProviderForTests) {
    return videoProviderForTests();
  }

  try {
    const { getVideos } =
      require("../storageService/videos") as typeof import("../storageService/videos");
    return getVideos();
  } catch {
    return [];
  }
}

export function setOutputPathAllocatorVideoProviderForTests(
  provider: (() => Video[]) | null
): void {
  videoProviderForTests = provider;
}

function buildDbPathSets(existingLocalVideoId?: string): {
  otherPaths: Set<string>;
  ownedPaths: Set<string>;
} {
  const otherPaths = new Set<string>();
  const ownedPaths = new Set<string>();
  for (const video of getStoredVideosForAllocation()) {
    const targetSet = sameLocalRow(video, existingLocalVideoId)
      ? ownedPaths
      : otherPaths;
    if (video.videoPath) {
      targetSet.add(canonicalizeManagedPath(video.videoPath));
    }
    if (video.thumbnailPath) {
      targetSet.add(canonicalizeManagedPath(video.thumbnailPath));
    }
    for (const subtitle of video.subtitles || []) {
      if (subtitle.path) {
        targetSet.add(canonicalizeManagedPath(subtitle.path));
      }
    }
  }
  return { otherPaths, ownedPaths };
}

function candidateConflicts(input: {
  videoRelativePath: string;
  thumbnailRelativePath: string;
  subtitleBaseRelativePath: string;
  subtitleBaseDir?: string;
  subtitleFiles?: Array<{ language: string; extension: string }>;
  thumbnailBaseDir: string;
  otherDbPaths: Set<string>;
  ownedDbPaths: Set<string>;
  thumbnailRequired?: boolean;
  subtitleRequired?: boolean;
}): boolean {
  const videoPath = resolveSafeChildPath(VIDEOS_DIR, input.videoRelativePath);
  const thumbnailPath = resolveSafeChildPath(
    input.thumbnailBaseDir,
    input.thumbnailRelativePath
  );

  const videoManagedPath = canonicalizeManagedPath(
    `/videos/${input.videoRelativePath}`
  );
  if (
    pathExistsSafeSync(videoPath, VIDEOS_DIR) &&
    !input.ownedDbPaths.has(videoManagedPath)
  ) {
    return true;
  }
  const thumbPrefix = input.thumbnailBaseDir === VIDEOS_DIR ? "/videos" : "/images";
  const thumbnailManagedPath = canonicalizeManagedPath(
    `${thumbPrefix}/${input.thumbnailRelativePath}`
  );
  if (
    input.thumbnailRequired &&
    pathExistsSafeSync(thumbnailPath, [IMAGES_DIR, VIDEOS_DIR]) &&
    !input.ownedDbPaths.has(thumbnailManagedPath)
  ) {
    return true;
  }

  if (input.otherDbPaths.has(videoManagedPath)) {
    return true;
  }
  if (
    input.thumbnailRequired &&
    input.otherDbPaths.has(thumbnailManagedPath)
  ) {
    return true;
  }

  if (
    input.subtitleRequired &&
    input.otherDbPaths.has(canonicalizeManagedPath(input.subtitleBaseRelativePath))
  ) {
    return true;
  }

  if (input.subtitleRequired && input.subtitleFiles?.length) {
    const subtitleBaseDir = input.subtitleBaseDir || SUBTITLES_DIR;
    const subtitlePrefix =
      subtitleBaseDir === VIDEOS_DIR ? "/videos" : "/subtitles";
    for (const subtitle of input.subtitleFiles) {
      const extension = subtitle.extension.startsWith(".")
        ? subtitle.extension
        : `.${subtitle.extension}`;
      const subtitleRelativePath = `${input.subtitleBaseRelativePath}.${subtitle.language}${extension}`;
      const subtitlePath = resolveSafeChildPath(
        subtitleBaseDir,
        subtitleRelativePath
      );
      const subtitleManagedPath = canonicalizeManagedPath(
        `${subtitlePrefix}/${subtitleRelativePath}`
      );
      if (
        pathExistsSafeSync(subtitlePath, [SUBTITLES_DIR, VIDEOS_DIR]) &&
        !input.ownedDbPaths.has(subtitleManagedPath)
      ) {
        return true;
      }
      if (input.otherDbPaths.has(subtitleManagedPath)) {
        return true;
      }
    }
  }

  return false;
}

function createCandidate(
  preferredVideo: string,
  preferredThumbnail: string,
  preferredSubtitleBase: string,
  suffix: string
): {
  videoRelativePath: string;
  thumbnailRelativePath: string;
  subtitleBaseRelativePath: string;
} {
  const videoRelativePath = suffix
    ? appendSuffixToRelativePath(preferredVideo, suffix)
    : preferredVideo;
  const related = applyDedupeToRelatedPaths(
    preferredVideo,
    videoRelativePath,
    preferredThumbnail,
    preferredSubtitleBase
  );
  return {
    videoRelativePath,
    thumbnailRelativePath: related.thumbnail,
    subtitleBaseRelativePath: related.subtitleBase,
  };
}

function writeReservationLockSync(
  lockPath: string,
  canonicalFamilyStem: string,
  identity: MediaIdentity
): void {
  writeFileSafeSync(
    lockPath,
    getReservationRoot(),
    JSON.stringify({
      version: 1,
      allocationId: crypto.randomUUID(),
      canonicalFamilyStem,
      identityKey: [
        identity.platform,
        identity.sourceVideoId,
        identity.mediaType,
        identity.partNumber || 0,
      ].join(":"),
      hostname: os.hostname(),
      processId: process.pid,
      createdAtMs: Date.now(),
      heartbeatAtMs: Date.now(),
    }),
    { flag: "wx" }
  );
}

function isProcessLive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return fsErrorCode(error) !== "ESRCH";
  }
}

function reclaimAbandonedReservationLockSync(lockPath: string): boolean {
  try {
    const raw = readFileSafeSync(lockPath, getReservationRoot(), "utf8");
    const payload = JSON.parse(raw) as {
      hostname?: unknown;
      processId?: unknown;
    };

    if (payload.hostname !== os.hostname()) {
      return false;
    }

    const processId = payload.processId;
    if (
      typeof processId !== "number" ||
      !Number.isInteger(processId) ||
      processId <= 0 ||
      processId === process.pid ||
      isProcessLive(processId)
    ) {
      return false;
    }

    unlinkSafeSync(lockPath, getReservationRoot());
    return true;
  } catch {
    return false;
  }
}

function acquireLock(canonicalFamilyStem: string, identity: MediaIdentity): string | null {
  const lockPath = lockPathForFamily(canonicalFamilyStem);
  ensureDirSafeSync(getReservationRoot(), DATA_DIR);

  try {
    writeReservationLockSync(lockPath, canonicalFamilyStem, identity);
    return lockPath;
  } catch (error) {
    if (
      fsErrorCode(error) === "EEXIST" &&
      reclaimAbandonedReservationLockSync(lockPath)
    ) {
      try {
        writeReservationLockSync(lockPath, canonicalFamilyStem, identity);
        return lockPath;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function allocateOutputFamilySync(
  input: AllocateOutputFamilyInput
): OutputFamilyReservation {
  const { otherPaths, ownedPaths } = buildDbPathSets(input.existingLocalVideoId);
  for (const ownedManagedPath of input.ownedManagedPaths || []) {
    ownedPaths.add(canonicalizeManagedPath(ownedManagedPath));
  }
  const sourceSuffix = buildSourceSuffix(input.identity);
  let attemptedSourceSuffix = false;

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let suffix = "";
    let collisionStrategy: OutputFamilyReservation["collisionStrategy"] = "none";
    if (attempt > 0 && sourceSuffix && !attemptedSourceSuffix) {
      suffix = sourceSuffix;
      collisionStrategy = "source_id";
      attemptedSourceSuffix = true;
    } else if (attempt > 0) {
      const numeric = sourceSuffix
        ? `${sourceSuffix} (${attemptedSourceSuffix ? attempt : attempt + 1})`
        : ` (${attempt + 1})`;
      suffix = numeric;
      collisionStrategy = "numeric";
    }

    const candidate = createCandidate(
      input.videoRelativePath,
      input.thumbnailRelativePath,
      input.subtitleBaseRelativePath,
      suffix
    );
    const canonicalFamilyStem = canonicalizeManagedPath(
      getVideoFamilyStem(candidate.videoRelativePath)
    );
    if (activeFamilyReservations.has(canonicalFamilyStem)) {
      continue;
    }

    const lockPath = acquireLock(canonicalFamilyStem, input.identity);
    if (!lockPath) {
      continue;
    }

    activeFamilyReservations.add(canonicalFamilyStem);
    if (
      candidateConflicts({
          ...candidate,
          subtitleBaseDir: input.subtitleBaseDir,
          subtitleFiles: input.subtitleFiles,
          thumbnailBaseDir: input.thumbnailBaseDir,
          otherDbPaths: otherPaths,
          ownedDbPaths: ownedPaths,
        thumbnailRequired: input.thumbnailRequired,
        subtitleRequired: input.subtitleRequired,
      })
    ) {
      activeFamilyReservations.delete(canonicalFamilyStem);
      unlinkSafeSync(lockPath, getReservationRoot());
      continue;
    }

    return {
      ...candidate,
      collisionStrategy,
      release: () => {
        activeFamilyReservations.delete(canonicalFamilyStem);
        try {
          unlinkSafeSync(lockPath, getReservationRoot());
        } catch {
          // Best-effort cleanup; a stale-lock sweep can remove leftovers.
        }
      },
    };
  }

  throw new Error(
    `Could not allocate an output path family for ${input.videoRelativePath}`
  );
}

export function isManagedPathOwnedByLocalVideoId(
  candidatePath: string,
  existingLocalVideoId?: string
): boolean {
  if (!existingLocalVideoId) {
    return false;
  }
  const normalizedCandidate = canonicalizeManagedPath(candidatePath);
  return getStoredVideosForAllocation().some((video) => {
    if (!sameLocalRow(video, existingLocalVideoId)) {
      return false;
    }
    if (video.videoPath && canonicalizeManagedPath(video.videoPath) === normalizedCandidate) {
      return true;
    }
    if (
      video.thumbnailPath &&
      canonicalizeManagedPath(video.thumbnailPath) === normalizedCandidate
    ) {
      return true;
    }
    return (video.subtitles || []).some(
      (subtitle) =>
        subtitle.path &&
        canonicalizeManagedPath(subtitle.path) === normalizedCandidate
    );
  });
}

export function planOwnedReplacementStagingPathSync(
  destinationPath: string,
  destinationRootDir: string | string[],
  existingLocalVideoId?: string
): OwnedReplacementStagingPath | null {
  const destinationRoots = Array.isArray(destinationRootDir)
    ? destinationRootDir
    : [destinationRootDir];

  if (
    !pathExistsSafeSync(destinationPath, destinationRoots) ||
    !isManagedPathOwnedByLocalVideoId(destinationPath, existingLocalVideoId)
  ) {
    return null;
  }

  const finalPath = normalizeSafeAbsolutePath(destinationPath);
  const stagingRootDir = destinationRoots.find((rootDir) =>
    isPathWithinDirectory(finalPath, rootDir)
  );

  if (!stagingRootDir) {
    throw new Error(`Destination path is outside managed roots: ${destinationPath}`);
  }

  const stagingDir = path.dirname(finalPath);
  if (!isPathWithinDirectory(stagingDir, stagingRootDir)) {
    throw new Error(`Destination directory is outside managed roots: ${destinationPath}`);
  }

  const extension = path.extname(finalPath);
  const stagingFilename = `.mytube-redownload-${crypto.randomUUID()}${extension}`;
  const stagingPath = resolveSafeChildPath(stagingDir, stagingFilename);
  if (!isPathWithinDirectory(stagingPath, stagingRootDir)) {
    throw new Error(`Staging path is outside managed roots: ${stagingPath}`);
  }
  ensureDirSafeSync(path.dirname(stagingPath), destinationRoots);

  return {
    finalPath,
    stagingPath,
    stagingRootDir,
    destinationRootDir,
  };
}

function ensureDestinationStagingRootSync(destinationRoot: string): string {
  const stagingRoot = resolveSafeChildPath(destinationRoot, OUTPUT_STAGING_DIR);
  ensureDirSafeSync(stagingRoot, destinationRoot);

  const ignorePath = resolveSafeChildPath(stagingRoot, ".ignore");
  if (!pathExistsSafeSync(ignorePath, stagingRoot)) {
    writeFileSafeSync(ignorePath, stagingRoot, "", { flag: "wx" });
  }

  const embyIgnorePath = resolveSafeChildPath(stagingRoot, ".embyignore");
  if (!pathExistsSafeSync(embyIgnorePath, stagingRoot)) {
    writeFileSafeSync(embyIgnorePath, stagingRoot, "*\n", { flag: "wx" });
  }

  return stagingRoot;
}

function fsErrorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function canFallbackFromHardLinkError(error: unknown): boolean {
  const code = fsErrorCode(error);
  return code ? HARD_LINK_FALLBACK_ERROR_CODES.has(code) : false;
}

function hardLinkPublishSupportedSync(destinationRootDir: string): boolean {
  const destinationRoot = normalizeSafeAbsolutePath(destinationRootDir);
  const cached = hardLinkPublishSupportByRoot.get(destinationRoot);
  if (cached !== undefined) {
    return cached;
  }

  const stagingRoot = ensureDestinationStagingRootSync(destinationRoot);
  const probeId = crypto.randomUUID();
  const probeSource = resolveSafeChildPath(
    stagingRoot,
    `.hardlink-probe-${probeId}.src`
  );
  const probeTarget = resolveSafeChildPath(
    stagingRoot,
    `.hardlink-probe-${probeId}.dst`
  );

  let supported = false;
  try {
    writeFileSafeSync(probeSource, stagingRoot, "probe", { flag: "wx" });
    linkSafeSync(probeSource, stagingRoot, probeTarget, stagingRoot);
    supported = true;
  } catch {
    supported = false;
  } finally {
    cleanupStagingFileSync(probeTarget, stagingRoot);
    cleanupStagingFileSync(probeSource, stagingRoot);
  }

  hardLinkPublishSupportByRoot.set(destinationRoot, supported);
  return supported;
}

function fsyncFileBestEffort(
  filePath: string,
  allowedDirOrDirs: string | string[]
): void {
  try {
    fsyncFileSafeSync(filePath, allowedDirOrDirs);
  } catch {
    // Some filesystems do not support fsync for every path. The no-overwrite
    // claim still prevents replacing foreign data.
  }
}

function prepareDestinationStagingFileSync(
  sourcePath: string,
  sourceRootDir: string | string[],
  destinationPath: string,
  destinationRootDir: string | string[],
  allocationId: string
): {
  sourcePath: string;
  stagingPath: string;
  stagingRootDir: string;
  destinationRootDir: string;
  expectedSize: number;
} {
  const safeSourcePath = resolvePathWithinRoots(sourcePath, sourceRootDir);
  const safeDestinationPath = resolvePathWithinRoots(
    destinationPath,
    destinationRootDir
  );
  const destinationRoot = findContainingRoot(
    safeDestinationPath,
    destinationRootDir
  );
  const stagingRoot = ensureDestinationStagingRootSync(destinationRoot);
  const extension = path.extname(safeDestinationPath);
  const stagingPath = resolveSafeChildPath(
    stagingRoot,
    `${allocationId}${extension || ".tmp"}`
  );
  const expectedSize = statSafeSync(safeSourcePath, sourceRootDir).size;

  copyFileSafeSync(
    safeSourcePath,
    sourceRootDir,
    stagingPath,
    stagingRoot,
    fsConstants.COPYFILE_EXCL
  );
  fsyncFileBestEffort(stagingPath, stagingRoot);

  return {
    sourcePath: safeSourcePath,
    stagingPath,
    stagingRootDir: stagingRoot,
    destinationRootDir: destinationRoot,
    expectedSize,
  };
}

function cleanupStagingFileSync(
  stagingPath: string,
  stagingRootDir: string
): void {
  try {
    if (pathExistsSafeSync(stagingPath, stagingRootDir)) {
      unlinkSafeSync(stagingPath, stagingRootDir);
    }
  } catch {
    // Preserve the primary operation error.
  }
}

export function moveOutputFamilyWithJournalSync(
  moves: OutputFamilyMove[],
  afterMoves?: () => void
): void {
  if (moves.length === 0) {
    afterMoves?.();
    return;
  }

  const allocationId = crypto.randomUUID();
  const completedMoves: OutputFamilyMove[] = [];
  writeOutputFamilyJournalSync(allocationId, {
    step: "prepared",
    purpose: "relocation",
    moves,
    completedMoves: [],
  });

  try {
    for (const move of moves) {
      ensureDirSafeSync(path.dirname(move.to), move.toBase);
      moveSafeSync(move.from, move.fromBase, move.to, move.toBase, {
        overwrite: false,
      });
      completedMoves.push(move);
      writeOutputFamilyJournalSync(allocationId, {
        step: "moving",
        purpose: "relocation",
        moves,
        completedMoves,
      });
    }

    afterMoves?.();
    writeOutputFamilyJournalSync(allocationId, {
      step: "committed",
      purpose: "relocation",
      moves,
      completedMoves,
    });
    removeOutputFamilyJournalSync(allocationId);
  } catch (error) {
    let rollbackFailed = false;
    for (const move of completedMoves.slice().reverse()) {
      try {
        if (
          pathExistsSafeSync(move.to, move.toBase) &&
          !pathExistsSafeSync(move.from, move.fromBase)
        ) {
          moveSafeSync(move.to, move.toBase, move.from, move.fromBase, {
            overwrite: false,
          });
        }
      } catch {
        rollbackFailed = true;
      }
    }

    writeOutputFamilyJournalSync(allocationId, {
      step: rollbackFailed ? "rollback_failed" : "rolled_back",
      purpose: "relocation",
      moves,
      completedMoves,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!rollbackFailed) {
      removeOutputFamilyJournalSync(allocationId);
    }
    throw error;
  }
}

export function promoteFileNoOverwriteSync(
  sourcePath: string,
  sourceRootDir: string | string[],
  destinationPath: string,
  destinationRootDir: string | string[]
): void {
  if (path.normalize(sourcePath) === path.normalize(destinationPath)) {
    return;
  }

  const destinationRoots = Array.isArray(destinationRootDir)
    ? destinationRootDir
    : [destinationRootDir];
  ensureDirSafeSync(path.dirname(destinationPath), destinationRoots);
  const allocationId = crypto.randomUUID();
  const marker = `${CLAIM_MARKER_PREFIX}:${crypto.randomUUID()}`;
  const safeDestinationPath = resolvePathWithinRoots(
    destinationPath,
    destinationRootDir
  );
  const staging = prepareDestinationStagingFileSync(
    sourcePath,
    sourceRootDir,
    destinationPath,
    destinationRootDir,
    allocationId
  );

  writeOutputFamilyJournalSync(allocationId, {
    step: "staged",
    purpose: "publication",
    sourcePath: staging.sourcePath,
    stagingPath: staging.stagingPath,
    destinationPath,
    expectedSize: staging.expectedSize,
  });

  if (hardLinkPublishSupportedSync(staging.destinationRootDir)) {
    writeOutputFamilyJournalSync(allocationId, {
      step: "hard_linking",
      purpose: "publication",
      sourcePath: staging.sourcePath,
      stagingPath: staging.stagingPath,
      destinationPath,
      expectedSize: staging.expectedSize,
    });

    try {
      linkSafeSync(
        staging.stagingPath,
        staging.stagingRootDir,
        safeDestinationPath,
        destinationRootDir
      );
      const finalSize = statSafeSync(destinationPath, destinationRootDir).size;
      if (finalSize !== staging.expectedSize) {
        throw new Error(
          `Published file size mismatch for ${destinationPath}: expected ${staging.expectedSize}, got ${finalSize}`
        );
      }
      cleanupStagingFileSync(staging.stagingPath, staging.stagingRootDir);
      if (pathExistsSafeSync(staging.sourcePath, sourceRootDir)) {
        unlinkSafeSync(staging.sourcePath, sourceRootDir);
      }
      writeOutputFamilyJournalSync(allocationId, {
        step: "committed",
        purpose: "publication",
        publishMethod: "hard_link",
        sourcePath: staging.sourcePath,
        stagingPath: staging.stagingPath,
        destinationPath,
        expectedSize: staging.expectedSize,
      });
      removeOutputFamilyJournalSync(allocationId);
      return;
    } catch (error) {
      if (canFallbackFromHardLinkError(error)) {
        hardLinkPublishSupportByRoot.set(
          normalizeSafeAbsolutePath(staging.destinationRootDir),
          false
        );
      } else {
        cleanupStagingFileSync(staging.stagingPath, staging.stagingRootDir);
        writeOutputFamilyJournalSync(allocationId, {
          step: "hard_link_failed",
          purpose: "publication",
          sourcePath: staging.sourcePath,
          stagingPath: staging.stagingPath,
          destinationPath,
          expectedSize: staging.expectedSize,
          error: error instanceof Error ? error.message : String(error),
        });
        removeOutputFamilyJournalSync(allocationId);
        throw error;
      }
    }
  }

  try {
    writeFileSafeSync(destinationPath, destinationRoots, marker, { flag: "wx" });
  } catch (error) {
    cleanupStagingFileSync(staging.stagingPath, staging.stagingRootDir);
    writeOutputFamilyJournalSync(allocationId, {
      step: "claim_failed",
      purpose: "publication",
      sourcePath: staging.sourcePath,
      stagingPath: staging.stagingPath,
      destinationPath,
      expectedSize: staging.expectedSize,
      error: error instanceof Error ? error.message : String(error),
    });
    removeOutputFamilyJournalSync(allocationId);
    throw error;
  }

  writeOutputFamilyJournalSync(allocationId, {
    step: "claimed",
    purpose: "publication",
    sourcePath: staging.sourcePath,
    stagingPath: staging.stagingPath,
    destinationPath,
    expectedSize: staging.expectedSize,
  });

  try {
    const current = readFileSafeSync(destinationPath, destinationRoots, "utf8");
    if (current !== marker) {
      throw new Error(`Output claim marker was modified for ${destinationPath}`);
    }
    renameSafeSync(
      staging.stagingPath,
      staging.stagingRootDir,
      destinationPath,
      destinationRootDir
    );
    const finalSize = statSafeSync(destinationPath, destinationRootDir).size;
    if (finalSize !== staging.expectedSize) {
      throw new Error(
        `Published file size mismatch for ${destinationPath}: expected ${staging.expectedSize}, got ${finalSize}`
      );
    }
    if (pathExistsSafeSync(staging.sourcePath, sourceRootDir)) {
      unlinkSafeSync(staging.sourcePath, sourceRootDir);
    }
    writeOutputFamilyJournalSync(allocationId, {
      step: "committed",
      purpose: "publication",
      sourcePath: staging.sourcePath,
      stagingPath: staging.stagingPath,
      destinationPath,
      expectedSize: staging.expectedSize,
    });
    removeOutputFamilyJournalSync(allocationId);
  } catch (error) {
    try {
      const current = readFileSafeSync(destinationPath, destinationRoots, "utf8");
      if (current === marker) {
        unlinkSafeSync(destinationPath, destinationRoots);
      }
    } catch {
      // Preserve unknown final content.
    }
    cleanupStagingFileSync(staging.stagingPath, staging.stagingRootDir);
    writeOutputFamilyJournalSync(allocationId, {
      step: "rolled_back",
      purpose: "publication",
      sourcePath: staging.sourcePath,
      stagingPath: staging.stagingPath,
      destinationPath,
      expectedSize: staging.expectedSize,
      error: error instanceof Error ? error.message : String(error),
    });
    removeOutputFamilyJournalSync(allocationId);
    throw error;
  }
}

export function replaceOwnedFileWithBackupSync(
  sourcePath: string,
  sourceRootDir: string | string[],
  destinationPath: string,
  destinationRootDir: string | string[],
  existingLocalVideoId?: string
): void {
  if (path.normalize(sourcePath) === path.normalize(destinationPath)) {
    return;
  }

  const destinationRoots = Array.isArray(destinationRootDir)
    ? destinationRootDir
    : [destinationRootDir];

  if (
    !pathExistsSafeSync(destinationPath, destinationRoots) ||
    !isManagedPathOwnedByLocalVideoId(destinationPath, existingLocalVideoId)
  ) {
    promoteFileNoOverwriteSync(
      sourcePath,
      sourceRootDir,
      destinationPath,
      destinationRootDir
    );
    return;
  }

  const backupPath = `${normalizeSafeAbsolutePath(
    destinationPath
  )}${REPLACEMENT_BACKUP_SUFFIX}-${crypto.randomUUID()}`;
  const allocationId = crypto.randomUUID();
  ensureDirSafeSync(path.dirname(destinationPath), destinationRoots);
  const staging = prepareDestinationStagingFileSync(
    sourcePath,
    sourceRootDir,
    destinationPath,
    destinationRootDir,
    allocationId
  );
  writeOutputFamilyJournalSync(allocationId, {
    step: "staged",
    purpose: "owned_replacement",
    sourcePath: staging.sourcePath,
    stagingPath: staging.stagingPath,
    destinationPath,
    backupPath,
    expectedSize: staging.expectedSize,
  });

  renameSafeSync(destinationPath, destinationRootDir, backupPath, destinationRootDir);
  writeOutputFamilyJournalSync(allocationId, {
    step: "backed_up",
    purpose: "owned_replacement",
    sourcePath: staging.sourcePath,
    stagingPath: staging.stagingPath,
    destinationPath,
    backupPath,
    expectedSize: staging.expectedSize,
  });

  try {
    renameSafeSync(
      staging.stagingPath,
      staging.stagingRootDir,
      destinationPath,
      destinationRootDir
    );
    const finalSize = statSafeSync(destinationPath, destinationRootDir).size;
    if (finalSize !== staging.expectedSize) {
      throw new Error(
        `Replacement file size mismatch for ${destinationPath}: expected ${staging.expectedSize}, got ${finalSize}`
      );
    }
    if (pathExistsSafeSync(staging.sourcePath, sourceRootDir)) {
      unlinkSafeSync(staging.sourcePath, sourceRootDir);
    }
    writeOutputFamilyJournalSync(allocationId, {
      step: "committed",
      purpose: "owned_replacement",
      sourcePath: staging.sourcePath,
      stagingPath: staging.stagingPath,
      destinationPath,
      backupPath,
      expectedSize: staging.expectedSize,
    });
  } catch (error) {
    try {
      if (
        pathExistsSafeSync(backupPath, destinationRoots) &&
        !pathExistsSafeSync(destinationPath, destinationRoots)
      ) {
        renameSafeSync(backupPath, destinationRootDir, destinationPath, destinationRootDir);
      }
    } catch {
      // Keep the original error visible; rollback failure is logged by caller context.
    }
    cleanupStagingFileSync(staging.stagingPath, staging.stagingRootDir);
    writeOutputFamilyJournalSync(allocationId, {
      step: "rolled_back",
      purpose: "owned_replacement",
      sourcePath: staging.sourcePath,
      stagingPath: staging.stagingPath,
      destinationPath,
      backupPath,
      expectedSize: staging.expectedSize,
      error: error instanceof Error ? error.message : String(error),
    });
    removeOutputFamilyJournalSync(allocationId);
    throw error;
  }

  try {
    unlinkSafeSync(backupPath, destinationRoots);
  } catch {
    // Best-effort cleanup; preserving the new destination is more important.
  }
  removeOutputFamilyJournalSync(allocationId);
}
