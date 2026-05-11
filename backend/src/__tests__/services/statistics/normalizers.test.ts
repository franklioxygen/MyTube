import { describe, expect, it } from "vitest";
import {
  bucketDownloadError,
  parseDurationSeconds,
  platformFromUrl,
} from "../../../services/statistics/normalizers";

describe("statistics normalizers", () => {
  it("classifies allowlisted hosts without substring spoofing", () => {
    expect(platformFromUrl("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(platformFromUrl("https://youtu.be/abc")).toBe("youtube");
    expect(platformFromUrl("https://youtube.com.evil.test/watch?v=abc")).toBe(
      "unknown"
    );
    expect(platformFromUrl("https://foo.bilibili.com/video/1")).toBe("bilibili");
    expect(platformFromUrl("https://evil.test/?next=youtube.com")).toBe("unknown");
    expect(platformFromUrl("https://b23.tv/abc")).toBe("bilibili");
    expect(platformFromUrl("missav.ai/watch/abc")).toBe("missav");
    expect(platformFromUrl("https://cdn.missav.live/watch/abc")).toBe("missav");
  });

  it("classifies download failures into stable buckets", () => {
    expect(bucketDownloadError("Login required: cookies missing")).toBe("auth_required");
    expect(bucketDownloadError("Video unavailable (404)")).toBe("source_unavailable");
    expect(bucketDownloadError("Connection reset by peer")).toBe("geo_or_network_blocked");
    expect(bucketDownloadError("Unable to extract player config")).toBe(
      "extractor_changed"
    );
    expect(bucketDownloadError("ENOSPC: no space left on device")).toBe(
      "filesystem_error"
    );
    expect(bucketDownloadError("Cloud upload failed while syncing")).toBe(
      "cloud_upload_failed"
    );
    expect(bucketDownloadError("Something unexpected happened")).toBe("unknown");
  });

  it("parses supported duration formats", () => {
    expect(parseDurationSeconds("75")).toBe(75);
    expect(parseDurationSeconds("PT1H2M3.5S")).toBe(3724);
    expect(parseDurationSeconds("01:02:03")).toBe(3723);
    expect(parseDurationSeconds("12:34")).toBe(754);
    expect(parseDurationSeconds("1h2m3s")).toBe(3723);
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds("n/a")).toBeNull();
  });
});
