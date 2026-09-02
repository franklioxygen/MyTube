import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  GESTURE_SCRYPT_N,
  GESTURE_SCRYPT_P,
  GESTURE_SCRYPT_R,
  GESTURE_VERIFIER_PREFIX,
  encodeGestureVerifier,
  isSupportedVerifier,
  verifyGestureVerifier,
} from "../../services/gestureLoginVerifier";
import { canonicalizePattern } from "../../utils/gesturePattern";

const PEPPER = Buffer.from("p".repeat(32), "utf8");
const OTHER_PEPPER = Buffer.from("q".repeat(32), "utf8");

const materialFor = (pattern: number[]): string => {
  const result = canonicalizePattern(pattern);
  if (!result.ok) {
    throw new Error(`fixture is not a valid pattern: ${result.error}`);
  }
  return result.material;
};

describe("encodeGestureVerifier", () => {
  it("produces the documented scrypt-v1 envelope", async () => {
    const stored = await encodeGestureVerifier(materialFor([0, 1, 2]), PEPPER);
    const parts = stored.split("$");

    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe(GESTURE_VERIFIER_PREFIX);
    expect(parts[1]).toBe(String(GESTURE_SCRYPT_N));
    expect(parts[2]).toBe(String(GESTURE_SCRYPT_R));
    expect(parts[3]).toBe(String(GESTURE_SCRYPT_P));
    expect(Buffer.from(parts[4], "base64url")).toHaveLength(16);
    expect(Buffer.from(parts[5], "base64url")).toHaveLength(32);
  });

  it("never embeds the pattern or its material", async () => {
    const material = materialFor([0, 1, 4, 7]);
    const stored = await encodeGestureVerifier(material, PEPPER);

    expect(stored).not.toContain(material);
    expect(stored).not.toContain("0.1.4.7");
    expect(stored).not.toContain("gesture-v1");
  });

  it("salts each credential, so the same pattern stores differently twice", async () => {
    const material = materialFor([0, 1, 2]);
    const first = await encodeGestureVerifier(material, PEPPER);
    const second = await encodeGestureVerifier(material, PEPPER);

    expect(first).not.toBe(second);
    await expect(verifyGestureVerifier(first, material, PEPPER)).resolves.toBe("match");
    await expect(verifyGestureVerifier(second, material, PEPPER)).resolves.toBe("match");
  });
});

describe("verifyGestureVerifier", () => {
  it("matches the enrolled pattern", async () => {
    const material = materialFor([0, 4, 8]);
    const stored = await encodeGestureVerifier(material, PEPPER);

    await expect(verifyGestureVerifier(stored, material, PEPPER)).resolves.toBe("match");
  });

  it("rejects a different pattern", async () => {
    const stored = await encodeGestureVerifier(materialFor([0, 4, 8]), PEPPER);

    await expect(
      verifyGestureVerifier(stored, materialFor([2, 4, 6]), PEPPER)
    ).resolves.toBe("mismatch");
  });

  it("rejects the reverse of the enrolled pattern", async () => {
    const stored = await encodeGestureVerifier(materialFor([0, 1, 2]), PEPPER);

    await expect(
      verifyGestureVerifier(stored, materialFor([2, 1, 0]), PEPPER)
    ).resolves.toBe("mismatch");
  });

  it("rejects the right pattern under the wrong pepper", async () => {
    const material = materialFor([0, 1, 2]);
    const stored = await encodeGestureVerifier(material, PEPPER);

    // This is what a database-only leak buys an attacker: nothing.
    await expect(verifyGestureVerifier(stored, material, OTHER_PEPPER)).resolves.toBe(
      "mismatch"
    );
  });

  it("reports unreadable rather than mismatch for corrupt stored values", async () => {
    const material = materialFor([0, 1, 2]);
    const valid = await encodeGestureVerifier(material, PEPPER);
    const salt = crypto.randomBytes(16).toString("base64url");
    const digest = crypto.randomBytes(32).toString("base64url");

    const corrupt = [
      "",
      "not-a-verifier",
      material,
      valid.split("$").slice(1).join("$"),
      `${valid}$extra`,
      `scrypt-v2$32768$8$1$${salt}$${digest}`,
      `${GESTURE_VERIFIER_PREFIX}$32768$8$1$${salt}`,
      `${GESTURE_VERIFIER_PREFIX}$32768$8$1$${crypto.randomBytes(8).toString("base64url")}$${digest}`,
      `${GESTURE_VERIFIER_PREFIX}$32768$8$1$${salt}$${crypto.randomBytes(16).toString("base64url")}`,
    ];

    for (const stored of corrupt) {
      // Collapsing these into "mismatch" would burn the admin's three attempts
      // and lock a credential that was never actually tried.
      await expect(verifyGestureVerifier(stored, material, PEPPER)).resolves.toBe(
        "unreadable"
      );
    }
  });

  it("refuses work factors it did not choose itself", async () => {
    const salt = crypto.randomBytes(16).toString("base64url");
    const digest = crypto.randomBytes(32).toString("base64url");

    // Honouring a stored N would let anyone who can write one row make every
    // later login arbitrarily expensive.
    for (const header of ["1048576$8$1", "1024$8$1", "32768$64$1", "32768$8$16"]) {
      const stored = `${GESTURE_VERIFIER_PREFIX}$${header}$${salt}$${digest}`;
      expect(isSupportedVerifier(stored)).toBe(false);
      await expect(
        verifyGestureVerifier(stored, materialFor([0, 1, 2]), PEPPER)
      ).resolves.toBe("unreadable");
    }
  });
});

describe("isSupportedVerifier", () => {
  it("accepts a freshly encoded verifier and rejects anything else", async () => {
    const stored = await encodeGestureVerifier(materialFor([0, 1, 2]), PEPPER);

    expect(isSupportedVerifier(stored)).toBe(true);
    expect(isSupportedVerifier("")).toBe(false);
    expect(isSupportedVerifier("gesture-v1:0.1.2")).toBe(false);
    expect(isSupportedVerifier(undefined as unknown as string)).toBe(false);
  });
});
