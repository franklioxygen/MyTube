import { describe, expect, it } from "vitest";
import { sameVideo, videoIdentity, youtubeVideoId } from "../../utils/videoIdentity";

describe("YouTube video identity", () => {
  it.each([
    "https://www.youtube.com/watch?v=Ab_cd-12345",
    "https://m.youtube.com/watch?feature=share&v=Ab_cd-12345&t=30",
    "https://www.youtube.com/shorts/Ab_cd-12345?si=share",
    "https://youtu.be/Ab_cd-12345?si=share",
    "https://youtube.com/live/Ab_cd-12345",
    "https://www.youtube.com/embed/Ab_cd-12345",
  ])("matches aliases without changing the original URL: %s", url => {
    expect(youtubeVideoId(url)).toBe("Ab_cd-12345");
    expect(sameVideo(url, "https://www.youtube.com/shorts/Ab_cd-12345")).toBe(true);
  });

  it.each([
    "https://youtube.com.evil.test/watch?v=Ab_cd-12345",
    "https://example.com/?v=Ab_cd-12345",
    "https://www.youtube.com/playlist?list=Ab_cd-12345",
    "https://www.youtube.com/@Ab_cd-12345/shorts",
    "https://www.youtube.com/watch?v=",
    "not a URL",
  ])("keeps unrelated URLs distinct: %s", url => {
    expect(youtubeVideoId(url)).toBeUndefined();
    expect(videoIdentity(url)).toBe(`url:${url}`);
  });

  it("distinguishes missing cursors and case-sensitive video IDs", () => {
    expect(sameVideo("https://youtu.be/AbC", "https://youtu.be/abc")).toBe(false);
    expect(sameVideo("https://youtu.be/AbC", null)).toBe(false);
    expect(sameVideo("other-platform-url", "other-platform-url")).toBe(true);
  });
});
