import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSafePathInDirectories: vi.fn(
    (filePath: string, _allowedDirs: string[]) => filePath,
  ),
  axios: vi.fn(),
  ensureDirSync: vi.fn(),
  createWriteStream: vi.fn(),
  pipe: vi.fn(),
}));

vi.mock("../../../utils/security", () => ({
  resolveSafePathInDirectories: (filePath: string, allowedDirs: string[]) =>
    mocks.resolveSafePathInDirectories(filePath, allowedDirs),
}));

vi.mock("../../../config/paths", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    VIDEOS_DIR: "/mock/videos",
    IMAGES_DIR: "/mock/images",
    AVATARS_DIR: "/mock/avatars",
  };
});

vi.mock("axios", () => ({
  default: (...args: any[]) => mocks.axios(...args),
}));

vi.mock("fs-extra", () => ({
  default: {
    ensureDirSync: (...args: any[]) => mocks.ensureDirSync(...args),
    createWriteStream: (...args: any[]) => mocks.createWriteStream(...args),
  },
}));

vi.mock("../../../services/storageService", () => ({}));

import { BaseDownloader } from "../../../services/downloaders/BaseDownloader";

class TestDownloader extends BaseDownloader {
  async getVideoInfo(): Promise<any> {
    return {
      title: "test",
      author: "test",
      date: "20240101",
      thumbnailUrl: null,
    };
  }

  async downloadVideo(): Promise<any> {
    throw new Error("Not implemented for test");
  }

  public async downloadThumbnailPublic(
    thumbnailUrl: string,
    savePath: string,
  ): Promise<boolean> {
    return this.downloadThumbnail(thumbnailUrl, savePath);
  }
}

describe("BaseDownloader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSafePathInDirectories.mockImplementation(
      (filePath: string) => filePath,
    );

    let writer: any;
    writer = {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === "finish") {
          cb();
        }
        return writer;
      }),
    };

    mocks.createWriteStream.mockReturnValue(writer);
    mocks.axios.mockResolvedValue({
      data: {
        pipe: mocks.pipe,
      },
    });
  });

  it("allows avatar directory paths when downloading images", async () => {
    const downloader = new TestDownloader();

    const result = await downloader.downloadThumbnailPublic(
      "https://example.com/avatar.jpg",
      "/mock/avatars/temp_avatar.jpg",
    );

    expect(result).toBe(true);
    expect(mocks.resolveSafePathInDirectories).toHaveBeenCalledWith(
      "/mock/avatars/temp_avatar.jpg",
      ["/mock/videos", "/mock/images", "/mock/avatars"],
    );
  });
});
