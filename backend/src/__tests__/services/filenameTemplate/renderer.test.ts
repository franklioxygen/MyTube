import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock paths before importing modules that use them
vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/mock/videos",
  IMAGES_DIR: "/mock/images",
  SUBTITLES_DIR: "/mock/subtitles",
  AVATARS_DIR: "/mock/avatars",
  DATA_DIR: "/mock/data",
}));

vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: vi.fn().mockReturnValue(false),
  resolveSafeChildPath: vi.fn((base: string, child: string) => `${base}/${child}`),
  ensureDirSafeSync: vi.fn(),
}));

import {
  renderFilenameTemplate,
  planVideoOutputPaths,
} from "../../../services/filenameTemplate/renderer";
import { FilenameTemplateContext } from "../../../services/filenameTemplate/types";

function makeCtx(overrides: Partial<FilenameTemplateContext> = {}): FilenameTemplateContext {
  return {
    title: "My Video",
    id: "abc123",
    ext: "",
    uploader: "Channel Name",
    channel: "Channel Name",
    uploadDate: "20260430",
    uploadYear: "2026",
    uploadMonth: "04",
    uploadDay: "30",
    durationSeconds: 120,
    durationString: "02-00",
    artistName: "Channel Name",
    sourceCustomName: "",
    sourceCollectionName: "Test Playlist",
    sourceCollectionId: "PL123",
    sourceCollectionType: "playlist",
    mediaPlaylistIndex: 3,
    platform: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=abc123",
    ...overrides,
  };
}

