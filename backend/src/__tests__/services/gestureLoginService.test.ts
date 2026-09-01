import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sqlite: undefined as any,
  settings: {} as Record<string, unknown>,
  pepperKeyId: "aaaabbbbccccdddd" as string | null,
  verifyOutcome: "match" as "match" | "mismatch" | "unreadable",
  supportedVerifier: true,
}));

vi.mock("../../db", () => ({
  get sqlite() {
    return mocks.sqlite;
  },
  db: {},
}));

vi.mock("../../services/storageService", () => ({
  getSettings: () => mocks.settings,
}));

vi.mock("../../services/gestureLoginPepper", () => ({
  GesturePepperError: class GesturePepperError extends Error {},
  getActivePepperKeyId: () => mocks.pepperKeyId,
  readGesturePepper: () =>
    mocks.pepperKeyId
      ? { secret: Buffer.from("pepper"), keyId: mocks.pepperKeyId }
      : null,
  requireGesturePepper: () => ({
    secret: Buffer.from("pepper"),
    keyId: mocks.pepperKeyId ?? "aaaabbbbccccdddd",
  }),
}));

// The real crypto path has its own suite (gestureLoginVerifier.test.ts). Here
// the verifier is a switch, so these tests stay about the state machine,
// expiry, and the compare-and-swap races - and run in milliseconds.
const encodeGestureVerifier = vi.fn(
  async (material: string, _pepper: Buffer) =>
    `scrypt-v1$32768$8$1$salt$${material}`
);
const verifyGestureVerifier = vi.fn(
  async (_stored: string, _material: string, _pepper: Buffer) =>
    mocks.verifyOutcome
);
vi.mock("../../services/gestureLoginVerifier", () => ({
  encodeGestureVerifier: (material: string, pepper: Buffer) =>
    encodeGestureVerifier(material, pepper),
  verifyGestureVerifier: (stored: string, material: string, pepper: Buffer) =>
    verifyGestureVerifier(stored, material, pepper),
  isSupportedVerifier: () => mocks.supportedVerifier,
}));

vi.mock("../../services/authService", () => ({
  generateToken: vi.fn(() => "signed-admin-token"),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  GESTURE_MAX_FAILED_ATTEMPTS,
  PARTIAL_GESTURE_FAILURE_RESET_MS,
  authenticateGesture,
  configureGesture,
  getGestureLoginStatus,
  hasGestureCredential,
  removeGesture,
  unlockAfterSuccessfulAdminPasswordLogin,
} from "../../services/gestureLoginService";

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "../../../drizzle/0028_easy_invaders.sql"),
  "utf8"
);

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const WINDOW = PARTIAL_GESTURE_FAILURE_RESET_MS;

const GOOD: number[] = [0, 1, 2];
const OTHER: number[] = [2, 4, 6];

type Row = {
  credential_version: string;
  failed_attempts: number;
  last_failed_at: number | null;
  locked_at: number | null;
  created_at: number;
  pepper_key_id: string;
};

const readRow = (): Row | undefined =>
  mocks.sqlite
    .prepare("SELECT * FROM admin_gesture_credential WHERE id = 1")
    .get() as Row | undefined;

const at = (ms: number): void => {
  vi.setSystemTime(new Date(ms));
};

/** Enrol a credential and leave the clock at T0 with a clean failure state. */
const enrol = async (): Promise<void> => {
  at(T0);
  const result = await configureGesture(GOOD);
  expect(result.ok).toBe(true);
};

const failOnce = async (when: number) => {
  at(when);
  mocks.verifyOutcome = "mismatch";
  return authenticateGesture(OTHER);
};

beforeEach(() => {
  vi.useFakeTimers();
  at(T0);
  mocks.sqlite = new Database(":memory:");
  mocks.sqlite.exec(MIGRATION);
  mocks.settings = { loginEnabled: true, passwordLoginAllowed: true };
  mocks.pepperKeyId = "aaaabbbbccccdddd";
  mocks.verifyOutcome = "match";
  mocks.supportedVerifier = true;
  verifyGestureVerifier.mockClear();
  encodeGestureVerifier.mockClear();
});

