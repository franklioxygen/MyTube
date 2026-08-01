import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dirs = vi.hoisted(() => {
  const nodeFs = require("fs");
  const nodeOs = require("os");
  const nodePath = require("path");
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "mytube-superseded-"));
  return {
    root,
    DATA_DIR: nodePath.join(root, "data"),
    IMAGES_DIR: nodePath.join(root, "images"),
    IMAGES_SMALL_DIR: nodePath.join(root, "images-small"),
    SUBTITLES_DIR: nodePath.join(root, "subtitles"),
    AVATARS_DIR: nodePath.join(root, "avatars"),
    UPLOADS_DIR: nodePath.join(root, "uploads"),
    VIDEOS_DIR: nodePath.join(root, "videos"),
  };
});

vi.mock("../../../config/paths", () => ({
  DATA_DIR: dirs.DATA_DIR,
  IMAGES_DIR: dirs.IMAGES_DIR,
  IMAGES_SMALL_DIR: dirs.IMAGES_SMALL_DIR,
  SUBTITLES_DIR: dirs.SUBTITLES_DIR,
  AVATARS_DIR: dirs.AVATARS_DIR,
  UPLOADS_DIR: dirs.UPLOADS_DIR,
  VIDEOS_DIR: dirs.VIDEOS_DIR,
}));

import { resolveSupersededManagedPath } from "../../../services/downloaders/supersededOutput";

describe("resolveSupersededManagedPath", () => {
  afterAll(() => {
    require("fs-extra").removeSync(dirs.root);
  });

  it("returns the old file when a template change moves the redownload", () => {
    expect(
      resolveSupersededManagedPath({
        previousWebPath: "/videos/Old Name.mp4",
        previousFilename: "Old Name.mp4",
        fallbackRootDir: dirs.VIDEOS_DIR,
        newAbsolutePath: path.join(dirs.VIDEOS_DIR, "Author", "New Name.mp4"),
      })
    ).toBe(path.join(dirs.VIDEOS_DIR, "Old Name.mp4"));
  });

  it("returns the old file when only the directory changed", () => {
    // An authorOrganizationMode change keeps the basename and only relocates the
    // file, so a filename comparison would leave the previous copy orphaned.
    expect(
      resolveSupersededManagedPath({
        previousWebPath: "/videos/Episode.mp4",
        previousFilename: "Episode.mp4",
        fallbackRootDir: dirs.VIDEOS_DIR,
        newAbsolutePath: path.join(dirs.VIDEOS_DIR, "Author", "Episode.mp4"),
      })
    ).toBe(path.join(dirs.VIDEOS_DIR, "Episode.mp4"));
  });

  it("catches a directory-only change for thumbnails too", () => {
    expect(
      resolveSupersededManagedPath({
        previousWebPath: "/images/Episode.jpg",
        previousFilename: "Episode.jpg",
        fallbackRootDir: dirs.IMAGES_DIR,
        newAbsolutePath: path.join(dirs.IMAGES_DIR, "Author", "Episode.jpg"),
      })
    ).toBe(path.join(dirs.IMAGES_DIR, "Episode.jpg"));
  });

  it("never selects the file the redownload just wrote in place", () => {
    const samePath = path.join(dirs.VIDEOS_DIR, "Author", "Episode.mp4");
    expect(
      resolveSupersededManagedPath({
        previousWebPath: "/videos/Author/Episode.mp4",
        previousFilename: "Episode.mp4",
        fallbackRootDir: dirs.VIDEOS_DIR,
        newAbsolutePath: samePath,
      })
    ).toBeNull();
  });

  it("falls back to the managed filename when the row has no path", () => {
    expect(
      resolveSupersededManagedPath({
        previousFilename: "Episode.mp4",
        fallbackRootDir: dirs.VIDEOS_DIR,
        newAbsolutePath: path.join(dirs.VIDEOS_DIR, "Author", "Episode.mp4"),
      })
    ).toBe(path.join(dirs.VIDEOS_DIR, "Episode.mp4"));
  });

  it("returns null when the row identifies no previous file", () => {
    expect(
      resolveSupersededManagedPath({
        fallbackRootDir: dirs.VIDEOS_DIR,
        newAbsolutePath: path.join(dirs.VIDEOS_DIR, "Episode.mp4"),
      })
    ).toBeNull();
  });
});
