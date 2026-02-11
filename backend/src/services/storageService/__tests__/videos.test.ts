import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVATARS_DIR, IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { db } from "../../../db";
import { DatabaseError } from "../../../errors/DownloadErrors";
import { formatVideoFilename } from "../../../utils/helpers";
import * as collections from "../collections";
import * as fileHelpers from "../fileHelpers";
import { markVideoDownloadDeleted } from "../videoDownloadTracking";
import {
  deleteVideo,
  formatLegacyFilenames,
  getVideoById,
  getVideoBySourceUrl,
  getVideoPartBySourceUrl,
  getVideos,
  saveVideo,
  updateVideo,
} from "../videos";

vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("fs-extra");
vi.mock("../fileHelpers");
vi.mock("../collections");
vi.mock("../videoDownloadTracking", () => ({
  markVideoDownloadDeleted: vi.fn(),
}));
vi.mock("../../../utils/helpers", () => ({
  formatVideoFilename: vi.fn(),
}));
vi.mock("../../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const mockSelect = ({
  allRows = [],
  whereRow,
}: {
  allRows?: any[];
  whereRow?: any;
}) => {
  const allMock = vi.fn().mockReturnValue(allRows);
  const getMock = vi.fn().mockReturnValue(whereRow);
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({ all: allMock }),
      where: vi.fn().mockReturnValue({
        get: getMock,
      }),
    }),
  } as any);
  return { allMock, getMock };
};

