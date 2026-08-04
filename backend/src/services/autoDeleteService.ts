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
// See design §5.3. NOTE: for a canonical ISO-8601 reference a lexical `< cutoff`
// comparison equals a chronological one, but a legacy/imported row can hold a
// non-canonical value (RFC-2822, locale, or epoch string) for which lexical
// ordering is meaningless — hence the GLOB carve-out below and the authoritative
// numeric re-check before each deletion (resolveReferenceMs).
const referenceIsoExpr = sql<string>`COALESCE(NULLIF(TRIM(${videos.addedAt}), ''), NULLIF(TRIM(${videos.createdAt}), ''))`;

// True only for a reference that is a *truly valid* canonical ISO date-first
// value — the sole shape for which the lexical `< cutoffIso` comparison is
// chronologically meaningful. SQLite's date() returns NULL for an unparseable
// value (9999-99-99, RFC/locale/epoch strings) and silently rolls over an
// out-of-range calendar date (2020-02-31 -> 2020-03-02); requiring the
// normalized date to equal the input's own YYYY-MM-DD rejects both, so every
// other value is routed to the numeric JS validation instead of being
// permanently excluded by a meaningless string comparison.
const isCanonicalReference = sql`date(${referenceIsoExpr}) IS substr(${referenceIsoExpr}, 1, 10)`;

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
    // Select a truly-canonical reference only when it is lexically (=
    // chronologically) older than the cutoff, PLUS every non-canonical or
    // invalid reference regardless of lexical position. The latter would
    // otherwise be permanently excluded by a meaningless string comparison;
    // instead it flows to the numeric age check (resolveReferenceMs), which
    // decides correctly and never deletes a row it cannot date. This closes the
    // under-deletion gap for legacy/imported timestamps.
    or(
      and(isCanonicalReference, lt(referenceIsoExpr, cutoffIso)),
      sql`NOT (${isCanonicalReference})`
    )
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

// Strictly parse a stored timestamp to epoch ms, or null when it is blank or
// unparseable. The SQL pre-filter compares reference strings lexically, which is
// only valid for canonical ISO-8601; a legacy/imported row can carry a
// non-canonical added_at (locale- or epoch-formatted) that migrationService
// copies verbatim, and a lexical comparison could mark a recent video as
// expired. Re-parsing here and comparing numerically closes that data-loss gap.
function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  // Numeric epoch string (legacy JSON stored addedAt as an epoch; Date.parse
  // does NOT accept these). Only treat a 10+ digit run as an epoch so a bare
  // year like "2020" still parses as a calendar year below. Values under ~1e11
  // are Unix seconds, otherwise milliseconds; reject anything outside the range
  // a JS Date can represent so an absurd value falls back to created_at.
  if (/^\d{10,}$/.test(trimmed)) {
    const epoch = Number(trimmed);
    const epochMs = epoch < 1e11 ? epoch * 1000 : epoch;
    return Number.isFinite(epochMs) && Math.abs(epochMs) <= 8.64e15
      ? epochMs
      : null;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return null;
  }
  // Date.parse silently normalizes an out-of-range ISO calendar date
  // (e.g. 2020-02-31 -> 2020-03-02), which could make a recently added video
  // look old enough to delete. Reject a date-first ISO value whose literal
  // Y-M-D is not a real calendar date so the caller falls back to created_at.
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    // Day 0 of the next month is the last day of `month` (handles leap years).
    const lastDayOfMonth =
      month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
    if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth) {
      return null;
    }
  }
  return ms;
}

// Reference age = "time in library": a parseable added_at, else a parseable
// created_at, else null (undateable → never auto-deleted). Mirrors the SQL
// COALESCE but falls back to created_at when added_at cannot be parsed rather
// than trusting a non-canonical added_at value.
function resolveReferenceMs(addedAt: unknown, createdAt: unknown): number | null {
  return parseTimestampMs(addedAt) ?? parseTimestampMs(createdAt);
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
        // widened mid-sweep (e.g. 30 -> 90 days) is honored immediately. A
        // now-protected candidate is dropped by the numeric age check below
        // (not stopped early): the batch may contain non-canonical references
        // that sort after the cutoff yet still need per-row numeric validation,
        // so a lexical early-stop could skip genuinely-old legacy rows.
        const currentCutoffMs =
          Date.now() - currentPolicy.intervalDays * MS_PER_DAY;

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

        // Authoritative age check: re-resolve the reference timestamp from the
        // current row with strict parsing and compare NUMERICALLY. This corrects
        // any lexical misclassification by the SQL pre-filter — a non-canonical
        // added_at can never mark a recent video as expired, and an undateable
        // row (neither timestamp parses) is skipped and never deleted.
        const referenceMs = resolveReferenceMs(
          current.addedAt,
          current.createdAt
        );
        if (referenceMs === null || !(referenceMs < currentCutoffMs)) {
          logger.debug(
            `[AutoDelete] Skipping id=${candidate.id}: reference not strictly older than cutoff or unparseable`
          );
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
