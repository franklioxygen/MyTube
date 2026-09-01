import crypto from "crypto";
import { promisify } from "util";

/**
 * Encode and verify the admin Gesture Login secret.
 *
 * A gesture carries far less entropy than a password - as little as ~320
 * possibilities at the three-dot minimum - so a plain digest would be trivially
 * enumerable from a database leak. The material is therefore HMAC'd under the
 * server pepper and then run through memory-hard scrypt with a per-credential
 * salt. This raises the cost of an offline attack; it does not make a gesture a
 * high-entropy credential, and the UI must keep saying so.
 */

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

export const GESTURE_VERIFIER_PREFIX = "scrypt-v1";
export const GESTURE_SCRYPT_N = 32768;
export const GESTURE_SCRYPT_R = 8;
export const GESTURE_SCRYPT_P = 1;
export const GESTURE_SCRYPT_KEY_BYTES = 32;
export const GESTURE_SCRYPT_SALT_BYTES = 16;
// 128 * N * r is 32 MiB at these parameters; leave headroom for the allocator.
export const GESTURE_SCRYPT_MAXMEM = 64 * 1024 * 1024;

export type GestureVerifyOutcome = "match" | "mismatch" | "unreadable";

interface ParsedVerifier {
  salt: Buffer;
  digest: Buffer;
}

const prehash = (material: string, pepper: Buffer): Buffer =>
  crypto.createHmac("sha256", pepper).update(material, "utf8").digest();

const derive = (material: string, pepper: Buffer, salt: Buffer): Promise<Buffer> =>
  scryptAsync(prehash(material, pepper), salt, GESTURE_SCRYPT_KEY_BYTES, {
    N: GESTURE_SCRYPT_N,
    r: GESTURE_SCRYPT_R,
    p: GESTURE_SCRYPT_P,
    maxmem: GESTURE_SCRYPT_MAXMEM,
  });

/**
 * Parse a stored verifier, accepting only the exact supported shape.
 *
 * The work factors are compared against the compiled-in constants rather than
 * being read out of the string. A stored value is not a trusted input: honouring
 * whatever N it names would let anyone who can write one row turn every
 * subsequent login into an arbitrarily expensive computation.
 */
function parseVerifier(stored: string): ParsedVerifier | null {
  if (typeof stored !== "string") {
    return null;
  }

  const parts = stored.split("$");
  if (parts.length !== 6) {
    return null;
  }

  const [prefix, n, r, p, saltEncoded, digestEncoded] = parts;
  if (
    prefix !== GESTURE_VERIFIER_PREFIX ||
    n !== String(GESTURE_SCRYPT_N) ||
    r !== String(GESTURE_SCRYPT_R) ||
    p !== String(GESTURE_SCRYPT_P)
  ) {
    return null;
  }

  const salt = Buffer.from(saltEncoded, "base64url");
  const digest = Buffer.from(digestEncoded, "base64url");
  if (
    salt.byteLength !== GESTURE_SCRYPT_SALT_BYTES ||
    digest.byteLength !== GESTURE_SCRYPT_KEY_BYTES
  ) {
    return null;
  }

  return { salt, digest };
}

/** True when a stored value is a verifier this build knows how to check. */
export function isSupportedVerifier(stored: string): boolean {
  return parseVerifier(stored) !== null;
}

/** Derive a fresh verifier for storage. Never returns the material itself. */
export async function encodeGestureVerifier(
  material: string,
  pepper: Buffer
): Promise<string> {
  const salt = crypto.randomBytes(GESTURE_SCRYPT_SALT_BYTES);
  const digest = await derive(material, pepper, salt);

  return [
    GESTURE_VERIFIER_PREFIX,
    GESTURE_SCRYPT_N,
    GESTURE_SCRYPT_R,
    GESTURE_SCRYPT_P,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

/**
 * Check material against a stored verifier.
 *
 * "unreadable" is returned for anything that does not parse, so the caller can
 * route it to reset-required. It must never be collapsed into "mismatch": a
 * corrupt row would then burn the admin's three attempts and lock a credential
 * that was never actually tried. There is no plaintext fallback.
 */
export async function verifyGestureVerifier(
  stored: string,
  material: string,
  pepper: Buffer
): Promise<GestureVerifyOutcome> {
  const parsed = parseVerifier(stored);
  if (!parsed) {
    return "unreadable";
  }

  const candidate = await derive(material, pepper, parsed.salt);

  // Both buffers are a fixed 32 bytes by construction, so timingSafeEqual
  // cannot throw on a length mismatch here.
  return crypto.timingSafeEqual(candidate, parsed.digest) ? "match" : "mismatch";
}
