import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/mock/videos",
  IMAGES_DIR: "/mock/images",
  SUBTITLES_DIR: "/mock/subtitles",
  AVATARS_DIR: "/mock/avatars",
  DATA_DIR: "/mock/data",
}));

vi.mock("../../../utils/security", () => ({
  resolveSafeChildPath: vi.fn((base: string, child: string) => {
    if (child.includes("..")) throw new Error("traversal");
    if (typeof child !== "string" || !child) throw new Error("invalid");
    return `${base}/${child}`;
  }),
}));

import {
  getManagedRelativePath,
  resolveManagedWebPath,
} from "../../../services/filenameTemplate/pathHelpers";

describe("getManagedRelativePath", () => {
  it("returns the relative segment for a /videos path", () => {
    expect(getManagedRelativePath("/videos/Channel/file.mp4", "/videos")).toBe(
      "Channel/file.mp4"
    );
  });

  it("returns the relative segment for an /images path", () => {
    expect(getManagedRelativePath("/images/file.jpg", "/images")).toBe(
      "file.jpg"
    );
  });

  it("returns the relative segment for a /subtitles path", () => {
    expect(getManagedRelativePath("/subtitles/file.vtt", "/subtitles")).toBe(
      "file.vtt"
    );
  });

  it("returns null when prefix does not match", () => {
    expect(getManagedRelativePath("/images/file.jpg", "/videos")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(getManagedRelativePath("", "/videos")).toBeNull();
  });

  it("returns null when type is not a string", () => {
    expect(
      getManagedRelativePath(undefined as unknown as string, "/videos")
    ).toBeNull();
  });

  it("returns null when path equals the prefix with trailing slash", () => {
    expect(getManagedRelativePath("/videos/", "/videos")).toBeNull();
  });
});

describe("resolveManagedWebPath", () => {
  it("resolves /videos paths with the right metadata", () => {
    const result = resolveManagedWebPath("/videos/Channel/file.mp4");
    expect(result).not.toBeNull();
    expect(result?.prefix).toBe("/videos");
    expect(result?.rootDir).toBe("/mock/videos");
    expect(result?.relativePath).toBe("Channel/file.mp4");
    expect(result?.absolutePath).toBe("/mock/videos/Channel/file.mp4");
  });

  it("resolves /images paths", () => {
    const result = resolveManagedWebPath("/images/file.jpg");
    expect(result?.prefix).toBe("/images");
    expect(result?.rootDir).toBe("/mock/images");
  });

  it("resolves /subtitles paths", () => {
    const result = resolveManagedWebPath("/subtitles/file.vtt");
    expect(result?.prefix).toBe("/subtitles");
    expect(result?.rootDir).toBe("/mock/subtitles");
  });

  it("returns null for cloud: paths", () => {
    expect(resolveManagedWebPath("cloud:Channel/file.mp4")).toBeNull();
  });

  it("returns null for mount: paths", () => {
    expect(resolveManagedWebPath("mount:/external/file.mp4")).toBeNull();
  });

  it("returns null for http URLs", () => {
    expect(resolveManagedWebPath("http://example.com/file.mp4")).toBeNull();
  });

  it("returns null for https URLs", () => {
    expect(resolveManagedWebPath("https://example.com/file.mp4")).toBeNull();
  });

  it("returns null for unrecognized prefixes", () => {
    expect(resolveManagedWebPath("/avatars/foo.jpg")).toBeNull();
  });

  it("returns null when relative segment is empty", () => {
    expect(resolveManagedWebPath("/videos/")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveManagedWebPath("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(resolveManagedWebPath(null as unknown as string)).toBeNull();
  });

  it("returns null when resolveSafeChildPath rejects traversal", () => {
    expect(resolveManagedWebPath("/videos/../etc/passwd")).toBeNull();
  });
});
