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
