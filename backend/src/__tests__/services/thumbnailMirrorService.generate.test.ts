import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs-extra", () => ({
  default: {
    ensureDir: vi.fn(),
    pathExists: vi.fn(),
    existsSync: vi.fn(),
    copy: vi.fn(),
  },
  ensureDir: vi.fn(),
  pathExists: vi.fn(),
  existsSync: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("../../utils/security", () => ({
  execFileSafe: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  isPathWithinDirectory: vi.fn(() => true),
  resolveSafePath: vi.fn((target: string) => target),
}));

import { regenerateSmallThumbnailForThumbnailPath } from "../../services/thumbnailMirrorService";
import { ensureSmallThumbnailForRelativePath } from "../../services/thumbnailMirrorService";
import { execFileSafe } from "../../utils/security";

describe("thumbnailMirrorService small thumbnail generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true as any);
    vi.mocked(fs.pathExists).mockResolvedValue(true as any);
  });

  it("uses ffmpeg single-image update mode when regenerating thumbnails", async () => {
    await regenerateSmallThumbnailForThumbnailPath("/images/poster.jpg");

    expect(execFileSafe).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-update", "1"]),
      expect.objectContaining({ timeout: 60000 })
    );
  });

  it("returns null when the source thumbnail does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false as any);
    vi.mocked(fs.pathExists).mockResolvedValue(false as any);

    const result = await ensureSmallThumbnailForRelativePath("poster.jpg");

    expect(result).toBeNull();
    expect(execFileSafe).not.toHaveBeenCalled();
    expect(fs.copy).not.toHaveBeenCalled();
  });

  it("skips regeneration when a small thumbnail already exists", async () => {
    const result = await ensureSmallThumbnailForRelativePath("poster.jpg");

    expect(result).toContain("images-small");
    expect(execFileSafe).not.toHaveBeenCalled();
  });

  it("regenerates an existing thumbnail when force is true", async () => {
    await ensureSmallThumbnailForRelativePath("poster.jpg", { force: true });

    expect(execFileSafe).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-update", "1"]),
      expect.objectContaining({ timeout: 60000 })
    );
  });

  it("falls back to copying the source image when ffmpeg fails", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as any);
    vi.mocked(execFileSafe).mockRejectedValueOnce(new Error("ffmpeg failed"));

    const result = await ensureSmallThumbnailForRelativePath("poster.jpg", {
      force: true,
    });

    expect(result).toContain("images-small");
    expect(fs.copy).toHaveBeenCalledWith(
      expect.stringContaining("/uploads/images/poster.jpg"),
      expect.stringContaining("/uploads/images-small/poster.jpg"),
      { overwrite: true }
    );
  });
});
