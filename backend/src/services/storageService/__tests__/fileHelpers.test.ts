import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/safe/videos",
  IMAGES_DIR: "/safe/images",
  SUBTITLES_DIR: "/safe/subtitles",
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../utils/security", () => ({
  isPathWithinDirectories: vi.fn(() => true),
  sanitizePathSegment: vi.fn((segment: string) =>
    segment.replace(/\.\./g, "").replace(/[\\/]/g, "")
  ),
}));

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    ensureDirSync: vi.fn(),
    moveSync: vi.fn(),
  },
  existsSync: vi.fn(),
  ensureDirSync: vi.fn(),
  moveSync: vi.fn(),
}));

import fs from "fs-extra";
import { logger } from "../../../utils/logger";
import {
  isPathWithinDirectories,
  sanitizePathSegment,
} from "../../../utils/security";
import { findImageFile, findVideoFile, moveFile } from "../fileHelpers";

describe("fileHelpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPathWithinDirectories).mockReturnValue(true);
    vi.mocked(sanitizePathSegment).mockImplementation((segment: string) =>
      segment.replace(/\.\./g, "").replace(/[\\/]/g, "")
    );
  });

  it("returns null for invalid video filename after sanitization", () => {
    vi.mocked(sanitizePathSegment).mockReturnValueOnce("");

    const result = findVideoFile("../unsafe.mp4");

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("finds video file in root videos directory", () => {
    const rootPath = path.join("/safe/videos", "movie.mp4");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => p === rootPath);

    const result = findVideoFile("movie.mp4");

    expect(result).toBe(rootPath);
  });

  it("falls back to collection directories for video files", () => {
    const collectionPath = path.join("/safe/videos", "SciFi", "movie.mp4");

    vi.mocked(fs.existsSync).mockImplementation((p: any) => p === collectionPath);

    const result = findVideoFile("movie.mp4", [
      { id: "c1", title: "SciFi", videos: [] } as any,
    ]);

    expect(result).toBe(collectionPath);
  });

  it("skips unsafe root path and still checks collections", () => {
    const collectionPath = path.join("/safe/videos", "Drama", "movie.mp4");
    vi.mocked(isPathWithinDirectories)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    vi.mocked(fs.existsSync).mockImplementation((p: any) => p === collectionPath);

    const result = findVideoFile("movie.mp4", [
      { id: "c1", name: "Drama", videos: [] } as any,
    ]);

    expect(result).toBe(collectionPath);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unsafe root path detected for video file")
    );
  });

  it("finds image file from collection path", () => {
    const imagePath = path.join("/safe/images", "Anime", "cover.jpg");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => p === imagePath);

    const result = findImageFile("cover.jpg", [
      { id: "c2", title: "Anime", videos: [] } as any,
    ]);

    expect(result).toBe(imagePath);
  });

  it("returns null and logs when image lookup throws", () => {
    vi.mocked(sanitizePathSegment).mockImplementation(() => {
      throw new Error("sanitize failed");
    });

    const result = findImageFile("cover.jpg");

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "Error finding image file",
      expect.any(Error)
    );
  });

  it("moves file when source exists", () => {
    const sourcePath = "/safe/videos/a.mp4";
    const destPath = "/safe/videos/sub/b.mp4";

    vi.mocked(fs.existsSync).mockImplementation((p: any) => p === sourcePath);

    moveFile(sourcePath, destPath);

    expect(fs.ensureDirSync).toHaveBeenCalledWith(path.dirname(destPath));
    expect(fs.moveSync).toHaveBeenCalledWith(sourcePath, destPath, {
      overwrite: true,
    });
    expect(logger.info).toHaveBeenCalledWith(
      `Moved file from ${sourcePath} to ${destPath}`
    );
  });

  it("does nothing when source file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    moveFile("/safe/videos/missing.mp4", "/safe/videos/out.mp4");

    expect(fs.ensureDirSync).not.toHaveBeenCalled();
    expect(fs.moveSync).not.toHaveBeenCalled();
  });

  it("throws and logs when path validation fails", () => {
    vi.mocked(isPathWithinDirectories).mockReturnValue(false);

    expect(() => moveFile("/safe/videos/a.mp4", "/safe/videos/b.mp4")).toThrow(
      "Security Error: Path traversal attempted"
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error moving file"),
      expect.any(Error)
    );
  });
});