afterEach(() => {
  mocks.sqlite?.close();
  vi.useRealTimers();
});

describe("status derivation", () => {
  it("reports nothing configured on a clean install", () => {
    expect(getGestureLoginStatus()).toEqual({
      configured: false,
      canConfigure: true,
      locked: false,
      available: false,
      attemptsRemaining: null,
      resetRequired: false,
    });
    expect(hasGestureCredential()).toBe(false);
  });

  it("re-reads settings on every call rather than caching prerequisites", async () => {
    await enrol();
    expect(getGestureLoginStatus().available).toBe(true);

    mocks.settings = { loginEnabled: true, passwordLoginAllowed: false };
    expect(getGestureLoginStatus()).toMatchObject({
      configured: true,
      canConfigure: false,
      available: false,
    });

    mocks.settings = { loginEnabled: false, passwordLoginAllowed: true };
    expect(getGestureLoginStatus()).toMatchObject({
      canConfigure: false,
      available: false,
    });
  });

  it("treats passwordLoginAllowed as allowed when unset, for backward compatibility", async () => {
    mocks.settings = { loginEnabled: true };
    await enrol();
    expect(getGestureLoginStatus().available).toBe(true);
  });

  it("never exposes the verifier, pepper id, or any timestamp", async () => {
    await enrol();
    expect(Object.keys(getGestureLoginStatus()).sort()).toEqual([
      "attemptsRemaining",
      "available",
      "canConfigure",
      "configured",
      "locked",
      "resetRequired",
    ]);
  });

  it("reports reset-required when the pepper no longer matches the row", async () => {
    await enrol();
    mocks.pepperKeyId = "0000111122223333";

    expect(getGestureLoginStatus()).toMatchObject({
      configured: false,
      available: false,
      resetRequired: true,
      attemptsRemaining: null,
    });
    // The row is still there; only its usability changed.
    expect(hasGestureCredential()).toBe(true);
  });

  it("reports reset-required when the stored verifier cannot be parsed", async () => {
    await enrol();
    mocks.supportedVerifier = false;

    expect(getGestureLoginStatus()).toMatchObject({
      configured: false,
      resetRequired: true,
    });
  });

  it("reports reset-required when no pepper is resolvable at all", async () => {
    await enrol();
    mocks.pepperKeyId = null;

    expect(getGestureLoginStatus()).toMatchObject({
      configured: false,
      resetRequired: true,
    });
  });
});

describe("configureGesture", () => {
  it("requires login protection and password login to be persisted on", async () => {
    mocks.settings = { loginEnabled: false, passwordLoginAllowed: true };
    await expect(configureGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_password_login_required",
    });

    mocks.settings = { loginEnabled: true, passwordLoginAllowed: false };
    await expect(configureGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_password_login_required",
    });

    expect(hasGestureCredential()).toBe(false);
  });

  it("inserts the singleton on first enrolment", async () => {
    const result = await configureGesture(GOOD);

    expect(result).toMatchObject({ ok: true, created: true });
    expect(result.ok && result.status).toMatchObject({
      configured: true,
      available: true,
      attemptsRemaining: 3,
    });
    expect(readRow()?.failed_attempts).toBe(0);
  });

  it("hashes the canonical material, not the raw dots", async () => {
    await configureGesture([0, 2]);
    expect(encodeGestureVerifier).toHaveBeenCalledWith(
      "gesture-v1:0.1.2",
      expect.anything()
    );
  });

  it("replaces in place: keeps createdAt, rotates version, clears failures", async () => {
    await enrol();
    const before = readRow()!;
    await failOnce(T0 + 1000);
    expect(readRow()?.failed_attempts).toBe(1);

    at(T0 + 2000);
    const result = await configureGesture([3, 4, 5]);
    const after = readRow()!;

    expect(result).toMatchObject({ ok: true, created: false });
    expect(after.created_at).toBe(before.created_at);
    expect(after.credential_version).not.toBe(before.credential_version);
    expect(after.failed_attempts).toBe(0);
    expect(after.last_failed_at).toBeNull();
  });

  it("rejects an invalid pattern without touching an existing credential", async () => {
    await enrol();
    const before = readRow()!;

    await expect(configureGesture([0, 4])).resolves.toEqual({
      ok: false,
      code: "gesture_invalid",
    });
    await expect(configureGesture("0,1,2")).resolves.toEqual({
      ok: false,
      code: "gesture_invalid",
    });

    expect(readRow()).toEqual(before);
  });

  it("refuses to replace a locked credential", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);
    expect(getGestureLoginStatus().locked).toBe(true);

    // Recovery is a password login, not a redraw by whoever holds the page.
    await expect(configureGesture([3, 4, 5])).resolves.toEqual({
      ok: false,
      code: "gesture_locked",
    });
  });

  it("allows replacing a credential that is only reset-required", async () => {
    await enrol();
    mocks.pepperKeyId = "0000111122223333";

    // It can never authenticate, so refusing to replace it would be a dead end.
    await expect(configureGesture([3, 4, 5])).resolves.toMatchObject({
      ok: true,
      created: false,
    });
    expect(readRow()?.pepper_key_id).toBe("0000111122223333");
  });
});

