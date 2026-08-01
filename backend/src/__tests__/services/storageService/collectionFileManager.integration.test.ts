import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, Video } from "../../../services/storageService/types";

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-collection-move-"));

  return {
    root,
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    imagesSmall: path.join(root, "images-small"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
    uploads: path.join(root, "uploads"),
    data: path.join(root, "data"),
  };
});

const settingsState = vi.hoisted(() => ({
  current: {
    moveThumbnailsToVideoFolder: false,
    moveSubtitlesToVideoFolder: false,
  },
}));

const videoStore = vi.hoisted(() => ({
  videos: [] as Video[],
}));

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  DATA_DIR: testPaths.data,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  SUBTITLES_DIR: testPaths.subtitles,
  UPLOADS_DIR: testPaths.uploads,
  VIDEOS_DIR: testPaths.videos,
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: () => settingsState.current,
  invalidateSettingsCache: vi.fn(),
}));

vi.mock("../../../services/storageService/videos", () => ({
  getVideos: () => videoStore.videos,
}));

vi.mock("../../../services/thumbnailMirrorService", () => ({
  moveSmallThumbnailMirrorSync: vi.fn(),
  resolveManagedThumbnailWebPathFromAbsolutePath: (absolutePath: string) => {
    const path = require("path") as typeof import("path");
    const normalized = absolutePath.replace(/\\/g, "/");
    const imageRelative = path.relative(testPaths.images, normalized).replace(/\\/g, "/");
    if (imageRelative && !imageRelative.startsWith("..") && !path.isAbsolute(imageRelative)) {
      return `/images/${imageRelative}`;
    }
    const videoRelative = path.relative(testPaths.videos, normalized).replace(/\\/g, "/");
    if (videoRelative && !videoRelative.startsWith("..") && !path.isAbsolute(videoRelative)) {
      return `/videos/${videoRelative}`;
    }
    return null;
  },
}));

import {
  moveAllFilesFromCollection,
  moveAllFilesToCollection,
} from "../../../services/storageService/collectionFileManager";
import { setOutputPathAllocatorVideoProviderForTests } from "../../../services/filenameTemplate/outputPathAllocator";

function ensureManagedRoots(): void {
  for (const dir of [
    testPaths.videos,
    testPaths.images,
    testPaths.imagesSmall,
    testPaths.avatars,
    testPaths.subtitles,
    testPaths.uploads,
    testPaths.data,
  ]) {
    fs.ensureDirSync(dir);
  }
}

function clearManagedRoots(): void {
  for (const dir of [
    testPaths.videos,
    testPaths.images,
    testPaths.imagesSmall,
    testPaths.avatars,
    testPaths.subtitles,
    testPaths.uploads,
    testPaths.data,
  ]) {
    fs.emptyDirSync(dir);
  }
}

function journalEntries(): string[] {
  const journalDir = path.join(testPaths.data, "output-family-journals");
  return fs.existsSync(journalDir) ? fs.readdirSync(journalDir) : [];
}

