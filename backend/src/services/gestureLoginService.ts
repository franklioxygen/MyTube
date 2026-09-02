import crypto from "crypto";
import { sqlite } from "../db";
import { generateToken } from "./authService";
import {
  GesturePepperError,
  getActivePepperKeyId,
  readGesturePepper,
  requireGesturePepper,
} from "./gestureLoginPepper";
import {
  encodeGestureVerifier,
  isSupportedVerifier,
  verifyGestureVerifier,
} from "./gestureLoginVerifier";
import { getSettings } from "./storageService";
import { canonicalizePattern } from "../utils/gesturePattern";
import { logger } from "../utils/logger";

/**
 * Admin Gesture Login.
 *
 * Deliberately imports nothing from passwordService: password success calls
 * back into this module to clear a lock, and a cycle there would be a load
 * order hazard. Prerequisites are read straight from settings instead.
 */

/**
 * A streak of one or two wrong gestures expires this long after the most
 * recent one. The window slides: every new wrong gesture below the threshold
 * restarts it. Reaching three inside the window locks permanently, and no
 * amount of elapsed time clears that.
 */
export const PARTIAL_GESTURE_FAILURE_RESET_MS = 12 * 60 * 60 * 1000;

export const GESTURE_MAX_FAILED_ATTEMPTS = 3;

export interface GestureLoginStatus {
  configured: boolean;
  canConfigure: boolean;
  locked: boolean;
  available: boolean;
  attemptsRemaining: number | null;
  resetRequired: boolean;
}

export type GestureConfigureErrorCode =
  | "gesture_invalid"
  | "gesture_password_login_required"
  | "gesture_locked"
  | "gesture_configuration_failed";

export type GestureAuthErrorCode =
  | "gesture_invalid"
  | "gesture_incorrect"
  | "gesture_locked"
  | "gesture_unavailable"
  | "gesture_authentication_failed";

export type GestureConfigureResult =
  | { ok: true; created: boolean; status: GestureLoginStatus }
  | { ok: false; code: GestureConfigureErrorCode };

export type GestureRemoveResult =
  | { ok: true; removed: boolean }
  | { ok: false; code: "gesture_removal_failed" };

export type GestureAuthResult =
  | { ok: true; token: string; role: "admin" }
  | { ok: false; code: GestureAuthErrorCode; attemptsRemaining?: number };

interface CredentialRow {
  pattern_hash: string;
  pepper_key_id: string;
  credential_version: string;
  failed_attempts: number;
  last_failed_at: number | null;
  locked_at: number | null;
  created_at: number;
}

const selectRow = (): CredentialRow | undefined =>
  sqlite
    .prepare(
      `SELECT pattern_hash, pepper_key_id, credential_version, failed_attempts,
              last_failed_at, locked_at, created_at
         FROM admin_gesture_credential
        WHERE id = 1`
    )
    .get() as CredentialRow | undefined;

/**
 * Lazily clear a partial streak that has aged out.
 *
 * Doing this on read rather than on a timer is what makes the 12-hour rule
 * survive downtime: the streak is logically expired at its timestamp whether or
 * not the process was running, and the write is only a materialisation of that.
 * The guard on locked_at is load-bearing - a locked row must never be
 * normalised, no matter how old it is.
 *
 * credential_version is intentionally left alone. Expiry changes attempt state,
 * not the credential, so it must not invalidate an in-flight verification.
 */
const expirePartialFailureStreak = (now: number): void => {
  sqlite
    .prepare(
      `UPDATE admin_gesture_credential
          SET failed_attempts = 0,
              last_failed_at = NULL,
              updated_at = @now
        WHERE id = 1
          AND locked_at IS NULL
          AND failed_attempts IN (1, 2)
          AND last_failed_at IS NOT NULL
          AND @now - last_failed_at >= @window`
    )
    .run({ now, window: PARTIAL_GESTURE_FAILURE_RESET_MS });
};

/** Read the row with any aged-out partial streak already normalised away. */
const readNormalizedRow = (now: number): CredentialRow | undefined => {
  const row = selectRow();
  if (!row) {
    return undefined;
  }

  if (
    row.locked_at === null &&
    row.failed_attempts >= 1 &&
    row.failed_attempts <= 2 &&
    row.last_failed_at !== null &&
    now - row.last_failed_at >= PARTIAL_GESTURE_FAILURE_RESET_MS
  ) {
    expirePartialFailureStreak(now);
    return selectRow();
  }

  return row;
};

/**
 * Whether settings currently permit a gesture to exist at all. Password login
 * is the mandated recovery factor, so it has to stay reachable.
 */
