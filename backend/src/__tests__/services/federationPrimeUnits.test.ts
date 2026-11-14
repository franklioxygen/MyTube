import crypto from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "../../config/paths";
import {
  decryptCredential,
  encryptCredential,
  FEDERATION_KEY_ENV_VAR,
  FEDERATION_KEY_FILENAME,
  resetCredentialKeyCacheForTests,
} from "../../services/federation/credentialVault";
import {
  PeerDestinationError,
  resolvePeerDestination,
  type HostResolver,
} from "../../services/federation/peerDestination";

const CREDENTIAL = `${"a".repeat(16)}.${"b".repeat(43)}`;
const keyFile = () => path.join(DATA_DIR, FEDERATION_KEY_FILENAME);

describe("credential vault", () => {
  beforeEach(() => {
    delete process.env[FEDERATION_KEY_ENV_VAR];
    fs.rmSync(keyFile(), { force: true });
    resetCredentialKeyCacheForTests();
  });
  afterEach(() => {
    delete process.env[FEDERATION_KEY_ENV_VAR];
    resetCredentialKeyCacheForTests();
  });

  it("round-trips without storing the plaintext", () => {
    const stored = encryptCredential(CREDENTIAL);
    expect(stored).not.toContain(CREDENTIAL);
    expect(decryptCredential(stored)).toBe(CREDENTIAL);
    // A fresh IV each time.
    expect(encryptCredential(CREDENTIAL)).not.toBe(stored);
  });

  it("creates the key file once, readable only by its owner, outside the database", () => {
    encryptCredential(CREDENTIAL);
    const firstKey = fs.readFileSync(keyFile(), "utf8");
    if (process.platform !== "win32") {
      expect(fs.statSync(keyFile()).mode & 0o777).toBe(0o600);
    }
    resetCredentialKeyCacheForTests();
    encryptCredential(CREDENTIAL);
    expect(fs.readFileSync(keyFile(), "utf8")).toBe(firstKey);
  });

  it("does not create a key just to read", () => {
    expect(decryptCredential("v1.x.y.z.w")).toBeNull();
    expect(fs.existsSync(keyFile())).toBe(false);
  });

  it("returns null when the key is lost, replaced, or the ciphertext altered", () => {
    const stored = encryptCredential(CREDENTIAL);

    const parts = stored.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(decryptCredential(parts.join("."))).toBeNull();

    fs.rmSync(keyFile());
    resetCredentialKeyCacheForTests();
    expect(decryptCredential(stored)).toBeNull();

    process.env[FEDERATION_KEY_ENV_VAR] = crypto.randomBytes(32).toString("base64url");
    resetCredentialKeyCacheForTests();
    expect(decryptCredential(stored)).toBeNull();
  });

  it("prefers a configured key and refuses a malformed one", () => {
    process.env[FEDERATION_KEY_ENV_VAR] = crypto.randomBytes(32).toString("base64url");
    expect(decryptCredential(encryptCredential(CREDENTIAL))).toBe(CREDENTIAL);
    expect(fs.existsSync(keyFile())).toBe(false);

    process.env[FEDERATION_KEY_ENV_VAR] = "too-short";
    resetCredentialKeyCacheForTests();
    expect(() => encryptCredential(CREDENTIAL)).toThrow(/32 base64url-encoded bytes/);
  });
});

describe("peer destination policy", () => {
  const resolver =
    (answers: Record<string, string[]>): HostResolver =>
    async (host) => {
      if (!(host in answers)) throw new Error("ENOTFOUND");
      return answers[host];
    };

  it("treats a private-network host as a LAN exception and keeps its base path", async () => {
    await expect(resolvePeerDestination("http://192.168.1.20:5551/mytube/")).resolves.toEqual({
      baseUrl: "http://192.168.1.20:5551/mytube",
      lanOrigin: "http://192.168.1.20:5551",
    });
    await expect(
      resolvePeerDestination("http://nas.local:5551", resolver({ "nas.local": ["10.0.0.5", "fd00::5"] }))
    ).resolves.toEqual({ baseUrl: "http://nas.local:5551", lanOrigin: "http://nas.local:5551" });
  });

  it("requires https for public peers and trusts no origin for them", async () => {
    await expect(
      resolvePeerDestination("https://media.example.com", resolver({ "media.example.com": ["93.184.216.34"] }))
    ).resolves.toEqual({ baseUrl: "https://media.example.com", lanOrigin: null });

    await expect(resolvePeerDestination("http://93.184.216.34")).rejects.toThrow(/must use https/);
  });

  it.each([
    ["embedded credentials", "https://user:pw@192.168.1.2"],
    ["a query", "http://192.168.1.2/?x=1"],
    ["a fragment", "http://192.168.1.2/#x"],
    ["another scheme", "ftp://192.168.1.2"],
    ["garbage", "not a url"],
  ])("rejects %s", async (_name, input) => {
    await expect(resolvePeerDestination(input)).rejects.toBeInstanceOf(PeerDestinationError);
  });

  it("rejects hosts that resolve to both public and private addresses, or not at all", async () => {
    await expect(
      resolvePeerDestination("https://mixed.example", resolver({ "mixed.example": ["93.184.216.34", "10.0.0.1"] }))
    ).rejects.toThrow(/both public and private/);
    await expect(resolvePeerDestination("https://missing.example", resolver({}))).rejects.toThrow(/could not be resolved/);
  });

  it.each(["64:ff9b::5db8:d822", "2002:5db8:d822::1", "198.18.0.1"])(
    "refuses a host at %s, which is neither public nor a LAN", async (address) => {
      await expect(
        resolvePeerDestination("http://nas.example", resolver({ "nas.example": [address] }))
      ).rejects.toThrow(/neither public nor private/);
    }
  );
});
