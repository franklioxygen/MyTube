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
import {
  stemBudgetForSuffix,
  trimRelativePathStemForSuffix,
} from "./sanitize";

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
  subtitleFiles?: Array<{
    language: string;
    extension: string;
    /** Managed root this subtitle will actually be written to. */
    baseDir?: string;
  }>;
  thumbnailBaseDir: string;
  identity: MediaIdentity;
  existingLocalVideoId?: string;
  ownedManagedPaths?: string[];
  thumbnailRequired?: boolean;
  subtitleRequired?: boolean;
};

const activeFamilyReservations = new Set<string>();
const RESERVATION_DIR = "output-path-reservations";
const RESERVATION_HEARTBEAT_INTERVAL_MS = 30_000;
const RESERVATION_STALE_AFTER_MS = 5 * 60_000;
const OUTPUT_FAMILY_JOURNAL_DIR = "output-family-journals";
const OUTPUT_STAGING_DIR = ".mytube-staging";
const CLAIM_MARKER_PREFIX = "MYTUBE_OUTPUT_CLAIM_V1";
const REPLACEMENT_BACKUP_SUFFIX = ".mytube-replace-backup";
/**
 * Room held back for the tail a subtitle appends to the family stem when the
 * languages are not known yet. Wide enough for the longest tags yt-dlp hands
 * back plus the numeric discriminator collectionFileManager adds to a repeated
 * language, as in ".zh-Hant-TW.2.vtt".
 */
const SUBTITLE_TAIL_RESERVE_BYTES = 20;
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

type ReservationLockPayload = {
  version: number;
  allocationId: string;
  canonicalFamilyStem?: string;
  identityKey?: string;
  hostname?: unknown;
  processId?: unknown;
  createdAtMs?: unknown;
  heartbeatAtMs?: unknown;
};

type ReservationLockHandle = {
  lockPath: string;
  allocationId: string;
  heartbeatPath: string;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
};

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

