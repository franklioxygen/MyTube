/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatVideoFilename } from "../../../utils/helpers";
import { DownloadCancelledError } from "../../../errors/DownloadErrors";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  getSettings: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  updateVideo: vi.fn(),
  saveVideo: vi.fn(),
  organizeVideoByAuthor: vi.fn(),
  updateActiveDownload: vi.fn(),
  isThumbnailReferencedByOtherVideo: vi.fn(),
  getVideoById: vi.fn(),
  resolveManagedThumbnailWebPathFromAbsolutePath: vi.fn(),
  deleteSmallThumbnailMirrorSync: vi.fn(),
  executeYtDlpJson: vi.fn(),
  executeYtDlpSpawn: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(),
  getAxiosProxyConfig: vi.fn(),
  prepareBilibiliDownloadFlags: vi.fn(),
  resolveResolutionPreference: vi.fn(),
  resolveResolutionRetryTarget: vi.fn(),
  getVideoHeight: vi.fn(),
  createTempDir: vi.fn(),
  cleanupTempDir: vi.fn(),
  findVideoFileInTemp: vi.fn(),
  moveVideoFile: vi.fn(),
  prepareFilePaths: vi.fn(),
  renameFilesWithMetadata: vi.fn(),
  cleanupFilesOnCancellation: vi.fn(),
  extractPartMetadata: vi.fn(),
  getVideoDuration: vi.fn(),
  getFileSize: vi.fn(),
  downloadSubtitles: vi.fn(),
  downloadAndProcessAvatar: vi.fn(),
  downloadThumbnail: vi.fn(),
  throwIfCancelled: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    existsSync: (...args: any[]) => mocks.existsSync(...args),
    ensureDirSync: vi.fn(),
    ensureFileSync: vi.fn(),
    readdirSync: (...args: any[]) => mocks.readdirSync(...args),
    statSync: (...args: any[]) => mocks.statSync(...args),
    unlinkSync: (...args: any[]) => mocks.unlinkSync(...args),
  },
}));

vi.mock("../../../config/paths", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    IMAGES_DIR: "/mock/images",
    SUBTITLES_DIR: "/mock/subtitles",
    VIDEOS_DIR: "/mock/videos",
  };
});

vi.mock("../../../utils/avatarUtils", () => ({
  downloadAndProcessAvatar: (...args: any[]) =>
    mocks.downloadAndProcessAvatar(...args),
}));

vi.mock("../../../utils/logger", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    logger: mocks.logger,
  };
});

vi.mock("../../../utils/ytDlpUtils", () => {
  class InvalidProxyError extends Error {}

  return {
    executeYtDlpJson: (...args: any[]) => mocks.executeYtDlpJson(...args),
    executeYtDlpSpawn: (...args: any[]) => mocks.executeYtDlpSpawn(...args),
    getAxiosProxyConfig: (...args: any[]) => mocks.getAxiosProxyConfig(...args),
    getNetworkConfigFromUserConfig: (...args: any[]) =>
      mocks.getNetworkConfigFromUserConfig(...args),
    getUserYtDlpConfig: (...args: any[]) => mocks.getUserYtDlpConfig(...args),
    InvalidProxyError,
  };
});

vi.mock("../../../services/storageService", () => ({
  getSettings: (...args: any[]) => mocks.getSettings(...args),
  getVideoBySourceUrl: (...args: any[]) => mocks.getVideoBySourceUrl(...args),
  updateVideo: (...args: any[]) => mocks.updateVideo(...args),
  saveVideo: (...args: any[]) => mocks.saveVideo(...args),
  organizeVideoByAuthor: (...args: any[]) =>
    mocks.organizeVideoByAuthor(...args),
  updateActiveDownload: (...args: any[]) =>
    mocks.updateActiveDownload(...args),
  isThumbnailReferencedByOtherVideo: (...args: any[]) =>
    mocks.isThumbnailReferencedByOtherVideo(...args),
  getVideoById: (...args: any[]) => mocks.getVideoById(...args),
}));

vi.mock("../../../services/thumbnailMirrorService", () => ({
  deleteSmallThumbnailMirrorSync: (...args: any[]) =>
    mocks.deleteSmallThumbnailMirrorSync(...args),
  resolveManagedThumbnailWebPathFromAbsolutePath: (...args: any[]) =>
    mocks.resolveManagedThumbnailWebPathFromAbsolutePath(...args),
}));

