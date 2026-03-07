import path from "path";
import { describe, expect, it } from "vitest";
import {
  getPlatformMountDirectoryDescriptors,
  isPathWithinPlatformMountDirectories,
  PLATFORM_MOUNT_DIRECTORIES_ENV_KEY,
  resolveMountDirectoriesByIds,
  resolvePlatformMountDirectories,
} from "../mountDirectories";

describe("mountDirectories config", () => {
  it("returns empty list when env value is missing", () => {
    const directories = resolvePlatformMountDirectories({ rawConfig: undefined });
    expect(directories).toEqual([]);
  });

  it("parses valid configured platform mount directories", () => {
    const directories = resolvePlatformMountDirectories({
      rawConfig: JSON.stringify([
        { id: "library", label: "Main Library", path: "/mnt/library" },
        { id: "archive", path: "/srv/archive" },
      ]),
    });

    expect(directories).toEqual([
      {
        id: "library",
        label: "Main Library",
        path: path.resolve("/mnt/library"),
      },
      {
        id: "archive",
        label: "archive",
        path: path.resolve("/srv/archive"),
      },
    ]);
  });

  it("ignores invalid or duplicate entries", () => {
    const directories = resolvePlatformMountDirectories({
      rawConfig: JSON.stringify([
        { id: "good", path: "/mnt/good" },
        { id: "bad id", path: "/mnt/bad" },
        { id: "good", path: "/mnt/duplicate" },
        { id: "null-byte", path: "/mnt/\0bad" },
      ]),
    });

    expect(directories).toEqual([
      {
        id: "good",
        label: "good",
        path: path.resolve("/mnt/good"),
      },
    ]);
  });

  it("matches requested directory ids and reports unknown ids", () => {
    const configured = resolvePlatformMountDirectories({
      rawConfig: JSON.stringify([
        { id: "a", path: "/mnt/a" },
        { id: "b", path: "/mnt/b" },
      ]),
    });

    const { matchedDirectories, invalidDirectoryIds } = resolveMountDirectoriesByIds(
      ["a", "missing", "a", "b"],
      configured
    );

    expect(matchedDirectories.map((directory) => directory.id)).toEqual(["a", "b"]);
    expect(invalidDirectoryIds).toEqual(["missing"]);
  });

  it("checks whether file path is within configured mount roots", () => {
    const configured = resolvePlatformMountDirectories({
      rawConfig: JSON.stringify([{ id: "lib", path: "/mnt/library" }]),
    });

    expect(
      isPathWithinPlatformMountDirectories("/mnt/library/a/video.mp4", configured)
    ).toBe(true);
    expect(
      isPathWithinPlatformMountDirectories("/mnt/other/video.mp4", configured)
    ).toBe(false);
  });

  it("returns descriptors without exposing host paths", () => {
    const configured = resolvePlatformMountDirectories({
      rawConfig: JSON.stringify([{ id: "lib", label: "Library", path: "/mnt/library" }]),
    });

    expect(getPlatformMountDirectoryDescriptors(configured)).toEqual([
      { id: "lib", label: "Library" },
    ]);
  });

  it("resolves from expected environment key", () => {
    const previousValue = process.env[PLATFORM_MOUNT_DIRECTORIES_ENV_KEY];
    process.env[PLATFORM_MOUNT_DIRECTORIES_ENV_KEY] = JSON.stringify([
      { id: "env", path: "/mnt/env" },
    ]);

    const directories = resolvePlatformMountDirectories();

    if (previousValue === undefined) {
      delete process.env[PLATFORM_MOUNT_DIRECTORIES_ENV_KEY];
    } else {
      process.env[PLATFORM_MOUNT_DIRECTORIES_ENV_KEY] = previousValue;
    }

    expect(directories.map((directory) => directory.id)).toEqual(["env"]);
  });
});
