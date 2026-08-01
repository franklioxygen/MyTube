import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-bili-files-"));
  tempRoots.push(root);
  fs.ensureDirSync(path.join(root, "data"));
  fs.ensureDirSync(path.join(root, "videos"));
  fs.ensureDirSync(path.join(root, "images"));
  fs.ensureDirSync(path.join(root, "subtitles"));
  return root;
}

async function loadFileManager(root: string, videos: any[] = []) {
  vi.resetModules();
  vi.doMock("../../../config/paths", () => ({
    DATA_DIR: path.join(root, "data"),
    VIDEOS_DIR: path.join(root, "videos"),
    IMAGES_DIR: path.join(root, "images"),
    SUBTITLES_DIR: path.join(root, "subtitles"),
  }));
  vi.doMock("../../../services/storageService", () => ({
    getVideos: vi.fn(() => videos),
  }));
  vi.doMock("../../../services/storageService/videoQueries", () => ({
    getVideos: vi.fn(() => videos),
  }));
  vi.doMock("../../../services/storageService/videos", () => ({
    getVideos: vi.fn(() => videos),
  }));
  vi.doMock("../../../services/thumbnailMirrorService", () => ({
    deleteSmallThumbnailMirrorSync: vi.fn(),
    moveSmallThumbnailMirrorSync: vi.fn(),
  }));
  // The allocator reads stored rows through this provider in tests; without it
  // its DB-ownership checks see an empty library.
  const allocator = await import(
    "../../../services/filenameTemplate/outputPathAllocator"
  );
  allocator.setOutputPathAllocatorVideoProviderForTests(() => videos as any);
  loadedAllocator = allocator;
  return import("../../../services/downloaders/bilibili/bilibiliFileManager");
}

let loadedAllocator:
  | typeof import("../../../services/filenameTemplate/outputPathAllocator")
  | null = null;

