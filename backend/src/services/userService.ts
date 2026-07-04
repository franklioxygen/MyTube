import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import {
  UserConflictError,
  UserNotFoundError,
  UserValidationError,
} from "../errors/UserErrors";
import { UserPayload } from "./authService";
import {
  revokeSessionsByUserId,
  updateSessionUsernames,
} from "./authService";
import * as storageService from "./storageService";
import { logger } from "../utils/logger";

export interface VisitorUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: "visitor";
  enabled: boolean;
  isLegacyShared: boolean;
  sessionVersion: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export type SafeVisitorUser = Omit<VisitorUserRecord, "passwordHash">;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "owner",
  "superuser",
  "system",
  "mytube",
]);

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const DUMMY_BCRYPT_HASH =
  "$2b$10$2ZbYbTsv5Pqf1vMXM8DmneBElxkw0ArG6iX/t.PHhX1zB0qfP0PN.";

type UserRow = typeof users.$inferSelect;

let usersById: Map<string, VisitorUserRecord> | null = null;
let usersByLowerUsername: Map<string, VisitorUserRecord> | null = null;

function lowerUsername(username: string): string {
  return username.toLowerCase();
}

function toRecord(row: UserRow): VisitorUserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    role: "visitor",
    enabled: row.enabled === 1,
    isLegacyShared: row.isLegacyShared === 1,
    sessionVersion: row.sessionVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt ?? null,
  };
}

function toSafeUser(record: VisitorUserRecord): SafeVisitorUser {
  const { passwordHash: _passwordHash, ...safeUser } = record;
  return { ...safeUser };
}

function loadCache(): void {
  const rows = db.select().from(users).all();
  const records = rows
    .map(toRecord)
    .sort((a, b) => a.createdAt - b.createdAt || a.username.localeCompare(b.username));

  usersById = new Map(records.map((record) => [record.id, record]));
  usersByLowerUsername = new Map(
    records.map((record) => [lowerUsername(record.username), record])
  );
}

function ensureCache(): void {
  if (usersById === null || usersByLowerUsername === null) {
    loadCache();
  }
}

function rebuildCache(): void {
  usersById = null;
  usersByLowerUsername = null;
  loadCache();
}

function normalizeUsername(username: string): string {
  return username.trim();
}

function validateUsername(username: unknown): string {
  if (typeof username !== "string") {
    throw new UserValidationError(
      "Username must be 3-32 characters using letters, numbers, dots, dashes or underscores.",
      "userUsernameInvalid"
    );
  }

  const normalized = normalizeUsername(username);
  if (
    normalized.length < USERNAME_MIN_LENGTH ||
    normalized.length > USERNAME_MAX_LENGTH ||
    !USERNAME_PATTERN.test(normalized)
  ) {
    throw new UserValidationError(
      "Username must be 3-32 characters using letters, numbers, dots, dashes or underscores.",
      "userUsernameInvalid"
    );
  }

  if (RESERVED_USERNAMES.has(lowerUsername(normalized))) {
    throw new UserValidationError(
      "This username is reserved.",
      "userUsernameReserved"
    );
  }

  return normalized;
}

function validatePassword(password: unknown): string {
  if (
    typeof password !== "string" ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new UserValidationError(
      "Password must be 6-128 characters.",
      "userPasswordInvalid"
    );
  }

  return password;
}

function throwIfUsernameTaken(username: string, ownId?: string): void {
  const existing = findUserByUsernameInsensitive(username);
  if (existing && existing.id !== ownId) {
    throw new UserConflictError();
  }
}

function isSqliteConstraintError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | undefined;
  return (
    candidate?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    candidate?.code === "SQLITE_CONSTRAINT" ||
    candidate?.message?.includes("UNIQUE constraint failed") === true
  );
}

function compareInputForDummy(password: unknown): Promise<boolean> {
  return bcrypt.compare(typeof password === "string" ? password : "", DUMMY_BCRYPT_HASH);
}