describe("removeGesture", () => {
  it("deletes the credential and is idempotent", async () => {
    await enrol();

    expect(removeGesture()).toEqual({ removed: true });
    expect(removeGesture()).toEqual({ removed: false });
    expect(hasGestureCredential()).toBe(false);
  });

  it("is permitted while locked, removing the feature rather than unlocking it", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);

    expect(removeGesture()).toEqual({ removed: true });
    expect(getGestureLoginStatus().locked).toBe(false);
    expect(getGestureLoginStatus().configured).toBe(false);
  });
});

describe("authenticateGesture", () => {
  it("mints an admin session for the enrolled pattern", async () => {
    await enrol();

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: true,
      token: "signed-admin-token",
      role: "admin",
    });
  });

  it("compares the canonical material, so raw and canonical draws agree", async () => {
    await enrol();
    await authenticateGesture([0, 2]);

    expect(verifyGestureVerifier).toHaveBeenLastCalledWith(
      expect.any(String),
      "gesture-v1:0.1.2",
      expect.anything()
    );
  });

  it("counts down 2, then 1, then locks", async () => {
    await enrol();

    await expect(failOnce(T0 + 1)).resolves.toEqual({
      ok: false,
      code: "gesture_incorrect",
      attemptsRemaining: 2,
    });
    await expect(failOnce(T0 + 2)).resolves.toEqual({
      ok: false,
      code: "gesture_incorrect",
      attemptsRemaining: 1,
    });
    await expect(failOnce(T0 + 3)).resolves.toEqual({
      ok: false,
      code: "gesture_locked",
      attemptsRemaining: 0,
    });
    expect(readRow()).toMatchObject({ failed_attempts: 3 });
    expect(readRow()?.locked_at).not.toBeNull();
  });

  it("caps at three and leaves lockedAt at the moment of locking", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);
    const lockedAt = readRow()!.locked_at;

    await failOnce(T0 + 10_000);
    await failOnce(T0 + 20_000);

    expect(readRow()?.failed_attempts).toBe(GESTURE_MAX_FAILED_ATTEMPTS);
    expect(readRow()?.locked_at).toBe(lockedAt);
  });

  it("rejects a malformed body without touching the counter", async () => {
    await enrol();
    await failOnce(T0 + 1);
    const before = readRow()!;

    for (const bad of ["0,1,2", null, [0, 4], [0, 9], [0, 1, 0], 42]) {
      await expect(authenticateGesture(bad)).resolves.toEqual({
        ok: false,
        code: "gesture_invalid",
      });
    }

    // Junk traffic must not be able to extend or lock the admin's streak.
    expect(readRow()).toEqual(before);
  });

  it("clears a partial streak on a correct gesture", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    expect(readRow()?.failed_attempts).toBe(2);

    at(T0 + 3);
    mocks.verifyOutcome = "match";
    await expect(authenticateGesture(GOOD)).resolves.toMatchObject({ ok: true });

    expect(readRow()).toMatchObject({
      failed_attempts: 0,
      last_failed_at: null,
      locked_at: null,
    });
  });

  it("refuses even the correct gesture once locked, and does not unlock", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);

    at(T0 + 4);
    mocks.verifyOutcome = "match";
    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_locked",
      attemptsRemaining: 0,
    });
    expect(getGestureLoginStatus().locked).toBe(true);
  });

  it("short-circuits a locked credential before running the verifier", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);
    verifyGestureVerifier.mockClear();

    await authenticateGesture(GOOD);

    // Deriving a key here would be free threadpool work for an attacker.
    expect(verifyGestureVerifier).not.toHaveBeenCalled();
  });

  it("short-circuits when prerequisites are off, before running the verifier", async () => {
    await enrol();
    mocks.settings = { loginEnabled: true, passwordLoginAllowed: false };
    verifyGestureVerifier.mockClear();

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_unavailable",
    });
    expect(verifyGestureVerifier).not.toHaveBeenCalled();
  });

  it("reports unavailable when no credential exists", async () => {
    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_unavailable",
    });
  });

  it("never authenticates against a pepper that no longer matches", async () => {
    await enrol();
    mocks.pepperKeyId = "0000111122223333";
    verifyGestureVerifier.mockClear();

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_unavailable",
    });
    expect(verifyGestureVerifier).not.toHaveBeenCalled();
  });

  it("treats an unreadable verifier as unavailable, not as a wrong gesture", async () => {
    await enrol();
    at(T0 + 1);
    mocks.verifyOutcome = "unreadable";

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_unavailable",
    });
    // Counting it would lock a credential that was never actually tried.
    expect(readRow()?.failed_attempts).toBe(0);
  });
});

