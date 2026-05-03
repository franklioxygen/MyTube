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
});
