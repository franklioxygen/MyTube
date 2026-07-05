import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-artifact-relocation-"));

  return {
    root,
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    imagesSmall: path.join(root, "images-small"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
    cloudThumbnailCache: path.join(root, "cloud-thumbnail-cache"),
  };
});

const getSettingsMock = vi.fn();
const getVideoByIdMock = vi.fn();
const removeMediaServerArtifactsForVideoMock = vi.fn();
const syncMediaServerArtifactsForRecordMock = vi.fn();
const syncMediaServerShowArtifactsForShowRootMock = vi.fn();

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  CLOUD_THUMBNAIL_CACHE_DIR: testPaths.cloudThumbnailCache,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  SUBTITLES_DIR: testPaths.subtitles,
  VIDEOS_DIR: testPaths.videos,
}));

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: () => getSettingsMock(),
}));

vi.mock("../../../services/storageService/videos", () => ({
  getVideoById: (id: string) => getVideoByIdMock(id),
}));

vi.mock("../../../services/mediaServerExport/syncService", () => ({
  removeMediaServerArtifactsForVideo: (...args: unknown[]) =>
    removeMediaServerArtifactsForVideoMock(...args),
  syncMediaServerArtifactsForRecord: (...args: unknown[]) =>
    syncMediaServerArtifactsForRecordMock(...args),
  syncMediaServerShowArtifactsForShowRoot: (...args: unknown[]) =>
    syncMediaServerShowArtifactsForShowRootMock(...args),
}));

import { relocateMediaServerArtifactsAroundMove } from "../../../services/mediaServerExport/artifactRelocation";

describe("mediaServerExport/artifactRelocation", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    fs.ensureDirSync(testPaths.videos);
    fs.ensureDirSync(testPaths.images);
    fs.ensureDirSync(testPaths.imagesSmall);
    fs.ensureDirSync(testPaths.avatars);
    fs.ensureDirSync(testPaths.subtitles);
    fs.ensureDirSync(testPaths.cloudThumbnailCache);
    getSettingsMock.mockReset();
    getVideoByIdMock.mockReset();
    removeMediaServerArtifactsForVideoMock.mockReset();
    syncMediaServerArtifactsForRecordMock.mockReset();
    syncMediaServerShowArtifactsForShowRootMock.mockReset();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  it("runs the move without artifact I/O when export is off", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "off" });
    const performMove = vi.fn().mockReturnValue(true);

    const moved = relocateMediaServerArtifactsAroundMove(
      {
        id: "v1",
        title: "Episode",
        videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
      } as any,
      performMove
    );

    expect(moved).toBe(true);
    expect(performMove).toHaveBeenCalledTimes(1);
    expect(removeMediaServerArtifactsForVideoMock).not.toHaveBeenCalled();
    expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
  });

  it("does not touch artifacts when the move produced no path update", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo" });

    const moved = relocateMediaServerArtifactsAroundMove(
      {
        id: "v1",
        title: "Episode",
        videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
      } as any,
      vi.fn().mockReturnValue(false)
    );

    expect(moved).toBe(false);
    expect(removeMediaServerArtifactsForVideoMock).not.toHaveBeenCalled();
    expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
  });

  it("removes old artifacts and syncs the updated record after a move", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo" });
    const videoBefore = {
      id: "v1",
      title: "Episode",
      videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
    } as any;
    const videoAfter = {
      ...videoBefore,
      videoPath: "/videos/New/Season 1/s01e01 - Episode.mp4",
    };
    getVideoByIdMock.mockReturnValue(videoAfter);

    const moved = relocateMediaServerArtifactsAroundMove(
      videoBefore,
      vi.fn().mockReturnValue(true)
    );

    expect(moved).toBe(true);
    expect(removeMediaServerArtifactsForVideoMock).toHaveBeenCalledWith(
      videoBefore
    );
    expect(syncMediaServerShowArtifactsForShowRootMock).toHaveBeenCalledWith(
      "Old",
      { modeOverride: "nfo" }
    );
    expect(syncMediaServerArtifactsForRecordMock).toHaveBeenCalledWith(
      videoAfter,
      expect.objectContaining({ modeOverride: "nfo" })
    );
  });

  it("preserves existing source JSON contents when relocating sidecars", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo_and_source_json" });
    const videoBefore = {
      id: "v1",
      title: "Episode",
      videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
    } as any;
    const videoAfter = {
      ...videoBefore,
      videoPath: "/videos/New/Season 1/s01e01 - Episode.mp4",
    };
    const sourceInfo = {
      id: "raw-video-id",
      uploader: "Raw Channel",
      extractor_key: "Youtube",
      _mytube: {
        generatedBy: "mytube",
        rawSourcePreserved: true,
      },
    };
    fs.ensureDirSync(path.join(testPaths.videos, "Old/Season 1"));
    fs.writeFileSync(
      path.join(testPaths.videos, "Old/Season 1/s01e01 - Episode.info.json"),
      `${JSON.stringify(sourceInfo)}\n`,
      "utf8"
    );
    getVideoByIdMock.mockReturnValue(videoAfter);

    const moved = relocateMediaServerArtifactsAroundMove(
      videoBefore,
      vi.fn().mockReturnValue(true)
    );

    expect(moved).toBe(true);
    expect(syncMediaServerArtifactsForRecordMock).toHaveBeenCalledWith(
      videoAfter,
      {
        modeOverride: "nfo_and_source_json",
        rawSourceInfo: sourceInfo,
      }
    );
  });
});
