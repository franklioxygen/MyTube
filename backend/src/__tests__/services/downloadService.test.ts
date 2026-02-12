import { beforeEach, describe, expect, it, vi } from "vitest";
import { continuousDownloadService } from "../../services/continuousDownloadService";
import * as downloadService from "../../services/downloadService";
import { BilibiliDownloader } from "../../services/downloaders/BilibiliDownloader";
import { MissAVDownloader } from "../../services/downloaders/MissAVDownloader";
import { YtDlpDownloader } from "../../services/downloaders/YtDlpDownloader";
import { getProviderScript } from "../../services/downloaders/ytdlp/ytdlpHelpers";
import * as storageService from "../../services/storageService";
import {
    extractBilibiliVideoId,
    isBilibiliUrl,
    isMissAVUrl,
} from "../../utils/helpers";
import { logger } from "../../utils/logger";
import {
    executeYtDlpJson,
    getNetworkConfigFromUserConfig,
    getUserYtDlpConfig,
} from "../../utils/ytDlpUtils";

vi.mock("../../services/downloaders/BilibiliDownloader");
vi.mock("../../services/downloaders/YtDlpDownloader");
vi.mock("../../services/downloaders/MissAVDownloader");
vi.mock("../../services/continuousDownloadService", () => ({
  continuousDownloadService: {
    getTaskByAuthorUrl: vi.fn(),
    createPlaylistTask: vi.fn(),
  },
}));
vi.mock("../../services/storageService", () => ({
  getCollectionByName: vi.fn(),
  getCollectionById: vi.fn(),
  saveCollection: vi.fn(),
  generateUniqueCollectionName: vi.fn((name: string) => name),
}));
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
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("uuid", () => ({
  v4: vi.fn(() => "uuid-fixed"),
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
    (continuousDownloadService.getTaskByAuthorUrl as any).mockResolvedValue(null);
    (continuousDownloadService.createPlaylistTask as any).mockResolvedValue(undefined);
    (storageService.getCollectionByName as any).mockReturnValue(null);
    (storageService.getCollectionById as any).mockReturnValue(null);
    (storageService.saveCollection as any).mockImplementation((collection: any) => collection);
  });

  describe("wrapper calls", () => {
    it("delegates bilibili download and check calls", async () => {
      await downloadService.downloadBilibiliVideo("u", "vp", "tp", "d1");
      await downloadService.checkBilibiliVideoParts("bv1");
      await downloadService.checkBilibiliCollectionOrSeries("bv1");
      await downloadService.getBilibiliCollectionVideos(1, 2);
      await downloadService.getBilibiliSeriesVideos(3, 4);

      expect(BilibiliDownloader.downloadVideo).toHaveBeenCalledWith(
        "u", "vp", "tp", "d1", undefined
      );
      expect(BilibiliDownloader.checkVideoParts).toHaveBeenCalledWith("bv1");
      expect(BilibiliDownloader.checkCollectionOrSeries).toHaveBeenCalledWith("bv1");
      expect(BilibiliDownloader.getCollectionVideos).toHaveBeenCalledWith(1, 2);
      expect(BilibiliDownloader.getSeriesVideos).toHaveBeenCalledWith(3, 4);
    });

    it("delegates bilibili part and collection downloads", async () => {
      await downloadService.downloadSingleBilibiliPart(
        "u", 2, 5, "series", "d2", undefined, "collection"
      );
      await downloadService.downloadBilibiliCollection({} as any, "c", "d3");
      await downloadService.downloadRemainingBilibiliParts(
        "u", 2, 5, "series", "cid", "d4"
      );

      expect(BilibiliDownloader.downloadSinglePart).toHaveBeenCalledWith(
        "u", 2, 5, "series", "d2", undefined, "collection"
      );
      expect(BilibiliDownloader.downloadCollection).toHaveBeenCalledWith(
        {}, "c", "d3"
      );
      expect(BilibiliDownloader.downloadRemainingParts).toHaveBeenCalledWith(
        "u", 2, 5, "series", "cid", "d4"
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

  describe("downloadChannelPlaylists", () => {
    const mockPlaylistFeedForCollectionCreation = () => {
      vi.mocked(executeYtDlpJson).mockResolvedValue({
        channel_id: "channel-id",
        entries: [
          { title: "No URL and ID" },
          { id: "pl-existing", title: "Existing Playlist" },
          {
            url: "https://www.youtube.com/playlist?list=pl-orphan",
            title: "Orphan Playlist",
          },
          {
            url: "https://www.youtube.com/playlist?list=pl-new",
            title: "Fresh:Playlist?*",
          },
          { id: "pl-title-match", title: "Title Match" },
        ],
      } as any);
    };

    const mockExistingPlaylistTaskLookups = () => {
      (continuousDownloadService.getTaskByAuthorUrl as any)
        .mockResolvedValueOnce({ collectionId: "col-existing" })
        .mockResolvedValueOnce({ collectionId: "col-missing" })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
    };

    const mockCollectionLookupsForPlaylistCreation = () => {
      (storageService.getCollectionById as any)
        .mockReturnValueOnce({ id: "col-existing", name: "Already There" })
        .mockReturnValueOnce(null);

      (storageService.getCollectionByName as any).mockImplementation((name: string) => {
        if (name === "Title Match - @channel-name") {
          return null;
        }
        if (name === "Title Match") {
          return { id: "col-title", name: "Title Match" };
        }
        return null;
      });
    };

    it("returns failure when no playlists are found", async () => {
      vi.mocked(executeYtDlpJson).mockResolvedValue({ entries: [] } as any);

      const result = await downloadService.downloadChannelPlaylists(
        "https://www.youtube.com/@demo"
      );

      expect(result).toEqual({
        success: false,
        message: "No playlists found on this channel.",
      });
      expect(executeYtDlpJson).toHaveBeenCalledWith(
        "https://www.youtube.com/@demo/playlists",
        expect.objectContaining({
          noWarnings: true,
          flatPlaylist: true,
          dumpSingleJson: true,
          playlistEnd: 100,
        })
      );
      expect(continuousDownloadService.createPlaylistTask).not.toHaveBeenCalled();
    });

    it("skips existing playlist tasks and creates collections/tasks for new playlists", async () => {
      mockPlaylistFeedForCollectionCreation();
      mockExistingPlaylistTaskLookups();
      mockCollectionLookupsForPlaylistCreation();

      const result = await downloadService.downloadChannelPlaylists(
        "https://www.youtube.com/@channel-name"
      );

      expect(result).toEqual({
        success: true,
        message: "Started downloading 2 playlists. Collections created.",
      });

      expect(storageService.saveCollection).toHaveBeenCalledTimes(1);
      expect(storageService.saveCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "uuid-fixed",
          name: "Fresh-Playlist-- - @channel-name",
          title: "Fresh-Playlist-- - @channel-name",
        })
      );

      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledTimes(2);
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=pl-new",
        "@channel-name",
        "YouTube",
        "uuid-fixed"
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=pl-title-match",
        "@channel-name",
        "YouTube",
        "col-title"
      );
    });

    it("adds provider extractor args and supports trailing slash channel URLs", async () => {
      vi.mocked(getProviderScript).mockReturnValue("/tmp/provider.js");
      vi.mocked(executeYtDlpJson).mockResolvedValue({
        uploader: "Channel A",
        entries: [{ id: "pl-1", title: "Playlist 1" }],
      } as any);

      await downloadService.downloadChannelPlaylists(
        "https://www.youtube.com/@channela/"
      );

      expect(executeYtDlpJson).toHaveBeenCalledWith(
        "https://www.youtube.com/@channela/playlists",
        expect.objectContaining({
          extractorArgs: "youtubepot-bgutilscript:script_path=/tmp/provider.js",
        })
      );
      expect(continuousDownloadService.createPlaylistTask).toHaveBeenCalledWith(
        "https://www.youtube.com/playlist?list=pl-1",
        "Channel A",
        "YouTube",
        "uuid-fixed"
      );
    });

    it("returns failure payload when processing throws", async () => {
      vi.mocked(executeYtDlpJson).mockRejectedValue(new Error("network error"));

      const result = await downloadService.downloadChannelPlaylists(
        "https://www.youtube.com/@broken"
      );

      expect(result).toEqual({
        success: false,
        message: "network error",
      });
      expect(logger.error).toHaveBeenCalledWith(
        "Error processing channel playlists:",
        expect.any(Error)
      );
    });
  });
});
