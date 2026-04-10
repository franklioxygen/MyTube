/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractXiaoHongShuAuthor,
  getProviderScript,
} from "../../../services/downloaders/ytdlp/ytdlpHelpers";
import { logger } from "../../../utils/logger";

vi.mock("axios");
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}));
vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ytdlpHelpers", () => {
  const axiosGetMock = vi.mocked(axios.get);
  const existsSyncMock = vi.mocked(fs.existsSync);
  const loggerWarnMock = vi.mocked(logger.warn);
  const originalCwd = process.cwd();
  const bundledScriptPath = path.resolve(
    originalCwd,
    "bgutil-ytdlp-pot-provider/server/build/generate_once.js",
  );
  const srcLayoutFallbackPath = path.resolve(
    originalCwd,
    "src/services/downloaders/ytdlp",
    "../../../..",
    "bgutil-ytdlp-pot-provider/server/build/generate_once.js",
  );
  const deeperFallbackPath = path.resolve(
    originalCwd,
    "src/services/downloaders/ytdlp",
    "../../../../..",
    "bgutil-ytdlp-pot-provider/server/build/generate_once.js",
  );
  const alternateCwd = path.resolve(originalCwd, "src");

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(false);
    delete process.env.BGUTIL_SCRIPT_PATH;
    process.chdir(originalCwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  describe("extractXiaoHongShuAuthor", () => {
    it("should extract author nickname from profile html using uploader_id", async () => {
      axiosGetMock.mockResolvedValue({
        data: `
          <script>
            window.__INITIAL_STATE__={"user":{"userId":"676255a3000000001801484c","nickname":"虾仁不眨眼","nickName":"虾仁不眨眼"}}
          </script>
        `,
      });

      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
        "676255a3000000001801484c",
      );

      expect(author).toBe("虾仁不眨眼");
      expect(axiosGetMock).toHaveBeenCalledTimes(1);
      expect(axiosGetMock).toHaveBeenCalledWith(
        "https://www.xiaohongshu.com/user/profile/676255a3000000001801484c",
        expect.any(Object),
      );
    });

    it("should return null and avoid request when uploader_id is invalid", async () => {
      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
        "invalid-id-with-slash/..",
      );

      expect(author).toBeNull();
      expect(axiosGetMock).not.toHaveBeenCalled();
    });

    it("should return null when uploader_id is missing", async () => {
      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
      );

      expect(author).toBeNull();
      expect(axiosGetMock).not.toHaveBeenCalled();
    });

    it("should decode escaped unicode nickname", async () => {
      axiosGetMock.mockResolvedValue({
        data: '{"user":{"userId":"676255a3000000001801484c","nickname":"\\u867e\\u4ec1\\u4e0d\\u7728\\u773c"}}',
      });

      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
        "676255a3000000001801484c",
      );

      expect(author).toBe("虾仁不眨眼");
    });
  });

  describe("getProviderScript", () => {
    it("should prefer BGUTIL_SCRIPT_PATH when configured", () => {
      process.env.BGUTIL_SCRIPT_PATH = "/tmp/custom-provider.js";
      existsSyncMock.mockReturnValue(true);

      expect(getProviderScript()).toBe("/tmp/custom-provider.js");
      expect(existsSyncMock).toHaveBeenCalledWith("/tmp/custom-provider.js");
      expect(existsSyncMock).toHaveBeenCalledTimes(1);
      expect(loggerWarnMock).not.toHaveBeenCalled();
    });

    it("should warn once when BGUTIL_SCRIPT_PATH points to a missing file", () => {
      process.env.BGUTIL_SCRIPT_PATH = "/tmp/missing-provider.js";

      expect(getProviderScript()).toBe("/tmp/missing-provider.js");
      expect(getProviderScript()).toBe("/tmp/missing-provider.js");
      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
      expect(loggerWarnMock).toHaveBeenCalledWith(
        "BGUTIL_SCRIPT_PATH points to a non-existent file: /tmp/missing-provider.js",
      );
    });

    it("should stop searching after finding the bundled provider script in the current working directory", () => {
      existsSyncMock.mockImplementation((target: any) => target === bundledScriptPath);

      expect(getProviderScript()).toBe(bundledScriptPath);
      expect(existsSyncMock).toHaveBeenCalledTimes(1);
      expect(existsSyncMock).toHaveBeenNthCalledWith(1, bundledScriptPath);
    });

    it("should fall back to the helper-relative bundled provider script path", () => {
      process.chdir(alternateCwd);
      const cwdCandidatePath = path.resolve(
        alternateCwd,
        "bgutil-ytdlp-pot-provider/server/build/generate_once.js",
      );
      existsSyncMock.mockImplementation((target: any) => target === srcLayoutFallbackPath);

      expect(getProviderScript()).toBe(srcLayoutFallbackPath);
      expect(existsSyncMock).toHaveBeenCalledTimes(2);
      expect(existsSyncMock).toHaveBeenNthCalledWith(1, cwdCandidatePath);
      expect(existsSyncMock).toHaveBeenNthCalledWith(2, srcLayoutFallbackPath);
    });

    it("should return empty string when no provider script is available", () => {
      process.chdir(alternateCwd);
      const cwdCandidatePath = path.resolve(
        alternateCwd,
        "bgutil-ytdlp-pot-provider/server/build/generate_once.js",
      );

      expect(getProviderScript()).toBe("");
      expect(existsSyncMock).toHaveBeenCalledTimes(3);
      expect(existsSyncMock).toHaveBeenNthCalledWith(1, cwdCandidatePath);
      expect(existsSyncMock).toHaveBeenNthCalledWith(2, srcLayoutFallbackPath);
      expect(existsSyncMock).toHaveBeenNthCalledWith(3, deeperFallbackPath);
    });
  });
});
