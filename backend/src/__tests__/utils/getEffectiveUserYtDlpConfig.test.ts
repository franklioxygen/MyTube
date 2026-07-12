import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storageService from "../../services/storageService";
import { getEffectiveUserYtDlpConfig } from "../../utils/ytdlp/config";

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));

const mockedGetSettings = vi.mocked(storageService.getSettings);

describe("getEffectiveUserYtDlpConfig (issue #345)", () => {
  const originalTrust = process.env.MYTUBE_ADMIN_TRUST_LEVEL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default deployment trust is "container"; make it explicit for the tests.
    process.env.MYTUBE_ADMIN_TRUST_LEVEL = "container";
    mockedGetSettings.mockReturnValue({
      ytDlpConfig: "--proxy http://global-proxy:8080",
    } as any);
  });

  afterEach(() => {
    if (originalTrust === undefined) {
      delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
    } else {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrust;
    }
  });

  it("returns exactly the global config when no override is provided", () => {
    const effective = getEffectiveUserYtDlpConfig("https://example.com/v");
    expect(effective).toEqual({ proxy: "http://global-proxy:8080" });
  });

  it("returns exactly the global config for an empty/whitespace override", () => {
    expect(getEffectiveUserYtDlpConfig("https://example.com/v", "")).toEqual({
      proxy: "http://global-proxy:8080",
    });
    expect(
      getEffectiveUserYtDlpConfig("https://example.com/v", "   \n  ")
    ).toEqual({ proxy: "http://global-proxy:8080" });
  });

  it("merges the override on top of the global config (override wins per-key)", () => {
    const effective = getEffectiveUserYtDlpConfig(
      "https://example.com/v",
      "--format bestaudio"
    );
    // Override supplies format; proxy is inherited from the global config.
    expect(effective).toEqual({
      proxy: "http://global-proxy:8080",
      format: "bestaudio",
    });
  });

  it("lets a long-form override replace the same long-form global key", () => {
    mockedGetSettings.mockReturnValue({
      ytDlpConfig: "--format bestvideo+bestaudio",
    } as any);
    const effective = getEffectiveUserYtDlpConfig(
      "https://example.com/v",
      "--format bestaudio"
    );
    expect(effective.format).toBe("bestaudio");
  });

  it("lets a short-form override supersede a long-form global format (alias)", () => {
    mockedGetSettings.mockReturnValue({
      ytDlpConfig: "--format bestvideo+bestaudio",
    } as any);
    const effective = getEffectiveUserYtDlpConfig(
      "https://example.com/v",
      "-f bestaudio"
    );
    // The override's `-f` (key `f`) wins and the global `format` is dropped so
    // no competing format key survives.
    expect(effective.f).toBe("bestaudio");
    expect(effective.format).toBeUndefined();
  });

  it("ignores the override entirely below 'container' trust", () => {
    process.env.MYTUBE_ADMIN_TRUST_LEVEL = "application";
    const effective = getEffectiveUserYtDlpConfig(
      "https://example.com/v",
      "--format bestaudio"
    );
    // Below container trust the global config also returns {}, so no format leaks.
    expect(effective).toEqual({});
    expect(effective.format).toBeUndefined();
  });
});