vi.mock("../../../services/downloaders/BaseDownloader", () => ({
  BaseDownloader: class {
    protected async handleCancellationError(
      _error: unknown,
      cleanupFn?: () => void | Promise<void>,
    ): Promise<void> {
      if (cleanupFn) {
        await cleanupFn();
      }
    }

    protected throwIfCancelled(downloadId?: string): void {
      mocks.throwIfCancelled(downloadId);
    }

    protected async downloadThumbnail(
      ...args: any[]
    ): Promise<boolean> {
      return mocks.downloadThumbnail(...args);
    }
  },
}));

vi.mock(
  "../../../services/downloaders/bilibili/bilibiliConfig",
  async (importOriginal) => {
    // Keep the real, pure helpers (isLikelyBilibiliAuthFailure, the cookie hint)
    // and override only the settings-driven functions the tests control.
    const actual = await importOriginal<any>();
    return {
      ...actual,
      prepareBilibiliDownloadFlags: (...args: any[]) =>
        mocks.prepareBilibiliDownloadFlags(...args),
      resolveResolutionPreference: (...args: any[]) =>
        mocks.resolveResolutionPreference(...args),
      resolveResolutionRetryTarget: (...args: any[]) =>
        mocks.resolveResolutionRetryTarget(...args),
    };
  },
);

vi.mock("../../../services/downloaders/bilibili/bilibiliFileManager", () => ({
  cleanupFilesOnCancellation: (...args: any[]) =>
    mocks.cleanupFilesOnCancellation(...args),
  cleanupTempDir: (...args: any[]) => mocks.cleanupTempDir(...args),
  createTempDir: (...args: any[]) => mocks.createTempDir(...args),
  findVideoFileInTemp: (...args: any[]) => mocks.findVideoFileInTemp(...args),
  moveVideoFile: (...args: any[]) => mocks.moveVideoFile(...args),
  prepareFilePaths: (...args: any[]) => mocks.prepareFilePaths(...args),
  renameFilesWithMetadata: (...args: any[]) =>
    mocks.renameFilesWithMetadata(...args),
}));

vi.mock("../../../services/downloaders/bilibili/bilibiliMetadata", () => ({
  extractPartMetadata: (...args: any[]) => mocks.extractPartMetadata(...args),
  getFileSize: (...args: any[]) => mocks.getFileSize(...args),
  getVideoDuration: (...args: any[]) => mocks.getVideoDuration(...args),
  getVideoHeight: (...args: any[]) => mocks.getVideoHeight(...args),
}));

vi.mock("../../../services/downloaders/bilibili/bilibiliSubtitle", () => ({
  downloadSubtitles: (...args: any[]) => mocks.downloadSubtitles(...args),
}));

import { downloadSinglePart } from "../../../services/downloaders/bilibili/bilibiliVideo";

const buildExistingVideo = (overrides: Record<string, any> = {}) => ({
  id: "existing-video",
  addedAt: "2024-01-01T00:00:00.000Z",
  createdAt: "2024-01-01T00:00:00.000Z",
  thumbnailFilename: "old-thumb.jpg",
  thumbnailPath: "/images/Collection/old-thumb.jpg",
  authorAvatarFilename: "avatar.jpg",
  authorAvatarPath: "/avatars/avatar.jpg",
  ...overrides,
});

