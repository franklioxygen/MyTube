/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: "/safe/avatars",
  VIDEOS_DIR: "/safe/videos",
  IMAGES_DIR: "/safe/images",
  IMAGES_SMALL_DIR: "/safe/images-small",
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
  ensureDirSafeSync: vi.fn(),
  isPathWithinDirectories: vi.fn(() => true),
  moveSafeSync: vi.fn(),
  normalizeSafeAbsolutePath: vi.fn((targetPath: string) => targetPath),
  pathExistsTrustedSync: vi.fn(() => false),
  sanitizePathSegment: vi.fn((segment: string) =>
    segment.replace(/\.\./g, "").replace(/[\\/]/g, "")
  ),
}));

vi.mock("fs-extra", () => ({
  default: {
    opendirSync: vi.fn(),
    pathExistsSync: vi.fn(),
    removeSync: vi.fn(),
  },
  opendirSync: vi.fn(),
  pathExistsSync: vi.fn(),
  removeSync: vi.fn(),
}));

import { logger } from "../../../utils/logger";
import {
  ensureDirSafeSync,
  isPathWithinDirectories,
  moveSafeSync,
  pathExistsTrustedSync,
  sanitizePathSegment,
} from "../../../utils/security";
import {
  buildStoragePath,
  findImageFile,
  findVideoFile,
  moveFile,
} from "../fileHelpers";

const pathExistsTrustedSyncMock = vi.mocked(pathExistsTrustedSync);
const ensureDirSafeSyncMock = vi.mocked(ensureDirSafeSync);
const moveSafeSyncMock = vi.mocked(moveSafeSync);
const loggerInfoMock = vi.mocked(logger.info);
const loggerWarnMock = vi.mocked(logger.warn);
const loggerErrorMock = vi.mocked(logger.error);
const expectedAllowedStorageDirs = [
  "/safe/videos",
  "/safe/images",
  "/safe/images-small",
  "/safe/subtitles",
  "/safe/avatars",
];

describe("fileHelpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPathWithinDirectories).mockReturnValue(true);
    vi.mocked(sanitizePathSegment).mockImplementation((segment: string) =>
      segment.replace(/\.\./g, "").replace(/[\\/]/g, "")
    );
    pathExistsTrustedSyncMock.mockReturnValue(false);
  });

  it("returns null for invalid video filename after sanitization", () => {
    vi.mocked(sanitizePathSegment).mockReturnValueOnce("");

    const result = findVideoFile("../unsafe.mp4");

    expect(result).toBeNull();
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it("allows images-small paths through the storage allowlist", () => {
    const targetPath = buildStoragePath("/safe/images-small", "Collection", "thumb.jpg");

    expect(targetPath).toBe(path.resolve("/safe/images-small/Collection/thumb.jpg"));
    expect(isPathWithinDirectories).toHaveBeenCalledWith(
      path.resolve("/safe/images-small/Collection/thumb.jpg"),
      expect.arrayContaining([
        path.resolve("/safe/images-small"),
        path.resolve("/safe/avatars"),
      ])
    );
  });

  it("allows avatar paths through the storage allowlist", () => {
    const targetPath = buildStoragePath("/safe/avatars", "author.jpg");

    expect(targetPath).toBe(path.resolve("/safe/avatars/author.jpg"));
    expect(isPathWithinDirectories).toHaveBeenCalledWith(
      path.resolve("/safe/avatars/author.jpg"),
      expect.arrayContaining([
        path.resolve("/safe/images-small"),
        path.resolve("/safe/avatars"),
      ])
    );
  });

  it("finds video file in root videos directory", () => {
    const rootPath = path.join("/safe/videos", "movie.mp4");
    pathExistsTrustedSyncMock.mockImplementation((targetPath: string) => targetPath === rootPath);

    const result = findVideoFile("movie.mp4");

    expect(result).toBe(rootPath);
  });

  it("falls back to collection directories for video files", () => {
    const collectionPath = path.join("/safe/videos", "SciFi", "movie.mp4");

    pathExistsTrustedSyncMock.mockImplementation(
      (targetPath: string) => targetPath === collectionPath
    );

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
    pathExistsTrustedSyncMock.mockImplementation(
      (targetPath: string) => targetPath === collectionPath
    );

    const result = findVideoFile("movie.mp4", [
      { id: "c1", name: "Drama", videos: [] } as any,
    ]);

    expect(result).toBe(collectionPath);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Unsafe root path detected for video file")
    );
  });

  it("finds image file from collection path", () => {
    const imagePath = path.join("/safe/images", "Anime", "cover.jpg");
    pathExistsTrustedSyncMock.mockImplementation(
      (targetPath: string) => targetPath === imagePath
    );

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
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "Error finding image file",
      expect.any(Error)
    );
  });

  it("moves file when source exists", () => {
    const sourcePath = "/safe/videos/a.mp4";
    const destPath = "/safe/videos/sub/b.mp4";

    pathExistsTrustedSyncMock.mockImplementation(
      (targetPath: string) => targetPath === sourcePath
    );

    moveFile(sourcePath, destPath);

    expect(ensureDirSafeSyncMock).toHaveBeenCalledWith(
      path.dirname(destPath),
      expectedAllowedStorageDirs
    );
    expect(moveSafeSyncMock).toHaveBeenCalledWith(
      sourcePath,
      expectedAllowedStorageDirs,
      destPath,
      expectedAllowedStorageDirs,
      { overwrite: true }
    );
    expect(loggerInfoMock).toHaveBeenCalledWith(
      `Moved file from ${sourcePath} to ${destPath}`
    );
  });

  it("does nothing when source file does not exist", () => {
    pathExistsTrustedSyncMock.mockReturnValue(false);

    moveFile("/safe/videos/missing.mp4", "/safe/videos/out.mp4");

    expect(ensureDirSafeSyncMock).not.toHaveBeenCalled();
    expect(moveSafeSyncMock).not.toHaveBeenCalled();
  });

  it("throws and logs when path validation fails", () => {
    vi.mocked(isPathWithinDirectories).mockReturnValue(false);

    expect(() => moveFile("/safe/videos/a.mp4", "/safe/videos/b.mp4")).toThrow(
      "Security Error: Path traversal attempted"
    );

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Error moving file"),
      expect.any(Error)
    );
  });
});
