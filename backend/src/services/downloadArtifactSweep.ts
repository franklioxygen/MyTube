import path from "path";
import { VIDEOS_DIR } from "../config/paths";
import { logger } from "../utils/logger";
import { readdirDirentsSafe, resolveSafeChildPath, statSafeSync } from "../utils/security";
import { isActiveDownloadTempDir, isOwnedInactiveDownloadTempDir } from "./downloadTempDirectories";
import * as storageService from "./storageService";
import { createArtifactReferenceGuard } from "./storageService/artifactReferences";

/**
 * Finds download artifacts that have been abandoned in the library directory.
 *
 * `POST /api/cleanup-temp-files` already removes `.part`/`.ytdl` files and temp
 * directories carrying the `.mytube-download.json` ownership marker. Two kinds
 * escape it:
 *
 *  - **Unmarked temp directories.** The marker was introduced after the temp
 *    directory mechanism, so anything created before it is unrecognisable to
 *    `isOwnedInactiveDownloadTempDir` and can never be cleaned. One such
 *    directory was found in production holding 136 MB, and had to be deleted by
 *    hand.
 *  - **Split-stream artifacts.** `*.fNNN.*` and `*.temp.*` files, which the
 *    non-Bilibili downloaders write straight into the library and leave behind
 *    when a merge fails. Production held 429 MB of them.
 *
 * Detection is the hard part and is what this module provides. Deletion is
 * implemented but **not armed anywhere yet**: the startup job reports only. See
 * `reports/download-integrity-followups-design-2026-09-21.md`.
 */

// Same definition the metadata backfills use to skip yt-dlp intermediates.
const TEMPORARY_VIDEO_ARTIFACT_PATTERN = /(\.temp\.)|(\.part$)|(\.ytdl$)|(\.f\d+\.)/i;

// `temp_<13-digit ms>_<uuid>`, as createTempDir builds it. A user folder called
// `temp_holidays` does not match - the shape of the earlier P1, where cleanup
// removed any directory whose name merely started with `temp_`.
const DOWNLOAD_TEMP_DIR_PATTERN =
  /^temp_(\d{13})_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nothing younger than this is ever a candidate, armed or not. */
export const DEFAULT_MIN_ARTIFACT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SweepCandidate {
  absolutePath: string;
  kind: "temporary_file" | "unmarked_temp_directory" | "marked_temp_directory";
  sizeBytes: number;
  ageMs: number;
}

export interface SweepResult {
  candidates: SweepCandidate[];
  totalBytes: number;
  /** True when nothing was deleted, only reported. */
  dryRun: boolean;
  deletedCount: number;
  errors: string[];
}

export interface SweepOptions {
  minAgeMs?: number;
  /** Defaults to true. Deletion is deliberately opt-in. */
  dryRun?: boolean;
  now?: number;
}

function safeStat(absolutePath: string): { size: number; mtimeMs: number } | null {
  try {
    return statSafeSync(absolutePath, VIDEOS_DIR);
  } catch {
    return null;
  }
}

async function directorySizeBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdirDirentsSafe(directory, VIDEOS_DIR)) {
    const child = resolveSafeChildPath(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(child);
    } else if (entry.isFile()) {
      total += safeStat(child)?.size ?? 0;
    }
  }
  return total;
}

