import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBestVideoResumeProgress,
  readVideoResumeProgress,
  writeVideoResumeProgress,
} from "../videoResumeProgress";

describe("videoResumeProgress", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores and reads a floored positive resume point", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);

    writeVideoResumeProgress("video-1", 42.9);

    expect(readVideoResumeProgress("video-1")).toEqual({
      progress: 42,
      updatedAt: 1000,
    });
  });

  it("prefers fresh local progress over stale server progress", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    writeVideoResumeProgress("video-2", 120);

    expect(getBestVideoResumeProgress("video-2", 0, 9_000)).toBe(120);
  });

  it("falls back to server progress when local progress is older than the last play", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    writeVideoResumeProgress("video-3", 120);

    expect(getBestVideoResumeProgress("video-3", 20, 100_000)).toBe(20);
  });

  it("does not let a fresh low local value override a much later server resume point", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    writeVideoResumeProgress("video-4", 5);

    expect(getBestVideoResumeProgress("video-4", 826, 9_000)).toBe(826);
  });
});
