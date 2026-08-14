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
  downloadThumbnail: vi.fn(),
  updateActiveDownload: vi.fn(),
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

// The real path guards resolve against the on-disk layout; these tests only care
// about which URL the avatar lookup uses, so keep the filesystem out of it.
vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: () => true,
  readdirSafeSync: () => ["video.mp4"],
  removeSafe: vi.fn(),
  resolveSafeChildPath: (dir: string, child: string) => `${dir}/${child}`,
  statSafeSync: () => ({ size: 2048 }),
}));

vi.mock("../../../utils/ytDlpUtils", async () => {
  // The real InvalidProxyError, so the `instanceof` check in the downloader
  // behaves as it does in production.
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

import { downloadVideo } from "../../../services/downloaders/bilibili/bilibiliCoreDownload";
import { InvalidProxyError } from "../../../utils/ytdlp/proxy";

const SHORT_URL = "https://b23.tv/zKTXLw5";
const AVATAR_URL = "https://i2.hdslb.com/bfs/face/abc.jpg";

/** yt-dlp metadata for a b23.tv download: no avatar field, but a canonical URL. */
const ytDlpInfo = (overrides: Record<string, any> = {}) => ({
  title: "Mock Title",
  uploader: "Mock Author",
  upload_date: "20240101",
  thumbnail: null,
  description: "",
  id: "BV1xx411c7mD",
  webpage_url: "https://www.bilibili.com/video/BV1xx411c7mD",
  ...overrides,
});

describe("bilibiliCoreDownload avatar lookup for short URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const subprocess: any = Promise.resolve(undefined);
    subprocess.stdout = { on: vi.fn() };
    subprocess.stderr = { on: vi.fn() };
    subprocess.kill = vi.fn();

    mocks.createTempDir.mockReturnValue("/mock/videos/temp");
    mocks.executeYtDlpSpawn.mockReturnValue(subprocess);
    mocks.getUserYtDlpConfig.mockReturnValue({});
    mocks.getNetworkConfigFromUserConfig.mockReturnValue({});
    mocks.prepareBilibiliDownloadFlags.mockReturnValue({ flags: {} });
    mocks.resolveResolutionPreference.mockReturnValue({
      height: null,
      strict: false,
    });
    mocks.findVideoFileInTemp.mockReturnValue("video.mp4");
    mocks.downloadAndProcessAvatar.mockResolvedValue(
      "/mock/avatars/bilibili_Mock Author.jpg",
    );
    mocks.axiosGet.mockResolvedValue({
      data: { data: { owner: { face: AVATAR_URL } } },
    });
  });

  it("derives the BV id from yt-dlp metadata when the URL is a b23.tv short link", async () => {
    mocks.executeYtDlpJson.mockResolvedValue(ytDlpInfo());

    const result = await downloadVideo(
      SHORT_URL,
      "/mock/videos/out.mp4",
      "/mock/images/out.jpg",
    );

    expect(mocks.axiosGet).toHaveBeenCalledWith(
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
      expect.anything(),
    );
    expect(mocks.downloadAndProcessAvatar).toHaveBeenCalledWith(
      AVATAR_URL,
      "bilibili",
      "Mock Author",
      expect.any(Function),
      expect.anything(),
    );
    expect(result.authorAvatarSaved).toBe(true);
    expect(result.authorAvatarPath).toBe("/avatars/bilibili_Mock Author.jpg");
  });

  it("falls back to the bare yt-dlp id when webpage_url is absent", async () => {
    // Multipart downloads report the part suffix on the id.
    mocks.executeYtDlpJson.mockResolvedValue(
      ytDlpInfo({ webpage_url: undefined, id: "BV1xx411c7mD_p2" }),
    );

    await downloadVideo(SHORT_URL, "/mock/videos/out.mp4", "/mock/images/out.jpg");

    expect(mocks.axiosGet).toHaveBeenCalledWith(
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD",
      expect.anything(),
    );
  });

  it("still prefers an avatar already present in the yt-dlp metadata", async () => {
    mocks.executeYtDlpJson.mockResolvedValue(
      ytDlpInfo({ uploader_avatar: AVATAR_URL }),
    );

    await downloadVideo(SHORT_URL, "/mock/videos/out.mp4", "/mock/images/out.jpg");

    expect(mocks.axiosGet).not.toHaveBeenCalled();
    expect(mocks.downloadAndProcessAvatar).toHaveBeenCalled();
  });

  it("skips the avatar lookup when no id can be recovered at all", async () => {
    mocks.executeYtDlpJson.mockResolvedValue(
      ytDlpInfo({ webpage_url: undefined, id: undefined }),
    );

    const result = await downloadVideo(
      SHORT_URL,
      "/mock/videos/out.mp4",
      "/mock/images/out.jpg",
    );

    expect(mocks.axiosGet).not.toHaveBeenCalled();
    expect(mocks.downloadAndProcessAvatar).not.toHaveBeenCalled();
    expect(result.authorAvatarSaved).toBe(false);
  });

  describe("proxy handling for side requests", () => {
    it("routes the avatar API lookup through the configured proxy", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({
        proxy: "socks5://127.0.0.1:1080",
      });
      mocks.getAxiosProxyConfig.mockReturnValue({
        proxy: false,
        httpsAgent: "agent",
      });
      mocks.executeYtDlpJson.mockResolvedValue(ytDlpInfo());

      await downloadVideo(SHORT_URL, "/mock/videos/out.mp4", "/mock/images/out.jpg");

      // Previously this request got only headers, so it bypassed the proxy and
      // hit api.bilibili.com from the host.
      expect(mocks.axiosGet).toHaveBeenCalledWith(
        expect.stringContaining("api.bilibili.com"),
        expect.objectContaining({ proxy: false, httpsAgent: "agent" }),
      );
      expect(mocks.downloadAndProcessAvatar).toHaveBeenCalledWith(
        AVATAR_URL,
        "bilibili",
        "Mock Author",
        expect.any(Function),
        expect.objectContaining({ proxy: false, httpsAgent: "agent" }),
      );
    });

    it("skips side requests entirely when the proxy is unusable", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
      mocks.getAxiosProxyConfig.mockImplementation(() => {
        throw new InvalidProxyError("not-a-proxy");
      });
      mocks.executeYtDlpJson.mockResolvedValue(
        ytDlpInfo({ thumbnail: "https://i0.hdslb.com/thumb.jpg" }),
      );

      const result = await downloadVideo(
        SHORT_URL,
        "/mock/videos/out.mp4",
        "/mock/images/out.jpg",
      );

      // A direct request here would expose the user's real IP.
      expect(mocks.axiosGet).not.toHaveBeenCalled();
      expect(mocks.downloadThumbnail).not.toHaveBeenCalled();
      expect(mocks.downloadAndProcessAvatar).not.toHaveBeenCalled();
      // The video itself still downloaded; yt-dlp applies the proxy itself.
      expect(result.error).toBeUndefined();
      expect(result.authorAvatarSaved).toBe(false);
      expect(result.thumbnailSaved).toBe(false);
    });

    it("still uses a yt-dlp-supplied avatar URL over an unusable proxy path", async () => {
      mocks.getUserYtDlpConfig.mockReturnValue({ proxy: "not-a-proxy" });
      mocks.getAxiosProxyConfig.mockImplementation(() => {
        throw new InvalidProxyError("not-a-proxy");
      });
      mocks.executeYtDlpJson.mockResolvedValue(
        ytDlpInfo({ uploader_avatar: AVATAR_URL }),
      );

      const result = await downloadVideo(
        SHORT_URL,
        "/mock/videos/out.mp4",
        "/mock/images/out.jpg",
      );

      // The URL is known, but fetching the image would still leak the IP.
      expect(mocks.downloadAndProcessAvatar).not.toHaveBeenCalled();
      expect(result.authorAvatarUrl).toBe(AVATAR_URL);
      expect(result.authorAvatarSaved).toBe(false);
    });
  });

  it("uses the id in the URL directly when the short link was already resolved", async () => {
    mocks.executeYtDlpJson.mockResolvedValue(
      ytDlpInfo({ webpage_url: undefined, id: undefined }),
    );

    await downloadVideo(
      "https://www.bilibili.com/video/av123456",
      "/mock/videos/out.mp4",
      "/mock/images/out.jpg",
    );

    expect(mocks.axiosGet).toHaveBeenCalledWith(
      "https://api.bilibili.com/x/web-interface/view?aid=123456",
      expect.anything(),
    );
  });
});
