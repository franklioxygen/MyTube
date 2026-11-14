import crypto from "crypto";
import path from "path";
import { DATA_DIR } from "../../config/paths";
import { logger } from "../../utils/logger";
import { ensureDirSafeSync, readFileSafeSync, writeFileSafeSync } from "../../utils/security";

/**
 * Encrypts the credentials this instance presents to its peers (design §4.1).
 *
 * The key lives outside the database: `MYTUBE_FEDERATION_KEY`, or a mode-0600
 * file beside it. A database backup therefore holds only ciphertext, and a
 * restore without the key leaves bindings `credential_missing` rather than
 * usable. Never derived from the JWT or CSRF secrets, which can change per
 * process.
 */

export const FEDERATION_KEY_ENV_VAR = "MYTUBE_FEDERATION_KEY";
export const FEDERATION_KEY_FILENAME = "federation.key";
const KEY_BYTES = 32;
const FORMAT = "v1";

let cachedKey: Buffer | null = null;

const keyFilePath = (): string => path.join(DATA_DIR, FEDERATION_KEY_FILENAME);

const parseKey = (encoded: string, source: string): Buffer => {
  const key = Buffer.from(encoded.trim(), "base64url");
  if (key.byteLength !== KEY_BYTES) {
    // Never regenerate over a malformed key: that would silently orphan every
    // stored credential.
    throw new Error(`${source} must hold ${KEY_BYTES} base64url-encoded bytes`);
  }
  return key;
};

const readKey = (): Buffer | null => {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env[FEDERATION_KEY_ENV_VAR];
  if (fromEnv) {
    cachedKey = parseKey(fromEnv, FEDERATION_KEY_ENV_VAR);
    return cachedKey;
  }
  try {
    cachedKey = parseKey(readFileSafeSync(keyFilePath(), DATA_DIR, "utf8"), FEDERATION_KEY_FILENAME);
    return cachedKey;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
};

/** Creates the key file on first use; only credential writes may call this. */
const requireKey = (): Buffer => {
  const existing = readKey();
  if (existing) return existing;

  const key = crypto.randomBytes(KEY_BYTES);
  try {
    ensureDirSafeSync(DATA_DIR, DATA_DIR);
    // "wx": two first writes must not each create a key and orphan the other.
    writeFileSafeSync(keyFilePath(), DATA_DIR, key.toString("base64url"), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    logger.info("Federation credential key generated");
    cachedKey = key;
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      const raced = readKey();
      if (raced) return raced;
    }
    throw error;
  }
};

const keyId = (key: Buffer): string =>
  crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);

export function encryptCredential(plaintext: string): string {
  const key = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    FORMAT,
    keyId(key),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** The plaintext, or null when the key is missing, changed, or the data was altered. */
export function decryptCredential(stored: string): string | null {
  try {
    const key = readKey();
    const [format, storedKeyId, iv, tag, ciphertext] = stored.split(".");
    if (!key || format !== FORMAT || storedKeyId !== keyId(key) || !iv || !tag || !ciphertext) {
      return null;
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Test hook: the key is cached for the process lifetime. */
export function resetCredentialKeyCacheForTests(): void {
  cachedKey = null;
}
