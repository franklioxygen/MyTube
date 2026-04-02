/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVATARS_DIR } from "../../config/paths";
import {
  downloadAndProcessAvatar,
  getExistingAvatarPath,
  resizeAvatar,
} from "../../utils/avatarUtils";
import { formatAvatarFilename } from "../../utils/helpers";
import { execFileSafe } from "../../utils/security";

vi.mock("fs-extra");
vi.mock("../../utils/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/security")>();
  return {
    ...actual,
    execFileSafe: vi.fn(),
  };
});
vi.mock("../../utils/helpers", () => ({
  formatAvatarFilename: vi.fn((platform: string, author: string) =>
    `${platform}_${author}.jpg`
  ),
}));
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("avatarUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFileSafe as any).mockResolvedValue({ stdout: "", stderr: "" });
  });

  describe("getExistingAvatarPath", () => {
    it("should return existing avatar path", () => {
      const expected = path.join(AVATARS_DIR, "youtube_author.jpg");
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        return String(target) === expected;
      });

      const result = getExistingAvatarPath("youtube", "author");
      expect(formatAvatarFilename).toHaveBeenCalledWith("youtube", "author");
      expect(result).toBe(expected);
    });

    it("should return null when avatar file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(getExistingAvatarPath("youtube", "author")).toBeNull();
    });
  });

  describe("resizeAvatar", () => {
    it("should resize avatar to 100x100 jpeg via ffmpeg", async () => {
      const input = "/tmp/original.png";
      const output = "/tmp/out/avatar.jpg";

      const ok = await resizeAvatar(input, output);

      expect(ok).toBe(true);
      expect(fs.ensureDirSync).toHaveBeenCalledWith("/tmp/out");
      expect(execFileSafe).toHaveBeenCalledWith("ffmpeg", [
        "-y",
        "-i",
        input,
        "-vf",
        "scale=100:100:force_original_aspect_ratio=increase,crop=100:100",
        "-frames:v",
        "1",
        output,
      ]);
    });

    it("should return false on ffmpeg failures", async () => {
      vi.mocked(execFileSafe as any).mockRejectedValueOnce(new Error("ffmpeg failed"));
      const ok = await resizeAvatar("/tmp/input.png", "/tmp/output.jpg");
      expect(ok).toBe(false);
    });
  });

  describe("downloadAndProcessAvatar", () => {
    it("should return existing avatar without downloading", async () => {
      const existing = path.join(AVATARS_DIR, "youtube_author.jpg");
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        return String(target) === existing;
      });
      const downloadFn = vi.fn();

      const result = await downloadAndProcessAvatar(
        "https://cdn/avatar.jpg",
        "youtube",
        "author",
        downloadFn
      );

      expect(result).toBe(existing);
      expect(downloadFn).not.toHaveBeenCalled();
    });

    it("should process local avatar file path without downloading", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      const localFile = "/tmp/local-avatar.png";
      const finalPath = path.join(AVATARS_DIR, "youtube_author.jpg");
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return p === localFile;
      });
      const downloadFn = vi.fn();

      const result = await downloadAndProcessAvatar(
        localFile,
        "youtube",
        "author",
        downloadFn
      );

      expect(result).toBe(finalPath);
      expect(downloadFn).not.toHaveBeenCalled();
      expect(execFileSafe).toHaveBeenCalled();
    });

    it("should return null when remote download fails", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000001);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const downloadFn = vi.fn().mockResolvedValue(false);

      const result = await downloadAndProcessAvatar(
        "https://cdn/avatar.jpg",
        "youtube",
        "author",
        downloadFn
      );

      expect(result).toBeNull();
      expect(downloadFn).toHaveBeenCalledTimes(1);
    });

    it("should return null and cleanup temp file when resize fails", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000002);
      const temp = path.join(AVATARS_DIR, "temp_1700000000002_youtube_author.jpg");

      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return p === temp;
      });
      vi.mocked(execFileSafe as any).mockRejectedValueOnce(new Error("resize failed"));
      const downloadFn = vi.fn().mockResolvedValue(true);

      const result = await downloadAndProcessAvatar(
        "https://cdn/avatar.jpg",
        "youtube",
        "author",
        downloadFn
      );

      expect(result).toBeNull();
      expect(fs.unlinkSync).toHaveBeenCalledWith(temp);
    });

    it("should cleanup temp file and return null when processing throws unexpectedly", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000003);
      const temp = path.join(AVATARS_DIR, "temp_1700000000003_youtube_author.jpg");
      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return p === temp;
      });
      vi.mocked(fs.ensureDirSync).mockImplementationOnce(() => {
        throw new Error("mkdir failed");
      });
      const downloadFn = vi.fn().mockResolvedValue(true);

      const result = await downloadAndProcessAvatar(
        "https://cdn/avatar.jpg",
        "youtube",
        "author",
        downloadFn
      );

      expect(result).toBeNull();
      expect(fs.unlinkSync).toHaveBeenCalledWith(temp);
    });

    it("should download, resize and cleanup temp file on success", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000004);
      const temp = path.join(AVATARS_DIR, "temp_1700000000004_youtube_author.jpg");
      const finalPath = path.join(AVATARS_DIR, "youtube_author.jpg");

      vi.mocked(fs.existsSync).mockImplementation((target: any) => {
        const p = String(target);
        return p === temp;
      });
      const downloadFn = vi.fn().mockResolvedValue(true);

      const result = await downloadAndProcessAvatar(
        "https://cdn/avatar.jpg",
        "youtube",
        "author",
        downloadFn
      );

      expect(result).toBe(finalPath);
      expect(downloadFn).toHaveBeenCalledWith(
        "https://cdn/avatar.jpg",
        temp,
        undefined
      );
      expect(fs.unlinkSync).toHaveBeenCalledWith(temp);
    });
  });
});