function makeVideo(overrides: Partial<Video>): Video {
  return {
    id: "video",
    title: "Episode",
    author: "Author",
    source: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=video",
    sourceVideoId: "video",
    videoFilename: "Episode.mp4",
    thumbnailFilename: "Episode.jpg",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("collectionFileManager allocator-backed family relocation", () => {
  beforeEach(() => {
    clearManagedRoots();
    ensureManagedRoots();
    settingsState.current = {
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    };
    videoStore.videos = [];
    setOutputPathAllocatorVideoProviderForTests(() => videoStore.videos);
  });

  afterAll(() => {
    setOutputPathAllocatorVideoProviderForTests(null);
    fs.removeSync(testPaths.root);
  });

  it("moves a family into a collection with a source-id suffix when another row owns the preferred target", () => {
    const current = makeVideo({
      id: "current",
      sourceVideoId: "yt-current",
      videoPath: "/videos/Episode.mp4",
      thumbnailPath: "/images/Episode.jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode.en.vtt",
          path: "/subtitles/Episode.en.vtt",
        },
      ],
    });
    const other = makeVideo({
      id: "other",
      sourceVideoId: "yt-other",
      videoPath: "/videos/Series/Episode.mp4",
      thumbnailPath: "/images/Series/Episode.jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode.en.vtt",
          path: "/subtitles/Series/Episode.en.vtt",
        },
      ],
    });
    const collections: Collection[] = [
      { id: "collection", title: "Series", name: "Series", videos: [] },
    ];
    videoStore.videos = [current, other];

    fs.outputFileSync(path.join(testPaths.videos, "Episode.mp4"), "source-video");
    fs.outputFileSync(path.join(testPaths.images, "Episode.jpg"), "source-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "Episode.en.vtt"), "source-sub");
    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.mp4"), "other-video");
    fs.outputFileSync(path.join(testPaths.images, "Series", "Episode.jpg"), "other-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "Series", "Episode.en.vtt"), "other-sub");

    const updates = moveAllFilesToCollection(current, "Series", collections);

    expect(updates).toEqual({
      videoPath: "/videos/Series/Episode [yt-current].mp4",
      videoFilename: "Episode [yt-current].mp4",
      thumbnailPath: "/images/Series/Episode [yt-current].jpg",
      thumbnailFilename: "Episode [yt-current].jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode [yt-current].en.vtt",
          path: "/subtitles/Series/Episode [yt-current].en.vtt",
        },
      ],
    });
    expect(fs.readFileSync(path.join(testPaths.videos, "Series", "Episode [yt-current].mp4"), "utf8")).toBe("source-video");
    expect(fs.readFileSync(path.join(testPaths.images, "Series", "Episode [yt-current].jpg"), "utf8")).toBe("source-thumb");
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Series", "Episode [yt-current].en.vtt"), "utf8")).toBe("source-sub");
    expect(fs.readFileSync(path.join(testPaths.videos, "Series", "Episode.mp4"), "utf8")).toBe("other-video");
    expect(fs.readFileSync(path.join(testPaths.images, "Series", "Episode.jpg"), "utf8")).toBe("other-thumb");
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Series", "Episode.en.vtt"), "utf8")).toBe("other-sub");
    expect(fs.existsSync(path.join(testPaths.videos, "Episode.mp4"))).toBe(false);
    expect(fs.existsSync(path.join(testPaths.images, "Episode.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(testPaths.subtitles, "Episode.en.vtt"))).toBe(false);
    expect(journalEntries()).toEqual([]);
  });

  it("keeps central subtitles in the subtitle root when unlinking to the root", () => {
    // removeVideoFromCollection passes no subtitlePathPrefix when the unlink
    // target is the storage root. That must not be read as "store subtitles in
    // the video folder" while moveSubtitlesToVideoFolder is disabled.
    settingsState.current.moveSubtitlesToVideoFolder = false;
    const current = makeVideo({
      id: "current",
      sourceVideoId: "yt-current",
      videoPath: "/videos/Series/Episode.mp4",
      thumbnailPath: "/images/Series/Episode.jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode.en.vtt",
          path: "/subtitles/Series/Episode.en.vtt",
        },
      ],
    });
    const collections: Collection[] = [
      { id: "collection", title: "Series", name: "Series", videos: [] },
    ];
    videoStore.videos = [current];

    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.mp4"), "source-video");
    fs.outputFileSync(path.join(testPaths.images, "Series", "Episode.jpg"), "source-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "Series", "Episode.en.vtt"), "source-sub");

    const updates = moveAllFilesFromCollection(
      current,
      testPaths.videos,
      testPaths.images,
      testPaths.subtitles,
      "/videos",
      "/images",
      undefined,
      collections
    );

    expect(updates.subtitles).toEqual([
      {
        language: "en",
        filename: "Episode.en.vtt",
        path: "/subtitles/Episode.en.vtt",
      },
    ]);
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Episode.en.vtt"), "utf8")).toBe("source-sub");
    expect(fs.existsSync(path.join(testPaths.videos, "Episode.en.vtt"))).toBe(false);
    expect(fs.existsSync(path.join(testPaths.subtitles, "Series", "Episode.en.vtt"))).toBe(false);
    expect(journalEntries()).toEqual([]);
  });

  it("keeps thumbnails in the video folder when that setting is enabled", () => {
    // Unlinking must respect the active storage configuration rather than
    // hard-coding the image root, or an enabled moveThumbnailsToVideoFolder
    // silently pulls the thumbnail back out into /images.
    settingsState.current.moveThumbnailsToVideoFolder = true;
    const current = makeVideo({
      id: "current",
      sourceVideoId: "yt-current",
      videoPath: "/videos/Series/Episode.mp4",
      thumbnailPath: "/videos/Series/Episode.jpg",
      subtitles: [],
    });
    const collections: Collection[] = [
      { id: "collection", title: "Series", name: "Series", videos: [] },
    ];
    videoStore.videos = [current];

    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.mp4"), "source-video");
    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.jpg"), "source-thumb");

    const updates = moveAllFilesFromCollection(
      current,
      testPaths.videos,
      testPaths.images,
      testPaths.subtitles,
      "/videos",
      "/images",
      undefined,
      collections
    );

    expect(updates.thumbnailPath).toBe("/videos/Episode.jpg");
    expect(fs.readFileSync(path.join(testPaths.videos, "Episode.jpg"), "utf8")).toBe("source-thumb");
    expect(fs.existsSync(path.join(testPaths.images, "Episode.jpg"))).toBe(false);
    expect(journalEntries()).toEqual([]);
  });

  it("moves subtitles into the video folder when that setting is enabled", () => {
    settingsState.current.moveSubtitlesToVideoFolder = true;
    const current = makeVideo({
      id: "current",
      sourceVideoId: "yt-current",
      videoPath: "/videos/Series/Episode.mp4",
      thumbnailPath: "/images/Series/Episode.jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode.en.vtt",
          path: "/videos/Series/Episode.en.vtt",
        },
      ],
    });
    const collections: Collection[] = [
      { id: "collection", title: "Series", name: "Series", videos: [] },
    ];
    videoStore.videos = [current];

    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.mp4"), "source-video");
    fs.outputFileSync(path.join(testPaths.images, "Series", "Episode.jpg"), "source-thumb");
    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.en.vtt"), "source-sub");

    const updates = moveAllFilesFromCollection(
      current,
      testPaths.videos,
      testPaths.images,
      testPaths.subtitles,
      "/videos",
      "/images",
      undefined,
      collections
    );

    expect(updates.subtitles).toEqual([
      {
        language: "en",
        filename: "Episode.en.vtt",
        path: "/videos/Episode.en.vtt",
      },
    ]);
    expect(fs.readFileSync(path.join(testPaths.videos, "Episode.en.vtt"), "utf8")).toBe("source-sub");
    expect(fs.existsSync(path.join(testPaths.subtitles, "Episode.en.vtt"))).toBe(false);
    expect(journalEntries()).toEqual([]);
  });

  it("moves a family out of a collection with a source-id suffix when root files already exist", () => {
    const current = makeVideo({
      id: "current",
      sourceVideoId: "yt-current",
      videoPath: "/videos/Series/Episode.mp4",
      thumbnailPath: "/images/Series/Episode.jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode.en.vtt",
          path: "/subtitles/Series/Episode.en.vtt",
        },
      ],
    });
    const other = makeVideo({
      id: "other",
      sourceVideoId: "yt-other",
      videoPath: "/videos/Episode.mp4",
      thumbnailPath: "/images/Episode.jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode.en.vtt",
          path: "/subtitles/Episode.en.vtt",
        },
      ],
    });
    const collections: Collection[] = [
      { id: "collection", title: "Series", name: "Series", videos: ["current"] },
    ];
    videoStore.videos = [current, other];

    fs.outputFileSync(path.join(testPaths.videos, "Series", "Episode.mp4"), "source-video");
    fs.outputFileSync(path.join(testPaths.images, "Series", "Episode.jpg"), "source-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "Series", "Episode.en.vtt"), "source-sub");
    fs.outputFileSync(path.join(testPaths.videos, "Episode.mp4"), "other-video");
    fs.outputFileSync(path.join(testPaths.images, "Episode.jpg"), "other-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "Episode.en.vtt"), "other-sub");

    const updates = moveAllFilesFromCollection(
      current,
      testPaths.videos,
      testPaths.images,
      testPaths.subtitles,
      "/videos",
      "/images",
      "/subtitles",
      collections
    );

    expect(updates).toEqual({
      videoPath: "/videos/Episode [yt-current].mp4",
      videoFilename: "Episode [yt-current].mp4",
      thumbnailPath: "/images/Episode [yt-current].jpg",
      thumbnailFilename: "Episode [yt-current].jpg",
      subtitles: [
        {
          language: "en",
          filename: "Episode [yt-current].en.vtt",
          path: "/subtitles/Episode [yt-current].en.vtt",
        },
      ],
    });
    expect(fs.readFileSync(path.join(testPaths.videos, "Episode [yt-current].mp4"), "utf8")).toBe("source-video");
    expect(fs.readFileSync(path.join(testPaths.images, "Episode [yt-current].jpg"), "utf8")).toBe("source-thumb");
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Episode [yt-current].en.vtt"), "utf8")).toBe("source-sub");
    expect(fs.readFileSync(path.join(testPaths.videos, "Episode.mp4"), "utf8")).toBe("other-video");
    expect(fs.readFileSync(path.join(testPaths.images, "Episode.jpg"), "utf8")).toBe("other-thumb");
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Episode.en.vtt"), "utf8")).toBe("other-sub");
    expect(fs.existsSync(path.join(testPaths.videos, "Series", "Episode.mp4"))).toBe(false);
    expect(fs.existsSync(path.join(testPaths.images, "Series", "Episode.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(testPaths.subtitles, "Series", "Episode.en.vtt"))).toBe(false);
    expect(journalEntries()).toEqual([]);
  });
});