const readPrerequisites = (): boolean => {
  const settings = getSettings();
  return (
    settings.loginEnabled === true && settings.passwordLoginAllowed !== false
  );
};

const deriveStatus = (
  row: CredentialRow | undefined,
  canConfigure: boolean
): GestureLoginStatus => {
  if (!row) {
    return {
      configured: false,
      canConfigure,
      locked: false,
      available: false,
      attemptsRemaining: null,
      resetRequired: false,
    };
  }

  // A row whose verifier this build cannot read, or that was written under a
  // pepper we no longer hold, is not "configured" - it can never authenticate,
  // and reporting it as usable would strand the admin on a grid that always
  // fails.
  const activeKeyId = getActivePepperKeyId();
  const configured =
    isSupportedVerifier(row.pattern_hash) &&
    activeKeyId !== null &&
    row.pepper_key_id === activeKeyId;

  if (!configured) {
    return {
      configured: false,
      canConfigure,
      locked: false,
      available: false,
      attemptsRemaining: null,
      resetRequired: true,
    };
  }

  const locked =
    row.locked_at !== null || row.failed_attempts >= GESTURE_MAX_FAILED_ATTEMPTS;

  return {
    configured: true,
    canConfigure,
    locked,
    available: canConfigure && !locked,
    attemptsRemaining: Math.max(
      0,
      GESTURE_MAX_FAILED_ATTEMPTS - row.failed_attempts
    ),
    resetRequired: false,
  };
};

/**
 * Public status for the login screen. Safe to call unauthenticated: it exposes
 * only booleans and the remaining attempt count, never the verifier, the pepper
 * id, or any timestamp.
 */
export function getGestureLoginStatus(): GestureLoginStatus {
  const now = Date.now();

  try {
    return deriveStatus(readNormalizedRow(now), readPrerequisites());
  } catch (error) {
    logger.error(
      "Failed to derive Gesture Login status",
      error instanceof Error ? error : new Error(String(error))
    );
    // Fail closed: an unknown state must not present an interactive grid.
    return {
      configured: false,
      canConfigure: false,
      locked: false,
      available: false,
      attemptsRemaining: null,
      resetRequired: false,
    };
  }
}

/** Whether any credential row exists, however unusable. */
export function hasGestureCredential(): boolean {
  try {
    return selectRow() !== undefined;
  } catch (error) {
    logger.error(
      "Failed to read Gesture Login credential",
      error instanceof Error ? error : new Error(String(error))
    );
    // Fail closed. This helper guards the password-recovery invariant, so an
    // unknown database state must block password-login disablement rather than
    // assume that no gesture exists.
    return true;
  }
}