describe("bilibiliVideo.downloadSinglePart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not cancelled. Individual tests opt into cancellation.
    mocks.throwIfCancelled.mockReset();

    const subprocess: any = Promise.resolve(undefined);
    subprocess.stdout = { on: vi.fn() };
    subprocess.stderr = { on: vi.fn() };
    subprocess.kill = vi.fn();

    mocks.existsSync.mockReturnValue(true);
    mocks.readdirSync.mockReturnValue(["video.mp4"]);
    mocks.statSync.mockReturnValue({ size: 2048 });
    mocks.getSettings.mockReturnValue({
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
      authorOrganizationMode: "root",
      saveAuthorFilesToCollection: false,
    });
    mocks.getVideoBySourceUrl.mockReturnValue(null);
    mocks.updateVideo.mockReturnValue({ id: "existing-video" });
    mocks.organizeVideoByAuthor.mockReturnValue(null);
    mocks.isThumbnailReferencedByOtherVideo.mockReturnValue(false);
    mocks.resolveManagedThumbnailWebPathFromAbsolutePath.mockReturnValue(null);
    mocks.executeYtDlpJson.mockResolvedValue({
      title: "Mock Title",
      uploader: "Mock Author",
      upload_date: "20240101",
      thumbnail: "https://example.com/thumb.jpg",
      description: "Mock description",
    });
    mocks.executeYtDlpSpawn.mockReturnValue(subprocess);
    mocks.getUserYtDlpConfig.mockReturnValue({ mergeOutputFormat: "mp4" });
    mocks.getNetworkConfigFromUserConfig.mockReturnValue({});
    mocks.prepareBilibiliDownloadFlags.mockReturnValue({ flags: [] });
    mocks.resolveResolutionPreference.mockReturnValue({
      height: null,
      strict: false,
    });
    mocks.resolveResolutionRetryTarget.mockReturnValue(null);
    mocks.getVideoHeight.mockResolvedValue(null);
    mocks.createTempDir.mockReturnValue("/mock/videos/temp-dir");
    mocks.cleanupTempDir.mockResolvedValue(undefined);
    mocks.findVideoFileInTemp.mockReturnValue("video.mp4");
    mocks.moveVideoFile.mockImplementation(() => undefined);
    mocks.prepareFilePaths.mockImplementation(
      (_format: string, collectionName?: string, moveThumbs = false) => {
        const baseDir =
          collectionName && moveThumbs
            ? `/mock/videos/${collectionName}`
            : collectionName
              ? "/mock/images/Collection"
              : moveThumbs
                ? "/mock/videos"
                : "/mock/images";
        return {
          videoPath: collectionName
            ? `/mock/videos/${collectionName}/video_1.mp4`
            : "/mock/videos/video_1.mp4",
          thumbnailPath: `${baseDir}/video_1.jpg`,
          videoDir: collectionName
            ? `/mock/videos/${collectionName}`
            : "/mock/videos",
          imageDir: baseDir,
        };
      },
    );
    mocks.renameFilesWithMetadata.mockImplementation(
      (
        _title: string,
        _author: string,
        _date: string,
        _format: string,
        _videoPath: string,
        _thumbnailPath: string,
        _thumbnailSaved: boolean,
        videoDir: string,
        imageDir: string,
      ) => ({
        newVideoPath: `${videoDir}/final-video.mp4`,
        newThumbnailPath: `${imageDir}/final-thumb.jpg`,
        finalVideoFilename: "final-video.mp4",
        finalThumbnailFilename: "final-thumb.jpg",
      }),
    );
    mocks.extractPartMetadata.mockResolvedValue({
      channelUrl: "https://space.bilibili.com/42",
      partTitle: "Part Title",
    });
    mocks.getVideoDuration.mockResolvedValue(123);
    mocks.getFileSize.mockReturnValue(456);
    mocks.downloadSubtitles.mockResolvedValue([]);
    mocks.downloadAndProcessAvatar.mockResolvedValue(null);
    mocks.downloadThumbnail.mockResolvedValue(true);
  });

  it("writes /videos thumbnail paths for existing videos when moveThumbnailsToVideoFolder is enabled", async () => {
    mocks.getSettings.mockReturnValue({
      moveThumbnailsToVideoFolder: true,
      moveSubtitlesToVideoFolder: false,
      saveAuthorFilesToCollection: false,
    });
    mocks.getVideoBySourceUrl.mockReturnValue(
      buildExistingVideo({
        thumbnailFilename: "final-thumb.jpg",
        thumbnailPath: "/videos/Collection/final-thumb.jpg",
      }),
    );

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1test",
      1,
      1,
      "",
      "download-1",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    expect(mocks.updateActiveDownload).toHaveBeenCalledWith(
      "download-1",
      expect.objectContaining({
        title: "Mock Title",
        filename: "Mock Title",
        progress: 0,
      }),
    );
    expect(mocks.updateVideo).toHaveBeenCalledWith(
      "existing-video",
      expect.objectContaining({
        videoPath: "/videos/Collection/final-video.mp4",
        thumbnailFilename: "final-thumb.jpg",
        thumbnailPath: "/videos/Collection/final-thumb.jpg",
      }),
    );
    expect(mocks.saveVideo).not.toHaveBeenCalled();
  });

  it("skips deleting the old thumbnail when another video still references it", async () => {
    mocks.getVideoBySourceUrl.mockReturnValue(buildExistingVideo());
    mocks.isThumbnailReferencedByOtherVideo.mockReturnValue(true);
    mocks.resolveManagedThumbnailWebPathFromAbsolutePath.mockReturnValue(
      "/images/Collection/final-thumb.jpg",
    );

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1shared",
      1,
      1,
      "",
      "download-2",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    expect(mocks.isThumbnailReferencedByOtherVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "existing-video",
        thumbnailFilename: "old-thumb.jpg",
        thumbnailPath: "/images/Collection/old-thumb.jpg",
      }),
      "existing-video",
    );
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
    expect(mocks.deleteSmallThumbnailMirrorSync).not.toHaveBeenCalled();
  });

  it("deletes the old thumbnail and its small mirror when the old file is no longer shared", async () => {
    mocks.getVideoBySourceUrl.mockReturnValue(buildExistingVideo());
    mocks.resolveManagedThumbnailWebPathFromAbsolutePath.mockReturnValue(
      "/images/Collection/final-thumb.jpg",
    );

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1cleanup",
      1,
      1,
      "",
      "download-3",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    expect(mocks.unlinkSync).toHaveBeenCalledWith(
      "/mock/images/Collection/old-thumb.jpg",
    );
    expect(mocks.deleteSmallThumbnailMirrorSync).toHaveBeenCalledWith(
      "/mock/images/Collection/old-thumb.jpg",
    );
  });

  it("passes downloadFilenamePresetId when adding a new video to the author collection", async () => {
    mocks.getSettings.mockReturnValue({
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
      authorOrganizationMode: "author_collection_linked",
      downloadFilenamePresetId: "channel_year_date_index",
    });

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1preset",
      1,
      1,
      "",
      "download-4",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    expect(mocks.organizeVideoByAuthor).toHaveBeenCalledWith(
      expect.any(String),
      "Mock Author",
      "author_collection_linked",
      "channel_year_date_index",
      { moveFiles: false },
    );
  });

  it("passes downloadFilenamePresetId when updating an existing video", async () => {
    mocks.getSettings.mockReturnValue({
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
      authorOrganizationMode: "author_collection_linked",
      downloadFilenamePresetId: "channel_year_date_index",
    });
    mocks.getVideoBySourceUrl.mockReturnValue(buildExistingVideo());

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1preset-update",
      1,
      1,
      "",
      "download-5",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    expect(mocks.organizeVideoByAuthor).toHaveBeenCalledWith(
      "existing-video",
      "Mock Author",
      "author_collection_linked",
      "channel_year_date_index",
      { moveFiles: false },
    );
  });

  it("allows direct single-video downloads to keep legacy author-folder moves enabled", async () => {
    mocks.getSettings.mockReturnValue({
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
      authorOrganizationMode: "author_folder_only",
      downloadFilenamePresetId: "legacy",
    });

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1single",
      1,
      1,
      "",
      "download-direct",
    );

    expect(result.success).toBe(true);
    expect(mocks.organizeVideoByAuthor).toHaveBeenCalledWith(
      expect.any(String),
      "Mock Author",
      "author_folder_only",
      "legacy",
      undefined,
    );
  });

  it("relocates collection videos into the author folder under author_folder_only (legacy)", async () => {
    mocks.getSettings.mockReturnValue({
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
      authorOrganizationMode: "author_folder_only",
      downloadFilenamePresetId: "legacy",
    });

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1afo",
      1,
      1,
      "",
      "download-afo",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    // undefined options => organizeVideoByAuthor falls back to the legacy move,
    // pulling the collection episode (and its subtitles) into the author folder
    // instead of leaving it in /videos/Collection (issue #295 2-2 / 2-3).
    expect(mocks.organizeVideoByAuthor).toHaveBeenCalledWith(
      expect.any(String),
      "Mock Author",
      "author_folder_only",
      "legacy",
      undefined,
    );
  });

  it("retries once at a height floor when an episode downloads below the preferred resolution", async () => {
    mocks.resolveResolutionPreference.mockReturnValue({
      height: 1080,
      strict: false,
    });
    mocks.getVideoHeight.mockResolvedValue(480);
    mocks.resolveResolutionRetryTarget.mockReturnValue(1080);

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1lowres",
      1,
      1,
      "",
      "download-lowres",
    );

    expect(result.success).toBe(true);
    // The retry re-prepares flags with the resolved floor.
    expect(mocks.prepareBilibiliDownloadFlags).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BV1lowres",
      expect.any(String),
      { retryFloorHeight: 1080 },
    );
    // Exactly one retry: two yt-dlp invocations total for the single part.
    expect(mocks.executeYtDlpSpawn).toHaveBeenCalledTimes(2);
  });

  it("does not delete the first downloaded file when cancelling the resolution retry", async () => {
    const cancelCallbacks: Array<() => void | Promise<void>> = [];
    mocks.resolveResolutionPreference.mockReturnValue({
      height: 1080,
      strict: false,
    });
    mocks.getVideoHeight.mockResolvedValue(480);
    mocks.resolveResolutionRetryTarget.mockReturnValue(1080);

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1retrycancel",
      1,
      1,
      "",
      "download-retrycancel",
      (cancel) => {
        cancelCallbacks.push(cancel);
      },
    );

    expect(result.success).toBe(true);
    expect(cancelCallbacks).toHaveLength(2);

    await cancelCallbacks[1]();

    expect(mocks.cleanupFilesOnCancellation).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupFilesOnCancellation).toHaveBeenCalledWith(
      undefined,
      undefined,
      "/mock/videos/temp-dir",
    );
  });

  it("keeps the original metadata and file when the resolution retry fails", async () => {
    mocks.resolveResolutionPreference.mockReturnValue({
      height: 1080,
      strict: false,
    });
    mocks.getVideoHeight.mockResolvedValue(480);
    mocks.resolveResolutionRetryTarget.mockReturnValue(1080);
    // First download finds the file; the retry finds nothing, so it fails and
    // returns the generic "Bilibili Video" / "Bilibili User" fallback object.
    mocks.findVideoFileInTemp
      .mockReturnValueOnce("video.mp4")
      .mockReturnValueOnce(null);

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1retryfail",
      1,
      1,
      "",
      "download-retryfail",
    );

    expect(result.success).toBe(true);
    expect(mocks.executeYtDlpSpawn).toHaveBeenCalledTimes(2);
    // The saved video must carry the real metadata from the first (successful)
    // download, not the retry's generic fallback (issue #295 2-1 follow-up).
    expect(mocks.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({ author: "Mock Author" }),
    );
    expect(mocks.saveVideo).not.toHaveBeenCalledWith(
      expect.objectContaining({ author: "Bilibili User" }),
    );
  });

  it("does not retry when the downloaded resolution already meets the preference", async () => {
    mocks.resolveResolutionPreference.mockReturnValue({
      height: 1080,
      strict: false,
    });
    mocks.getVideoHeight.mockResolvedValue(1080);
    mocks.resolveResolutionRetryTarget.mockReturnValue(null);

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1ok",
      1,
      1,
      "",
      "download-ok",
    );

    expect(result.success).toBe(true);
    expect(mocks.executeYtDlpSpawn).toHaveBeenCalledTimes(1);
    expect(mocks.prepareBilibiliDownloadFlags).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ retryFloorHeight: expect.anything() }),
    );
  });

  it("returns a failure instead of saving a record when the download fails (issue #295)", async () => {
    // No file is produced — downloadVideo returns its fallback object with an error.
    mocks.findVideoFileInTemp.mockReturnValue(null);

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1nofile",
      1,
      1,
      "",
      "download-nofile",
    );

    expect(result.success).toBe(false);
    expect(mocks.saveVideo).not.toHaveBeenCalled();
    expect(mocks.organizeVideoByAuthor).not.toHaveBeenCalled();
  });

  it("surfaces a cookie-refresh hint when the download fails with a risk-control error", async () => {
    const ytDlpError = new Error("yt-dlp process exited with code 1");
    (ytDlpError as any).stderr = [
      "ERROR: HTTP Error 412: Precondition Failed (-352)",
      "Cookie: SESSDATA=very-secret; bili_jct=csrf-secret",
      "authorization=Bearer abc123",
      "https://user:pass@example.com/video?token=rawtoken",
      "/Users/franklioxygen/private/cookies.txt",
      "ERROR: unable to open file /Users/leaky-user/data/output.mp4",
    ].join("\n");
    const failing: any = Promise.reject(ytDlpError);
    // Mark the rejection handled so it is not reported as an unhandled rejection;
    // downloadVideo attaches its own handler via `await`.
    failing.catch(() => {});
    failing.stdout = { on: vi.fn() };
    failing.stderr = { on: vi.fn() };
    failing.kill = vi.fn();
    mocks.executeYtDlpSpawn.mockReturnValue(failing);
    mocks.findVideoFileInTemp.mockReturnValue(null);

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1risk",
      1,
      1,
      "",
      "download-risk",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("yt-dlp process exited with code 1");
    expect(result.error).toContain("412");
    expect(result.error).toContain("refresh");
    expect(result.error).not.toContain("very-secret");
    expect(result.error).not.toContain("csrf-secret");
    expect(result.error).not.toContain("abc123");
    expect(result.error).not.toContain("user:pass");
    expect(result.error).not.toContain("rawtoken");
    expect(result.error).not.toContain("/Users/franklioxygen");
    // A space-preceded absolute path must also be redacted, not just one that
    // happens to follow a word char.
    expect(result.error).not.toContain("/Users/leaky-user");
    expect(mocks.saveVideo).not.toHaveBeenCalled();
  });

  it("propagates cancellation instead of recording a failed episode when the part is cancelled (issue #295)", async () => {
    // A cancelled part comes back from downloadVideo through its fallback return
    // (error set, no file), not as a thrown error. downloadSinglePart must
    // re-check and surface DownloadCancelledError so downloadCollection aborts the
    // whole collection rather than logging a normal failed episode and continuing
    // to the next video.
    // existsSync=false keeps downloadVideo off the temp-dir cleanup branch so the
    // cancellation surfaces as a clean "Download cancelled by user" fallback.
    mocks.existsSync.mockReturnValue(false);
    mocks.throwIfCancelled.mockImplementation(() => {
      throw DownloadCancelledError.create();
    });

    await expect(
      downloadSinglePart(
        "https://www.bilibili.com/video/BV1cancelled",
        1,
        1,
        "",
        "download-cancelled",
      ),
    ).rejects.toBeInstanceOf(DownloadCancelledError);

    expect(mocks.saveVideo).not.toHaveBeenCalled();
    expect(mocks.organizeVideoByAuthor).not.toHaveBeenCalled();
  });

  it("uses zero-padded multipart prefixes for legacy filenames and subtitles", async () => {
    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1legacy?p=2",
      2,
      12,
      "Series",
      "download-legacy",
      undefined,
      "Collection",
    );

    expect(result.success).toBe(true);
    expect(mocks.renameFilesWithMetadata).toHaveBeenCalledWith(
      "2 Part Title",
      "Mock Author",
      "20240101",
      "mp4",
      expect.any(String),
      expect.any(String),
      true,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        legacyTitleOverride: "02 Part Title",
      }),
    );
    expect(mocks.downloadSubtitles).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BV1legacy?p=2",
      formatVideoFilename("02 Part Title", "Mock Author", "20240101"),
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("sources metadata from the first entry and pins part 1 when a bare URL resolves as a multipart playlist", async () => {
    // A bare multipart BV URL makes yt-dlp emit a playlist whose uploader and
    // thumbnail live on the per-part entries, not the top level (issue #295).
    mocks.executeYtDlpJson.mockResolvedValue({
      title: "Playlist Title",
      // No top-level uploader/thumbnail, mirroring real playlist JSON.
      entries: [
        {
          title: "Part 1 Title",
          uploader: "Real Author",
          thumbnail: "https://example.com/part1.jpg",
          upload_date: "20240202",
          description: "Part 1 description",
        },
        { title: "Part 2 Title", uploader: "Real Author" },
      ],
    });
    const flags: Record<string, any> = {};
    mocks.prepareBilibiliDownloadFlags.mockReturnValue({ flags });

    const result = await downloadSinglePart(
      "https://www.bilibili.com/video/BV1multipart",
      1,
      1,
      "",
      "download-multipart",
    );

    expect(result.success).toBe(true);
    // Author comes from the entry, not the "Bilibili User" fallback.
    expect(mocks.saveVideo).toHaveBeenCalledWith(
      expect.objectContaining({ author: "Real Author" }),
    );
    expect(mocks.saveVideo).not.toHaveBeenCalledWith(
      expect.objectContaining({ author: "Bilibili User" }),
    );
    // The entry thumbnail is downloaded.
    expect(mocks.downloadThumbnail).toHaveBeenCalledWith(
      "https://example.com/part1.jpg",
      expect.any(String),
      expect.any(Object),
    );
    // The download spawn is restricted to part 1 so yt-dlp does not merge every
    // part into the single output template.
    expect(flags.playlistItems).toBe("1");
  });
});
