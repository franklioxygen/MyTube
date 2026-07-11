import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external collaborators so the planner's branching/dedup logic is
// exercised in isolation, with the filesystem probes fully controlled.
vi.mock("../../../../config/paths", () => ({
  VIDEOS_DIR: "/tmp/videos",
  IMAGES_DIR: "/tmp/images",
  SUBTITLES_DIR: "/tmp/subtitles",
  DATA_DIR: "/tmp/data",
}));
vi.mock("../../../../utils/security", () => ({
  pathExistsSafeSync: vi.fn().mockReturnValue(false),
  resolveSafeChildPath: vi.fn((dir: string, rel: string) => `${dir}/${rel}`),
}));
vi.mock("../../../../utils/helpers", () => ({
  formatVideoFilename: vi.fn(
    (title: string, author: string, date: string) => `${title}-${author}-${date}`
  ),
}));
vi.mock("../../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../../services/filenameTemplate/contextBuilder", () => ({
  buildContextFromYtDlpInfo: vi.fn(() => ({ context: true })),
}));
vi.mock("../../../../services/filenameTemplate/renderer", () => ({
  planVideoOutputPaths: vi.fn(),
}));
vi.mock("../../../../services/filenameTemplate/dedupe", () => ({
  dedupeRelativePath: vi.fn((rel: string) => rel),
}));
vi.mock("../../../../services/filenameTemplate/sourceOptions", () => ({
  enrichSourceOptionsForDownload: vi.fn((opts: unknown) => opts),
}));
vi.mock(
  "../../../../services/downloaders/ytdlp/ytdlpVideoHelpers",
  () => ({
    pathExistsWithAnyKnownMediaExtension: vi.fn().mockReturnValue(false),
    stripTrailingExtension: vi.fn((value: string, ext: string) =>
      ext && value.endsWith(ext) ? value.slice(0, -ext.length) : value
    ),
  })
);

import { planDownloadPaths } from "../../../../services/downloaders/ytdlp/downloadPathPlanner";
import { dedupeRelativePath } from "../../../../services/filenameTemplate/dedupe";
import { planVideoOutputPaths } from "../../../../services/filenameTemplate/renderer";
import { pathExistsSafeSync } from "../../../../utils/security";
import { pathExistsWithAnyKnownMediaExtension } from "../../../../services/downloaders/ytdlp/ytdlpVideoHelpers";

const baseArgs = {
  videoUrl: "https://youtube.com/watch?v=abc",
  info: { uploader: "Uploader" },
  filenameTemplateSourceOptions: undefined,
  videoTitle: "Title",
  videoAuthor: "Author",
  videoDate: "20240101",
  videoExtension: "mp4",
  moveThumbnailsToVideoFolder: false,
  moveSubtitlesToVideoFolder: false,
};

