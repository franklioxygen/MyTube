import { and, asc, eq, gt, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { db, getDatabaseGeneration } from "../db";
import { videos } from "../db/schema";
import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import {
  MIN_AUTO_DELETE_INTERVAL_DAYS,
  MAX_AUTO_DELETE_INTERVAL_DAYS,
} from "../types/settings";

const CANDIDATE_BATCH_SIZE = 100;
// Max videos to delete per sweep run, preventing a first-enable spike from
// deleting thousands of files (and hammering disk) in one tick. The scheduler
// owns a follow-up when a run is capped.
const MAX_DELETIONS_PER_RUN = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AutoDeleteSweepSummary {
  enabled: boolean;
  intervalDays: number | null;
  scanned: number; // candidate rows examined
  deletedVideos: number;
  skippedLocked: number; // candidates locked after selection but before deletion
  errors: number;
  capped: boolean; // true if the per-run cap stopped the sweep early
}

type CandidateCursor = {
  referenceIso: string;
  id: string;
};

// COALESCE(NULLIF(TRIM(added_at), ''), NULLIF(TRIM(created_at), '')): "time in
// library" keyed on addedAt first, falling back to createdAt. Blank legacy
// values are normalized to null so an undateable row is skipped (never deleted).
// After normalization the stored values are ISO-8601 strings, so a lexical
// comparison against the ISO cutoff is valid and runs in SQL. See design §5.3.
const referenceIsoExpr = sql<string>`COALESCE(NULLIF(TRIM(${videos.addedAt}), ''), NULLIF(TRIM(${videos.createdAt}), ''))`;

// Unlocked: auto_delete_locked is null or not 1. Only the literal 1 protects a
// row; null/0 (and any stray non-1 value from a manual DB edit) stay eligible.
const unlockedFilter = or(
  sql`${videos.autoDeleteLocked} IS NULL`,
  ne(videos.autoDeleteLocked, 1)
);

function buildCandidateFilter(cutoffIso: string, cursor: CandidateCursor | null) {
  const baseFilter = and(
    unlockedFilter,
    isNotNull(referenceIsoExpr),
    lt(referenceIsoExpr, cutoffIso)
  );

  if (!cursor) {
    return baseFilter;
  }

  return and(
    baseFilter,
    or(
      gt(referenceIsoExpr, cursor.referenceIso),
      and(
        eq(referenceIsoExpr, cursor.referenceIso),
        gt(videos.id, cursor.id)
      )
    )
  );
}

async function getCandidateBatch(
  cutoffIso: string,
  cursor: CandidateCursor | null
): Promise<Array<{ id: string; referenceIso: string }>> {
  return await db
    .select({ id: videos.id, referenceIso: referenceIsoExpr })
    .from(videos)
    .where(buildCandidateFilter(cutoffIso, cursor))
    .orderBy(asc(referenceIsoExpr), asc(videos.id))
    .limit(CANDIDATE_BATCH_SIZE);
}

function readAutoDeletePolicy(): {
  enabled: boolean;
  intervalDays: number | null;
} {
  const settings = storageService.getSettings();
  const enabled = settings.autoDeleteEnabled === true;
  const rawDays = settings.autoDeleteIntervalDays;
  const intervalDays =
    typeof rawDays === "number" &&
    Number.isInteger(rawDays) &&
    rawDays >= MIN_AUTO_DELETE_INTERVAL_DAYS &&
    rawDays <= MAX_AUTO_DELETE_INTERVAL_DAYS
      ? rawDays
      : null;
  return { enabled, intervalDays };
}

let isSweepRunning = false;

/**
 * Library-wide age-based auto-delete sweep. Deletes unlocked videos whose
 * in-library reference timestamp is strictly older than `now - intervalDays`,
 * reusing storageService.deleteVideo("auto_delete") so files, thumbnails,
 * subtitles, history and tracking are cleaned up identically to a manual delete.
 *
 * The sweep re-reads the enabled flag and re-fetches each row's lock state
 * immediately before every deletion (after yielding to the event loop), so
 * disabling the policy or locking a video takes effect for an already-running
 * sweep. Timer ownership for the capped-run follow-up lives in the scheduler.
 */
export async function runAutoDeleteSweep(): Promise<AutoDeleteSweepSummary> {
  const summary: AutoDeleteSweepSummary = {
    enabled: false,
    intervalDays: null,
    scanned: 0,
    deletedVideos: 0,
    skippedLocked: 0,
    errors: 0,
    capped: false,
  };

  if (isSweepRunning) {
    logger.debug("[AutoDelete] Sweep already running, skipping tick");
    return summary;
  }

  const policy = readAutoDeletePolicy();
  if (!policy.enabled || policy.intervalDays === null) {
    // Feature off or interval invalid: never touch any row.
    return summary;
  }

  isSweepRunning = true;
  summary.enabled = true;
  summary.intervalDays = policy.intervalDays;

  // Snapshot the database generation. A database import/restore swaps the
  // connection and bumps this; if it changes mid-sweep, abort so we never run
  // deletions selected from the old database against the replacement library.
  const startGeneration = getDatabaseGeneration();

  try {
    const cutoffMs = Date.now() - policy.intervalDays * MS_PER_DAY;
    const cutoffIso = new Date(cutoffMs).toISOString();
    let cursor: CandidateCursor | null = null;

    while (summary.deletedVideos < MAX_DELETIONS_PER_RUN) {
      const candidates = await getCandidateBatch(cutoffIso, cursor);
      if (candidates.length === 0) {
        break;
      }

      let reachedCap = false;

      for (const candidate of candidates) {
        summary.scanned += 1;

        // Yield to the event loop so an already-arrived disable/lock request can
        // complete before this synchronous deletion. Without this, a loop of
        // synchronous deleteVideo calls would starve the "immediate" action.
        await new Promise<void>((resolve) => setImmediate(resolve));

        // Abort if the database was replaced (import/restore) mid-sweep. The
        // remaining candidates were selected from the now-discarded database, so
        // deleting them against the replacement library could remove restored
        // videos that were never past the new policy's cutoff.
        if (getDatabaseGeneration() !== startGeneration) {
          logger.info(
            "[AutoDelete] Database replaced mid-sweep; aborting before further deletions"
          );
          return summary;
        }

        // Re-read the FULL policy: a completed disable OR interval change
        // invalidates the settings cache, so it is visible here. Stop the run
        // without deleting further candidates when the feature is turned off.
        const currentPolicy = readAutoDeletePolicy();
        if (!currentPolicy.enabled || currentPolicy.intervalDays === null) {
          logger.info(
            "[AutoDelete] Policy disabled mid-sweep; stopping before further deletions"
          );
          return summary;
        }

        // Recompute the cutoff from the CURRENT interval so a retention window
        // widened mid-sweep (e.g. 30 -> 90 days) never irreversibly deletes a
        // now-protected video under the original, staler cutoff. Candidates are
        // ordered by ascending reference timestamp, so the first one that is no
        // longer strictly older than the current cutoff means every remaining
        // candidate is at least as new — stop before deleting any of them.
        const currentCutoffIso = new Date(
          Date.now() - currentPolicy.intervalDays * MS_PER_DAY
        ).toISOString();
        if (!(candidate.referenceIso < currentCutoffIso)) {
          logger.info(
            "[AutoDelete] Interval widened mid-sweep; stopping before deleting now-protected videos"
          );
          return summary;
        }

        // Re-fetch the current row: skip if it no longer exists or was locked
        // after selection.
        const current = storageService.getVideoById(candidate.id);
        if (!current) {
          continue;
        }
        if (current.autoDeleteLocked === 1) {
          summary.skippedLocked += 1;
          continue;
        }

        try {
          const deleted = storageService.deleteVideo(
            candidate.id,
            "auto_delete"
          );
          if (deleted) {
            summary.deletedVideos += 1;
            logger.info(
              `[AutoDelete] Deleted video "${current.title}" (id=${candidate.id}) ` +
                `older than ${policy.intervalDays} day(s)`
            );
          } else {
            // The row existed in the immediately preceding safety check, so a
            // false result means the deletion did not complete. Count it just
            // like a thrown delete failure so operators and statistics do not
            // report a clean sweep that left an eligible row behind.
            summary.errors += 1;
            logger.warn(
              `[AutoDelete] Delete returned false for video ${candidate.id}`
            );
          }
        } catch (error) {
          summary.errors += 1;
          logger.error(
            `[AutoDelete] Failed to delete video ${candidate.id}:`,
            error instanceof Error ? error : new Error(String(error))
          );
        }

        if (summary.deletedVideos >= MAX_DELETIONS_PER_RUN) {
          reachedCap = true;
          break;
        }
      }

      const lastCandidate = candidates[candidates.length - 1];
      cursor = {
        referenceIso: lastCandidate.referenceIso,
        id: lastCandidate.id,
      };

      if (reachedCap) {
        summary.capped = true;
        break;
      }

      if (candidates.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
    }

    // Record the last successful sweep so the boot-time catch-up and any UI hint
    // are accurate. autoDeleteLastRunAt is system-managed and written through the
    // escape hatch rather than the public whitelist.
    try {
      storageService.saveSettings(
        { autoDeleteLastRunAt: Date.now() },
        { extraWhitelistedKeys: ["autoDeleteLastRunAt"] }
      );
    } catch (error) {
      logger.warn(
        "[AutoDelete] Failed to persist autoDeleteLastRunAt",
        error instanceof Error ? error : new Error(String(error))
      );
    }

    try {
      const { recordEvent } = await import("./statistics");
      recordEvent({
        eventType: "auto_delete_completed",
        actorRole: "system",
        surface: "background",
        payload: {
          deletedCount: summary.deletedVideos,
          errors: summary.errors,
          intervalDays: policy.intervalDays,
          capped: summary.capped,
        },
      });
    } catch {
      // statistics is best-effort
    }

    return summary;
  } catch (error) {
    summary.errors += 1;
    logger.error(
      "[AutoDelete] Unexpected error during auto-delete sweep:",
      error instanceof Error ? error : new Error(String(error))
    );
    return summary;
  } finally {
    isSweepRunning = false;
  }
}