/** Every file below `directory`, so a reference check can cover the whole tree. */
async function filesUnder(directory: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdirDirentsSafe(directory, VIDEOS_DIR)) {
    const child = resolveSafeChildPath(directory, entry.name);
    if (entry.isDirectory()) {
      await filesUnder(child, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
  return out;
}

/**
 * Identify abandoned artifacts. Read-only unless `dryRun` is explicitly false.
 *
 * Every candidate must clear three independent conditions, so a file the library
 * still uses cannot be selected by any one of them misfiring:
 *
 *  1. its name matches a known download-artifact shape,
 *  2. it is older than `minAgeMs`,
 *  3. no library row references it (or, for a directory, anything inside it).
 */
export async function sweepDownloadArtifacts(
  options: SweepOptions = {}
): Promise<SweepResult> {
  const minAgeMs = options.minAgeMs ?? DEFAULT_MIN_ARTIFACT_AGE_MS;
  const dryRun = options.dryRun !== false;
  const now = options.now ?? Date.now();

  // A failed read must abort before anything is considered, never be taken as
  // evidence that a file has no owners.
  const isReferenced = createArtifactReferenceGuard(storageService.getArtifactOwners());

  const candidates: SweepCandidate[] = [];
  const errors: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdirDirentsSafe(directory, VIDEOS_DIR)) {
      const child = resolveSafeChildPath(directory, entry.name);

      if (entry.isDirectory()) {
        const match = DOWNLOAD_TEMP_DIR_PATTERN.exec(entry.name);
        if (!match) {
          // An ordinary library folder: descend, artifacts hide in author and
          // collection subdirectories too.
          await visit(child);
          continue;
        }

        // Never select an active directory or pick its files individually.
        if (isActiveDownloadTempDir(child)) {
          continue;
        }

        const ageMs = now - Number(match[1]);
        if (ageMs < minAgeMs) {
          continue;
        }

        const contained = await filesUnder(child);
        if (contained.some(isReferenced)) {
          continue;
        }

        candidates.push({
          absolutePath: child,
          kind: isOwnedInactiveDownloadTempDir(child)
            ? "marked_temp_directory"
            : "unmarked_temp_directory",
          sizeBytes: await directorySizeBytes(child),
          ageMs,
        });
        continue;
      }

      if (!entry.isFile() || !TEMPORARY_VIDEO_ARTIFACT_PATTERN.test(entry.name)) {
        continue;
      }
      if (isReferenced(child)) {
        continue;
      }
      const stat = safeStat(child);
      if (!stat) {
        continue;
      }
      const ageMs = now - stat.mtimeMs;
      if (ageMs < minAgeMs) {
        continue;
      }
      candidates.push({
        absolutePath: child,
        kind: "temporary_file",
        sizeBytes: stat.size,
        ageMs,
      });
    }
  };

  await visit(VIDEOS_DIR);

  const totalBytes = candidates.reduce((sum, c) => sum + c.sizeBytes, 0);
  let deletedCount = 0;

  if (!dryRun) {
    const { removeSafe } = await import("../utils/security");
    for (const candidate of candidates) {
      try {
        await removeSafe(candidate.absolutePath, VIDEOS_DIR);
        deletedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.absolutePath}: ${message}`);
        logger.warn("Download artifact sweep failed to remove a candidate", { message });
      }
    }
  }

  return { candidates, totalBytes, dryRun, deletedCount, errors };
}

/**
 * Startup job: report what an armed sweep would reclaim, and delete nothing.
 *
 * Deliberately report-only. These artifacts can be hundreds of megabytes, and
 * removing them unprompted is not something a restart should decide; the point
 * here is that a user with half a gigabyte of abandoned downloads currently has
 * no way to find out.
 */
export async function reportAbandonedDownloadArtifacts(): Promise<void> {
  try {
    const result = await sweepDownloadArtifacts({ dryRun: true });
    if (result.candidates.length === 0) {
      return;
    }
    const megabytes = (result.totalBytes / 1048576).toFixed(1);
    logger.warn(
      `Found ${result.candidates.length} abandoned download artifact(s) in the library ` +
        `holding ${megabytes} MB. None were removed. ` +
        `Run "Clean up temporary files" in Settings to reclaim the ones it covers.`,
      {
        candidates: result.candidates.map((c) => ({
          path: path.relative(VIDEOS_DIR, c.absolutePath),
          kind: c.kind,
          sizeBytes: c.sizeBytes,
          ageDays: Math.floor(c.ageMs / 86_400_000),
        })),
      }
    );
  } catch (error) {
    logger.warn(
      "Could not scan for abandoned download artifacts:",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