describe("renderFilenameTemplate", () => {
  it("renders basic Liquid variables", () => {
    const result = renderFilenameTemplate({
      template: "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}",
      context: makeCtx(),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-Channel Name-2026.mp4");
    expect(result.directory).toBe("");
  });

  it("renders nested subdirectory from alias variable", () => {
    const result = renderFilenameTemplate({
      template: "{{ season_by_year__episode_by_date }}.{{ ext }}",
      context: makeCtx(),
      extension: "mp4",
      mode: "video",
    });
    expect(result.relativePath).toBe("Season 2026/s2026e0430.mp4");
    expect(result.directory).toBe("Season 2026");
    expect(result.basename).toBe("s2026e0430.mp4");
  });

  it("sanitizes illegal characters in variable values", () => {
    const result = renderFilenameTemplate({
      template: "{{ title }}.{{ ext }}",
      context: makeCtx({ title: 'Video: "Special" <chars>/here' }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).not.toMatch(/[:"<>]/);
    expect(result.basename).toContain(".mp4");
  });

  it("replaces / in non-alias variable values with space", () => {
    const result = renderFilenameTemplate({
      template: "{{ uploader }}.{{ ext }}",
      context: makeCtx({ uploader: "A/B Channel" }),
      extension: "mp4",
      mode: "video",
    });
    // / in uploader should be replaced with space, not create subdirectory
    expect(result.directory).toBe("");
    expect(result.basename).toBe("A B Channel.mp4");
  });

  it("throws for unknown variable (validation error)", () => {
    expect(() =>
      renderFilenameTemplate({
        template: "{{ nonexistent }}.{{ ext }}",
        context: makeCtx(),
        extension: "mp4",
        mode: "video",
      })
    ).toThrow(/nonexistent/);
  });

  it("renders yt-dlp style placeholders", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(uploader)s.%(ext)s",
      context: makeCtx(),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-Channel Name.mp4");
  });

  it("throws for traversal in template", () => {
    expect(() =>
      renderFilenameTemplate({
        template: "../sneaky.{{ ext }}",
        context: makeCtx(),
        extension: "mp4",
        mode: "video",
      })
    ).toThrow();
  });
});

describe("planVideoOutputPaths", () => {
  it("legacy preset produces flat structure matching formatVideoFilename pattern", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "legacy" },
      context: makeCtx(),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    // Legacy produces flat filename in VIDEOS_DIR root
    expect(result.video.relativePath).not.toContain("/");
    expect(result.video.webPath.startsWith("/videos/")).toBe(true);
    expect(result.thumbnail.webPath.startsWith("/images/")).toBe(true);
  });

  it("legacy preset is byte-identical to formatVideoFilename (design §23.3)", () => {
    // formatVideoFilename strips punctuation (,!#) and replaces spaces with
    // dots, so the template renderer cannot match its output. Legacy must
    // bypass the renderer.
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "legacy" },
      context: makeCtx({
        title: "Hello, World! Episode #5",
        uploader: "Some Channel",
        uploadDate: "20240115",
      }),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    // formatVideoFilename: removes "," "!" "#" (keeps digit "5"),
    // collapses whitespace, then joins with dots.
    expect(result.video.filename).toBe(
      "Hello.World.Episode.5-Some.Channel-2024.mp4"
    );
    expect(result.thumbnail.filename).toBe(
      "Hello.World.Episode.5-Some.Channel-2024.jpg"
    );
    expect(result.subtitle.baseNameWithoutLanguageOrExt).toBe(
      "Hello.World.Episode.5-Some.Channel-2024"
    );
  });

  it("legacy preset strips a previous -Author-Year suffix from the title (design §24)", () => {
    // Reported regression: a scanned file named "Title-Author-2026.mp4" gets
    // its title set to "Title-Author-2026". After a round-trip through a
    // non-legacy preset and back, re-rendering through legacy used to produce
    // "TitleAuthor2026-Author-2026.mp4". With suffix stripping it stays
    // byte-identical to the original.
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "legacy" },
      context: makeCtx({
        title: "万元房租一分不退维权反被骂-Yajunchannel-2026",
        uploader: "Yajunchannel",
        uploadDate: "20260101",
      }),
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.video.filename).toBe(
      "万元房租一分不退维权反被骂-Yajunchannel-2026.mp4"
    );
  });

  it("legacy preset is byte-identical on round-trip for CJK titles (user's reported case)", () => {
    // The reported user video had a CJK title with no spaces. After a
    // round-trip through a non-legacy preset, the title field can become the
    // previous legacy basename. Without suffix stripping, re-rendering
    // through legacy concatenated the old -Author-Year suffix back into the
    // title and appended a fresh one, producing a garbled name. With the
    // §24 fix, the rename is now byte-identical.
    const ctx = makeCtx({
      title: "万元房租一分不退维权反被骂",
      uploader: "Yajunchannel",
      uploadDate: "20260101",
    });
    const first = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "legacy" },
      context: ctx,
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    // Simulate: "the title field now equals the previous legacy basename".
    const second = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "legacy" },
      context: { ...ctx, title: first.video.basenameWithoutExt },
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(second.video.filename).toBe(first.video.filename);
  });

  it("channel_year_date_index preset produces subdirectory structure", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "channel_year_date_index" },
      context: makeCtx(),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    // Should have a directory part
    expect(result.video.relativePath).toContain("/");
    expect(result.video.webPath).toContain("/videos/");
  });

  it("moveThumbnailsToVideoFolder places thumbnail in video dir", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "channel_year_date_index" },
      context: makeCtx(),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: true,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.thumbnail.webPath.startsWith("/videos/")).toBe(true);
  });

  it("thumbnail has same directory and stem as video", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "channel_year_date_index" },
      context: makeCtx(),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.thumbnail.filename).toBe(
      result.video.basenameWithoutExt + ".jpg"
    );
  });

  it("subtitle basenameWithoutLanguageOrExt matches video stem", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "channel_year_date_index" },
      context: makeCtx(),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.subtitle.baseNameWithoutLanguageOrExt).toBe(
      result.video.basenameWithoutExt
    );
  });

  it("custom preset uses provided template", () => {
    const result = planVideoOutputPaths({
      settings: {
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "{{ uploader }}/{{ title }}.{{ ext }}",
      },
      context: makeCtx(),
      videoExtension: "mp4",
      thumbnailExtension: "jpg",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.video.relativePath).toMatch(/^Channel Name\//);
    expect(result.video.filename).toBe("My Video.mp4");
  });

  it("custom preset falls back to legacy default when template is empty", () => {
    const result = planVideoOutputPaths({
      settings: {
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "",
      },
      context: makeCtx(),
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.video.relativePath).not.toContain("/");
    expect(result.video.filename).toMatch(/\.mp4$/);
  });

  it("unknown preset id falls back to legacy default template", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "unknown_preset" },
      context: makeCtx(),
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.video.filename).toMatch(/\.mp4$/);
  });

  it("subtitleWebDirectory is /subtitles when not moving to video folder", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "channel_year_date_index" },
      context: makeCtx(),
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.subtitle.webDirectory.startsWith("/subtitles")).toBe(true);
  });

  it("subtitleWebDirectory is /videos when moveSubtitlesToVideoFolder is true", () => {
    const result = planVideoOutputPaths({
      settings: { downloadFilenamePresetId: "channel_year_date_index" },
      context: makeCtx(),
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: true,
    });
    expect(result.subtitle.webDirectory.startsWith("/videos")).toBe(true);
  });

  it("flat (non-nested) template gives empty subtitle directory pointing at root", () => {
    const result = planVideoOutputPaths({
      settings: {
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "{{ title }}.{{ ext }}",
      },
      context: makeCtx(),
      videoExtension: "mp4",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    expect(result.subtitle.relativeDirectory).toBe("");
    expect(result.subtitle.webDirectory).toBe("/subtitles");
  });
});

