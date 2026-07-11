import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathExistsSafeSync: vi.fn(),
  readdirSafeSync: vi.fn(),
}));

vi.mock("../../../utils/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/security")>();
  return {
    ...actual,
    pathExistsSafeSync: (...args: any[]) => mocks.pathExistsSafeSync(...args),
    readdirSafeSync: (...args: any[]) => mocks.readdirSafeSync(...args),
  };
});

import { findVideoFileInTemp } from "../../../services/downloaders/bilibili/bilibiliFileManager";

describe("findVideoFileInTemp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExistsSafeSync.mockReturnValue(true);
  });

  it("returns null when the temp directory does not exist", () => {
    mocks.pathExistsSafeSync.mockReturnValue(false);
    expect(findVideoFileInTemp("/tmp/x")).toBeNull();
  });

  it("prefers the video container over a leftover split audio stream for normal downloads", () => {
    // A failed/absent ffmpeg merge can leave both streams behind.
    mocks.readdirSafeSync.mockReturnValue(["video_1.m4a", "video_1.mp4"]);
    expect(findVideoFileInTemp("/tmp/x")).toBe("video_1.mp4");
  });

  it("prefers the extracted audio track in audio-only mode", () => {
    mocks.readdirSafeSync.mockReturnValue(["video_1.m4a", "video_1.mp4"]);
    expect(findVideoFileInTemp("/tmp/x", true)).toBe("video_1.m4a");
  });

  it("returns null for normal downloads when only an audio stream remains", () => {
    // A video-mode download that produced only audio must fail rather than
    // save an audio-only file as a mediaType:"video" item with no frames.
    mocks.readdirSafeSync.mockReturnValue(["video_1.m4a"]);
    expect(findVideoFileInTemp("/tmp/x")).toBeNull();
  });

  it("falls back to a video container in audio-only mode when no audio stream exists", () => {
    mocks.readdirSafeSync.mockReturnValue(["video_1.mp4"]);
    expect(findVideoFileInTemp("/tmp/x", true)).toBe("video_1.mp4");
  });

  it("returns null when no known media extension is present", () => {
    mocks.readdirSafeSync.mockReturnValue(["notes.txt"]);
    expect(findVideoFileInTemp("/tmp/x")).toBeNull();
  });
});