describe("the sliding 12-hour partial expiry", () => {
  it("keeps a streak alive just before the boundary", async () => {
    await enrol();
    await failOnce(T0 + 1);

    await expect(failOnce(T0 + 1 + WINDOW - 1)).resolves.toMatchObject({
      attemptsRemaining: 1,
    });
    expect(readRow()?.failed_attempts).toBe(2);
  });

  it("expires exactly at the boundary", async () => {
    await enrol();
    await failOnce(T0 + 1);

    at(T0 + 1 + WINDOW);
    expect(getGestureLoginStatus().attemptsRemaining).toBe(3);
    expect(readRow()).toMatchObject({
      failed_attempts: 0,
      last_failed_at: null,
    });
  });

  it("starts the next wrong gesture after expiry back at failure one", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);

    await expect(failOnce(T0 + 2 + WINDOW + 1)).resolves.toMatchObject({
      code: "gesture_incorrect",
      attemptsRemaining: 2,
    });
    expect(readRow()?.failed_attempts).toBe(1);
  });

  it("slides the deadline on every new wrong gesture below the threshold", async () => {
    await enrol();
    await failOnce(T0);
    const second = T0 + WINDOW - 1000;
    await failOnce(second);

    // Measured from the second failure, not the first.
    at(second + WINDOW - 1);
    expect(getGestureLoginStatus().attemptsRemaining).toBe(1);

    at(second + WINDOW);
    expect(getGestureLoginStatus().attemptsRemaining).toBe(3);
  });

  it("never expires a lock, however long the wait", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);

    for (const later of [WINDOW, WINDOW * 2, WINDOW * 60, WINDOW * 1000]) {
      at(T0 + later);
      expect(getGestureLoginStatus().locked).toBe(true);
      expect(readRow()?.failed_attempts).toBe(3);
    }
  });

  it("does not rotate the credential version when normalising an expired streak", async () => {
    await enrol();
    await failOnce(T0 + 1);
    const version = readRow()!.credential_version;

    at(T0 + 1 + WINDOW);
    getGestureLoginStatus();

    // Expiry changes attempt state, not the credential; rotating here would
    // make an in-flight verification fail for no reason.
    expect(readRow()?.credential_version).toBe(version);
  });
});

