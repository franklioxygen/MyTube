import { describe, expect, it } from "vitest";
import { platformFromUrl } from "../../../services/statistics/normalizers";

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
});
