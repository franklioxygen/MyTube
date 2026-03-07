import { describe, expect, it } from "vitest";
import { ValidationError } from "../../errors/DownloadErrors";
import {
  convertYtDlpSafeConfigToFlags,
  deriveYtDlpSafeConfigFromLegacyText,
  normalizeYtDlpSafeConfig,
  parseLegacyYtDlpConfigText,
} from "../../utils/ytDlpSafeConfig";

describe("ytDlpSafeConfig", () => {
  it("parses legacy text options into key-value map", () => {
    const parsed = parseLegacyYtDlpConfigText(
      "--proxy http://127.0.0.1:7890\n-S res:1080\n--merge-output-format webm\n-4"
    );

    expect(parsed).toEqual({
      proxy: "http://127.0.0.1:7890",
      S: "res:1080",
      mergeOutputFormat: "webm",
      "4": true,
    });
  });

  it("normalizes valid structured config and rejects invalid option values", () => {
    const normalized = normalizeYtDlpSafeConfig({
      maxResolution: 1080,
      mergeOutputFormat: "webm",
      retries: 3,
      forceIpVersion: "ipv4",
      proxy: "http://127.0.0.1:7890",
    });

    expect(normalized.config).toEqual({
      maxResolution: 1080,
      mergeOutputFormat: "webm",
      retries: 3,
      forceIpVersion: "ipv4",
      proxy: "http://127.0.0.1:7890",
    });
    expect(normalized.rejectedOptions).toEqual([]);
  });

  it("throws for unsupported structured keys in strict validation mode", () => {
    expect(() =>
      normalizeYtDlpSafeConfig({
        maxResolution: 1080,
        exec: "echo hacked",
      })
    ).toThrow(ValidationError);
  });

  it("derives allowlisted structured config from legacy text and reports rejected options", () => {
    const derived = deriveYtDlpSafeConfigFromLegacyText(
      "--proxy http://127.0.0.1:7890\n-S res:1080,vcodec:h264\n--exec echo hacked"
    );

    expect(derived.config).toEqual({
      proxy: "http://127.0.0.1:7890",
      maxResolution: 1080,
    });
    expect(derived.rejectedOptions).toEqual(
      expect.arrayContaining(["exec", "formatSort:vcodec:h264"])
    );
  });

  it("converts structured config to yt-dlp flags", () => {
    const flags = convertYtDlpSafeConfigToFlags({
      maxResolution: 720,
      mergeOutputFormat: "mp4",
      limitRate: "2M",
      retries: 4,
      forceIpVersion: "ipv6",
    });

    expect(flags).toEqual({
      formatSort: "res:720",
      mergeOutputFormat: "mp4",
      limitRate: "2M",
      retries: 4,
      forceIpv6: true,
    });
  });
});
