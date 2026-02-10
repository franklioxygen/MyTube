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
    it("should extract author on allowed XiaoHongShu URL", async () => {
      (axios.get as any).mockResolvedValue({
        data: '{"nickname":"test-author"}',
      });

      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com/explore/123",
      );

      expect(author).toBe("test-author");
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it("should block URL with credentials", async () => {
      const author = await extractXiaoHongShuAuthor(
        "https://user:pass@www.xiaohongshu.com/explore/123",
      );

      expect(author).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });

    it("should block URL with explicit port", async () => {
      const author = await extractXiaoHongShuAuthor(
        "https://www.xiaohongshu.com:8443/explore/123",
      );

      expect(author).toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
