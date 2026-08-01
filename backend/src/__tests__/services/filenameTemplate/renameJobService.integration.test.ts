import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Video } from "../../../services/storageService/types";

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-rename-job-"));

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

const storageState = vi.hoisted(() => ({
  videos: [] as Video[],
  settings: {
    authorOrganizationMode: "root",
  },
}));

const dbState = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
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

vi.mock("../../../db", () => ({
  db: {
    transaction: (callback: () => unknown) => callback(),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          run: () => {
            dbState.updates.push(values);
          },
        }),
      }),
    })),
    select: vi.fn(() => ({
      from: () => ({
        all: () => [],
      }),
    })),
  },
}));

vi.mock("../../../db/schema", () => ({
  videos: {
    id: "videos.id",
  },
  downloadHistory: {
    videoId: "downloadHistory.videoId",
    status: "downloadHistory.status",
  },
  subscriptions: {
    collectionId: "subscriptions.collectionId",
    subscriptionType: "subscriptions.subscriptionType",
    playlistId: "subscriptions.playlistId",
    author: "subscriptions.author",
    authorUrl: "subscriptions.authorUrl",
    playlistTitle: "subscriptions.playlistTitle",
    channelName: "subscriptions.channelName",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../../../services/storageService", () => ({
  getVideos: () => storageState.videos,
  getCollections: () => [],
  getSettings: () => storageState.settings,
  getVideoById: () => null,
}));

vi.mock("../../../services/storageService/videos", () => ({
  getVideos: () => storageState.videos,
}));

vi.mock("../../../services/mediaServerExport", () => ({
  removeMediaServerArtifactsForVideo: vi.fn(),
  syncMediaServerArtifactsForRecord: vi.fn(),
  syncMediaServerShowArtifactsForShowRoot: vi.fn(),
}));

vi.mock("../../../services/mediaServerExport/pathPlanner", () => ({
  planMediaServerExportPaths: vi.fn(() => null),
}));

vi.mock("../../../services/thumbnailMirrorService", () => ({
  moveSmallThumbnailMirrorSync: vi.fn(),
}));

vi.mock("../../../services/storageService/videoListRevision", () => ({
  bumpVideosListRevision: vi.fn(),
}));

import {
  cancelRenameJob,
  getActiveRenameJob,
  startRenameJob,
} from "../../../services/filenameTemplate/renameJobService";
import { releaseRenameLock } from "../../../services/filenameTemplate/renameLockService";
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
    title: "Same Stem",
    author: "Author",
    source: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=video",
    sourceVideoId: "video",
    videoFilename: "original.mp4",
    thumbnailFilename: "original.jpg",
    createdAt: "2026-01-01T00:00:00Z",
    addedAt: "2026-01-01T00:00:00Z",
    date: "2026-01-01",
    subtitles: [],
    ...overrides,
  };
}

