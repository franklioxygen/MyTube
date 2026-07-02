import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock database first to prevent initialization errors
vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  sqlite: {
    prepare: vi.fn(),
  },
}));

// Mock dependencies
vi.mock("../../../services/storageService");
vi.mock("../../../services/downloadManager", () => ({
  default: {
    cancelDownload: vi.fn(),
  },
}));
vi.mock("../../../utils/downloadUtils", () => ({
  cleanupVideoArtifacts: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../utils/security", () => ({
  readFileSafeSync: vi.fn(),
}));
vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: "/tmp/avatars",
  VIDEOS_DIR: "/tmp/videos",
  IMAGES_DIR: "/tmp/images",
  IMAGES_SMALL_DIR: "/tmp/images-small",
  SUBTITLES_DIR: "/tmp/subtitles",
  DATA_DIR: "/tmp/data",
  CLOUD_THUMBNAIL_CACHE_DIR: "/tmp/thumbnails",
}));
vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("path", () => {
  const mocks = {
    basename: vi.fn((name) => name.split(".")[0]),
    extname: vi.fn(() => ".mp4"),
    join: vi.fn((...args) => args.join("/")),
    resolve: vi.fn((...args) => args.join("/")),
  };
  return {
    default: mocks,
    ...mocks,
  };
});
// Also mock fs-extra to prevent ensureDirSync failure
vi.mock("fs-extra", () => ({
  default: {
    ensureDirSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

import { TaskCleanup } from "../../../services/continuousDownload/taskCleanup";
import { ContinuousDownloadTask } from "../../../services/continuousDownload/types";
import * as storageService from "../../../services/storageService";
import { cleanupVideoArtifacts } from "../../../utils/downloadUtils";
import { readFileSafeSync } from "../../../utils/security";
import { logger } from "../../../utils/logger";

describe("TaskCleanup", () => {
  let taskCleanup: TaskCleanup;

  const mockTask: ContinuousDownloadTask = {
    id: "task-1",
    author: "Author",
    authorUrl: "url",
    platform: "YouTube",
    status: "active",
    createdAt: 0,
    currentVideoIndex: 1, // Must be > 0 to run cleanup
    totalVideos: 10,
    downloadedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    frozenVideoListPath: "/tmp/data/frozen-lists/task-1.json",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskCleanup = new TaskCleanup();

    // Default mocks: frozen list resolves url1 at index 1, no active downloads
    (readFileSafeSync as any).mockReturnValue(JSON.stringify(["url0", "url1"]));
    (storageService.getDownloadStatus as any).mockReturnValue({
      activeDownloads: [],
    });
  });

  describe("cleanupCurrentVideoTempFiles", () => {
    it("should do nothing if index is 0", async () => {
      await taskCleanup.cleanupCurrentVideoTempFiles({
        ...mockTask,
        currentVideoIndex: 0,
      });
      expect(readFileSafeSync).not.toHaveBeenCalled();
      expect(storageService.getDownloadStatus).not.toHaveBeenCalled();
    });

    it("stays offline: no lookup happens without a frozen list", async () => {
      await taskCleanup.cleanupCurrentVideoTempFiles({
        ...mockTask,
        frozenVideoListPath: undefined,
      });

      // The caller (cancelTask) already cancelled downloads it could match;
      // without the frozen list this path must not reach for the network or
      // guess filenames.
      expect(readFileSafeSync).not.toHaveBeenCalled();
      expect(storageService.getDownloadStatus).not.toHaveBeenCalled();
      expect(cleanupVideoArtifacts).not.toHaveBeenCalled();
    });

    it("should cancel active download matching the current video url", async () => {
      const activeDownload = {
        id: "dl-1",
        sourceUrl: "url1",
        filename: "file.mp4",
      };
      (storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [activeDownload],
      });

      await taskCleanup.cleanupCurrentVideoTempFiles(mockTask); // index 1 -> url1

      const downloadManager = await import("../../../services/downloadManager");
      expect(downloadManager.default.cancelDownload).toHaveBeenCalledWith(
        "dl-1"
      );
      // Artifact deletion is owned by the downloader's cancel hook; no
      // filename reconstruction happens here on the success path.
      expect(cleanupVideoArtifacts).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should ignore active downloads for other videos", async () => {
      (storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [
          { id: "dl-other", sourceUrl: "url0", filename: "other.mp4" },
        ],
      });

      await taskCleanup.cleanupCurrentVideoTempFiles(mockTask);

      const downloadManager = await import("../../../services/downloadManager");
      expect(downloadManager.default.cancelDownload).not.toHaveBeenCalled();
    });

    it("falls back to record removal + filename sweep when cancel fails", async () => {
      const activeDownload = {
        id: "dl-1",
        sourceUrl: "url1",
        filename: "file.mp4",
      };
      (storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [activeDownload],
      });
      const downloadManager = await import("../../../services/downloadManager");
      (downloadManager.default.cancelDownload as any).mockRejectedValue(
        new Error("cancel failed")
      );

      await taskCleanup.cleanupCurrentVideoTempFiles(mockTask);

      expect(storageService.removeActiveDownload).toHaveBeenCalledWith("dl-1");
      expect(cleanupVideoArtifacts).toHaveBeenCalledWith("file", "/tmp/videos");
    });

    it("should handle unreadable frozen lists gracefully", async () => {
      (readFileSafeSync as any).mockImplementation(() => {
        throw new Error("missing file");
      });

      await expect(
        taskCleanup.cleanupCurrentVideoTempFiles(mockTask)
      ).resolves.not.toThrow();
      expect(storageService.getDownloadStatus).not.toHaveBeenCalled();
    });
  });
});
