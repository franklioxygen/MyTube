import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dirs = vi.hoisted(() => {
  // Importing the downloader has load-time side effects that create the managed
  // roots, so these have to be real writable directories.
  const nodeFs = require("fs");
  const nodeOs = require("os");
  const nodePath = require("path");
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "mytube-missav-"));
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

import { resolveSupersededMissAvVideoPath } from "../../../services/downloaders/MissAVDownloader";

describe("resolveSupersededMissAvVideoPath", () => {
  afterAll(() => {
    require("fs-extra").removeSync(dirs.root);
  });

  it("returns the old file when a template change moves the redownload", () => {
    expect(
      resolveSupersededMissAvVideoPath(
        {
          videoPath: "/videos/Old Name.mp4",
          videoFilename: "Old Name.mp4",
        },
        path.join(dirs.VIDEOS_DIR, "Author", "New Name.mp4")
      )
    ).toBe(path.join(dirs.VIDEOS_DIR, "Old Name.mp4"));
  });

  it("returns the old file when only the directory changed", () => {
    // An organization-mode change keeps the filename but relocates the file, so
    // a filename-only comparison would leak the previous copy.
    expect(
      resolveSupersededMissAvVideoPath(
        {
          videoPath: "/videos/Episode.mp4",
          videoFilename: "Episode.mp4",
        },
        path.join(dirs.VIDEOS_DIR, "Author", "Episode.mp4")
      )
    ).toBe(path.join(dirs.VIDEOS_DIR, "Episode.mp4"));
  });

  it("never selects the file the redownload just wrote in place", () => {
    const samePath = path.join(dirs.VIDEOS_DIR, "Author", "Episode.mp4");
    expect(
      resolveSupersededMissAvVideoPath(
        {
          videoPath: "/videos/Author/Episode.mp4",
          videoFilename: "Episode.mp4",
        },
        samePath
      )
    ).toBeNull();
  });

  it("falls back to the managed filename when the row has no path", () => {
    expect(
      resolveSupersededMissAvVideoPath(
        { videoFilename: "Episode.mp4" },
        path.join(dirs.VIDEOS_DIR, "Author", "Episode.mp4")
      )
    ).toBe(path.join(dirs.VIDEOS_DIR, "Episode.mp4"));
  });

  it("returns null when the row identifies no previous file", () => {
    expect(
      resolveSupersededMissAvVideoPath(
        {},
        path.join(dirs.VIDEOS_DIR, "Episode.mp4")
      )
    ).toBeNull();
  });
});