describe("compare-and-swap against concurrent credential changes", () => {
  it("does not record a failure against a credential replaced mid-attempt", async () => {
    await enrol();
    at(T0 + 1);
    mocks.verifyOutcome = "mismatch";

    // Verification is where the time goes; simulate the admin replacing the
    // gesture while this request was inside scrypt.
    verifyGestureVerifier.mockImplementationOnce(async () => {
      mocks.verifyOutcome = "match";
      await configureGesture([3, 4, 5]);
      return "mismatch" as const;
    });

    const result = await authenticateGesture(OTHER);

    expect(result).toEqual({ ok: false, code: "gesture_unavailable" });
    expect(readRow()?.failed_attempts).toBe(0);
  });

  it("does not mint a session against a credential replaced mid-attempt", async () => {
    await enrol();
    at(T0 + 1);

    verifyGestureVerifier.mockImplementationOnce(async () => {
      await configureGesture([3, 4, 5]);
      return "match" as const;
    });

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_unavailable",
    });
  });

  it("does not mint a session against a credential removed mid-attempt", async () => {
    await enrol();
    at(T0 + 1);

    verifyGestureVerifier.mockImplementationOnce(async () => {
      removeGesture();
      return "match" as const;
    });

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_unavailable",
    });
    expect(hasGestureCredential()).toBe(false);
  });

  it("loses to a concurrent third failure rather than authenticating", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);

    at(T0 + 3);
    verifyGestureVerifier.mockImplementationOnce(async () => {
      // Another request commits the lock while this one is hashing.
      mocks.verifyOutcome = "mismatch";
      await authenticateGesture(OTHER);
      return "match" as const;
    });

    await expect(authenticateGesture(GOOD)).resolves.toEqual({
      ok: false,
      code: "gesture_locked",
      attemptsRemaining: 0,
    });
    expect(getGestureLoginStatus().locked).toBe(true);
  });
});

describe("unlockAfterSuccessfulAdminPasswordLogin", () => {
  it("clears a three-failure lock", async () => {
    await enrol();
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);
    expect(getGestureLoginStatus().locked).toBe(true);

    unlockAfterSuccessfulAdminPasswordLogin();

    expect(readRow()).toMatchObject({
      failed_attempts: 0,
      last_failed_at: null,
      locked_at: null,
    });
    expect(getGestureLoginStatus()).toMatchObject({
      locked: false,
      available: true,
      attemptsRemaining: 3,
    });
  });

  it("clears a partial streak too", async () => {
    await enrol();
    await failOnce(T0 + 1);

    unlockAfterSuccessfulAdminPasswordLogin();

    expect(readRow()?.failed_attempts).toBe(0);
  });

  it("leaves the verifier and credential version untouched", async () => {
    await enrol();
    const before = readRow()!;
    await failOnce(T0 + 1);
    await failOnce(T0 + 2);
    await failOnce(T0 + 3);

    unlockAfterSuccessfulAdminPasswordLogin();

    const after = readRow()!;
    expect(after.credential_version).toBe(before.credential_version);
    // The gesture itself still works after recovery.
    at(T0 + 4);
    mocks.verifyOutcome = "match";
    await expect(authenticateGesture(GOOD)).resolves.toMatchObject({ ok: true });
  });

  it("is a no-op when no credential exists", () => {
    expect(() => unlockAfterSuccessfulAdminPasswordLogin()).not.toThrow();
  });

  it("never throws, so a failure here cannot block a valid password login", async () => {
    await enrol();
    mocks.sqlite.close();

    expect(() => unlockAfterSuccessfulAdminPasswordLogin()).not.toThrow();
    mocks.sqlite = new Database(":memory:");
    mocks.sqlite.exec(MIGRATION);
  });
});
