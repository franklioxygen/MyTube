import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePlayableVideoFilePath } from "../../utils/videoFileResolver";

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

describe("resolvePlayableVideoFilePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns expected path when merged file exists", () => {
    const expected = path.join("C:", "videos", "movie.mp4");
    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      return String(target) === expected;
    });

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBe(expected);
    expect(fs.readdirSync).not.toHaveBeenCalled();
  });

  it("falls back to the largest split video artifact when merged file is missing", () => {
    const expected = path.join("C:", "videos", "movie.webm");
    const videoDir = path.dirname(expected);
    const fallbackVideo = path.join(videoDir, "movie.f248.webm");
    const fallbackAudio = path.join(videoDir, "movie.f251.webm");
    const audioOnlyFile = path.join(videoDir, "movie.f140.m4a");

    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return (
        value === videoDir ||
        value === fallbackVideo ||
        value === fallbackAudio ||
        value === audioOnlyFile
      );
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      "movie.f251.webm",
      "movie.f248.webm",
      "movie.f140.m4a",
      "movie.webm.part",
    ] as any);
    vi.mocked(fs.statSync).mockImplementation((target: any) => {
      const value = String(target);
      return {
        size: value.endsWith("movie.f248.webm") ? 2048 : 512,
      } as any;
    });

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBe(fallbackVideo);
  });

  it("returns null when neither merged nor split video files exist", () => {
    const expected = path.join("C:", "videos", "missing.mp4");
    const videoDir = path.dirname(expected);
    vi.mocked(fs.existsSync).mockImplementation((target: any) => {
      return String(target) === videoDir;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBeNull();
  });
});