function heartbeatPathForLock(
  lockPath: string,
  allocationId: string
): string {
  const lockName = path.basename(lockPath, ".lock");
  const ownerDigest = crypto
    .createHash("sha256")
    .update(allocationId)
    .digest("hex");
  return resolveSafeChildPath(
    getReservationRoot(),
    `${lockName}.${ownerDigest}.heartbeat`
  );
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

/**
 * Widest tail any member of this output family will grow onto the shared stem.
 * The video and thumbnail each add their own extension; a subtitle adds
 * `.<lang><ext>`, which is longer than either and is the member that decides
 * the budget. Languages are only known once a download finishes, so a request
 * that merely reserves the subtitle family gets a fixed allowance instead.
 */
function familyTailReserveBytes(input: AllocateOutputFamilyInput): number {
  const tails = [
    Buffer.byteLength(path.extname(input.videoRelativePath), "utf8"),
    Buffer.byteLength(path.extname(input.thumbnailRelativePath), "utf8"),
  ];
  // A language that repeats within one family gets a numeric discriminator from
  // collectionFileManager - the first target keeps `.<lang><ext>` and the rest
  // become `.<lang>.<n><ext>`, counting up to the size of the group. Budget for
  // the widest of those, not for the plain tail.
  const byLanguage = new Map<
    string,
    { language: string; extension: string; count: number }
  >();
  for (const subtitle of input.subtitleFiles || []) {
    const key = `${subtitle.language}\u0000${subtitle.extension}`;
    const seen = byLanguage.get(key);
    if (seen) {
      seen.count += 1;
    } else {
      byLanguage.set(key, {
        language: subtitle.language,
        extension: subtitle.extension,
        count: 1,
      });
    }
  }
  for (const { language, extension, count } of byLanguage.values()) {
    const discriminator = count > 1 ? `.${count}` : "";
    tails.push(
      Buffer.byteLength(`.${language}${discriminator}${extension}`, "utf8")
    );
  }
  if (input.subtitleRequired) {
    tails.push(SUBTITLE_TAIL_RESERVE_BYTES);
  }
  return Math.max(...tails);
}

/**
 * Whether this row both claims `relativePath` and has the file to show for it.
 *
 * Ownership is what lets a candidate skip the byte budget, and the reason it
 * may is that an existing file proves the name is creatable here whatever it
 * measures in bytes. ownedPaths is built from stored path strings alone, so the
 * proof has to be checked: a database written on APFS and restored onto ext4
 * carries names longer than that volume can hold, and a row whose file has gone
 * missing carries no proof either. Waving those through would hand back a
 * destination nothing can create, and the download would fail on it.
 *
 * fs.existsSync answers false for a name the filesystem cannot hold rather than
 * raising, so an over-long path falls through to trimming on its own.
 */
function holdsExistingVideoFile(
  relativePath: string,
  ownedPaths: Set<string>
): boolean {
  if (!ownedPaths.has(managedOwnershipKey(`/videos/${relativePath}`))) {
    return false;
  }
  try {
    return pathExistsSafeSync(
      resolveSafeChildPath(VIDEOS_DIR, relativePath),
      VIDEOS_DIR
    );
  } catch {
    return false;
  }
}

function getVideoFamilyStem(relativePath: string): string {
  const dotIdx = relativePath.lastIndexOf(".");
  return dotIdx > 0 ? relativePath.slice(0, dotIdx) : relativePath;
}

function sameLocalRow(video: Video, existingLocalVideoId?: string): boolean {
  return Boolean(existingLocalVideoId && video.id === existingLocalVideoId);
}

/**
 * Mirrors canonicalizeManagedPath's root detection, including its root ordering,
 * but reports which managed root matched instead of discarding it.
 */
function managedRootForPath(webOrAbsolutePath: string): string | null {
  const normalized = webOrAbsolutePath.replace(/\\/g, "/");
  if (normalized.startsWith("/videos/")) {
    return "videos";
  }
  if (normalized.startsWith("/images/")) {
    return "images";
  }
  if (normalized.startsWith("/subtitles/")) {
    return "subtitles";
  }
  if (path.isAbsolute(normalized)) {
    const roots: Array<[string, string]> = [
      ["videos", VIDEOS_DIR],
      ["images", IMAGES_DIR],
      ["subtitles", SUBTITLES_DIR],
    ];
    for (const [name, root] of roots) {
      const relative = path.relative(root, normalized).replace(/\\/g, "/");
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Ownership and collision keys must stay root-qualified. canonicalizeManagedPath
 * strips the managed root, so a thumbnail at /videos/Show/poster.jpg and a
 * distinct file at /images/Show/poster.jpg reduce to the same key: a redownload
 * that changes thumbnail storage roots would then see the new-root file as owned
 * by the selected row and let replaceOwnedFileWithBackupSync overwrite it.
 * Keeping the root in the key preserves the case and separator normalization
 * while telling the two destinations apart.
 */
function managedOwnershipKey(webOrAbsolutePath: string): string {
  const canonical = canonicalizeManagedPath(webOrAbsolutePath);
  const root = managedRootForPath(webOrAbsolutePath);
  return root ? `${root}:${canonical}` : canonical;
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
  otherSubtitlePaths: string[];
} {
  const otherPaths = new Set<string>();
  const ownedPaths = new Set<string>();
  const otherSubtitlePaths: string[] = [];
  for (const video of getStoredVideosForAllocation()) {
    const owned = sameLocalRow(video, existingLocalVideoId);
    const targetSet = owned ? ownedPaths : otherPaths;
    if (video.videoPath) {
      targetSet.add(managedOwnershipKey(video.videoPath));
    }
    if (video.thumbnailPath) {
      targetSet.add(managedOwnershipKey(video.thumbnailPath));
    }
    for (const subtitle of video.subtitles || []) {
      if (subtitle.path) {
        const canonical = managedOwnershipKey(subtitle.path);
        targetSet.add(canonical);
        if (!owned) {
          otherSubtitlePaths.push(canonical);
        }
      }
    }
  }
  return { otherPaths, ownedPaths, otherSubtitlePaths };
}

function candidateConflicts(input: {
  videoRelativePath: string;
  thumbnailRelativePath: string;
  subtitleBaseRelativePath: string;
  subtitleBaseDir?: string;
  subtitleFiles?: Array<{
    language: string;
    extension: string;
    /** Managed root this subtitle will actually be written to. */
    baseDir?: string;
  }>;
  thumbnailBaseDir: string;
  otherDbPaths: Set<string>;
  ownedDbPaths: Set<string>;
  otherSubtitlePaths: string[];
  thumbnailRequired?: boolean;
  subtitleRequired?: boolean;
}): boolean {
  const videoPath = resolveSafeChildPath(VIDEOS_DIR, input.videoRelativePath);
  const thumbnailPath = resolveSafeChildPath(
    input.thumbnailBaseDir,
    input.thumbnailRelativePath
  );

  const videoManagedPath = managedOwnershipKey(
    `/videos/${input.videoRelativePath}`
  );
  if (
    pathExistsSafeSync(videoPath, VIDEOS_DIR) &&
    !input.ownedDbPaths.has(videoManagedPath)
  ) {
    return true;
  }
  const thumbPrefix = input.thumbnailBaseDir === VIDEOS_DIR ? "/videos" : "/images";
  const thumbnailManagedPath = managedOwnershipKey(
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

  const subtitleBaseDir = input.subtitleBaseDir || SUBTITLES_DIR;
  const subtitleWebPrefix = (baseDir: string) =>
    baseDir === VIDEOS_DIR ? "/videos" : "/subtitles";

  if (input.subtitleRequired) {
    // Subtitle languages are not known until the download finishes, so the
    // whole `<stem>.<lang><ext>` family has to be reserved up front. An
    // equality test on the stem alone never matches, because the stored keys
    // are full filenames that still carry `.<lang><ext>`. Without this, another
    // row already owning a subtitle under this stem lets the allocator reuse
    // it, and the no-overwrite promotion of the newly downloaded subtitle then
    // fails and drops the subtitle silently.
    //
    // A batch rename can place subtitles of one video in different roots, so
    // reserve the stem in every root this family will actually touch.
    const stemRoots = new Set<string>([subtitleBaseDir]);
    for (const subtitle of input.subtitleFiles || []) {
      stemRoots.add(subtitle.baseDir || subtitleBaseDir);
    }
    for (const stemRoot of stemRoots) {
      const subtitleStem = managedOwnershipKey(
        `${subtitleWebPrefix(stemRoot)}/${input.subtitleBaseRelativePath}`
      );
      if (
        input.otherSubtitlePaths.some((candidatePath) =>
          candidatePath.startsWith(`${subtitleStem}.`)
        )
      ) {
        return true;
      }
    }
  }

  if (input.subtitleRequired && input.subtitleFiles?.length) {
    for (const subtitle of input.subtitleFiles) {
      const extension = subtitle.extension.startsWith(".")
        ? subtitle.extension
        : `.${subtitle.extension}`;
      const subtitleRelativePath = `${input.subtitleBaseRelativePath}.${subtitle.language}${extension}`;
      const entryBaseDir = subtitle.baseDir || subtitleBaseDir;
      const subtitlePath = resolveSafeChildPath(
        entryBaseDir,
        subtitleRelativePath
      );
      const subtitleManagedPath = managedOwnershipKey(
        `${subtitleWebPrefix(entryBaseDir)}/${subtitleRelativePath}`
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
  suffix: string,
  ownsVideoRelativePath: (relativePath: string) => boolean,
  reservedTailBytes: number
): {
  videoRelativePath: string;
  thumbnailRelativePath: string;
  subtitleBaseRelativePath: string;
} | null {
  if (!suffix) {
    return {
      videoRelativePath: preferredVideo,
      thumbnailRelativePath: preferredThumbnail,
      subtitleBaseRelativePath: preferredSubtitleBase,
    };
  }

  // A name this row already holds is creatable on whatever filesystem this
  // install runs on, however long it measures in bytes - APFS counts
  // characters, so a CJK name there can validly run well past 255 bytes. Hand
  // it back untouched: trimming it would compute a path the existing file does
  // not have, orphan that file, and write a duplicate beside it.
  const ownedCandidate = appendSuffixToRelativePath(preferredVideo, suffix);
  if (ownsVideoRelativePath(ownedCandidate)) {
    const ownedRelated = applyDedupeToRelatedPaths(
      preferredVideo,
      ownedCandidate,
      preferredThumbnail,
      preferredSubtitleBase
    );
    return {
      videoRelativePath: ownedCandidate,
      thumbnailRelativePath: ownedRelated.thumbnail,
      subtitleBaseRelativePath: ownedRelated.subtitleBase,
    };
  }

  // Otherwise the name is new, so it has to fit. A suffix wide enough to eat
  // the whole budget leaves no name to cut down to - a source id can be a whole
  // URL, since extractSourceVideoId falls back to one for platforms it has no
  // pattern for. Refuse rather than reserve a path that cannot be created; the
  // caller drops to the numeric strategy, which always fits.
  if (stemBudgetForSuffix(suffix, reservedTailBytes) <= 0) {
    return null;
  }

  // Names arrive here already at the sanitizer's cap and a suffix can push the
  // filename past NAME_MAX; the stem gives way instead - and every member of
  // the family is trimmed against the same budget, so they keep the common stem
  // that subtitle discovery and applyDedupeToRelatedPaths' append-diff below
  // both depend on. That budget reserves the longest tail anyone in the family
  // will grow, not this path's own extension: the subtitle base ends up
  // carrying `.<lang><ext>`, which outruns a video's `.mp4`.
  const fittedVideo = trimRelativePathStemForSuffix(
    preferredVideo,
    suffix,
    reservedTailBytes,
    path.extname(preferredVideo)
  );
  const fittedThumbnail = trimRelativePathStemForSuffix(
    preferredThumbnail,
    suffix,
    reservedTailBytes,
    path.extname(preferredThumbnail)
  );
  // The subtitle base is a bare stem. Saying so keeps a dotted title - which
  // the legacy formatter produces by writing spaces as dots - from being read
  // as an extension and measured short.
  const fittedSubtitleBase = trimRelativePathStemForSuffix(
    preferredSubtitleBase,
    suffix,
    reservedTailBytes,
    ""
  );

  const videoRelativePath = appendSuffixToRelativePath(fittedVideo, suffix);
  const related = applyDedupeToRelatedPaths(
    fittedVideo,
    videoRelativePath,
    fittedThumbnail,
    fittedSubtitleBase
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
): ReservationLockHandle {
  const allocationId = crypto.randomUUID();
  const now = Date.now();
  const payload: ReservationLockPayload = {
    version: 2,
    allocationId,
    canonicalFamilyStem,
    identityKey: [
      identity.platform,
      identity.sourceVideoId,
      identity.mediaType,
      identity.partNumber || 0,
    ].join(":"),
    hostname: os.hostname(),
    processId: process.pid,
    createdAtMs: now,
    heartbeatAtMs: now,
  };
  writeFileSafeSync(
    lockPath,
    getReservationRoot(),
    JSON.stringify(payload),
    { flag: "wx" }
  );

  const heartbeatPath = heartbeatPathForLock(lockPath, allocationId);
  try {
    writeFileSafeSync(
      heartbeatPath,
      getReservationRoot(),
      JSON.stringify({
        version: 1,
        allocationId,
        heartbeatAtMs: now,
      }),
      { flag: "wx" }
    );
  } catch (error) {
    try {
      unlinkSafeSync(lockPath, getReservationRoot());
    } catch {
      // Preserve the original heartbeat creation failure.
    }
    throw error;
  }

  const handle: ReservationLockHandle = {
    lockPath,
    allocationId,
    heartbeatPath,
    heartbeatTimer: null,
  };
  handle.heartbeatTimer = setInterval(() => {
    if (!reservationLockIsOwnedBy(handle.lockPath, handle.allocationId)) {
      if (handle.heartbeatTimer) {
        clearInterval(handle.heartbeatTimer);
        handle.heartbeatTimer = null;
      }
      return;
    }

    try {
      writeFileSafeSync(
        handle.heartbeatPath,
        getReservationRoot(),
        JSON.stringify({
          version: 1,
          allocationId: handle.allocationId,
          heartbeatAtMs: Date.now(),
        }),
        { flag: "w" }
      );
    } catch {
      // Retry on the next interval. If the owner cannot renew for the entire
      // stale window, another instance may safely reclaim the reservation.
    }
  }, RESERVATION_HEARTBEAT_INTERVAL_MS);
  handle.heartbeatTimer.unref?.();
  return handle;
}

function isProcessLive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return fsErrorCode(error) !== "ESRCH";
  }
}

function parseReservationLockPayload(
  raw: string
): ReservationLockPayload | null {
  try {
    const payload = JSON.parse(raw) as ReservationLockPayload;
    return typeof payload.allocationId === "string" &&
      payload.allocationId.length > 0
      ? payload
      : null;
  } catch {
    return null;
  }
}

function reservationLockIsOwnedBy(
  lockPath: string,
  allocationId: string
): boolean {
  try {
    const payload = parseReservationLockPayload(
      readFileSafeSync(lockPath, getReservationRoot(), "utf8")
    );
    return payload?.allocationId === allocationId;
  } catch {
    return false;
  }
}

function numericTimestamp(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function reservationLastHeartbeatMs(
  lockPath: string,
  payload: ReservationLockPayload | null
): number {
  const timestamps: number[] = [];
  const createdAtMs = numericTimestamp(payload?.createdAtMs);
  const heartbeatAtMs = numericTimestamp(payload?.heartbeatAtMs);
  if (createdAtMs !== null) {
    timestamps.push(createdAtMs);
  }
  if (heartbeatAtMs !== null) {
    timestamps.push(heartbeatAtMs);
  }

  if (payload) {
    const heartbeatPath = heartbeatPathForLock(lockPath, payload.allocationId);
    try {
      const heartbeat = JSON.parse(
        readFileSafeSync(heartbeatPath, getReservationRoot(), "utf8")
      ) as {
        allocationId?: unknown;
        heartbeatAtMs?: unknown;
      };
      if (heartbeat.allocationId === payload.allocationId) {
        const currentHeartbeatAtMs = numericTimestamp(
          heartbeat.heartbeatAtMs
        );
        if (currentHeartbeatAtMs !== null) {
          timestamps.push(currentHeartbeatAtMs);
        }
      }
    } catch {
      try {
        timestamps.push(
          statSafeSync(heartbeatPath, getReservationRoot()).mtimeMs
        );
      } catch {
        // Legacy locks do not have a heartbeat sidecar.
      }
    }
  }

  if (timestamps.length === 0) {
    try {
      timestamps.push(statSafeSync(lockPath, getReservationRoot()).mtimeMs);
    } catch {
      return Date.now();
    }
  }
  return Math.max(...timestamps);
}

function shouldReclaimReservationLock(
  lockPath: string,
  payload: ReservationLockPayload | null
): boolean {
  if (payload?.hostname === os.hostname()) {
    const processId = payload.processId;
    if (
      typeof processId === "number" &&
      Number.isInteger(processId) &&
      processId > 0 &&
      processId !== process.pid
    ) {
      // A live owner on this host stays authoritative even once its heartbeat
      // lapses, because a long synchronous publish can stall the renewal timer.
      return !isProcessLive(processId);
    }
    // A lock naming this process' own pid is never a reservation we still hold:
    // allocateOutputFamilySync short-circuits on activeFamilyReservations before
    // reaching acquireLock for those. It is a leftover from an earlier instance
    // that restarted onto the same pid, so fall through to the expiry policy
    // instead of treating "our" pid as a live owner forever.
  }

  return (
    Date.now() - reservationLastHeartbeatMs(lockPath, payload) >=
    RESERVATION_STALE_AFTER_MS
  );
}

function reclaimAbandonedReservationLockSync(lockPath: string): boolean {
  try {
    const raw = readFileSafeSync(lockPath, getReservationRoot(), "utf8");
    const payload = parseReservationLockPayload(raw);
    if (!shouldReclaimReservationLock(lockPath, payload)) {
      return false;
    }

    const confirmedRaw = readFileSafeSync(
      lockPath,
      getReservationRoot(),
      "utf8"
    );
    const confirmedPayload = parseReservationLockPayload(confirmedRaw);
    if (
      confirmedRaw !== raw ||
      !shouldReclaimReservationLock(lockPath, confirmedPayload)
    ) {
      return false;
    }

    unlinkSafeSync(lockPath, getReservationRoot());
    if (confirmedPayload) {
      try {
        unlinkSafeSync(
          heartbeatPathForLock(lockPath, confirmedPayload.allocationId),
          getReservationRoot()
        );
      } catch {
        // Legacy locks and interrupted owners may not have a sidecar.
      }
    }
    return true;
  } catch {
    return false;
  }
}

function releaseReservationLockSync(handle: ReservationLockHandle): void {
  if (handle.heartbeatTimer) {
    clearInterval(handle.heartbeatTimer);
    handle.heartbeatTimer = null;
  }

  if (reservationLockIsOwnedBy(handle.lockPath, handle.allocationId)) {
    try {
      unlinkSafeSync(handle.lockPath, getReservationRoot());
    } catch {
      // A concurrent stale-lock takeover may already have removed it.
    }
  }
  try {
    unlinkSafeSync(handle.heartbeatPath, getReservationRoot());
  } catch {
    // Heartbeat cleanup is best-effort after releasing the lock.
  }
}

function acquireLock(
  canonicalFamilyStem: string,
  identity: MediaIdentity
): ReservationLockHandle | null {
  const lockPath = lockPathForFamily(canonicalFamilyStem);
  ensureDirSafeSync(getReservationRoot(), DATA_DIR);

  try {
    return writeReservationLockSync(lockPath, canonicalFamilyStem, identity);
  } catch (error) {
    if (
      fsErrorCode(error) === "EEXIST" &&
      reclaimAbandonedReservationLockSync(lockPath)
    ) {
      try {
        return writeReservationLockSync(
          lockPath,
          canonicalFamilyStem,
          identity
        );
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
  const {
    otherPaths,
    ownedPaths,
    otherSubtitlePaths: dbOtherSubtitlePaths,
  } = buildDbPathSets(input.existingLocalVideoId);
  for (const ownedManagedPath of input.ownedManagedPaths || []) {
    ownedPaths.add(managedOwnershipKey(ownedManagedPath));
  }
  // Callers may declare subtitles as owned that the row scan attributed to a
  // different row, so honor that ownership before the stem reservation runs.
  const otherSubtitlePaths = dbOtherSubtitlePaths.filter(
    (subtitlePath) => !ownedPaths.has(subtitlePath)
  );
  const sourceSuffix = buildSourceSuffix(input.identity);
  const reservedTailBytes = familyTailReserveBytes(input);
  let attemptedSourceSuffix = false;
  // Set once a source suffix turns out to be too wide to leave any stem. The
  // numeric attempts embed the source suffix too, so they have to stop carrying
  // it as well or every one of them would be just as impossible.
  let sourceSuffixUnusable = false;

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let suffix = "";
    let collisionStrategy: OutputFamilyReservation["collisionStrategy"] = "none";
    const usableSourceSuffix = sourceSuffixUnusable ? null : sourceSuffix;
    if (attempt > 0 && usableSourceSuffix && !attemptedSourceSuffix) {
      suffix = usableSourceSuffix;
      collisionStrategy = "source_id";
      attemptedSourceSuffix = true;
    } else if (attempt > 0) {
      const numeric = usableSourceSuffix
        ? `${usableSourceSuffix} (${attemptedSourceSuffix ? attempt : attempt + 1})`
        : ` (${attempt + 1})`;
      suffix = numeric;
      collisionStrategy = "numeric";
    }

    const candidate = createCandidate(
      input.videoRelativePath,
      input.thumbnailRelativePath,
      input.subtitleBaseRelativePath,
      suffix,
      (relativePath) => holdsExistingVideoFile(relativePath, ownedPaths),
      reservedTailBytes
    );
    if (!candidate) {
      sourceSuffixUnusable = true;
      continue;
    }
    const canonicalFamilyStem = canonicalizeManagedPath(
      getVideoFamilyStem(candidate.videoRelativePath)
    );
    if (activeFamilyReservations.has(canonicalFamilyStem)) {
      continue;
    }

    const reservationLock = acquireLock(canonicalFamilyStem, input.identity);
    if (!reservationLock) {
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
          otherSubtitlePaths,
        thumbnailRequired: input.thumbnailRequired,
        subtitleRequired: input.subtitleRequired,
      })
    ) {
      activeFamilyReservations.delete(canonicalFamilyStem);
      releaseReservationLockSync(reservationLock);
      continue;
    }

    let released = false;
    return {
      ...candidate,
      collisionStrategy,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        activeFamilyReservations.delete(canonicalFamilyStem);
        releaseReservationLockSync(reservationLock);
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
  const normalizedCandidate = managedOwnershipKey(candidatePath);
  return getStoredVideosForAllocation().some((video) => {
    if (!sameLocalRow(video, existingLocalVideoId)) {
      return false;
    }
    if (video.videoPath && managedOwnershipKey(video.videoPath) === normalizedCandidate) {
      return true;
    }
    if (
      video.thumbnailPath &&
      managedOwnershipKey(video.thumbnailPath) === normalizedCandidate
    ) {
      return true;
    }
    return (video.subtitles || []).some(
      (subtitle) =>
        subtitle.path &&
        managedOwnershipKey(subtitle.path) === normalizedCandidate
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
  // Tracks whether a commit callback ran to completion. Once it has, the caller
  // has durably recorded the new paths and the files must stay where they are.
  let databaseCommitted = false;
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

    if (afterMoves) {
      afterMoves();
      databaseCommitted = true;
    }
    writeOutputFamilyJournalSync(allocationId, {
      step: "committed",
      purpose: "relocation",
      moves,
      completedMoves,
    });
    removeOutputFamilyJournalSync(allocationId);
  } catch (error) {
    if (databaseCommitted) {
      // Only the journal bookkeeping failed: the moves landed and the callback
      // already committed the new paths. Rolling the files back here would
      // strand those rows on destinations that no longer exist, so keep the
      // files and leave a journal breadcrumb instead of failing an operation
      // that actually succeeded.
      try {
        writeOutputFamilyJournalSync(allocationId, {
          step: "commit_journal_failed",
          purpose: "relocation",
          moves,
          completedMoves,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // The prior "moving" journal already records the completed moves.
      }
      return;
    }

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

/**
 * Records a failure that happened after the destination was already published
 * and verified. At that point the only remaining work is bookkeeping — removing
 * the staging link, unlinking the source, writing the journal — none of which
 * can be rolled back, because the destination is live and the source may be
 * gone. Reporting failure here would make callers skip persistence and orphan a
 * complete destination file, so the breadcrumb is written and the publication is
 * reported as the success it is.
 */
function recordPostPublicationBookkeepingFailure(
  allocationId: string,
  payload: Record<string, unknown>,
  error: unknown
): void {
  try {
    writeOutputFamilyJournalSync(allocationId, {
      step: "publish_bookkeeping_failed",
      purpose: "publication",
      ...payload,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // The prior journal step already records the published destination.
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

    let published = false;
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
      // The destination is live and verified from here on. Nothing below can be
      // undone, so a failure must not be reported as a publication failure.
      published = true;
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
      if (published) {
        recordPostPublicationBookkeepingFailure(
          allocationId,
          {
            publishMethod: "hard_link",
            sourcePath: staging.sourcePath,
            stagingPath: staging.stagingPath,
            destinationPath,
            expectedSize: staging.expectedSize,
          },
          error
        );
        return;
      }
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

  let published = false;
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
    // As in the hard-link branch: the destination now holds the real file, so
    // the rollback below no longer applies to anything that follows.
    published = true;
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
    if (published) {
      recordPostPublicationBookkeepingFailure(
        allocationId,
        {
          publishMethod: "rename",
          sourcePath: staging.sourcePath,
          stagingPath: staging.stagingPath,
          destinationPath,
          expectedSize: staging.expectedSize,
        },
        error
      );
      return;
    }
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

  // Built as a fixed-length sibling rather than `${destinationPath}-<uuid>`:
  // the suffix plus a UUID adds 59 bytes, and destination names already sit at
  // the sanitizer's own cap (180 bytes for templates, 200 for the legacy
  // formatter, plus any collision suffix), so deriving the backup name from the
  // destination pushed past the 255-byte NAME_MAX and failed the rename below
  // with ENAMETOOLONG - after the replacement file had already been downloaded.
  // Same shape as the redownload staging name above, and the journal records
  // destinationPath alongside backupPath for anything stranded by a crash.
  const backupPath = resolveSafeChildPath(
    path.dirname(normalizeSafeAbsolutePath(destinationPath)),
    `${REPLACEMENT_BACKUP_SUFFIX}-${crypto.randomUUID()}${path.extname(
      destinationPath
    )}`
  );
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

  try {
    // The backup rename and its journal write belong inside the guarded section:
    // once the destination has been moved aside, a failure here would otherwise
    // escape with the destination absent while the row still references it, and
    // with both the backup and the staging file stranded. The rollback below
    // restores from the backup whenever it exists and the destination does not,
    // which covers a failure at either of these two steps.
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
