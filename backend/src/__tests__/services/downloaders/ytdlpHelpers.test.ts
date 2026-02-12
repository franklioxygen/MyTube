/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractXiaoHongShuAuthor } from "../../../services/downloaders/ytdlp/ytdlpHelpers";

vi.mock("axios");
vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ytdlpHelpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractXiaoHongShuAuthor", () => {
    it("should extract author nickname from profile html using uploader_id", async () => {
      (axios.get as any).mockResolvedValue({
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
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
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
      expect(axios.get).not.toHaveBeenCalled();
    });

    it("should return null when uploader_id is missing", async () => {
      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
      );

      expect(author).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });

    it("should decode escaped unicode nickname", async () => {
      (axios.get as any).mockResolvedValue({
        data: '{"user":{"userId":"676255a3000000001801484c","nickname":"\\u867e\\u4ec1\\u4e0d\\u7728\\u773c"}}',
      });

      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
        "676255a3000000001801484c",
      );

      expect(author).toBe("虾仁不眨眼");
    });
  });
});
