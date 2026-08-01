import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/paths", () => ({
  VIDEOS_DIR: "/mock/videos",
  IMAGES_DIR: "/mock/images",
  SUBTITLES_DIR: "/mock/subtitles",
  DATA_DIR: "/mock/data",
}));

vi.mock("../../utils/security", () => ({
  pathExistsSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn((base: string, child: string) => {
    if (child.includes("..")) throw new Error("traversal");
    return `${base}/${child}`;
  }),
  validateUrl: vi.fn((url: string) => url),
}));

vi.mock("../../utils/helpers", () => {
  const hostnameMatches = (url: string, domains: string[]): boolean => {
    try {
      const hostname = new URL(url).hostname.toLocaleLowerCase();
      return domains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  };

  return {
    extractSourceVideoId: vi.fn((url: string) => {
      const bilibiliMatch = url.match(/\/video\/([^/?#]+)/);
      if (bilibiliMatch) {
        return { id: bilibiliMatch[1], platform: "bilibili" };
      }

      const youtubeMatch = url.match(/[?&]v=([^&#]+)/);
      if (youtubeMatch) {
        return { id: youtubeMatch[1], platform: "youtube" };
      }

      return { id: null, platform: "other" };
    }),
    getMissAVPlaceholderTitle: vi.fn(() => "MissAV Video"),
    isBilibiliUrl: vi.fn((url: string) =>
      hostnameMatches(url, ["bilibili.com", "b23.tv"])
    ),
    isMissAVUrl: vi.fn((url: string) =>
      hostnameMatches(url, ["missav.com"])
    ),
    isTwitchVideoUrl: vi.fn((url: string) =>
      hostnameMatches(url, ["twitch.tv"])
    ),
    isYouTubeUrl: vi.fn((url: string) =>
      hostnameMatches(url, ["youtube.com", "youtu.be"])
    ),
    isValidUrl: vi.fn((url: string) => /^https?:\/\//.test(url)),
    processVideoUrl: vi.fn(async (url: string) => {
      const youtubeMatch = url.match(/[?&]v=([^&#]+)/);
      if (youtubeMatch) {
        return {
          videoUrl: url,
          sourceVideoId: youtubeMatch[1],
          platform: "youtube",
        };
      }
      const bilibiliMatch = url.match(/\/video\/([^/?#]+)/);
      if (bilibiliMatch) {
        return {
          videoUrl: url,
          sourceVideoId: bilibiliMatch[1],
          platform: "bilibili",
        };
      }
      return { videoUrl: url, sourceVideoId: null, platform: "other" };
    }),
    trimBilibiliUrl: vi.fn((url: string) => url.split("&")[0]),
  };
});

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(() => ({ audioFormat: "mp3" })),
  getVideoById: vi.fn(),
  getVideos: vi.fn(),
  updateActiveDownloadTitle: vi.fn(),
}));

vi.mock("../../services/downloadManager", () => ({
  default: {
    addDownload: vi.fn(() => Promise.resolve({ success: true })),
    updateTaskTitle: vi.fn(),
  },
}));

vi.mock("../../services/downloadService", () => ({
  downloadMissAVVideo: vi.fn(),
  downloadYouTubeVideo: vi.fn(),
}));

vi.mock("../../services/bilibiliDownloadTask", () => ({
  buildBilibiliDownloadTask: vi.fn(() => vi.fn()),
}));

vi.mock("../../services/statistics", () => ({
  normalizeSurface: vi.fn((value: string) => value),
  platformFromUrl: vi.fn((url: string) => {
    try {
      const hostname = new URL(url).hostname.toLocaleLowerCase();
      return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")
        ? "bilibili"
        : "youtube";
    } catch {
      return "youtube";
    }
  }),
  recordEvent: vi.fn(() => "event-1"),
}));

import { auditMediaCollisions } from "../../services/mediaCollisionAuditService";
import { repairMediaCollisionFinding } from "../../services/mediaCollisionRepairService";
import { buildBilibiliDownloadTask } from "../../services/bilibiliDownloadTask";
import * as downloadService from "../../services/downloadService";
import downloadManager from "../../services/downloadManager";
import * as storageService from "../../services/storageService";
import { pathExistsSafeSync } from "../../utils/security";

describe("auditMediaCollisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pathExistsSafeSync).mockReturnValue(true);
  });

  it("reports duplicate managed paths as ambiguous without mutating data", () => {
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "row-a",
        title: "Same Title",
        sourceUrl: "https://www.bilibili.com/video/BV1111111111",
        sourceVideoId: "BV1111111111",
        videoPath: "/videos/Alice/Same Title.mp4",
        createdAt: "2026-07-28T00:00:00.000Z",
      },
      {
        id: "row-b",
        title: "Same Title",
        sourceUrl: "https://www.bilibili.com/video/BV2222222222",
        sourceVideoId: "BV2222222222",
        videoPath: "/videos/Alice/Same Title.mp4",
        createdAt: "2026-07-28T00:00:01.000Z",
      },
    ] as any);

    const result = auditMediaCollisions();

    expect(result.summary.duplicatePathGroups).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      normalizedPath: "/videos/alice/same title.mp4",
      localVideoIds: ["row-a", "row-b"],
      reasons: ["duplicate_path"],
      recoverability: "ambiguous_overwrite",
      recommendedAction: "redownload",
    });
  });

  it("does not group same-named artifacts living under different managed roots", () => {
    // A thumbnail left in /videos after moveThumbnailsToVideoFolder was turned
    // off, and another row's thumbnail in /images under the same relative path.
    // These are distinct files and must not be reported as a duplicate_path.
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "row-a",
        title: "Show",
        sourceUrl: "https://www.bilibili.com/video/BV1111111111",
        sourceVideoId: "BV1111111111",
        videoPath: "/videos/Show/a.mp4",
        thumbnailPath: "/videos/Show/poster.jpg",
        createdAt: "2026-07-28T00:00:00.000Z",
      },
      {
        id: "row-b",
        title: "Show",
        sourceUrl: "https://www.bilibili.com/video/BV2222222222",
        sourceVideoId: "BV2222222222",
        videoPath: "/videos/Show/b.mp4",
        thumbnailPath: "/images/Show/poster.jpg",
        createdAt: "2026-07-28T00:00:01.000Z",
      },
    ] as any);

    const result = auditMediaCollisions();

    expect(result.summary.duplicatePathGroups).toBe(0);
    expect(
      result.items.filter((item) => item.reasons.includes("duplicate_path"))
    ).toEqual([]);
  });

  it("still groups same-named artifacts sharing one managed root", () => {
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "row-a",
        title: "Show",
        sourceUrl: "https://www.bilibili.com/video/BV1111111111",
        sourceVideoId: "BV1111111111",
        videoPath: "/videos/Show/a.mp4",
        thumbnailPath: "/images/Show/poster.jpg",
        createdAt: "2026-07-28T00:00:00.000Z",
      },
      {
        id: "row-b",
        title: "Show",
        sourceUrl: "https://www.bilibili.com/video/BV2222222222",
        sourceVideoId: "BV2222222222",
        videoPath: "/videos/Show/b.mp4",
        thumbnailPath: "/images/Show/poster.jpg",
        createdAt: "2026-07-28T00:00:01.000Z",
      },
    ] as any);

    const result = auditMediaCollisions();

    expect(result.summary.duplicatePathGroups).toBe(1);
    expect(
      result.items.find((item) => item.reasons.includes("duplicate_path"))
    ).toMatchObject({
      normalizedPath: "/images/show/poster.jpg",
      localVideoIds: ["row-a", "row-b"],
    });
  });

  it("reports missing managed artifacts", () => {
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "row-a",
        title: "Missing",
        sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        sourceVideoId: "abcdefghijk",
        videoPath: "/videos/Missing.mp4",
        createdAt: "2026-07-28T00:00:00.000Z",
      },
    ] as any);
    vi.mocked(pathExistsSafeSync).mockReturnValue(false);

    const result = auditMediaCollisions();

    expect(result.summary.missingArtifacts).toBe(1);
    expect(result.items[0]).toMatchObject({
      normalizedPath: "/videos/missing.mp4",
      fileExists: false,
      reasons: ["missing_file"],
      recoverability: "missing",
      recommendedAction: "redownload",
    });
  });

  it("reports source id mismatches between stored rows and source URLs", () => {
    vi.mocked(storageService.getVideos).mockReturnValue([
      {
        id: "row-a",
        title: "Mismatch",
        sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        sourceVideoId: "different-id",
        videoPath: "/videos/Mismatch.mp4",
        createdAt: "2026-07-28T00:00:00.000Z",
      },
    ] as any);

    const result = auditMediaCollisions();

    expect(result.summary.sourceTrackingIssues).toBe(1);
    expect(result.sourceTrackingIssues[0]).toMatchObject({
      localVideoId: "row-a",
      storedSourceVideoId: "different-id",
      derivedSourceVideoId: "abcdefghijk",
      reason: "source_video_id_mismatch",
      recommendedAction: "manual_review",
    });
  });

  it("previews an explicit redownload repair without queuing by default", async () => {
    const video = {
      id: "row-a",
      title: "Missing",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      sourceVideoId: "abcdefghijk",
      videoPath: "/videos/Missing.mp4",
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    vi.mocked(storageService.getVideos).mockReturnValue([video] as any);
    vi.mocked(storageService.getVideoById).mockReturnValue(video as any);
    vi.mocked(pathExistsSafeSync).mockReturnValue(false);

    const result = await repairMediaCollisionFinding({
      localVideoId: "row-a",
      action: "redownload",
    });

    expect(result.applied).toBe(false);
    expect(result.preview).toMatchObject({
      localVideoId: "row-a",
      action: "redownload",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      sourceVideoId: "abcdefghijk",
      requiresConfirmation: true,
    });
    expect(downloadManager.addDownload).not.toHaveBeenCalled();
  });

  it("queues a redownload repair only when explicitly confirmed", async () => {
    const video = {
      id: "row-a",
      title: "Missing",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      sourceVideoId: "abcdefghijk",
      videoPath: "/videos/Missing.mp4",
      mediaType: "audio",
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    vi.mocked(storageService.getVideos).mockReturnValue([video] as any);
    vi.mocked(storageService.getVideoById).mockReturnValue(video as any);
    vi.mocked(pathExistsSafeSync).mockReturnValue(false);

    const result = await repairMediaCollisionFinding({
      localVideoId: "row-a",
      action: "redownload",
      confirm: true,
    });

    expect(result.applied).toBe(true);
    expect(result.queuedDownload).toMatchObject({
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      downloadType: "youtube",
    });
    expect(downloadManager.addDownload).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining("-repair-row-a"),
      "Missing",
      "https://www.youtube.com/watch?v=abcdefghijk",
      "youtube",
      expect.objectContaining({
        actorRole: "admin",
        sourceKind: "manual",
      }),
      expect.objectContaining({
        shape: "download_mode",
        audioOnly: true,
        existingLocalVideoId: "row-a",
      }),
    );

    const downloadTask = vi.mocked(downloadManager.addDownload).mock.calls[0][0];
    vi.mocked(downloadService.downloadYouTubeVideo).mockResolvedValue({
      id: "row-a",
    } as any);

    await downloadTask(vi.fn());

    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abcdefghijk",
      expect.objectContaining({
        audioOnly: true,
        existingLocalVideoId: "row-a",
      })
    );
  });

  it("passes the selected row id into Bilibili repair downloads", async () => {
    const video = {
      id: "row-a",
      title: "Missing Bilibili",
      sourceUrl: "https://www.bilibili.com/video/BV1111111111?from=repair",
      sourceVideoId: "BV1111111111",
      videoPath: "/videos/Missing Bilibili.mp4",
      mediaType: "video",
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    vi.mocked(storageService.getVideos).mockReturnValue([video] as any);
    vi.mocked(storageService.getVideoById).mockReturnValue(video as any);
    vi.mocked(pathExistsSafeSync).mockReturnValue(false);

    await repairMediaCollisionFinding({
      localVideoId: "row-a",
      action: "redownload",
      confirm: true,
    });

    const downloadTask = vi.mocked(downloadManager.addDownload).mock.calls[0][0];
    await downloadTask(vi.fn());

    expect(buildBilibiliDownloadTask).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadUrl: "https://www.bilibili.com/video/BV1111111111?from=repair",
        existingLocalVideoId: "row-a",
      })
    );
    expect(downloadManager.addDownload).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining("-repair-row-a"),
      "Missing Bilibili",
      "https://www.bilibili.com/video/BV1111111111?from=repair",
      "bilibili",
      expect.any(Object),
      expect.objectContaining({
        shape: "download_mode",
        audioOnly: false,
        existingLocalVideoId: "row-a",
      }),
    );
  });

  it("passes the selected row id into MissAV repair downloads", async () => {
    const video = {
      id: "row-a",
      title: "Missing MissAV",
      sourceUrl: "https://missav.com/example-video",
      sourceVideoId: "example-video",
      videoPath: "/videos/Missing MissAV.mp4",
      mediaType: "video",
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    vi.mocked(storageService.getVideos).mockReturnValue([video] as any);
    vi.mocked(storageService.getVideoById).mockReturnValue(video as any);
    vi.mocked(pathExistsSafeSync).mockReturnValue(false);

    await repairMediaCollisionFinding({
      localVideoId: "row-a",
      action: "redownload",
      confirm: true,
    });

    const downloadTask = vi.mocked(downloadManager.addDownload).mock.calls[0][0];
    vi.mocked(downloadService.downloadMissAVVideo).mockResolvedValue({
      id: "row-a",
    } as any);

    await downloadTask(vi.fn());

    expect(downloadService.downloadMissAVVideo).toHaveBeenCalledWith(
      "https://missav.com/example-video",
      expect.stringContaining("-repair-row-a"),
      expect.any(Function),
      undefined,
      "row-a"
    );
    expect(downloadManager.addDownload).toHaveBeenCalledWith(
      expect.any(Function),
      expect.stringContaining("-repair-row-a"),
      "Missing MissAV",
      "https://missav.com/example-video",
      "missav",
      expect.any(Object),
      expect.objectContaining({
        shape: "download_mode",
        audioOnly: false,
        existingLocalVideoId: "row-a",
      }),
    );
  });
});