describe("renderFilenameTemplate — yt-dlp placeholders", () => {
  it("renders %(upload_date)s simple lookup", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(upload_date)s.{{ ext }}",
      context: makeCtx({ uploadDate: "20260430" }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-20260430.mp4");
  });

  it("renders %(upload_date>%Y-%m-%d)s with format", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(upload_date>%Y-%m-%d)s.{{ ext }}",
      context: makeCtx({ uploadDate: "20260430" }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-2026-04-30.mp4");
  });

  it("renders %(duration>%H-%M-%S)s with format", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(duration>%H-%M-%S)s.{{ ext }}",
      context: makeCtx({ durationSeconds: 3725 }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-01-02-05.mp4");
  });

  it("renders nested rawInfo dot-path lookup", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(meta.author)s.{{ ext }}",
      context: makeCtx({ rawInfo: { meta: { author: "AuthorX" } } }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-AuthorX.mp4");
  });

  it("renders nested array index lookup with negative index", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(items.-1)s.{{ ext }}",
      context: makeCtx({ rawInfo: { items: ["a", "b", "c"] } }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toBe("My Video-c.mp4");
  });

  it("falls back to Unknown when nested lookup hits __proto__", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(__proto__.toString)s.{{ ext }}",
      context: makeCtx({ rawInfo: {} }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toContain("Unknown");
  });

  it("falls back to Unknown when nested array index is out of bounds", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(items.10)s.{{ ext }}",
      context: makeCtx({ rawInfo: { items: ["a"] } }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toContain("Unknown");
  });

  it("falls back to Unknown when nested array index is non-numeric", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(items.foo)s.{{ ext }}",
      context: makeCtx({ rawInfo: { items: ["a"] } }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toContain("Unknown");
  });

  it("falls back to Unknown when nested object key is not own property", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(meta.toString)s.{{ ext }}",
      context: makeCtx({ rawInfo: { meta: { real: "value" } } }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toContain("Unknown");
  });

  it("renders %(upload_date>...)s as raw value when source is shorter than 8 chars", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(upload_date>%Y-%m-%d)s.{{ ext }}",
      context: makeCtx({ uploadDate: "2026" }),
      extension: "mp4",
      mode: "video",
    });
    // formatDate returns the raw value when length < 8
    expect(result.basename).toContain("2026");
  });

  it("renders duration as 00-00-00 when seconds is missing/zero", () => {
    const result = renderFilenameTemplate({
      template: "%(title)s-%(duration>%H-%M-%S)s.{{ ext }}",
      context: makeCtx({ durationSeconds: undefined }),
      extension: "mp4",
      mode: "video",
    });
    expect(result.basename).toContain("00-00-00");
  });
});

