import { describe, expect, it, vi } from "vitest";
import { downloadVideoAvatar } from "../../../../services/downloaders/ytdlp/avatarDownload";
import { YtDlpDownloaderHelper } from "../../../../services/downloaders/ytdlp/ytdlpDownloaderHelper";
import { getAxiosProxyConfig, InvalidProxyError } from "../../../../utils/ytDlpUtils";
import { downloadAndProcessAvatar } from "../../../../utils/avatarUtils";

// Mock external collaborators so we never touch the network or filesystem.
vi.mock("fs-extra", () => ({
  default: { ensureDirSync: vi.fn() },
}));
vi.mock("../../../../utils/avatarUtils", () => ({
  downloadAndProcessAvatar: vi.fn(),
}));
vi.mock("../../../../utils/ytDlpUtils", () => ({
  downloadChannelAvatar: vi.fn(),
  getAxiosProxyConfig: vi.fn(),
  InvalidProxyError: class InvalidProxyError extends Error {},
}));
vi.mock("../../../../utils/security", () => ({
  pathExistsSafeSync: vi.fn().mockReturnValue(false),
  resolveSafeChildPath: vi.fn((_dir, name) => `/resolved/${name}`),
  moveSafeSync: vi.fn(),
  unlinkSafeSync: vi.fn(),
}));

// Stub the BaseDownloader-backed helper so construction is side-effect free.
vi.mock("../../../../services/downloaders/ytdlp/ytdlpDownloaderHelper", () => ({
  YtDlpDownloaderHelper: class {
    downloadThumbnailPublic = vi.fn();
    throwIfCancelledPublic = vi.fn();
    handleCancellationErrorPublic = vi.fn();
  },
}));

const makeInput = (overrides: Record<string, unknown> = {}) => ({
  channelUrl: null,
  videoUrl: "https://example.com/watch?v=abc",
  videoAuthor: "Someone",
  source: "generic",
  authorAvatarUrl: null,
  info: {},
  networkConfig: {},
  downloadUserConfig: { proxy: undefined },
  downloader: new YtDlpDownloaderHelper() as unknown as YtDlpDownloaderHelper,
  ...overrides,
});

describe("ytdlp avatarDownload", () => {
  it("skips an avatar with an invalid proxy instead of fetching directly", async () => {
    vi.clearAllMocks();
    vi.mocked(getAxiosProxyConfig).mockImplementationOnce(() => { throw new InvalidProxyError("invalid"); });
    const result = await downloadVideoAvatar(makeInput({
      authorAvatarUrl: "https://example.com/avatar.jpg", downloadUserConfig: { proxy: "invalid" },
    }));
    expect(result.authorAvatarSaved).toBe(false);
    expect(downloadAndProcessAvatar).not.toHaveBeenCalled();
  });
  it("returns no avatar when neither channelUrl nor avatarUrl is available", async () => {
    const result = await downloadVideoAvatar(makeInput());

    expect(result.authorAvatarPath).toBeNull();
    expect(result.authorAvatarSaved).toBe(false);
    expect(result.finalAuthorAvatarFilename).toBeUndefined();
    expect(result.authorAvatarUrl).toBeNull();
  });

  it("backfills authorAvatarUrl from info when no direct URL was passed", async () => {
    const result = await downloadVideoAvatar(
      makeInput({ info: { uploader_avatar: "https://img/avatar.png" } }),
    );

    // The info-derived URL is reported back even though no download happens
    // here (downloadAndProcessAvatar is mocked to return undefined).
    expect(result.authorAvatarUrl).toBe("https://img/avatar.png");
  });
});