describe("planDownloadPaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pathExistsSafeSync).mockReturnValue(false);
    vi.mocked(pathExistsWithAnyKnownMediaExtension).mockReturnValue(false);
    vi.mocked(dedupeRelativePath).mockImplementation((rel: string) => rel);
  });

  describe("legacy preset", () => {
    const legacySettings = { downloadFilenamePresetId: "legacy" };

    it("names files Title-Author-Year with the thumbnail in the images dir", () => {
      const planned = planDownloadPaths({
        ...baseArgs,
        settings: legacySettings,
      });

      expect(planned).toEqual({
        videoAbsolutePath: "/tmp/videos/Title-Author-20240101.mp4",
        videoFilename: "Title-Author-20240101.mp4",
        thumbnailAbsolutePath: "/tmp/images/Title-Author-20240101.jpg",
        thumbnailFilename: "Title-Author-20240101.jpg",
        safeBaseFilename: "Title-Author-20240101",
      });
    });

    it("places the thumbnail next to the video when the setting is on", () => {
      const planned = planDownloadPaths({
        ...baseArgs,
        settings: legacySettings,
        moveThumbnailsToVideoFolder: true,
      });

      expect(planned.thumbnailAbsolutePath).toBe(
        "/tmp/videos/Title-Author-20240101.jpg"
      );
    });

    it("appends a collision counter when the target already exists", () => {
      vi.mocked(pathExistsSafeSync).mockReturnValue(true);
      // _1 is also taken; _2 is free.
      vi.mocked(pathExistsWithAnyKnownMediaExtension).mockImplementation(
        (candidate: string) => candidate.endsWith("_1")
      );

      const planned = planDownloadPaths({
        ...baseArgs,
        settings: legacySettings,
      });

      expect(planned.videoAbsolutePath).toBe(
        "/tmp/videos/Title-Author-20240101_2.mp4"
      );
      expect(planned.videoFilename).toBe("Title-Author-20240101_2.mp4");
      expect(planned.thumbnailFilename).toBe("Title-Author-20240101_2.jpg");
      // The cleanup/subtitle stem carries the collision counter, matching the
      // template branch. An un-suffixed stem let cancel-time cleanup delete
      // the pre-existing video (exact-stem artifact match) and let subtitle
      // processing overwrite the original's subtitle files.
      expect(planned.safeBaseFilename).toBe("Title-Author-20240101_2");
    });

    it("treats a missing preset id as legacy", () => {
      const planned = planDownloadPaths({
        ...baseArgs,
        settings: {},
      });

      expect(planned.videoFilename).toBe("Title-Author-20240101.mp4");
      expect(vi.mocked(planVideoOutputPaths)).not.toHaveBeenCalled();
    });
  });

  describe("template preset", () => {
    const templateSettings = { downloadFilenamePresetId: "custom" };

    const primePlanner = () => {
      vi.mocked(planVideoOutputPaths).mockReturnValue({
        video: {
          relativePath: "Show/S01E01.mp4",
          basenameWithoutExt: "S01E01",
        },
        thumbnail: {
          relativePath: "Show/S01E01.jpg",
          filename: "S01E01.jpg",
        },
      } as any);
    };

    it("uses the planned template paths when nothing collides", () => {
      primePlanner();

      const planned = planDownloadPaths({
        ...baseArgs,
        settings: templateSettings,
      });

      expect(planned).toEqual({
        videoAbsolutePath: "/tmp/videos/Show/S01E01.mp4",
        videoFilename: "S01E01.mp4",
        thumbnailAbsolutePath: "/tmp/images/Show/S01E01.jpg",
        thumbnailFilename: "S01E01.jpg",
        safeBaseFilename: "S01E01",
      });
      expect(vi.mocked(planVideoOutputPaths)).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: templateSettings,
          videoExtension: "mp4",
          thumbnailExtension: "jpg",
        })
      );
    });

    it("carries a dedupe stem suffix into every derived name", () => {
      primePlanner();
      vi.mocked(dedupeRelativePath).mockReturnValue("Show/S01E01_1.mp4");

      const planned = planDownloadPaths({
        ...baseArgs,
        settings: templateSettings,
      });

      expect(planned.videoAbsolutePath).toBe("/tmp/videos/Show/S01E01_1.mp4");
      expect(planned.videoFilename).toBe("S01E01_1.mp4");
      expect(planned.thumbnailFilename).toBe("S01E01_1.jpg");
      expect(planned.thumbnailAbsolutePath).toBe(
        "/tmp/images/Show/S01E01_1.jpg"
      );
      expect(planned.safeBaseFilename).toBe("S01E01_1");
    });

    it("appends an on-disk collision counter including the cleanup base", () => {
      primePlanner();
      // The un-suffixed base exists on disk; _1 is free.
      vi.mocked(pathExistsWithAnyKnownMediaExtension).mockImplementation(
        (candidate: string) => candidate === "/tmp/videos/Show/S01E01"
      );

      const planned = planDownloadPaths({
        ...baseArgs,
        settings: templateSettings,
      });

      expect(planned.videoAbsolutePath).toBe("/tmp/videos/Show/S01E01_1.mp4");
      expect(planned.videoFilename).toBe("S01E01_1.mp4");
      expect(planned.thumbnailFilename).toBe("S01E01_1.jpg");
      // Unlike the legacy branch, the template branch keeps cleanup aligned
      // with the deduplicated name.
      expect(planned.safeBaseFilename).toBe("S01E01_1");
    });

    it("places template thumbnails next to the video when the setting is on", () => {
      primePlanner();

      const planned = planDownloadPaths({
        ...baseArgs,
        settings: templateSettings,
        moveThumbnailsToVideoFolder: true,
      });

      expect(planned.thumbnailAbsolutePath).toBe(
        "/tmp/videos/Show/S01E01.jpg"
      );
    });
  });
});
