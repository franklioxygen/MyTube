import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSettings = vi.fn();

vi.mock("../../../services/storageService", () => ({
  getSettings: () => mockGetSettings(),
}));

vi.mock("../../../utils/ytDlpUtils", () => ({
  getUserYtDlpConfig: vi.fn(() => ({})),
}));

vi.mock("../../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: () => null,
}));

import { prepareDownloadFlags } from "../../../services/downloaders/ytdlp/ytdlpConfig";

describe("prepareDownloadFlags final container preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({});
  });

  it("keeps existing YouTube auto merge behavior when no container is configured", () => {
    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.mergeOutputFormat).toBe("webm/mp4");
    expect(result.mergeOutputFormat).toBe("webm/mp4");
    expect(result.videoExtension).toBe("webm");
  });

  it("switches the default YouTube WebM-first selector to MP4 when forcing MP4", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "mp4",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).not.toContain("ext=webm");
    expect(result.flags.format).not.toContain("vp9");
    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("switches a VP9 codec selector to MP4 when forcing MP4", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "vp9",
      preferredVideoContainer: "mp4",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).not.toContain("vcodec^=vp9");
    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("keeps a user-specified WebM-first format even when forcing MP4", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "mp4",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      { format: "bestvideo[ext=webm]+bestaudio[ext=webm]" },
    );

    expect(result.flags.format).toBe(
      "bestvideo[ext=webm]+bestaudio[ext=webm]",
    );
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
  });

  it("uses the preferred final container after codec selection", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "vp9",
      preferredVideoContainer: "mkv",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.formatSort).toBe("vcodec:vp9");
    expect(result.flags.format).toContain("vcodec^=vp9");
    expect(result.flags.mergeOutputFormat).toBe("mkv");
    expect(result.mergeOutputFormat).toBe("mkv");
    expect(result.videoExtension).toBe("mkv");
  });

  it("keeps app WebM preference for the default YouTube WebM-first format", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).toContain("ext=webm");
    expect(result.flags.mergeOutputFormat).toBe("webm");
    expect(result.mergeOutputFormat).toBe("webm");
    expect(result.videoExtension).toBe("webm");
  });

  it("does not force app WebM preference onto Twitter MP4/M4A selections", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://twitter.com/example/status/123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.format).toContain("ext=m4a");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("does not force app WebM preference onto Twitch generic HLS selections", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://www.twitch.tv/videos/123456789",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).toContain("bestvideo");
    expect(result.flags.format).not.toContain("ext=webm");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("does not force app WebM preference onto direct HLS manifest selections", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://stream.example.com/live/master.m3u8?token=abc",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).toContain("bestvideo");
    expect(result.flags.format).not.toContain("ext=webm");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("keeps app WebM preference for non-HLS generic downloads", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://video.example.com/watch/123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.mergeOutputFormat).toBe("webm");
    expect(result.mergeOutputFormat).toBe("webm");
    expect(result.videoExtension).toBe("webm");
  });

  it("preserves explicit WebM mergeOutputFormat for Twitch downloads", () => {
    mockGetSettings.mockReturnValue({
      preferredVideoContainer: "mp4",
    });

    const result = prepareDownloadFlags(
      "https://www.twitch.tv/videos/123456789",
      "/tmp/video.mp4",
      { mergeOutputFormat: "webm" },
    );

    expect(result.flags.mergeOutputFormat).toBe("webm");
    expect(result.mergeOutputFormat).toBe("webm");
    expect(result.videoExtension).toBe("webm");
  });

  it("does not force app WebM preference onto H.264 MP4/M4A selections", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "h264",
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.formatSort).toBe("vcodec:h264");
    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.format).toContain("ext=m4a");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("does not force app WebM preference onto preferred-language MP4/M4A selections", () => {
    mockGetSettings.mockReturnValue({
      preferredAudioLanguage: "en",
      preferredVideoContainer: "webm",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).toContain("language=en");
    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.format).toContain("ext=m4a");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("preserves user yt-dlp mergeOutputFormat over app container and codec preferences", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "vp9",
      preferredVideoContainer: "mkv",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      { mergeOutputFormat: "mp4" },
    );

    expect(result.flags.formatSort).toBe("vcodec:vp9");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });
});
