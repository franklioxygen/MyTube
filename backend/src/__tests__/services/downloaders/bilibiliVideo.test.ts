/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  getSettings: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  updateVideo: vi.fn(),
  saveVideo: vi.fn(),
  addVideoToAuthorCollection: vi.fn(),
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
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    existsSync: (...args: any[]) => mocks.existsSync(...args),
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

vi.mock("../../../utils/logger", () => ({
  logger: mocks.logger,
}));

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
  addVideoToAuthorCollection: (...args: any[]) =>
    mocks.addVideoToAuthorCollection(...args),
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

    protected throwIfCancelled(_downloadId?: string): void {}

    protected async downloadThumbnail(
      ...args: any[]
    ): Promise<boolean> {
      return mocks.downloadThumbnail(...args);
    }
  },
}));

vi.mock("../../../services/downloaders/bilibili/bilibiliConfig", () => ({
  prepareBilibiliDownloadFlags: (...args: any[]) =>
    mocks.prepareBilibiliDownloadFlags(...args),
}));

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
      saveAuthorFilesToCollection: false,
    });
    mocks.getVideoBySourceUrl.mockReturnValue(null);
    mocks.updateVideo.mockReturnValue({ id: "existing-video" });
    mocks.addVideoToAuthorCollection.mockReturnValue(null);
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
});