describe("renderFilenameTemplate — sanitization & errors", () => {
  it("converts backslashes to forward slashes in template", () => {
    const result = renderFilenameTemplate({
      template: "{{ uploader }}\\{{ title }}.{{ ext }}",
      context: makeCtx(),
      extension: "mp4",
      mode: "video",
    });
    expect(result.directory).toBe("Channel Name");
  });

  it("strips a leading slash so absolute-style templates still resolve relative", () => {
    const result = renderFilenameTemplate({
      template: "/{{ title }}.{{ ext }}",
      context: makeCtx(),
      extension: "mp4",
      mode: "video",
    });
    expect(result.relativePath).toBe("My Video.mp4");
  });

  it("replaces in-segment slashes from variable values with spaces", () => {
    const result = renderFilenameTemplate({
      template: "{{ title }}.{{ ext }}",
      context: makeCtx({ title: "a/b/c" }),
      extension: "mp4",
      mode: "video",
    });
    // The "/" inside the variable becomes spaces so it cannot create extra dirs
    expect(result.basename).toBe("a b c.mp4");
    expect(result.directory).toBe("");
  });

  it("keeps a long path within the per-segment limit (180 chars per segment)", () => {
    const longTitle = "x".repeat(300);
    const result = renderFilenameTemplate({
      template: "dir/{{ title }}.{{ ext }}",
      context: makeCtx({ title: longTitle }),
      extension: "mp4",
      mode: "video",
    });
    // Each segment is independently sanitized and truncated to <= 180 chars.
    for (const segment of result.relativePath.split("/")) {
      expect(segment.length).toBeLessThanOrEqual(180);
    }
  });
});

describe("resolveAbsoluteDir", () => {
  // Import lazily so the test mocks above are applied first
  it("returns VIDEOS_DIR for video mode with empty relativeDir", async () => {
    const { resolveAbsoluteDir } = await import(
      "../../../services/filenameTemplate/renderer"
    );
    expect(resolveAbsoluteDir("", "video", false, false)).toBe("/mock/videos");
  });

  it("returns IMAGES_DIR for thumbnail mode without moveToVideo", async () => {
    const { resolveAbsoluteDir } = await import(
      "../../../services/filenameTemplate/renderer"
    );
    expect(resolveAbsoluteDir("", "thumbnail", false, false)).toBe(
      "/mock/images"
    );
  });

  it("returns VIDEOS_DIR for thumbnail mode with moveToVideo=true", async () => {
    const { resolveAbsoluteDir } = await import(
      "../../../services/filenameTemplate/renderer"
    );
    expect(resolveAbsoluteDir("", "thumbnail", true, false)).toBe(
      "/mock/videos"
    );
  });

  it("returns SUBTITLES_DIR for subtitle mode without moveToVideo", async () => {
    const { resolveAbsoluteDir } = await import(
      "../../../services/filenameTemplate/renderer"
    );
    expect(resolveAbsoluteDir("", "subtitle", false, false)).toBe(
      "/mock/subtitles"
    );
  });

  it("returns VIDEOS_DIR for subtitle mode with moveSubtitlesToVideoFolder=true", async () => {
    const { resolveAbsoluteDir } = await import(
      "../../../services/filenameTemplate/renderer"
    );
    expect(resolveAbsoluteDir("", "subtitle", false, true)).toBe(
      "/mock/videos"
    );
  });

  it("joins relative directory under the chosen base for video mode", async () => {
    const { resolveAbsoluteDir } = await import(
      "../../../services/filenameTemplate/renderer"
    );
    expect(resolveAbsoluteDir("Channel/Season 1", "video", false, false)).toBe(
      "/mock/videos/Channel/Season 1"
    );
  });
});