/** Enrol a new gesture, or replace the existing one. Admin-only. */
export async function configureGesture(
  rawPattern: unknown
): Promise<GestureConfigureResult> {
  const now = Date.now();

  let existing: CredentialRow | undefined;
  let canConfigure: boolean;
  try {
    canConfigure = readPrerequisites();
    existing = readNormalizedRow(now);
  } catch (error) {
    logger.error(
      "Failed to read state before configuring Gesture Login",
      error instanceof Error ? error : new Error(String(error))
    );
    return { ok: false, code: "gesture_configuration_failed" };
  }

  if (!canConfigure) {
    return { ok: false, code: "gesture_password_login_required" };
  }

  const existingStatus = deriveStatus(existing, canConfigure);
  // A locked credential must be recovered by password login, not replaced by
  // whoever is holding the settings page. A reset-required row is exempt: it
  // cannot authenticate, so refusing to replace it would be a dead end.
  if (existingStatus.configured && existingStatus.locked) {
    return { ok: false, code: "gesture_locked" };
  }

  const canonical = canonicalizePattern(rawPattern);
  if (!canonical.ok) {
    return { ok: false, code: "gesture_invalid" };
  }

  let patternHash: string;
  let pepperKeyId: string;
  try {
    const pepper = requireGesturePepper();
    pepperKeyId = pepper.keyId;
    patternHash = await encodeGestureVerifier(canonical.material, pepper.secret);
  } catch (error) {
    if (error instanceof GesturePepperError) {
      logger.error(`Gesture Login pepper unusable: ${error.code}`);
    } else {
      logger.error(
        "Failed to derive Gesture Login verifier",
        error instanceof Error ? error : new Error(String(error))
      );
    }
    return { ok: false, code: "gesture_configuration_failed" };
  }

  try {
    // Hashing yields to the event loop. Re-check the recovery prerequisite
    // after it completes so a concurrent settings update cannot leave a newly
    // saved gesture without password recovery.
    canConfigure = readPrerequisites();
    if (!canConfigure) {
      return { ok: false, code: "gesture_password_login_required" };
    }

    const created = existing === undefined;
    const persistedAt = Date.now();
    const version = crypto.randomUUID();
    const writeResult = created
      ? sqlite
          .prepare(
            `INSERT INTO admin_gesture_credential
           (id, pattern_hash, pepper_key_id, credential_version,
            failed_attempts, last_failed_at, locked_at, created_at, updated_at)
         VALUES (1, @hash, @keyId, @version, 0, NULL, NULL, @now, @now)
         ON CONFLICT(id) DO NOTHING`
          )
          .run({
            hash: patternHash,
            keyId: pepperKeyId,
            version,
            now: persistedAt,
          })
      : sqlite
          .prepare(
            `UPDATE admin_gesture_credential
                SET pattern_hash = @hash,
                    pepper_key_id = @keyId,
                    credential_version = @version,
                    failed_attempts = 0,
                    last_failed_at = NULL,
                    locked_at = NULL,
                    updated_at = @now
              WHERE id = 1
                AND credential_version = @expectedVersion
                AND (@allowLockedReplacement = 1 OR locked_at IS NULL)`
          )
          .run({
            hash: patternHash,
            keyId: pepperKeyId,
            version,
            expectedVersion: existing!.credential_version,
            allowLockedReplacement: existingStatus.resetRequired ? 1 : 0,
            now: persistedAt,
          });

    if (writeResult.changes === 0) {
      // Another setup changed/created/removed the row, or a third failure
      // locked it while scrypt was running. Never overwrite the winner or
      // clear its lock with this stale request.
      const current = deriveStatus(
        readNormalizedRow(Date.now()),
        readPrerequisites()
      );
      return current.locked
        ? { ok: false, code: "gesture_locked" }
        : { ok: false, code: "gesture_configuration_failed" };
    }

    logger.info(created ? "Gesture Login configured" : "Gesture Login changed");
    return {
      ok: true,
      created,
      status: deriveStatus(selectRow(), readPrerequisites()),
    };
  } catch (error) {
    logger.error(
      "Failed to persist Gesture Login credential",
      error instanceof Error ? error : new Error(String(error))
    );
    return { ok: false, code: "gesture_configuration_failed" };
  }
}

/** Delete the credential. Idempotent, and permitted even while locked. */
export function removeGesture(): GestureRemoveResult {
  try {
    const result = sqlite
      .prepare("DELETE FROM admin_gesture_credential WHERE id = 1")
      .run();

    if (result.changes > 0) {
      logger.info("Gesture Login removed");
    }

    return { ok: true, removed: result.changes > 0 };
  } catch (error) {
    logger.error(
      "Failed to remove Gesture Login credential",
      error instanceof Error ? error : new Error(String(error))
    );
    return { ok: false, code: "gesture_removal_failed" };
  }
}

/**
 * Record a wrong gesture.
 *
 * The expiry test is repeated inside the statement rather than trusting the
 * snapshot the caller read, so a request that stalled across the boundary
 * cannot increment a streak that has since expired. The version and
 * locked_at guards make the whole thing a compare-and-swap: if the credential
 * was changed, removed, or locked while scrypt was running, nothing is written
 * and the caller re-reads instead.
 */
const recordFailure = (
  credentialVersion: string,
  now: number
): { failedAttempts: number; locked: boolean } | null => {
  const nextAttempts = `CASE
      WHEN failed_attempts IN (1, 2)
       AND last_failed_at IS NOT NULL
       AND @now - last_failed_at >= @window
      THEN 1
      ELSE MIN(failed_attempts + 1, @max)
    END`;

  const row = sqlite
    .prepare(
      `UPDATE admin_gesture_credential
          SET failed_attempts = ${nextAttempts},
              last_failed_at = @now,
              locked_at = CASE WHEN (${nextAttempts}) >= @max THEN @now ELSE NULL END,
              updated_at = @now
        WHERE id = 1
          AND credential_version = @version
          AND locked_at IS NULL
        RETURNING failed_attempts, locked_at`
    )
    .get({
      now,
      window: PARTIAL_GESTURE_FAILURE_RESET_MS,
      max: GESTURE_MAX_FAILED_ATTEMPTS,
      version: credentialVersion,
    }) as { failed_attempts: number; locked_at: number | null } | undefined;

  if (!row) {
    return null;
  }

  return { failedAttempts: row.failed_attempts, locked: row.locked_at !== null };
};

/** Clear a partial streak after a correct gesture. Fails closed if raced. */
const clearFailuresOnSuccess = (
  credentialVersion: string,
  now: number
): boolean =>
  sqlite
    .prepare(
      `UPDATE admin_gesture_credential
          SET failed_attempts = 0, last_failed_at = NULL, locked_at = NULL,
              updated_at = @now
        WHERE id = 1 AND credential_version = @version AND locked_at IS NULL`
    )
    .run({ now, version: credentialVersion }).changes > 0;

