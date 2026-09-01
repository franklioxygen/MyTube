import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATA_DIR = vi.hoisted(
  () => `/tmp/mytube-gesture-pepper-${process.pid}-${Math.random().toString(36).slice(2)}`
);

vi.mock("../../config/paths", () => ({ DATA_DIR: TEST_DATA_DIR }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  GESTURE_PEPPER_ENV_VAR,
  GESTURE_PEPPER_FILENAME,
  GesturePepperError,
  getActivePepperKeyId,
  readGesturePepper,
  requireGesturePepper,
  resetGesturePepperCache,
} from "../../services/gestureLoginPepper";

const pepperPath = path.join(TEST_DATA_DIR, GESTURE_PEPPER_FILENAME);

beforeEach(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env[GESTURE_PEPPER_ENV_VAR];
  resetGesturePepperCache();
});

afterEach(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  delete process.env[GESTURE_PEPPER_ENV_VAR];
  resetGesturePepperCache();
});

describe("readGesturePepper", () => {
  it("returns null before any pepper exists, and creates nothing", () => {
    expect(readGesturePepper()).toBeNull();
    expect(getActivePepperKeyId()).toBeNull();
    // The public status endpoint polls this path; it must never mint a secret.
    expect(fs.existsSync(pepperPath)).toBe(false);
  });

  it("reads a pepper that configuration already generated", () => {
    const created = requireGesturePepper();
    resetGesturePepperCache();

    expect(readGesturePepper()?.keyId).toBe(created.keyId);
  });

  it("reports a truncated pepper file as unavailable instead of regenerating it", () => {
    fs.writeFileSync(pepperPath, Buffer.from("tooshort").toString("base64url"));

    // Regenerating here would silently destroy a working credential.
    expect(readGesturePepper()).toBeNull();
    expect(fs.readFileSync(pepperPath, "utf8")).toBe(
      Buffer.from("tooshort").toString("base64url")
    );
  });
});

describe("requireGesturePepper", () => {
  it("creates a 32-byte pepper on first use and reuses it afterwards", () => {
    const first = requireGesturePepper();

    expect(fs.existsSync(pepperPath)).toBe(true);
    expect(Buffer.from(fs.readFileSync(pepperPath, "utf8"), "base64url")).toHaveLength(32);

    resetGesturePepperCache();
    expect(requireGesturePepper().keyId).toBe(first.keyId);
  });

  it("creates the pepper file with owner-only permissions", () => {
    requireGesturePepper();

    const mode = fs.statSync(pepperPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("keeps the winner's pepper when a concurrent request already created one", () => {
    // Simulate losing the exclusive-create race: the file appears between this
    // process deciding to create one and the write landing.
    const winner = requireGesturePepper();
    const onDisk = fs.readFileSync(pepperPath, "utf8");
    resetGesturePepperCache();

    expect(requireGesturePepper().keyId).toBe(winner.keyId);
    expect(fs.readFileSync(pepperPath, "utf8")).toBe(onDisk);
  });

  it("prefers the environment variable over the file", () => {
    const fileBacked = requireGesturePepper();
    resetGesturePepperCache();

    process.env[GESTURE_PEPPER_ENV_VAR] = "e".repeat(48);
    const envBacked = requireGesturePepper();

    expect(envBacked.keyId).not.toBe(fileBacked.keyId);
    expect(envBacked.secret.toString("utf8")).toBe("e".repeat(48));
  });

  it("rejects an environment pepper shorter than 32 bytes", () => {
    process.env[GESTURE_PEPPER_ENV_VAR] = "short";

    expect(() => requireGesturePepper()).toThrow(GesturePepperError);
    try {
      requireGesturePepper();
    } catch (error) {
      expect((error as GesturePepperError).code).toBe("pepper_env_too_short");
    }
    // A misconfigured operator secret must not silently fall through to a file.
    expect(fs.existsSync(pepperPath)).toBe(false);
  });

  it("counts bytes rather than characters for the length floor", () => {
    // 16 four-byte characters clear 32 bytes while being only 16 code points.
    process.env[GESTURE_PEPPER_ENV_VAR] = "\u{1F600}".repeat(16);
    expect(() => requireGesturePepper()).not.toThrow();
  });
});

describe("pepper key id", () => {
  it("is a stable 16-hex-character fingerprint of the secret", () => {
    process.env[GESTURE_PEPPER_ENV_VAR] = "a".repeat(32);
    const first = requireGesturePepper().keyId;
    resetGesturePepperCache();
    const second = requireGesturePepper().keyId;

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the pepper changes, which is how rotation is detected", () => {
    process.env[GESTURE_PEPPER_ENV_VAR] = "a".repeat(32);
    const before = requireGesturePepper().keyId;

    resetGesturePepperCache();
    process.env[GESTURE_PEPPER_ENV_VAR] = "b".repeat(32);
    const after = requireGesturePepper().keyId;

    expect(after).not.toBe(before);
  });

  it("does not leak the secret itself", () => {
    process.env[GESTURE_PEPPER_ENV_VAR] = "z".repeat(40);
    const { keyId, secret } = requireGesturePepper();

    expect(keyId).not.toContain("z");
    expect(keyId).not.toBe(secret.toString("hex"));
  });
});