async function waitForJobToFinish(maxIterations = 100): Promise<void> {
  for (let index = 0; index < maxIterations; index += 1) {
    const job = getActiveRenameJob();
    if (!job || job.status !== "running") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("renameJobService allocator-backed filesystem collision handling", () => {
  beforeEach(() => {
    clearManagedRoots();
    ensureManagedRoots();
    storageState.videos = [];
    dbState.updates = [];
    setOutputPathAllocatorVideoProviderForTests(() => storageState.videos);
    const activeJob = getActiveRenameJob();
    if (activeJob && activeJob.status === "running") {
      cancelRenameJob(activeJob.id);
    }
    releaseRenameLock();
  });

  afterEach(async () => {
    const activeJob = getActiveRenameJob();
    if (activeJob && activeJob.status === "running") {
      cancelRenameJob(activeJob.id);
      await waitForJobToFinish();
    }
    releaseRenameLock();
  });

  afterAll(() => {
    setOutputPathAllocatorVideoProviderForTests(null);
    fs.removeSync(testPaths.root);
  });

  it("keeps an earlier renamed family and source-id suffixes the later same-stem batch item", async () => {
    const first = makeVideo({
      id: "first",
      sourceVideoId: "yt-one",
      sourceUrl: "https://www.youtube.com/watch?v=yt-one",
      videoFilename: "original-one.mp4",
      videoPath: "/videos/original-one.mp4",
      thumbnailFilename: "original-one.jpg",
      thumbnailPath: "/images/original-one.jpg",
      subtitles: [
        {
          language: "en",
          filename: "original-one.en.vtt",
          path: "/subtitles/original-one.en.vtt",
        },
      ],
    });
    const second = makeVideo({
      id: "second",
      sourceVideoId: "yt-two",
      sourceUrl: "https://www.youtube.com/watch?v=yt-two",
      videoFilename: "original-two.mp4",
      videoPath: "/videos/original-two.mp4",
      thumbnailFilename: "original-two.jpg",
      thumbnailPath: "/images/original-two.jpg",
      subtitles: [
        {
          language: "en",
          filename: "original-two.en.vtt",
          path: "/subtitles/original-two.en.vtt",
        },
      ],
    });
    storageState.videos = [first, second];

    fs.outputFileSync(path.join(testPaths.videos, "original-one.mp4"), "first-video");
    fs.outputFileSync(path.join(testPaths.images, "original-one.jpg"), "first-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "original-one.en.vtt"), "first-sub");
    fs.outputFileSync(path.join(testPaths.videos, "original-two.mp4"), "second-video");
    fs.outputFileSync(path.join(testPaths.images, "original-two.jpg"), "second-thumb");
    fs.outputFileSync(path.join(testPaths.subtitles, "original-two.en.vtt"), "second-sub");

    await startRenameJob(
      {
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "{{ title }}.{{ ext }}",
      },
      false,
      false
    );
    await waitForJobToFinish();

    const job = getActiveRenameJob();
    expect(job?.status).toBe("completed");
    expect(job?.succeeded).toBe(2);
    expect(job?.failed).toBe(0);
    expect(job?.items.map((item) => item.newVideoPath)).toEqual([
      "/videos/Same Stem.mp4",
      "/videos/Same Stem [yt-two].mp4",
    ]);
    expect(fs.readFileSync(path.join(testPaths.videos, "Same Stem.mp4"), "utf8")).toBe("first-video");
    expect(fs.readFileSync(path.join(testPaths.images, "Same Stem.jpg"), "utf8")).toBe("first-thumb");
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Same Stem.en.vtt"), "utf8")).toBe("first-sub");
    expect(fs.readFileSync(path.join(testPaths.videos, "Same Stem [yt-two].mp4"), "utf8")).toBe("second-video");
    expect(fs.readFileSync(path.join(testPaths.images, "Same Stem [yt-two].jpg"), "utf8")).toBe("second-thumb");
    expect(fs.readFileSync(path.join(testPaths.subtitles, "Same Stem [yt-two].en.vtt"), "utf8")).toBe("second-sub");
    expect(fs.existsSync(path.join(testPaths.videos, "original-one.mp4"))).toBe(false);
    expect(fs.existsSync(path.join(testPaths.videos, "original-two.mp4"))).toBe(false);
    expect(journalEntries()).toEqual([]);
  });

  it("keeps template batch-renamed files inside the author folder for linked author mode", async () => {
    const video = makeVideo({
      id: "linked-author",
      author: "Linked Author",
      sourceVideoId: "yt-linked",
      sourceUrl: "https://www.youtube.com/watch?v=yt-linked",
      videoFilename: "original.mp4",
      videoPath: "/videos/original.mp4",
      thumbnailFilename: undefined,
      thumbnailPath: undefined,
    });
    storageState.videos = [video];
    fs.outputFileSync(path.join(testPaths.videos, "original.mp4"), "video");

    await startRenameJob(
      {
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "Season 01/{{ title }}.{{ ext }}",
        authorOrganizationMode: "author_collection_linked",
      },
      false,
      false
    );
    await waitForJobToFinish();

    const job = getActiveRenameJob();
    expect(job?.status).toBe("completed");
    expect(job?.items[0]?.newVideoPath).toBe(
      "/videos/Linked Author/Season 01/Same Stem.mp4"
    );
    expect(
      fs.readFileSync(
        path.join(
          testPaths.videos,
          "Linked Author",
          "Season 01",
          "Same Stem.mp4"
        ),
        "utf8"
      )
    ).toBe("video");
  });
});