/** Authenticate a drawn gesture. Success always yields an admin session. */
export async function authenticateGesture(
  rawPattern: unknown
): Promise<GestureAuthResult> {
  const now = Date.now();

  let row: CredentialRow | undefined;
  let status: GestureLoginStatus;
  try {
    // Re-read settings and re-normalise every attempt, so a stale client
    // cannot authenticate against prerequisites or a streak that have moved on.
    const canConfigure = readPrerequisites();
    row = readNormalizedRow(now);
    status = deriveStatus(row, canConfigure);
  } catch (error) {
    logger.error(
      "Failed to read Gesture Login state during authentication",
      error instanceof Error ? error : new Error(String(error))
    );
    return { ok: false, code: "gesture_authentication_failed" };
  }

  const canonical = canonicalizePattern(rawPattern);
  if (!canonical.ok) {
    // A malformed body is not a credential attempt. Counting it would let
    // unauthenticated junk traffic lock the admin out of their own gesture.
    return { ok: false, code: "gesture_invalid" };
  }

  // Everything below this point is decided before any key derivation. Running
  // scrypt for a request that cannot possibly succeed would hand an attacker
  // ~32 MiB and ~100 ms of threadpool work per call for free.
  if (status.locked) {
    return { ok: false, code: "gesture_locked", attemptsRemaining: 0 };
  }

  if (!row || !status.available) {
    return { ok: false, code: "gesture_unavailable" };
  }

  const pepper = readGesturePepper();
  if (!pepper) {
    return { ok: false, code: "gesture_unavailable" };
  }

  let outcome: Awaited<ReturnType<typeof verifyGestureVerifier>>;
  try {
    outcome = await verifyGestureVerifier(
      row.pattern_hash,
      canonical.material,
      pepper.secret
    );
  } catch (error) {
    logger.error(
      "Gesture Login verification failed",
      error instanceof Error ? error : new Error(String(error))
    );
    return { ok: false, code: "gesture_authentication_failed" };
  }

  if (outcome === "unreadable") {
    logger.warn("Gesture Login verifier unavailable; reset required");
    return { ok: false, code: "gesture_unavailable" };
  }

  if (outcome === "mismatch") {
    const recorded = recordFailure(row.credential_version, Date.now());

    if (!recorded) {
      // Changed, removed, or locked while we were hashing. Do not overwrite
      // whatever won; report the current state instead.
      const current = getGestureLoginStatus();
      return current.locked
        ? { ok: false, code: "gesture_locked", attemptsRemaining: 0 }
        : { ok: false, code: "gesture_unavailable" };
    }

    if (recorded.locked) {
      logger.warn("Gesture Login locked after failed attempts");
      return { ok: false, code: "gesture_locked", attemptsRemaining: 0 };
    }

    logger.warn("Gesture authentication failed", {
      attemptsRemaining: GESTURE_MAX_FAILED_ATTEMPTS - recorded.failedAttempts,
    });
    return {
      ok: false,
      code: "gesture_incorrect",
      attemptsRemaining: GESTURE_MAX_FAILED_ATTEMPTS - recorded.failedAttempts,
    };
  }

  if (!clearFailuresOnSuccess(row.credential_version, Date.now())) {
    // The credential moved under us, or a concurrent third failure locked it
    // first. Never mint a session from a stale snapshot.
    const current = getGestureLoginStatus();
    return current.locked
      ? { ok: false, code: "gesture_locked", attemptsRemaining: 0 }
      : { ok: false, code: "gesture_unavailable" };
  }

  return { ok: true, token: generateToken({ role: "admin" }), role: "admin" };
}

/**
 * Clear the failure counter and any lock after a successful admin password
 * login. This is the only recovery path from a three-failure lock.
 *
 * Never throws: gesture recovery is optional, and a failure here must not stop
 * a valid password login from completing.
 */
export function unlockAfterSuccessfulAdminPasswordLogin(): void {
  try {
    const result = sqlite
      .prepare(
        `UPDATE admin_gesture_credential
            SET failed_attempts = 0, last_failed_at = NULL, locked_at = NULL,
                updated_at = @now
          WHERE id = 1 AND (failed_attempts > 0 OR locked_at IS NOT NULL)`
      )
      .run({ now: Date.now() });

    if (result.changes > 0) {
      logger.info("Gesture Login unlocked by successful admin password login");
    }
  } catch (error) {
    logger.error(
      "Failed to unlock Gesture Login after admin password login",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