describe("storageService videos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formatVideoFilename).mockReturnValue("Formatted.Title-Author-2024");
  });

  describe("getVideos/getVideoBy* helpers", () => {
    it("should return all videos with parsed tags and subtitles", () => {
      mockSelect({
        allRows: [
          {
            id: "1",
            title: "Video 1",
            createdAt: "2023-01-01",
            tags: '["tag1"]',
            subtitles: '[{"filename":"sub.vtt","language":"en"}]',
          },
        ],
      });

      const result = getVideos();
      expect(result).toHaveLength(1);
      expect(result[0].tags).toEqual(["tag1"]);
      expect(result[0].subtitles).toEqual([
        { filename: "sub.vtt", language: "en" },
      ]);
    });

    it("should return empty array on select errors", () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error("DB Error");
      });
      expect(getVideos()).toEqual([]);
    });

    it("should get video by source url and parse json fields", () => {
      mockSelect({
        whereRow: {
          id: "v1",
          sourceUrl: "https://example.com/v1",
          tags: '["a"]',
          subtitles: '[{"filename":"s.vtt"}]',
        },
      });

      const result = getVideoBySourceUrl("https://example.com/v1");
      expect(result).toEqual(
        expect.objectContaining({
          id: "v1",
          tags: ["a"],
          subtitles: [{ filename: "s.vtt" }],
        })
      );
    });

    it("should throw DatabaseError when getVideoBySourceUrl fails", () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error("boom");
      });
      expect(() => getVideoBySourceUrl("x")).toThrow(DatabaseError);
    });

    it("should get video by id and support part lookup", () => {
      mockSelect({
        whereRow: {
          id: "v2",
          sourceUrl: "source",
          tags: "[]",
          subtitles: undefined,
        },
      });
      expect(getVideoById("v2")?.id).toBe("v2");
      expect(getVideoPartBySourceUrl("source")?.id).toBe("v2");
    });

    it("should throw DatabaseError when getVideoById fails", () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error("boom");
      });
      expect(() => getVideoById("id")).toThrow(DatabaseError);
    });
  });

  describe("saveVideo/updateVideo", () => {
    it("should save video with stringified tags/subtitles", () => {
      const runMock = vi.fn();
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({ run: runMock }),
        }),
      } as any);

      const video = {
        id: "1",
        title: "Test",
        tags: ["tag1"],
        subtitles: [{ filename: "sub.vtt", language: "en" }],
      } as any;
      const saved = saveVideo(video);

      expect(saved).toEqual(video);
      expect(runMock).toHaveBeenCalled();
      const valuesArg = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0];
      expect(valuesArg.tags).toBe('["tag1"]');
      expect(valuesArg.subtitles).toContain("sub.vtt");
    });

    it("should throw DatabaseError when saveVideo fails", () => {
      vi.mocked(db.insert).mockImplementation(() => {
        throw new Error("insert failed");
      });
      expect(() => saveVideo({ id: "1" } as any)).toThrow(DatabaseError);
    });

    it("should update video and parse returned JSON fields", () => {
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({
                id: "1",
                title: "Updated",
                tags: '["x"]',
                subtitles: '[{"filename":"sub1.vtt"}]',
              }),
            }),
          }),
        }),
      } as any);

      const result = updateVideo("1", {
        title: "Updated",
        tags: ["x"],
        subtitles: [{ filename: "sub1.vtt" }] as any,
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: "1",
          title: "Updated",
          tags: ["x"],
          subtitles: [{ filename: "sub1.vtt" }],
        })
      );
    });

    it("should return null if update returns no row", () => {
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue(undefined),
            }),
          }),
        }),
      } as any);
      expect(updateVideo("1", { title: "x" })).toBeNull();
    });

    it("should throw DatabaseError on update failures", () => {
      vi.mocked(db.update).mockImplementation(() => {
        throw new Error("update failed");
      });
      expect(() => updateVideo("1", { title: "x" })).toThrow(DatabaseError);
    });
  });

  describe("formatLegacyFilenames", () => {
    const mockUpdateRun = () => {
      const run = vi.fn();
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ run }),
        }),
      } as any);
      return run;
    };

    it("should skip videos already using formatted filename", () => {
      mockSelect({
        allRows: [
          {
            id: "1",
            title: "Video 1",
            author: "Author",
            date: "2024",
            videoFilename: "Formatted.Title-Author-2024.mp4",
            videoPath: "/videos/Formatted.Title-Author-2024.mp4",
          },
        ],
      });
      mockUpdateRun();

      const result = formatLegacyFilenames();
      expect(result.processed).toBe(1);
      expect(result.renamed).toBe(0);
      expect(db.update).not.toHaveBeenCalled();
    });

    it("should rename video, thumbnail and subtitles in normal path", () => {
      mockSelect({
        allRows: [
          {
            id: "1",
            title: "Old Title",
            author: "Author",
            date: "2024",
            videoFilename: "old.mp4",
            videoPath: "/videos/collection/old.mp4",
            thumbnailFilename: "old.jpg",
            thumbnailPath: "/images/collection/old.jpg",
            subtitles:
              '[{"filename":"old.en.vtt","language":"en","path":"/subtitles/old.en.vtt"}]',
          },
        ],
      });
      mockUpdateRun();

      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return (
          p === path.join(VIDEOS_DIR, "collection", "old.mp4") ||
          p === path.join(IMAGES_DIR, "collection", "old.jpg") ||
          p === path.join(SUBTITLES_DIR, "old.en.vtt")
        );
      });

      formatLegacyFilenames();

      expect(fs.renameSync).toHaveBeenCalledWith(
        path.join(VIDEOS_DIR, "collection", "old.mp4"),
        path.join(VIDEOS_DIR, "collection", "Formatted.Title-Author-2024.mp4")
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        path.join(IMAGES_DIR, "collection", "old.jpg"),
        path.join(IMAGES_DIR, "collection", "Formatted.Title-Author-2024.jpg")
      );
      expect(fs.renameSync).toHaveBeenCalledWith(
        path.join(SUBTITLES_DIR, "old.en.vtt"),
        path.join(SUBTITLES_DIR, "Formatted.Title-Author-2024.en.vtt")
      );
    });

    it("should use unique suffix when destination file already exists", () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      mockSelect({
        allRows: [
          {
            id: "1",
            title: "Old Title",
            author: "Author",
            date: "2024",
            videoFilename: "old.mp4",
            videoPath: "/videos/old.mp4",
            thumbnailFilename: "old.jpg",
            thumbnailPath: "/images/old.jpg",
            subtitles:
              '[{"filename":"old.en.vtt","language":"en","path":"/subtitles/old.en.vtt"}]',
          },
        ],
      });
      mockUpdateRun();

      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return (
          p === path.join(VIDEOS_DIR, "old.mp4") ||
          p === path.join(VIDEOS_DIR, "Formatted.Title-Author-2024.mp4") ||
          p === path.join(IMAGES_DIR, "old.jpg") ||
          p === path.join(SUBTITLES_DIR, "old.en.vtt")
        );
      });

      const result = formatLegacyFilenames();
      expect(result.renamed).toBe(1);

      expect(fs.renameSync).toHaveBeenCalledWith(
        path.join(VIDEOS_DIR, "old.mp4"),
        path.join(VIDEOS_DIR, "Formatted.Title-Author-2024_1700000000000.mp4")
      );
    });

    it("should track missing-file entries and per-video errors", () => {
      mockSelect({
        allRows: [
          {
            id: "missing",
            title: "Missing File",
            author: "A",
            date: "2024",
            videoFilename: "missing.mp4",
            videoPath: "/videos/missing.mp4",
          },
          {
            id: "error",
            title: "Rename Error",
            author: "A",
            date: "2024",
            videoFilename: "error.mp4",
            videoPath: "/videos/error.mp4",
          },
        ],
      });
      mockUpdateRun();
      vi.mocked(fs.existsSync).mockImplementation((target: any) =>
        String(target) === path.join(VIDEOS_DIR, "error.mp4")
      );
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error("rename failed");
      });

      const result = formatLegacyFilenames();
      expect(result.processed).toBe(2);
      expect(result.errors).toBe(1);
      expect(result.details.join(" | ")).toContain("Skipped (file missing)");
      expect(result.details.join(" | ")).toContain("rename failed");
    });
  });

  describe("deleteVideo", () => {
    const setupDeleteVideoSelect = ({
      video,
      allVideos = [],
    }: {
      video: any;
      allVideos?: any[];
    }) => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue(video),
          }),
          orderBy: vi.fn().mockReturnValue({
            all: vi.fn().mockReturnValue(allVideos),
          }),
        }),
      } as any);
    };

    it("should return false when video does not exist", () => {
      setupDeleteVideoSelect({ video: undefined });
      expect(deleteVideo("missing")).toBe(false);
    });

    it("should delete video, thumbnail, avatar and subtitles then remove db row", () => {
      const video = {
        id: "1",
        author: "Author 1",
        videoFilename: "video.mp4",
        thumbnailFilename: "thumb.jpg",
        thumbnailPath: "/images/col/thumb.jpg",
        authorAvatarFilename: "avatar.jpg",
        authorAvatarPath: "/avatars/avatar.jpg",
        subtitles: '[{"filename":"en.vtt","path":"/subtitles/en.vtt","language":"en"}]',
      };
      setupDeleteVideoSelect({ video, allVideos: [video] });
      vi.mocked(collections.getCollections).mockReturnValue([]);
      vi.mocked(fileHelpers.findVideoFile).mockReturnValue("/abs/videos/video.mp4");
      vi.mocked(fileHelpers.findImageFile).mockReturnValue("/abs/images/thumb.jpg");
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return (
          p === "/abs/videos/video.mp4" ||
          p === path.join(IMAGES_DIR, "col/thumb.jpg") ||
          p === path.join(AVATARS_DIR, "avatar.jpg") ||
          p === path.join(path.join(process.cwd(), "uploads"), "avatars/avatar.jpg") ||
          p === path.join(path.join(process.cwd(), "uploads"), "subtitles/en.vtt")
        );
      });
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockReturnValue({ run: vi.fn() }),
      } as any);

      const ok = deleteVideo("1");
      expect(ok).toBe(true);
      expect(markVideoDownloadDeleted).toHaveBeenCalledWith("1");
      expect(fs.unlinkSync).toHaveBeenCalledWith("/abs/videos/video.mp4");
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(path.join(process.cwd(), "uploads"), "avatars/avatar.jpg")
      );
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(path.join(process.cwd(), "uploads"), "subtitles/en.vtt")
      );
    });

    it("should skip avatar deletion when other author videos exist", () => {
      const video = {
        id: "1",
        author: "Author 1",
        videoFilename: "video.mp4",
        authorAvatarFilename: "avatar.jpg",
        authorAvatarPath: "/avatars/avatar.jpg",
      };
      setupDeleteVideoSelect({
        video,
        allVideos: [
          video,
          { id: "2", author: "Author 1", videoFilename: "other.mp4" },
        ],
      });
      vi.mocked(collections.getCollections).mockReturnValue([]);
      vi.mocked(fileHelpers.findVideoFile).mockReturnValue("/abs/videos/video.mp4");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockReturnValue({ run: vi.fn() }),
      } as any);

      deleteVideo("1");
      expect(fs.unlinkSync).not.toHaveBeenCalledWith(
        path.join(path.join(process.cwd(), "uploads"), "avatars/avatar.jpg")
      );
    });

    it("should throw DatabaseError when delete flow fails", () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error("db fail");
      });
      expect(() => deleteVideo("1")).toThrow(DatabaseError);
    });
  });
});
