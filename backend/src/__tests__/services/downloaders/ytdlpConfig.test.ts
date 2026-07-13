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

import {
  inferAudioFormatFromUserConfig,
  isAudioOnlyUserConfig,
  prepareAudioDownloadFlags,
  prepareDownloadFlags,
  resolveDownloadAudioMode,
} from "../../../services/downloaders/ytdlp/ytdlpConfig";

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

  it("prepares an audio-only flag set without video mux or subtitle flags", () => {
    const result = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      { proxy: "http://proxy.example" },
    );

    expect(result.audioExtension).toBe("m4a");
    expect(result.flags).toMatchObject({
      format: "bestaudio/best",
      extractAudio: true,
      audioFormat: "m4a",
      audioQuality: 0,
      noPlaylist: true,
      proxy: "http://proxy.example",
    });
    expect(result.flags.mergeOutputFormat).toBeUndefined();
    expect(result.flags.writeSubs).toBeUndefined();
  });

  it("preserves an explicit audio-only format selector instead of forcing bestaudio/best", () => {
    const worst = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      { format: "worstaudio" },
    );
    expect(worst.flags.format).toBe("worstaudio");

    const wa = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      { f: "wa" },
    );
    expect(wa.flags.format).toBe("wa");

    const filtered = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      { format: "bestaudio[abr<=64]" },
    );
    expect(filtered.flags.format).toBe("bestaudio[abr<=64]");
  });

  it("falls back to bestaudio/best when the audio job has no audio-only selector", () => {
    // Explicit audio toggle with a video-oriented format: the user's selector
    // must not leak into the audio branch.
    const result = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      { format: "bestvideo+bestaudio" },
    );
    expect(result.flags.format).toBe("bestaudio/best");

    const noFormat = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      { extractAudio: true } as any,
    );
    expect(noFormat.flags.format).toBe("bestaudio/best");
  });

  it("preserves auth-related safe user config for audio jobs while stripping video/subtitle/mux options", () => {
    const result = prepareAudioDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/track.m4a",
      "m4a",
      {
        cookies: "/cookies.txt",
        cookiesFromBrowser: "firefox",
        addHeaders: "Referer:https://example.com",
        extractorArgs: "youtube:player_client=web",
        proxy: "http://proxy.example",
        // These must not leak into the audio branch.
        format: "bestvideo+bestaudio",
        mergeOutputFormat: "mkv",
        writeSubs: true,
        subLangs: "en",
      } as any,
    );

    // Auth/network config is preserved.
    expect(result.flags).toMatchObject({
      cookies: "/cookies.txt",
      cookiesFromBrowser: "firefox",
      addHeaders: "Referer:https://example.com",
      extractorArgs: "youtube:player_client=web",
      proxy: "http://proxy.example",
    });
    // Audio selectors win; video/subtitle/mux options are stripped.
    expect(result.flags.format).toBe("bestaudio/best");
    expect(result.flags.mergeOutputFormat).toBeUndefined();
    expect(result.flags.writeSubs).toBeUndefined();
    expect(result.flags.subLangs).toBeUndefined();
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

  it("preserves the audio-language filter when forcing MP4 over a VP9 codec", () => {
    mockGetSettings.mockReturnValue({
      preferredAudioLanguage: "en",
      defaultVideoCodec: "vp9",
      preferredVideoContainer: "mp4",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      {},
    );

    expect(result.flags.format).toContain("language=en");
    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.format).not.toContain("ext=webm");
    expect(result.flags.format).not.toContain("vcodec^=vp9");
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

  it("combines H.264 preference with a user resolution format sort", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "h264",
      preferredVideoContainer: "auto",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      { S: "res:2160" },
    );

    expect(result.flags.formatSort).toBe("vcodec:h264,res:2160");
    expect(result.flags.format).toContain("vcodec^=avc1");
    expect(result.flags.format).toContain("ext=mp4");
    expect(result.flags.format).toContain("ext=m4a");
    expect(result.flags.mergeOutputFormat).toBe("mp4");
    expect(result.mergeOutputFormat).toBe("mp4");
    expect(result.videoExtension).toBe("mp4");
  });

  it("preserves a user codec sort over the default codec preset", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "h264",
      preferredVideoContainer: "auto",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      { S: "vcodec:vp9" },
    );

    // The user's explicit codec sort must win: no app codec prepended and the
    // h264 preset selector (which leads with ext=mp4][vcodec^=avc1) must not
    // replace the format.
    expect(result.flags.formatSort).toBe("vcodec:vp9");
    expect(result.flags.format?.startsWith("bestvideo[vcodec^=vp9]")).toBe(true);
  });

  it("preserves a user codec sort combined with a resolution sort", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "h264",
      preferredVideoContainer: "auto",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      { S: "res:1080,vcodec:vp9" },
    );

    expect(result.flags.formatSort).toBe("res:1080,vcodec:vp9");
    expect(result.flags.format?.startsWith("bestvideo[vcodec^=vp9]")).toBe(true);
  });

  it("preserves a user container (ext) sort over the default codec preset", () => {
    mockGetSettings.mockReturnValue({
      defaultVideoCodec: "h264",
      preferredVideoContainer: "auto",
    });

    const result = prepareDownloadFlags(
      "https://www.youtube.com/watch?v=abc123",
      "/tmp/video.mp4",
      { S: "ext:webm" },
    );

    expect(result.flags.formatSort).toBe("ext:webm");
    expect(result.flags.format?.startsWith("bestvideo[vcodec^=vp9]")).toBe(true);
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

describe("audio-only user config detection (issue #345)", () => {
  it("detects bestaudio format overrides", () => {
    expect(isAudioOnlyUserConfig({ format: "bestaudio" })).toBe(true);
    expect(isAudioOnlyUserConfig({ f: "bestaudio/best" })).toBe(true);
    expect(isAudioOnlyUserConfig({ format: "bestaudio[ext=opus]" })).toBe(
      true,
    );
  });

  it("rejects mixed video+audio format selectors", () => {
    expect(
      isAudioOnlyUserConfig({ format: "bestvideo+bestaudio" }),
    ).toBe(false);
    expect(
      isAudioOnlyUserConfig({
        format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]",
      }),
    ).toBe(false);
  });

  it("detects exact yt-dlp audio-only aliases (ba/wa) and vcodec=none", () => {
    expect(isAudioOnlyUserConfig({ f: "ba" })).toBe(true);
    expect(isAudioOnlyUserConfig({ f: "wa" })).toBe(true);
    expect(isAudioOnlyUserConfig({ format: "ba/best" })).toBe(true);
    expect(isAudioOnlyUserConfig({ format: "worstaudio" })).toBe(true);
    expect(isAudioOnlyUserConfig({ format: "best[vcodec=none]" })).toBe(true);
    expect(isAudioOnlyUserConfig({ format: "vcodec=none" })).toBe(true);
  });

  it("does not classify possibly-video selectors as audio-only", () => {
    // ba*/wa* may contain video per yt-dlp docs, so they are not audio-only.
    expect(isAudioOnlyUserConfig({ format: "ba*" })).toBe(false);
    expect(isAudioOnlyUserConfig({ format: "wa*" })).toBe(false);
    // Negated video-codec filter selects video-containing formats.
    expect(isAudioOnlyUserConfig({ format: "best[vcodec!=none]" })).toBe(false);
  });

  it("does not treat video-only aliases or unrelated tokens as audio-only", () => {
    expect(isAudioOnlyUserConfig({ f: "bv" })).toBe(false);
    expect(isAudioOnlyUserConfig({ f: "bv*+ba" })).toBe(false);
    expect(isAudioOnlyUserConfig({ format: "worstvideo" })).toBe(false);
    // Words containing "ba"/"wa" substrings must not match.
    expect(isAudioOnlyUserConfig({ format: "bar" })).toBe(false);
    // acodec=none selects a video-only stream.
    expect(isAudioOnlyUserConfig({ format: "best[acodec=none]" })).toBe(false);
  });

  it("detects extract-audio flags", () => {
    expect(isAudioOnlyUserConfig({ extractAudio: true })).toBe(true);
    expect(isAudioOnlyUserConfig({ x: true })).toBe(true);
  });

  it("infers audio format from override text", () => {
    expect(
      inferAudioFormatFromUserConfig({ format: "bestaudio[ext=opus]" }),
    ).toBe("opus");
    expect(inferAudioFormatFromUserConfig({ audioFormat: "mp3" })).toBe(
      "mp3",
    );
    expect(inferAudioFormatFromUserConfig({ format: "bestaudio" })).toBe(
      "m4a",
    );
  });

  it("resolves explicit audio mode over config inference", () => {
    expect(
      resolveDownloadAudioMode({
        explicitAudioOnly: true,
        explicitAudioFormat: "mp3",
        userConfig: { format: "bestvideo+bestaudio" },
      }),
    ).toEqual({ audioOnly: true, audioFormat: "mp3" });
  });

  it("infers audio mode from subscription-style bestaudio override", () => {
    expect(
      resolveDownloadAudioMode({
        userConfig: { format: "bestaudio" },
      }),
    ).toEqual({ audioOnly: true, audioFormat: "m4a" });
  });
});
