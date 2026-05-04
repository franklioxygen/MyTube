import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/mock/videos",
  IMAGES_DIR: "/mock/images",
  SUBTITLES_DIR: "/mock/subtitles",
}));

const pathExistsMock = vi.hoisted(() => vi.fn().mockReturnValue(false));

vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: pathExistsMock,
  resolveSafeChildPath: vi.fn((base: string, child: string) => `${base}/${child}`),
}));

import {
  applyDedupeToRelatedPaths,
  dedupeRelativePath,
} from "../../../services/filenameTemplate/dedupe";

beforeEach(() => {
  pathExistsMock.mockReturnValue(false);
});

describe("dedupeRelativePath", () => {
  it("returns the same path when no conflict exists", () => {
    const result = dedupeRelativePath("video.mp4", "/mock/videos", new Set());
    expect(result).toBe("video.mp4");
  });

  it("appends _1 when file already exists on disk", () => {
    // First call returns true (conflict), second returns false (no conflict)
    pathExistsMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const result = dedupeRelativePath("video.mp4", "/mock/videos", new Set());
    expect(result).toBe("video_1.mp4");
  });

  it("increments counter until free path found", () => {
    // Conflicts for video.mp4, video_1.mp4, video_2.mp4; free for video_3.mp4
    pathExistsMock
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const result = dedupeRelativePath("video.mp4", "/mock/videos", new Set());
    expect(result).toBe("video_3.mp4");
  });

  it("respects job-level reserved set", () => {
    const reserved = new Set(["video.mp4", "video_1.mp4"]);
    const result = dedupeRelativePath("video.mp4", "/mock/videos", reserved);
    expect(result).toBe("video_2.mp4");
  });

  it("preserves subdirectory prefix", () => {
    const result = dedupeRelativePath("Channel/Season 2026/ep01.mp4", "/mock/videos", new Set());
    expect(result).toBe("Channel/Season 2026/ep01.mp4");
  });

  it("deduplicates paths with subdirectories correctly", () => {
    pathExistsMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const result = dedupeRelativePath("Channel/Season 2026/ep01.mp4", "/mock/videos", new Set());
    expect(result).toBe("Channel/Season 2026/ep01_1.mp4");
  });
});

describe("applyDedupeToRelatedPaths", () => {
  it("returns unchanged paths when no dedup occurred", () => {
    const { thumbnail, subtitleBase } = applyDedupeToRelatedPaths(
      "video.mp4",
      "video.mp4",
      "video.jpg",
      "video"
    );
    expect(thumbnail).toBe("video.jpg");
    expect(subtitleBase).toBe("video");
  });

  it("applies same suffix to thumbnail and subtitle base", () => {
    const { thumbnail, subtitleBase } = applyDedupeToRelatedPaths(
      "video.mp4",
      "video_1.mp4",
      "video.jpg",
      "video"
    );
    expect(thumbnail).toBe("video_1.jpg");
    expect(subtitleBase).toBe("video_1");
  });

  it("handles subdirectory paths", () => {
    const { thumbnail, subtitleBase } = applyDedupeToRelatedPaths(
      "Channel/ep01.mp4",
      "Channel/ep01_2.mp4",
      "Channel/ep01.jpg",
      "ep01"
    );
    expect(thumbnail).toBe("Channel/ep01_2.jpg");
    expect(subtitleBase).toBe("ep01_2");
  });
});
