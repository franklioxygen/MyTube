/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
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
  cleanupFilesOnCancellation: vi.fn(),
  downloadAndProcessAvatar: vi.fn(),
  buildBilibiliApiHeaders: vi.fn(),
  downloadThumbnail: vi.fn(),
  updateActiveDownload: vi.fn(),
  verifyDownloadedMediaComplete: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("axios", () => ({
  default: { get: (...args: any[]) => mocks.axiosGet(...args) },
}));

vi.mock("fs-extra", () => ({
  default: { ensureDirSync: vi.fn() },
}));

vi.mock("../../../config/paths", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, VIDEOS_DIR: "/mock/videos", AVATARS_DIR: "/mock/avatars" };
});

vi.mock("../../../utils/logger", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, logger: mocks.logger };
});

vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: () => true,
  readdirSafeSync: () => ["video.mp4"],
  removeSafe: vi.fn(),
  resolveSafeChildPath: (dir: string, child: string) => `${dir}/${child}`,
  statSafeSync: () => ({ size: 2048 }),
}));

vi.mock("../../../utils/ytDlpUtils", async () => {
  const { InvalidProxyError } = await import("../../../utils/ytdlp/proxy");
  return {
    executeYtDlpJson: (...args: any[]) => mocks.executeYtDlpJson(...args),
    executeYtDlpSpawn: (...args: any[]) => mocks.executeYtDlpSpawn(...args),
    getAxiosProxyConfig: (...args: any[]) => mocks.getAxiosProxyConfig(...args),
    getNetworkConfigFromUserConfig: (...args: any[]) =>
      mocks.getNetworkConfigFromUserConfig(...args),
    getUserYtDlpConfig: (...args: any[]) => mocks.getUserYtDlpConfig(...args),
    getEffectiveUserYtDlpConfig: (url: any) => mocks.getUserYtDlpConfig(url),
    InvalidProxyError,
  };
});

vi.mock("../../../services/storageService", () => ({
  updateActiveDownload: (...args: any[]) => mocks.updateActiveDownload(...args),
}));

vi.mock("../../../utils/avatarUtils", () => ({
  downloadAndProcessAvatar: (...args: any[]) =>
    mocks.downloadAndProcessAvatar(...args),
}));

vi.mock(
  "../../../services/downloaders/bilibili/bilibiliConfig",
  async (importOriginal) => {
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
}));

vi.mock("../../../services/downloaders/bilibili/bilibiliMetadata", () => ({
  getVideoHeight: (...args: any[]) => mocks.getVideoHeight(...args),
}));

vi.mock(
  "../../../services/downloaders/downloadIntegrity",
  async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
      ...actual,
      verifyDownloadedMediaComplete: (...args: any[]) =>
        mocks.verifyDownloadedMediaComplete(...args),
    };
  },
);

vi.mock(
  "../../../services/downloaders/bilibili/bilibiliVideoHelpers",
  async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
      ...actual,
      BilibiliDownloaderHelper: class {
        throwIfCancelledPublic() {}
        async downloadThumbnailPublic(...args: any[]) {
          return mocks.downloadThumbnail(...args);
        }
      },
    };
  },
);

vi.mock("../../../services/downloaders/bilibili/bilibiliHeaders", () => ({
  buildBilibiliApiHeaders: (...args: any[]) =>
    mocks.buildBilibiliApiHeaders(...args),
}));

import { downloadVideo } from "../../../services/downloaders/bilibili/bilibiliCoreDownload";

const URL = "https://www.bilibili.com/video/BV1g54y1q7ph?p=1";

const ytDlpInfo = (overrides: Record<string, any> = {}) => ({
  title: "Mock Title",
  uploader: "Mock Author",
  upload_date: "20240101",
  thumbnail: null,
  description: "",
  duration: 1110.762,
  id: "BV1g54y1q7ph",
  webpage_url: URL,
  ...overrides,
});

describe("bilibiliCoreDownload completeness check", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const subprocess: any = Promise.resolve(undefined);
    subprocess.stdout = { on: vi.fn() };
    subprocess.stderr = { on: vi.fn() };
    subprocess.kill = vi.fn();

    mocks.createTempDir.mockReturnValue("/mock/videos/temp");
    mocks.executeYtDlpSpawn.mockReturnValue(subprocess);
    mocks.executeYtDlpJson.mockResolvedValue(ytDlpInfo());
    mocks.getUserYtDlpConfig.mockReturnValue({});
    mocks.getNetworkConfigFromUserConfig.mockReturnValue({});
    mocks.prepareBilibiliDownloadFlags.mockReturnValue({ flags: {} });
    mocks.resolveResolutionPreference.mockReturnValue({
      height: null,
      strict: false,
    });
    mocks.findVideoFileInTemp.mockReturnValue("video.mp4");
    mocks.axiosGet.mockResolvedValue({ data: {} });
    mocks.verifyDownloadedMediaComplete.mockResolvedValue({ complete: true });
  });

  it("checks the merged file against the duration the source reported", async () => {
    await downloadVideo(URL, "/mock/videos/out.mp4", "/mock/images/out.jpg");

    expect(mocks.verifyDownloadedMediaComplete).toHaveBeenCalledWith(
      "/mock/videos/temp/video.mp4",
      expect.objectContaining({ sourceDurationSeconds: 1110.762 }),
    );
  });

  it("keeps a complete download", async () => {
    const result = await downloadVideo(
      URL,
      "/mock/videos/out.mp4",
      "/mock/images/out.jpg",
    );

    expect(result.error).toBeUndefined();
    expect(mocks.moveVideoFile).toHaveBeenCalled();
  });

  it("discards a truncated download instead of storing it", async () => {
    mocks.verifyDownloadedMediaComplete.mockResolvedValue({
      complete: false,
      reason: "the video track is 685.3s but the audio track is 400.0s",
    });

    const result = await downloadVideo(
      URL,
      "/mock/videos/out.mp4",
      "/mock/images/out.jpg",
    );

    // The failure has to surface as an error so downloadSinglePart records the
    // download as failed rather than saving a half file to the library.
    expect(result.error).toContain("incomplete");
    expect(result.error).toContain("400.0s");
    // Nothing may reach the library directory, and the temp dir is cleaned up.
    expect(mocks.moveVideoFile).not.toHaveBeenCalled();
    expect(mocks.cleanupTempDir).toHaveBeenCalledWith("/mock/videos/temp");
  });

  it("passes the effective yt-dlp config through so a clipped download is exempt", async () => {
    mocks.getUserYtDlpConfig.mockReturnValue({
      downloadSections: "*0:00-2:00",
    });

    await downloadVideo(URL, "/mock/videos/out.mp4", "/mock/images/out.jpg");

    expect(mocks.verifyDownloadedMediaComplete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userConfig: { downloadSections: "*0:00-2:00" },
      }),
    );
  });
});
