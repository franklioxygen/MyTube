import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/paths", () => ({
  UPLOADS_DIR: "/safe/uploads",
  VIDEOS_DIR: "/safe/videos",
  IMAGES_DIR: "/safe/images",
  SUBTITLES_DIR: "/safe/subtitles",
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    rmdirSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  rmdirSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("../fileHelpers", () => ({
  findImageFile: vi.fn(),
  findVideoFile: vi.fn(),
  moveFile: vi.fn(),
}));

vi.mock("../settings", () => ({
  getSettings: vi.fn(),
}));

import fs from "fs-extra";
import { logger } from "../../../utils/logger";
import { findImageFile, findVideoFile, moveFile } from "../fileHelpers";
import { getSettings } from "../settings";
import {
  cleanupCollectionDirectories,
  moveAllFilesFromCollection,
  moveAllFilesToCollection,
  moveSubtitlesFromCollection,
  moveSubtitlesToCollection,
  moveThumbnailFromCollection,
  moveThumbnailToCollection,
  moveVideoFromCollection,
  moveVideoToCollection,
  renameCollectionDirectories,
  updateVideoPathsForCollectionRename,
} from "../collectionFileManager";

describe("collectionFileManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockReturnValue({
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);
  });

  it("moves video into collection and updates path", () => {
    vi.mocked(findVideoFile).mockReturnValue("/safe/videos/video.mp4");

    const result = moveVideoToCollection(
      { videoFilename: "video.mp4" } as any,
      "My Collection",
      []
    );

    expect(moveFile).toHaveBeenCalledWith(
      "/safe/videos/video.mp4",
      "/safe/videos/My Collection/video.mp4"
    );
    expect(result).toEqual({
      updated: true,
      updates: { videoPath: "/videos/My Collection/video.mp4" },
    });
  });

  it("rejects invalid collection names", () => {
    const result = moveVideoToCollection(
      { videoFilename: "video.mp4" } as any,
      "../",
      []
    );

    expect(result).toEqual({ updated: false, updates: {} });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("moves video out of collection", () => {
    vi.mocked(findVideoFile).mockReturnValue("/safe/videos/Col/video.mp4");

    const result = moveVideoFromCollection(
      { videoFilename: "video.mp4" } as any,
      "/safe/videos",
      "/videos",
      []
    );

    expect(moveFile).toHaveBeenCalledWith(
      "/safe/videos/Col/video.mp4",
      "/safe/videos/video.mp4"
    );
    expect(result).toEqual({
      updated: true,
      updates: { videoPath: "/videos/video.mp4" },
    });
  });

  it("moves thumbnails using video-folder mode", () => {
    vi.mocked(getSettings).mockReturnValue({
      moveThumbnailsToVideoFolder: true,
    } as any);

    const result = moveThumbnailToCollection(
      {
        thumbnailFilename: "thumb.jpg",
        thumbnailPath: "/images/thumb.jpg",
      } as any,
      "Col",
      []
    );

    expect(moveFile).toHaveBeenCalledWith(
      "/safe/images/thumb.jpg",
      "/safe/videos/Col/thumb.jpg"
    );
    expect(result).toEqual({
      updated: true,
      updates: { thumbnailPath: "/videos/Col/thumb.jpg" },
    });
  });

  it("falls back to findImageFile when thumbnailPath missing on disk", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(findImageFile).mockReturnValue("/safe/images/thumb.jpg");

    const result = moveThumbnailToCollection(
      {
        thumbnailFilename: "thumb.jpg",
        thumbnailPath: "/images/thumb.jpg",
      } as any,
      "Col",
      []
    );

    expect(findImageFile).toHaveBeenCalledWith("thumb.jpg", []);
    expect(result.updated).toBe(true);
  });

  it("moves thumbnails from collection to image dir mode", () => {
    vi.mocked(getSettings).mockReturnValue({
      moveThumbnailsToVideoFolder: false,
    } as any);

    const result = moveThumbnailFromCollection(
      {
        thumbnailFilename: "thumb.jpg",
        thumbnailPath: "/videos/Col/thumb.jpg",
      } as any,
      "/safe/videos",
      "/safe/images",
      "/videos",
      "/images",
      []
    );

    expect(moveFile).toHaveBeenCalledWith(
      "/safe/videos/Col/thumb.jpg",
      "/safe/images/thumb.jpg"
    );
    expect(result).toEqual({
      updated: true,
      updates: { thumbnailPath: "/images/thumb.jpg" },
    });
  });

  it("moves subtitles into collection respecting settings", () => {
    vi.mocked(getSettings).mockReturnValue({
      moveSubtitlesToVideoFolder: true,
    } as any);

    const result = moveSubtitlesToCollection(
      {
        subtitles: [{ language: "en", filename: "sub.vtt", path: "/subtitles/sub.vtt" }],
      } as any,
      "Series"
    );

    expect(moveFile).toHaveBeenCalledWith(
      "/safe/uploads/subtitles/sub.vtt",
      "/safe/videos/Series/sub.vtt"
    );
    expect(result).toEqual({
      updated: true,
      updates: {
        subtitles: [
          {
            language: "en",
            filename: "sub.vtt",
            path: "/videos/Series/sub.vtt",
          },
        ],
      },
    });
  });

  it("moves subtitles out of collection to target subtitle dir", () => {
    const result = moveSubtitlesFromCollection(
      {
        subtitles: [{ language: "en", filename: "sub.vtt", path: "/subtitles/Col/sub.vtt" }],
      } as any,
      "/safe/videos",
      "/safe/subtitles",
      "/videos",
      "/subtitles"
    );

    expect(moveFile).toHaveBeenCalledWith(
      "/safe/uploads/subtitles/Col/sub.vtt",
      "/safe/subtitles/sub.vtt"
    );
    expect(result).toEqual({
      updated: true,
      updates: {
        subtitles: [
          {
            language: "en",
            filename: "sub.vtt",
            path: "/subtitles/sub.vtt",
          },
        ],
      },
    });
  });

  it("aggregates updates when moving all files to collection", () => {
    vi.mocked(findVideoFile).mockReturnValue("/safe/videos/video.mp4");
    vi.mocked(findImageFile).mockReturnValue("/safe/images/thumb.jpg");

    const updates = moveAllFilesToCollection(
      {
        videoFilename: "video.mp4",
        thumbnailFilename: "thumb.jpg",
        subtitles: [{ language: "en", filename: "sub.vtt", path: "/subtitles/sub.vtt" }],
      } as any,
      "Bundle",
      []
    );

    expect(updates.videoPath).toBe("/videos/Bundle/video.mp4");
    expect(updates.thumbnailPath).toBe("/images/Bundle/thumb.jpg");
    expect((updates.subtitles || [])[0].path).toBe("/subtitles/Bundle/sub.vtt");
  });

  it("aggregates updates when moving all files from collection", () => {
    vi.mocked(findVideoFile).mockReturnValue("/safe/videos/Col/video.mp4");
    vi.mocked(findImageFile).mockReturnValue("/safe/images/Col/thumb.jpg");

    const updates = moveAllFilesFromCollection(
      {
        videoFilename: "video.mp4",
        thumbnailFilename: "thumb.jpg",
        thumbnailPath: "/images/Col/thumb.jpg",
        subtitles: [{ language: "en", filename: "sub.vtt", path: "/videos/Col/sub.vtt" }],
      } as any,
      "/safe/videos",
      "/safe/images",
      "/safe/subtitles",
      "/videos",
      "/images",
      "/subtitles",
      []
    );

    expect(updates.videoPath).toBe("/videos/video.mp4");
    expect(updates.thumbnailPath).toBe("/images/thumb.jpg");
    expect((updates.subtitles || [])[0].path).toBe("/videos/sub.vtt");
  });

  it("cleans empty collection directories", () => {
    cleanupCollectionDirectories("MyCol");

    expect(fs.rmdirSync).toHaveBeenCalledWith("/safe/videos/MyCol");
    expect(fs.rmdirSync).toHaveBeenCalledWith("/safe/images/MyCol");
    expect(fs.rmdirSync).toHaveBeenCalledWith("/safe/subtitles/MyCol");
  });

  it("handles cleanup errors", () => {
    vi.mocked(fs.rmdirSync).mockImplementation(() => {
      throw new Error("remove failed");
    });

    cleanupCollectionDirectories("ErrCol");

    expect(logger.error).toHaveBeenCalledWith(
      "Error removing collection directories",
      expect.any(Error)
    );
  });

  it("renames collection directories when target does not exist", () => {
    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("/Old") && !value.endsWith("/New");
    });

    const ok = renameCollectionDirectories("Old", "New");

    expect(ok).toBe(true);
    expect(fs.renameSync).toHaveBeenCalledWith("/safe/videos/Old", "/safe/videos/New");
    expect(fs.renameSync).toHaveBeenCalledWith("/safe/images/Old", "/safe/images/New");
    expect(fs.renameSync).toHaveBeenCalledWith(
      "/safe/subtitles/Old",
      "/safe/subtitles/New"
    );
  });

  it("merges existing directories and removes old one", () => {
    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      if (value.includes("/videos/Old") || value.includes("/videos/New")) {
        return true;
      }
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(["a.mp4"] as any);

    const ok = renameCollectionDirectories("Old", "New");

    expect(ok).toBe(true);
    expect(moveFile).toHaveBeenCalledWith(
      "/safe/videos/Old/a.mp4",
      "/safe/videos/New/a.mp4"
    );
    expect(fs.rmSync).toHaveBeenCalledWith("/safe/videos/Old", {
      recursive: true,
      force: true,
    });
  });

  it("returns false when rename fails", () => {
    vi.mocked(fs.existsSync).mockImplementation((target: any) =>
      String(target).endsWith("/Old")
    );
    vi.mocked(fs.renameSync).mockImplementation(() => {
      throw new Error("rename failed");
    });

    const ok = renameCollectionDirectories("Old", "New");

    expect(ok).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it("updates video, thumbnail and subtitle paths for renamed collections", () => {
    const updates = updateVideoPathsForCollectionRename(
      {
        videoPath: "/videos/Old/video.mp4",
        thumbnailPath: "/images/Old/thumb.jpg",
        subtitles: [
          { language: "en", filename: "s1.vtt", path: "/subtitles/Old/s1.vtt" },
          { language: "zh", filename: "s2.vtt", path: "/videos/Old/s2.vtt" },
        ],
      } as any,
      "Old",
      "New"
    );

    expect(updates).toEqual({
      videoPath: "/videos/New/video.mp4",
      thumbnailPath: "/images/New/thumb.jpg",
      subtitles: [
        { language: "en", filename: "s1.vtt", path: "/subtitles/New/s1.vtt" },
        { language: "zh", filename: "s2.vtt", path: "/videos/New/s2.vtt" },
      ],
    });
  });

  it("returns empty updates when rename names are invalid", () => {
    const updates = updateVideoPathsForCollectionRename(
      { videoPath: "/videos/A/video.mp4" } as any,
      "../",
      "New"
    );

    expect(updates).toEqual({});
  });
});
