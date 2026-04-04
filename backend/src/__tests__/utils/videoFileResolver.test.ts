import fs from "fs-extra";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePlayableVideoFilePath } from "../../utils/videoFileResolver";

const mockSpawnSync = vi.hoisted(() => vi.fn());

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

vi.mock("child_process", () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

const asReaddirResult = (
  entries: string[]
): ReturnType<typeof fs.readdirSync> =>
  entries as unknown as ReturnType<typeof fs.readdirSync>;

describe("resolvePlayableVideoFilePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnSync.mockImplementation((_command: string, _args: string[]) => ({
      status: 1,
      stdout: "",
    }));
  });

  it("returns expected path when merged file exists", () => {
    const expected = path.resolve("/virtual/videos/movie.mp4");
    vi.mocked(fs.existsSync).mockImplementation((target: unknown) => {
      return String(target) === expected;
    });

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBe(expected);
    expect(fs.readdirSync).not.toHaveBeenCalled();
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("prefers likely video split artifacts over audio-only format ids when ffprobe is unavailable", () => {
    const expected = path.resolve("/virtual/videos/movie.webm");
    const videoDir = path.dirname(expected);
    const fallbackVideo = path.join(videoDir, "movie.f248.webm");
    const fallbackAudio = path.join(videoDir, "movie.f251.webm");
    const audioOnlyFile = path.join(videoDir, "movie.f140.m4a");

    vi.mocked(fs.existsSync).mockImplementation((target: unknown) => {
      const value = String(target);
      return (
        value === videoDir ||
        value === fallbackVideo ||
        value === fallbackAudio ||
        value === audioOnlyFile
      );
    });
    vi.mocked(fs.readdirSync).mockReturnValue(
      asReaddirResult([
        "movie.f251.webm",
        "movie.f248.webm",
        "movie.f140.m4a",
        "movie.webm.part",
      ])
    );
    vi.mocked(fs.statSync).mockImplementation((target: unknown) => {
      const value = String(target);
      return {
        size: value.endsWith("movie.f251.webm") ? 4096 : 512,
      } as unknown as fs.Stats;
    });

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBe(fallbackVideo);
  });

  it("uses ffprobe stream inspection when available", () => {
    const expected = path.resolve("/virtual/videos/movie.webm");
    const videoDir = path.dirname(expected);
    const fallbackVideo = path.join(videoDir, "movie.f248.webm");
    const fallbackAudio = path.join(videoDir, "movie.f251.webm");

    vi.mocked(fs.existsSync).mockImplementation((target: unknown) => {
      const value = String(target);
      return value === videoDir || value === fallbackVideo || value === fallbackAudio;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(
      asReaddirResult(["movie.f251.webm", "movie.f248.webm"])
    );
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as unknown as fs.Stats);
    mockSpawnSync.mockImplementation((command: string, args: string[]) => {
      if (command !== "ffprobe") {
        return { status: 1, stdout: "" };
      }
      if (args[0] === "-version") {
        return { status: 0, stdout: "ffprobe version n-0000" };
      }
      const target = args[args.length - 1];
      if (String(target).endsWith("movie.f251.webm")) {
        return { status: 0, stdout: "audio\n" };
      }
      if (String(target).endsWith("movie.f248.webm")) {
        return { status: 0, stdout: "video\naudio\n" };
      }
      return { status: 1, stdout: "" };
    });

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBe(fallbackVideo);
  });

  it("returns null when ffprobe confirms split artifacts are audio-only", () => {
    const expected = path.resolve("/virtual/videos/movie.webm");
    const videoDir = path.dirname(expected);
    const audioA = path.join(videoDir, "movie.f250.webm");
    const audioB = path.join(videoDir, "movie.f251.webm");

    vi.mocked(fs.existsSync).mockImplementation((target: unknown) => {
      const value = String(target);
      return value === videoDir || value === audioA || value === audioB;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(
      asReaddirResult(["movie.f251.webm", "movie.f250.webm"])
    );
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as unknown as fs.Stats);
    mockSpawnSync.mockImplementation((command: string, args: string[]) => {
      if (command !== "ffprobe") {
        return { status: 1, stdout: "" };
      }
      if (args[0] === "-version") {
        return { status: 0, stdout: "ffprobe version n-0000" };
      }
      return { status: 0, stdout: "audio\n" };
    });

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBeNull();
  });

  it("returns null when neither merged nor split video files exist", () => {
    const expected = path.resolve("/virtual/videos/missing.mp4");
    const videoDir = path.dirname(expected);
    vi.mocked(fs.existsSync).mockImplementation((target: unknown) => {
      return String(target) === videoDir;
    });
    vi.mocked(fs.readdirSync).mockReturnValue(asReaddirResult([]));

    const result = resolvePlayableVideoFilePath(expected);

    expect(result).toBeNull();
  });
});
