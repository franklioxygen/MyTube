import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../config/paths";
import { logger } from "../utils/logger";

/**
 * Server-side pepper for the admin Gesture Login verifier.
 *
 * A 3x3 pattern has far too little entropy to survive an offline attack on its
 * own, so the canonical material is HMAC'd under a secret that never leaves the
 * server before it reaches scrypt. A database-only leak is then insufficient to
 * mount the attack.
 *
 * Deliberately never derived from JWT_SECRET or CSRF_SECRET: both fall back to
 * a fresh random value per process, so reusing either would silently invalidate
 * an enrolled gesture on every restart.
 */

export const GESTURE_PEPPER_ENV_VAR = "GESTURE_LOGIN_PEPPER";
export const GESTURE_PEPPER_FILENAME = "gesture-login.pepper";
export const GESTURE_PEPPER_MIN_BYTES = 32;

export type GesturePepperErrorCode =
  | "pepper_env_too_short"
  | "pepper_unreadable"
  | "pepper_write_failed";

export class GesturePepperError extends Error {
  public readonly code: GesturePepperErrorCode;

  constructor(code: GesturePepperErrorCode, message: string) {
    super(message);
    this.name = "GesturePepperError";
    this.code = code;
  }
}

export interface GesturePepper {
  secret: Buffer;
  /** Non-secret fingerprint, stored alongside the verifier to detect rotation. */
  keyId: string;
}

let cachedPepper: GesturePepper | null = null;

const getPepperFilePath = (): string =>
  path.join(DATA_DIR, GESTURE_PEPPER_FILENAME);

const toPepper = (secret: Buffer): GesturePepper => ({
  secret,
  keyId: crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16),
});

const readEnvironmentPepper = (): Buffer | null => {
  const raw = process.env[GESTURE_PEPPER_ENV_VAR];
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  const secret = Buffer.from(raw, "utf8");
  if (secret.byteLength < GESTURE_PEPPER_MIN_BYTES) {
    throw new GesturePepperError(
      "pepper_env_too_short",
      `${GESTURE_PEPPER_ENV_VAR} must be at least ${GESTURE_PEPPER_MIN_BYTES} bytes.`
    );
  }

  return secret;
};

const readPepperFile = (): Buffer | null => {
  const filePath = getPepperFilePath();

  let encoded: string;
  try {
    encoded = fs.readFileSync(filePath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw new GesturePepperError(
      "pepper_unreadable",
      "Gesture Login pepper file could not be read."
    );
  }

  const secret = Buffer.from(encoded, "base64url");
  if (secret.byteLength < GESTURE_PEPPER_MIN_BYTES) {
    // Never regenerate here: a truncated file would otherwise silently destroy
    // a working credential. Surface it as unreadable so the admin is told to
    // re-enrol deliberately.
    throw new GesturePepperError(
      "pepper_unreadable",
      "Gesture Login pepper file is malformed."
    );
  }

  return secret;
};

const createPepperFile = (): Buffer => {
  const filePath = getPepperFilePath();
  const secret = crypto.randomBytes(GESTURE_PEPPER_MIN_BYTES);

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // "wx" is the point of this function: two concurrent first-time
    // configurations must not each generate a pepper and overwrite the other.
    fs.writeFileSync(filePath, secret.toString("base64url"), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    logger.info("Gesture Login pepper generated");
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      // Another request won the race; its file is the authority.
      const existing = readPepperFile();
      if (existing) {
        return existing;
      }
    }

    throw new GesturePepperError(
      "pepper_write_failed",
      "Gesture Login pepper file could not be created."
    );
  }
};

/**
 * Resolve the pepper without ever creating one. Returns null when no pepper
 * exists yet, which is the normal state before first enrolment - the public
 * status endpoint must not mint a secret as a side effect of being polled.
 *
 * Returns null rather than throwing when the pepper is unusable, so status
 * derivation stays total. A credential row whose key id no longer matches is
 * reported as reset-required by the caller.
 */
export function readGesturePepper(): GesturePepper | null {
  if (cachedPepper) {
    return cachedPepper;
  }

  try {
    const secret = readEnvironmentPepper() ?? readPepperFile();
    if (!secret) {
      return null;
    }

    cachedPepper = toPepper(secret);
    return cachedPepper;
  } catch (error) {
    logger.error(
      "Gesture Login pepper is unavailable",
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/**
 * Resolve the pepper, generating one on first use. Only authenticated
 * configuration may call this.
 */
export function requireGesturePepper(): GesturePepper {
  if (cachedPepper) {
    return cachedPepper;
  }

  const secret =
    readEnvironmentPepper() ?? readPepperFile() ?? createPepperFile();

  cachedPepper = toPepper(secret);
  return cachedPepper;
}

/** Fingerprint of the active pepper, or null when none is resolvable. */
export function getActivePepperKeyId(): string | null {
  return readGesturePepper()?.keyId ?? null;
}

/** Test seam; the pepper is otherwise resolved once per process. */
export function resetGesturePepperCache(): void {
  cachedPepper = null;
}