describe("bilibili file manager integration", () => {
  afterEach(() => {
    loadedAllocator?.setOutputPathAllocatorVideoProviderForTests(null);
    loadedAllocator = null;
    vi.resetModules();
    vi.clearAllMocks();
    for (const root of tempRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("keeps byte-distinct same-title BVs in legacy author folders", async () => {
    const root = makeTempRoot();
    const paths = {
      videos: path.join(root, "videos"),
      images: path.join(root, "images"),
    };
    const { renameFilesWithMetadata } = await loadFileManager(root);

    const firstIncoming = path.join(paths.videos, "incoming-one.mp4");
    const secondIncoming = path.join(paths.videos, "incoming-two.mp4");
    fs.outputFileSync(firstIncoming, "first-bv-bytes");
    fs.outputFileSync(secondIncoming, "second-bv-bytes");

    const commonSettings = {
      downloadFilenamePresetId: "legacy",
      authorOrganizationMode: "author_folder_only",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    };
    const first = renameFilesWithMetadata(
      "Same Title",
      "Same Author",
      "20240101",
      "mp4",
      firstIncoming,
      path.join(paths.images, "incoming-one.jpg"),
      false,
      paths.videos,
      paths.images,
      {
        settings: commonSettings,
        sourceUrl: "https://www.bilibili.com/video/BV111",
        sourceVideoId: "BV111",
        mediaType: "video",
      }
    );
    const second = renameFilesWithMetadata(
      "Same Title",
      "Same Author",
      "20240101",
      "mp4",
      secondIncoming,
      path.join(paths.images, "incoming-two.jpg"),
      false,
      paths.videos,
      paths.images,
      {
        settings: commonSettings,
        sourceUrl: "https://www.bilibili.com/video/BV222",
        sourceVideoId: "BV222",
        mediaType: "video",
      }
    );

    expect(first.newVideoPath).not.toBe(second.newVideoPath);
    expect(path.relative(paths.videos, first.newVideoPath)).toContain("Same Author");
    expect(path.relative(paths.videos, second.newVideoPath)).toContain("Same Author");
    expect(path.basename(second.newVideoPath)).toContain("BV222");
    expect(fs.readFileSync(first.newVideoPath, "utf8")).toBe("first-bv-bytes");
    expect(fs.readFileSync(second.newVideoPath, "utf8")).toBe("second-bv-bytes");
  });

  it("reserves the subtitle stem when only another row's subtitles collide", async () => {
    const root = makeTempRoot();
    const paths = {
      videos: path.join(root, "videos"),
      images: path.join(root, "images"),
    };
    const videos: any[] = [];
    const { renameFilesWithMetadata } = await loadFileManager(root, videos);

    const settings = {
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    };
    const rename = (incoming: string, bv: string) =>
      renameFilesWithMetadata(
        "Same Title",
        "Same Author",
        "20240101",
        "mp4",
        incoming,
        path.join(paths.images, `${bv}.jpg`),
        false,
        paths.videos,
        paths.images,
        {
          settings,
          sourceUrl: `https://www.bilibili.com/video/${bv}`,
          sourceVideoId: bv,
          mediaType: "video",
        }
      );

    // Learn the natural stem against an empty library.
    const probeIncoming = path.join(paths.videos, "probe.mp4");
    fs.outputFileSync(probeIncoming, "probe-bytes");
    const probe = rename(probeIncoming, "BV111");
    const stem = probe.subtitleStem;
    fs.removeSync(probe.newVideoPath);

    // Another row owns only the subtitle under that stem. Its video uses a
    // different container so the video path stays free, and this download saves
    // no thumbnail — subtitles are the only thing standing in the way.
    videos.push({
      id: "other",
      videoPath: `/videos/${stem}.mkv`,
      thumbnailPath: null,
      subtitles: [
        {
          language: "en",
          filename: `${stem}.en.vtt`,
          path: `/subtitles/${stem}.en.vtt`,
        },
      ],
    });

    const incoming = path.join(paths.videos, "incoming.mp4");
    fs.outputFileSync(incoming, "new-bytes");
    const result = rename(incoming, "BV222");

    expect(result.subtitleStem).not.toBe(stem);
    expect(result.subtitleStem).toContain("BV222");
  });

  it("keeps byte-distinct same-title BVs in template author folders", async () => {
    const root = makeTempRoot();
    const paths = {
      videos: path.join(root, "videos"),
      images: path.join(root, "images"),
    };
    const { renameFilesWithMetadata } = await loadFileManager(root);

    const firstIncoming = path.join(paths.videos, "incoming-template-one.mp4");
    const secondIncoming = path.join(paths.videos, "incoming-template-two.mp4");
    fs.outputFileSync(firstIncoming, "first-template-bv-bytes");
    fs.outputFileSync(secondIncoming, "second-template-bv-bytes");

    const commonSettings = {
      downloadFilenameMode: "template",
      downloadFilenamePresetId: "source_date_flat",
      authorOrganizationMode: "author_folder_only",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    };
    const first = renameFilesWithMetadata(
      "Same Title",
      "Same Author",
      "20240101",
      "mp4",
      firstIncoming,
      path.join(paths.images, "incoming-template-one.jpg"),
      false,
      paths.videos,
      paths.images,
      {
        settings: commonSettings,
        sourceUrl: "https://www.bilibili.com/video/BV111",
        sourceVideoId: "BV111",
        mediaType: "video",
      }
    );
    const second = renameFilesWithMetadata(
      "Same Title",
      "Same Author",
      "20240101",
      "mp4",
      secondIncoming,
      path.join(paths.images, "incoming-template-two.jpg"),
      false,
      paths.videos,
      paths.images,
      {
        settings: commonSettings,
        sourceUrl: "https://www.bilibili.com/video/BV222",
        sourceVideoId: "BV222",
        mediaType: "video",
      }
    );

    expect(first.newVideoPath).not.toBe(second.newVideoPath);
    expect(path.relative(paths.videos, first.newVideoPath)).toContain("Same Author");
    expect(path.relative(paths.videos, second.newVideoPath)).toContain("Same Author");
    expect(path.basename(second.newVideoPath)).toContain("BV222");
    expect(fs.readFileSync(first.newVideoPath, "utf8")).toBe(
      "first-template-bv-bytes"
    );
    expect(fs.readFileSync(second.newVideoPath, "utf8")).toBe(
      "second-template-bv-bytes"
    );
  });
});
