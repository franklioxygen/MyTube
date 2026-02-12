import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadCancelledError } from "../../errors/DownloadErrors";
import * as storageService from "../../services/storageService";
import * as downloadUtils from "../../utils/downloadUtils";
import { sanitizeLogMessage } from "../../utils/logger";
import { validatePathWithinDirectories } from "../../utils/security";

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../../services/storageService", () => ({
  getDownloadStatus: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  sanitizeLogMessage: vi.fn((input: string) => input),
}));
vi.mock("../../utils/security", () => ({
  validatePathWithinDirectories: vi.fn(),
}));

describe("downloadUtils", () => {
  let setTimeoutSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(((fn: (...args: any[]) => void) => {
        fn();
        return 0 as any;
      }) as any);

    vi.mocked(storageService.getDownloadStatus as any).mockReturnValue({
      activeDownloads: [],
    });

    vi.mocked(fs.existsSync as any).mockReturnValue(false);
    vi.mocked(fs.readdirSync as any).mockReturnValue([]);
    vi.mocked(fs.remove as any).mockResolvedValue(undefined);

    vi.mocked(sanitizeLogMessage as any).mockImplementation((v: string) => v);
    vi.mocked(validatePathWithinDirectories as any).mockReturnValue(true);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  describe("isDownloadActive / throwIfCancelled", () => {
    it("returns true when no download id is provided", () => {
      expect(downloadUtils.isDownloadActive()).toBe(true);
    });

    it("returns true when id is still active", () => {
      vi.mocked(storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [{ id: "job-1" }],
      });

      expect(downloadUtils.isDownloadActive("job-1")).toBe(true);
    });

    it("returns false when id is no longer active", () => {
      vi.mocked(storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [{ id: "job-2" }],
      });

      expect(downloadUtils.isDownloadActive("job-1")).toBe(false);
    });

    it("throws DownloadCancelledError when cancelled", () => {
      expect(() => downloadUtils.throwIfCancelled("job-1")).toThrow(
        DownloadCancelledError
      );
    });

    it("does not throw when still active", () => {
      vi.mocked(storageService.getDownloadStatus as any).mockReturnValue({
        activeDownloads: [{ id: "job-1" }],
      });

      expect(() => downloadUtils.throwIfCancelled("job-1")).not.toThrow();
    });
  });

  describe("isCancellationError", () => {
    it("returns true for cancellation errors", () => {
      expect(
        downloadUtils.isCancellationError(DownloadCancelledError.create())
      ).toBe(true);
    });

    it("returns false for non-cancellation errors", () => {
      expect(downloadUtils.isCancellationError(new Error("boom"))).toBe(false);
    });
  });

  describe("cleanupSubtitleFiles", () => {
    it("returns empty list when directory does not exist", async () => {
      vi.mocked(fs.existsSync as any).mockReturnValue(false);

      const result = await downloadUtils.cleanupSubtitleFiles("video");

      expect(result).toEqual([]);
    });

    it("removes matching vtt subtitle files", async () => {
      const dir = "/tmp/subtitles";

      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "video.en.vtt",
        "video.zh.vtt",
        "video.mp4",
        "other.vtt",
      ]);
      vi.mocked(fs.existsSync as any).mockImplementation((filePath: string) => {
        if (filePath === dir) return true;
        return filePath.endsWith(".vtt");
      });

      const result = await downloadUtils.cleanupSubtitleFiles("video", dir);

      expect(result).toEqual([
        `${dir}/video.en.vtt`,
        `${dir}/video.zh.vtt`,
      ]);
      expect(fs.remove).toHaveBeenCalledTimes(2);
    });

    it("handles cleanup exceptions and returns empty list", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(fs.existsSync as any).mockReturnValue(true);
      vi.mocked(fs.readdirSync as any).mockImplementation(() => {
        throw new Error("readdir failed");
      });

      const result = await downloadUtils.cleanupSubtitleFiles("video", "/tmp");

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("cleanupTemporaryFiles", () => {
    it("returns empty list when video directory does not exist", async () => {
      vi.mocked(fs.existsSync as any).mockReturnValue(false);

      const result = await downloadUtils.cleanupTemporaryFiles("/tmp/a/video.mp4");

      expect(result).toEqual([]);
    });

    it("removes temp files and partial video file", async () => {
      const videoPath = "/tmp/videos/movie.mp4";
      const videoDir = "/tmp/videos";

      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "movie.mp4",
        "movie.mp4.part",
        "movie.mp4.ytdl",
        "movie.mp4.txt",
      ]);

      vi.mocked(fs.existsSync as any).mockImplementation((filePath: string) => {
        if (filePath === videoDir) return true;
        if (filePath === `${videoDir}/movie.mp4.part`) return true;
        if (filePath === `${videoDir}/movie.mp4.ytdl`) return true;
        if (filePath === videoPath) return true;
        return false;
      });

      const result = await downloadUtils.cleanupTemporaryFiles(videoPath);

      expect(result).toEqual([
        `${videoDir}/movie.mp4.part`,
        `${videoDir}/movie.mp4.ytdl`,
        videoPath,
      ]);
      expect(fs.remove).toHaveBeenCalledTimes(3);
    });

    it("handles temporary file cleanup errors", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(fs.existsSync as any).mockReturnValue(true);
      vi.mocked(fs.readdirSync as any).mockImplementation(() => {
        throw new Error("boom");
      });

      const result = await downloadUtils.cleanupTemporaryFiles("/tmp/x.mp4");

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("cleanupPartialVideoFiles", () => {
    it("removes .part and full video file when both exist", async () => {
      const videoPath = "/tmp/videos/m.mp4";

      vi.mocked(fs.existsSync as any).mockImplementation((filePath: string) => {
        return filePath === `${videoPath}.part` || filePath === videoPath;
      });

      const result = await downloadUtils.cleanupPartialVideoFiles(videoPath);

      expect(result).toEqual([`${videoPath}.part`, videoPath]);
      expect(fs.remove).toHaveBeenCalledTimes(2);
    });

    it("handles partial cleanup errors", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(fs.existsSync as any).mockImplementation(() => {
        throw new Error("exists failed");
      });

      const result = await downloadUtils.cleanupPartialVideoFiles("/tmp/videos/m.mp4");

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("parseSize / formatBytes / calculateDownloadedSize", () => {
    it("parses binary and decimal units", () => {
      expect(downloadUtils.parseSize("1 KiB")).toBe(1024);
      expect(downloadUtils.parseSize("2 MB")).toBe(2_000_000);
      expect(downloadUtils.parseSize("~1.5 GiB")).toBe(1.5 * 1024 * 1024 * 1024);
    });

    it("returns 0 for invalid size strings", () => {
      expect(downloadUtils.parseSize("")).toBe(0);
      expect(downloadUtils.parseSize("unknown")).toBe(0);
    });

    it("formats bytes with binary units", () => {
      expect(downloadUtils.formatBytes(0)).toBe("0 B");
      expect(downloadUtils.formatBytes(1024)).toBe("1 KiB");
      expect(downloadUtils.formatBytes(1536)).toBe("1.5 KiB");
    });

    it("calculates downloaded size from percentage", () => {
      expect(downloadUtils.calculateDownloadedSize(50, "100 MiB")).toBe("50 MiB");
      expect(downloadUtils.calculateDownloadedSize(20, "?")).toBe("0 B");
    });
  });

  describe("cleanupVideoArtifacts", () => {
    it("returns empty list when directory is missing", async () => {
      vi.mocked(fs.existsSync as any).mockReturnValue(false);

      const result = await downloadUtils.cleanupVideoArtifacts("video", "/tmp/x");

      expect(result).toEqual([]);
    });

    it("deletes artifact files matching known patterns", async () => {
      const dir = "/tmp/artifacts";

      vi.mocked(fs.readdirSync as any).mockReturnValue([
        "video.part",
        "video.ytdl",
        "video.f137.mp4",
        "video.temp.mp4",
        "video.mp4",
        "video-extra.mp4",
        "other.part",
      ]);

      vi.mocked(fs.existsSync as any).mockImplementation((filePath: string) => {
        if (filePath === dir) return true;
        return filePath.startsWith(`${dir}/video`);
      });

      const result = await downloadUtils.cleanupVideoArtifacts("video", dir);

      expect(result).toEqual([
        `${dir}/video.part`,
        `${dir}/video.ytdl`,
        `${dir}/video.f137.mp4`,
        `${dir}/video.temp.mp4`,
        `${dir}/video.mp4`,
      ]);
      expect(fs.remove).toHaveBeenCalledTimes(5);
    });

    it("handles artifact cleanup exceptions", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(fs.existsSync as any).mockReturnValue(true);
      vi.mocked(fs.readdirSync as any).mockImplementation(() => {
        throw new Error("failed");
      });

      const result = await downloadUtils.cleanupVideoArtifacts("video", "/tmp/x");

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("safeRemove", () => {
    it("refuses to remove paths outside allow-list", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(validatePathWithinDirectories as any).mockReturnValue(false);

      await downloadUtils.safeRemove("/etc/passwd", 1, 0);

      expect(fs.remove).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Refusing to remove path outside allowed directories:",
        "/etc/passwd"
      );

      consoleErrorSpy.mockRestore();
    });

    it("removes path when it exists", async () => {
      vi.mocked(validatePathWithinDirectories as any).mockReturnValue(true);
      vi.mocked(fs.existsSync as any).mockReturnValue(true);

      await downloadUtils.safeRemove("/tmp/file.tmp", 1, 0);

      expect(fs.remove).toHaveBeenCalledTimes(1);
    });

    it("does nothing when path does not exist", async () => {
      vi.mocked(validatePathWithinDirectories as any).mockReturnValue(true);
      vi.mocked(fs.existsSync as any).mockReturnValue(false);

      await downloadUtils.safeRemove("/tmp/file.tmp", 1, 0);

      expect(fs.remove).not.toHaveBeenCalled();
    });

    it("retries after a failure and succeeds", async () => {
      vi.mocked(validatePathWithinDirectories as any).mockReturnValue(true);
      vi.mocked(fs.existsSync as any).mockReturnValue(true);
      vi.mocked(fs.remove as any)
        .mockRejectedValueOnce(new Error("locked"))
        .mockResolvedValueOnce(undefined);

      await downloadUtils.safeRemove("/tmp/retry.tmp", 2, 0);

      expect(fs.remove).toHaveBeenCalledTimes(2);
    });

    it("logs error after final retry failure", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      vi.mocked(validatePathWithinDirectories as any).mockReturnValue(true);
      vi.mocked(fs.existsSync as any).mockReturnValue(true);
      vi.mocked(fs.remove as any).mockRejectedValue(new Error("still locked"));

      await downloadUtils.safeRemove("/tmp/fail.tmp", 1, 0);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to remove path after retry attempts:",
        "/tmp/fail.tmp",
        1,
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