async function hashUserPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function comparePasswordForUser(
  password: unknown,
  record: VisitorUserRecord
): Promise<"match" | "legacy_plaintext_match" | "mismatch"> {
  if (typeof password !== "string") {
    return "mismatch";
  }

  if (!BCRYPT_HASH_PATTERN.test(record.passwordHash)) {
    return record.isLegacyShared && password === record.passwordHash
      ? "legacy_plaintext_match"
      : "mismatch";
  }

  try {
    return (await bcrypt.compare(password, record.passwordHash))
      ? "match"
      : "mismatch";
  } catch (error) {
    logger.warn("Visitor user password hash comparison failed", {
      userId: record.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return "mismatch";
  }
}

function persistUserLoginState(
  record: VisitorUserRecord,
  updates: Partial<Pick<VisitorUserRecord, "passwordHash" | "lastLoginAt">>
): VisitorUserRecord {
  const updatedRecord = {
    ...record,
    ...updates,
    updatedAt: record.updatedAt,
  };

  db.update(users)
    .set({
      passwordHash: updatedRecord.passwordHash,
      lastLoginAt: updatedRecord.lastLoginAt,
    })
    .where(eq(users.id, record.id))
    .run();

  rebuildCache();
  return updatedRecord;
}

async function verifyRecordPassword(
  record: VisitorUserRecord,
  password: unknown
): Promise<VisitorUserRecord | null> {
  const matchResult = await comparePasswordForUser(password, record);
  if (matchResult === "mismatch") {
    return null;
  }

  const updates: Partial<Pick<VisitorUserRecord, "passwordHash" | "lastLoginAt">> = {
    lastLoginAt: Date.now(),
  };

  if (matchResult === "legacy_plaintext_match" && typeof password === "string") {
    try {
      updates.passwordHash = await hashUserPassword(password);
      logger.warn("Detected legacy plaintext visitor user password. Automatically migrated to bcrypt hash.", {
        userId: record.id,
      });
    } catch (error) {
      logger.error(
        "Failed to migrate legacy plaintext visitor user password.",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  return persistUserLoginState(record, updates);
}

function markLegacySharedVisitorPasswordMigrated(now: number): void {
  // Drop the legacy shared secret before writing the marker so plaintext
  // credentials cannot remain indefinitely after a successful migration.
  storageService.deleteSettingsKeys(["visitorPassword"]);
  storageService.saveSettings(
    { visitorPasswordMigratedAt: now },
    { extraWhitelistedKeys: ["visitorPasswordMigratedAt"] }
  );
}

export function listUsers(): SafeVisitorUser[] {
  ensureCache();
  return Array.from(usersById!.values())
    .sort((a, b) => a.createdAt - b.createdAt || a.username.localeCompare(b.username))
    .map(toSafeUser);
}

export function getUserById(id: string): VisitorUserRecord | null {
  ensureCache();
  const record = usersById!.get(id);
  return record ? { ...record } : null;
}

export function findUserByUsernameInsensitive(
  username: string
): VisitorUserRecord | null {
  ensureCache();
  const record = usersByLowerUsername!.get(lowerUsername(normalizeUsername(username)));
  return record ? { ...record } : null;
}

export function hasEnabledVisitorUsers(): boolean {
  ensureCache();
  return Array.from(usersById!.values()).some((record) => record.enabled);
}

export function hasEnabledLegacySharedUser(): boolean {
  ensureCache();
  return Array.from(usersById!.values()).some(
    (record) => record.enabled && record.isLegacyShared
  );
}

export async function createUser(input: {
  username: string;
  password: string;
}): Promise<SafeVisitorUser> {
  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  throwIfUsernameTaken(username);

  const now = Date.now();
  const id = crypto.randomUUID();
  const passwordHash = await hashUserPassword(password);

  try {
    db.insert(users)
      .values({
        id,
        username,
        passwordHash,
        role: "visitor",
        enabled: 1,
        isLegacyShared: 0,
        sessionVersion: 1,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      })
      .run();
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      throw new UserConflictError();
    }
    throw error;
  }

  rebuildCache();
  logger.info("Visitor user created", { userId: id, username });

  const created = getUserById(id);
  if (!created) {
    throw new Error("Failed to create visitor user.");
  }

  return toSafeUser(created);
}

export async function updateUser(
  id: string,
  patch: {
    username?: string;
    password?: string;
    enabled?: boolean;
  }
): Promise<SafeVisitorUser> {
  const existing = getUserById(id);
  if (!existing) {
    throw new UserNotFoundError();
  }

  const update: Partial<typeof users.$inferInsert> = {
    updatedAt: Date.now(),
  };

  let nextUsername = existing.username;
  let usernameChanged = false;
  if (Object.prototype.hasOwnProperty.call(patch, "username")) {
    nextUsername = validateUsername(patch.username);
    throwIfUsernameTaken(nextUsername, id);
    update.username = nextUsername;
    usernameChanged = nextUsername !== existing.username;
  }

  let shouldRevoke = false;
  if (Object.prototype.hasOwnProperty.call(patch, "password")) {
    const password = validatePassword(patch.password);
    update.passwordHash = await hashUserPassword(password);
    update.isLegacyShared = 0;
    shouldRevoke = true;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    if (typeof patch.enabled !== "boolean") {
      throw new UserValidationError(
        "Enabled must be true or false.",
        "userEnabledInvalid"
      );
    }
    update.enabled = patch.enabled ? 1 : 0;
    if (patch.enabled === false) {
      shouldRevoke = true;
    }
  }

  if (shouldRevoke) {
    update.sessionVersion = existing.sessionVersion + 1;
  }

  try {
    db.update(users).set(update).where(eq(users.id, id)).run();
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      throw new UserConflictError();
    }
    throw error;
  }

  const revokedSessions = shouldRevoke ? revokeSessionsByUserId(id) : 0;
  if (usernameChanged) {
    // JWT fallback tokens keep their old display name until expiry; identity is userId.
    updateSessionUsernames(id, nextUsername);
  }

  rebuildCache();
  const updated = getUserById(id);
  if (!updated) {
    throw new UserNotFoundError();
  }

  logger.info("Visitor user updated", {
    userId: id,
    username: updated.username,
    enabled: updated.enabled,
    revokedSessions,
  });

  return toSafeUser(updated);
}

export function deleteUser(id: string): void {
  const existing = getUserById(id);
  if (!existing) {
    throw new UserNotFoundError();
  }

  db.delete(users).where(eq(users.id, id)).run();
  const revokedSessions = revokeSessionsByUserId(id);
  rebuildCache();

  logger.info("Visitor user deleted", {
    userId: id,
    username: existing.username,
    revokedSessions,
  });
}

export async function verifyUserLogin(
  username: string,
  password: string
): Promise<{ ok: true; user: SafeVisitorUser } | { ok: false }> {
  const record =
    typeof username === "string"
      ? findUserByUsernameInsensitive(username)
      : null;

  if (!record || !record.enabled) {
    await compareInputForDummy(password);
    logger.warn("Visitor login failed", {
      usernameLength: typeof username === "string" ? username.length : 0,
    });
    return { ok: false };
  }

  const verifiedRecord = await verifyRecordPassword(record, password);
  if (!verifiedRecord) {
    logger.warn("Visitor login failed", { usernameLength: username.length });
    return { ok: false };
  }

  logger.info("Visitor login succeeded", {
    userId: verifiedRecord.id,
    username: verifiedRecord.username,
  });

  return { ok: true, user: toSafeUser(verifiedRecord) };
}

export async function verifyLegacySharedVisitorPassword(
  password: string
): Promise<
  | { ok: true; user: SafeVisitorUser }
  | { ok: false; notConfigured: boolean }
> {
  ensureCache();
  const record = Array.from(usersById!.values()).find(
    (candidate) => candidate.enabled && candidate.isLegacyShared
  );

  if (!record) {
    return { ok: false, notConfigured: true };
  }

  const verifiedRecord = await verifyRecordPassword(record, password);
  if (!verifiedRecord) {
    return { ok: false, notConfigured: false };
  }

  return { ok: true, user: toSafeUser(verifiedRecord) };
}

export function isUserSessionPayloadValid(payload: UserPayload): boolean {
  if (!payload.userId) {
    return true;
  }

  const record = getUserById(payload.userId);
  return (
    record !== null &&
    record.enabled &&
    payload.sessionVersion === record.sessionVersion
  );
}

export async function migrateLegacySharedVisitorPassword(): Promise<void> {
  try {
    const settings = storageService.getSettings();
    if (settings.visitorPasswordMigratedAt) {
      return;
    }

    const now = Date.now();
    const raw = settings.visitorPassword;
    if (typeof raw !== "string" || raw.length === 0) {
      return;
    }

    let username = "visitor";
    let existing = findUserByUsernameInsensitive(username);
    if (existing && !existing.isLegacyShared) {
      username = "visitor-legacy";
      existing = findUserByUsernameInsensitive(username);
    }

    if (!existing) {
      const passwordHash = BCRYPT_HASH_PATTERN.test(raw)
        ? raw
        : await hashUserPassword(raw);

      db.insert(users)
        .values({
          id: crypto.randomUUID(),
          username,
          passwordHash,
          role: "visitor",
          enabled: settings.visitorUserEnabled === false ? 0 : 1,
          isLegacyShared: 1,
          sessionVersion: 1,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: null,
        })
        .run();
      rebuildCache();
      logger.info("Migrated legacy shared visitor password to user account", {
        username,
      });
    }

    markLegacySharedVisitorPasswordMigrated(now);
  } catch (error) {
    logger.error(
      "Failed to migrate legacy shared visitor password to user account",
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export function __resetUserCacheForTests(): void {
  usersById = null;
  usersByLowerUsername = null;
}
