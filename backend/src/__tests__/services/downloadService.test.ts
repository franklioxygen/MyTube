import { beforeEach, describe, expect, it, vi } from "vitest";
import * as downloadService from "../../services/downloadService";
import { BilibiliDownloader } from "../../services/downloaders/BilibiliDownloader";
import { MissAVDownloader } from "../../services/downloaders/MissAVDownloader";
import { YtDlpDownloader } from "../../services/downloaders/YtDlpDownloader";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";
import { getProviderScript } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import {
  extractBilibiliVideoId,
  isBilibiliUrl,
  isMissAVUrl,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";

vi.mock("../../services/downloaders/BilibiliDownloader");
vi.mock("../../services/downloaders/YtDlpDownloader");
vi.mock("../../services/downloaders/MissAVDownloader");
vi.mock("../../utils/ytDlpUtils", () => ({
  executeYtDlpJson: vi.fn(),
  getNetworkConfigFromUserConfig: vi.fn(),
  getUserYtDlpConfig: vi.fn(),
}));
vi.mock("../../services/downloaders/ytdlp/ytdlpHelpers", () => ({
  getProviderScript: vi.fn(),
}));
vi.mock("../../utils/helpers", () => ({
  extractBilibiliVideoId: vi.fn(),
  isBilibiliUrl: vi.fn(),
  isMissAVUrl: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("downloadService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserYtDlpConfig).mockReturnValue({ timeout: 10 } as any);
    vi.mocked(getNetworkConfigFromUserConfig).mockReturnValue({
      proxy: "http://proxy",
    } as any);
    vi.mocked(getProviderScript).mockReturnValue(undefined);
    vi.mocked(isBilibiliUrl).mockReturnValue(false);
    vi.mocked(isMissAVUrl).mockReturnValue(false);
    vi.mocked(extractBilibiliVideoId).mockReturnValue(null);
  });

  describe("wrapper calls", () => {
    it("delegates bilibili download helpers", async () => {
      await downloadService.downloadBilibiliVideo("u", "vp", "tp", "d1");
      await downloadService.checkBilibiliVideoParts("bv1");
      await downloadService.checkBilibiliCollectionOrSeries("bv1");
      await downloadService.getBilibiliCollectionVideos(1, 2);
      await downloadService.getBilibiliSeriesVideos(3, 4);
      await downloadService.downloadSingleBilibiliPart(
        "u",
        2,
        5,
        "series",
        "d2",
        undefined,
        "collection"
      );
      await downloadService.downloadBilibiliCollection({} as any, "c", "d3");
      await downloadService.downloadRemainingBilibiliParts(
        "u",
        2,
        5,
        "series",
        "cid",
        "d4"
      );

      expect(BilibiliDownloader.downloadVideo).toHaveBeenCalledWith(
        "u",
        "vp",
        "tp",
        "d1",
        undefined
      );
      expect(BilibiliDownloader.checkVideoParts).toHaveBeenCalledWith("bv1");
      expect(BilibiliDownloader.checkCollectionOrSeries).toHaveBeenCalledWith(
        "bv1"
      );
      expect(BilibiliDownloader.getCollectionVideos).toHaveBeenCalledWith(1, 2);
      expect(BilibiliDownloader.getSeriesVideos).toHaveBeenCalledWith(3, 4);
      expect(BilibiliDownloader.downloadSinglePart).toHaveBeenCalledWith(
        "u",
        2,
        5,
        "series",
        "d2",
        undefined,
        "collection"
      );
      expect(BilibiliDownloader.downloadCollection).toHaveBeenCalledWith(
        {},
        "c",
        "d3"
      );
      expect(BilibiliDownloader.downloadRemainingParts).toHaveBeenCalledWith(
        "u",
        2,
        5,
        "series",
        "cid",
        "d4"
      );
    });

    it("delegates yt-dlp and missav helpers", async () => {
      await downloadService.searchYouTube("query", 20, 2);
      await downloadService.downloadYouTubeVideo("https://youtube.com/v", "d5");
      await downloadService.downloadMissAVVideo("https://missav.com/v", "d6");

      expect(YtDlpDownloader.search).toHaveBeenCalledWith("query", 20, 2);
      expect(YtDlpDownloader.downloadVideo).toHaveBeenCalledWith(
        "https://youtube.com/v",
        "d5",
        undefined
      );
      expect(MissAVDownloader.downloadVideo).toHaveBeenCalledWith(
        "https://missav.com/v",
        "d6",
        undefined
      );
    });
  });

  describe("checkPlaylist", () => {
    it("returns playlist metadata using provider script when available", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      vi.mocked(executeYtDlpJson).mockResolvedValue({
        _type: "playlist",
        title: "My List",
        playlist_count: 9,
      } as any);

      const result = await downloadService.checkPlaylist("https://youtube.com/playlist?list=xx");

      expect(result).toEqual({ success: true, title: "My List", videoCount: 9 });
      expect(executeYtDlpJson).toHaveBeenCalledWith(
        "https://youtube.com/playlist?list=xx",
        expect.objectContaining({
          noWarnings: true,
          flatPlaylist: true,
          extractorArgs: expect.stringContaining("script_path=/tmp/provider.js"),
        })
      );
    });

    it("recognizes playlist by entries array and fallback title", async () => {
      vi.mocked(executeYtDlpJson).mockResolvedValue({
        entries: [{ id: 1 }, { id: 2 }],
        playlist: "Playlist Name",
      } as any);

      const result = await downloadService.checkPlaylist("https://youtube.com/playlist?list=yy");

      expect(result).toEqual({ success: true, title: "Playlist Name", videoCount: 2 });
    });

    it("returns not playlist when metadata does not contain playlist info", async () => {
      vi.mocked(executeYtDlpJson).mockResolvedValue({ title: "Single Video" } as any);

      const result = await downloadService.checkPlaylist("https://youtube.com/watch?v=abc");

      expect(result).toEqual({ success: false, error: "Not a valid playlist" });
    });

    it("returns error payload when yt-dlp throws", async () => {
      vi.mocked(executeYtDlpJson).mockRejectedValue(new Error("yt-dlp failed"));

      const result = await downloadService.checkPlaylist("https://youtube.com/playlist?list=zz");

      expect(result).toEqual({ success: false, error: "yt-dlp failed" });
      expect(logger.error).toHaveBeenCalledWith(
        "Error checking playlist:",
        expect.any(Error)
      );
    });
  });

  describe("getVideoInfo", () => {
    it("uses bilibili downloader for bilibili urls with valid video id", async () => {
      vi.mocked(isBilibiliUrl).mockReturnValue(true);
      vi.mocked(extractBilibiliVideoId).mockReturnValue("BV1xx411");

      await downloadService.getVideoInfo("https://www.bilibili.com/video/BV1xx411");

      expect(BilibiliDownloader.getVideoInfo).toHaveBeenCalledWith("BV1xx411");
      expect(MissAVDownloader.getVideoInfo).not.toHaveBeenCalled();
      expect(YtDlpDownloader.getVideoInfo).not.toHaveBeenCalled();
    });

    it("falls back to yt-dlp for bilibili urls without extractable video id", async () => {
      vi.mocked(isBilibiliUrl).mockReturnValue(true);
      vi.mocked(extractBilibiliVideoId).mockReturnValue(null);

      await downloadService.getVideoInfo("https://www.bilibili.com/video/no-id");

      expect(YtDlpDownloader.getVideoInfo).toHaveBeenCalledWith(
        "https://www.bilibili.com/video/no-id"
      );
    });

    it("uses missav downloader for missav urls", async () => {
      vi.mocked(isMissAVUrl).mockReturnValue(true);

      await downloadService.getVideoInfo("https://missav.com/watch/123");

      expect(MissAVDownloader.getVideoInfo).toHaveBeenCalledWith(
        "https://missav.com/watch/123"
      );
      expect(YtDlpDownloader.getVideoInfo).not.toHaveBeenCalled();
    });

    it("uses yt-dlp for all other urls", async () => {
      await downloadService.getVideoInfo("https://youtube.com/watch?v=normal");

      expect(YtDlpDownloader.getVideoInfo).toHaveBeenCalledWith(
        "https://youtube.com/watch?v=normal"
      );
    });
  });

  describe("createDownloadTask", () => {
    it("creates missav task", async () => {
      const task = downloadService.createDownloadTask(
        "missav",
        "https://missav.com/v",
        "d1"
      );
      const cancel = vi.fn();

      await task(cancel);

      expect(MissAVDownloader.downloadVideo).toHaveBeenCalledWith(
        "https://missav.com/v",
        "d1",
        cancel
      );
    });

    it("creates bilibili task", async () => {
      const task = downloadService.createDownloadTask(
        "bilibili",
        "https://www.bilibili.com/video/BV1xx",
        "d2"
      );
      const cancel = vi.fn();

      await task(cancel);

      expect(BilibiliDownloader.downloadSinglePart).toHaveBeenCalledWith(
        "https://www.bilibili.com/video/BV1xx",
        1,
        1,
        "",
        "d2",
        cancel
      );
    });

    it("creates default yt-dlp task for unknown type", async () => {
      const task = downloadService.createDownloadTask(
        "youtube",
        "https://youtube.com/watch?v=1",
        "d3"
      );
      const cancel = vi.fn();

      await task(cancel);

      expect(YtDlpDownloader.downloadVideo).toHaveBeenCalledWith(
        "https://youtube.com/watch?v=1",
        "d3",
        cancel
      );
    });
  });
});
