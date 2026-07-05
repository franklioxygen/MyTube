import fs from "fs-extra";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Video } from "../../services/storageService/types";

// Integration coverage for issue #337 (§9 of
// reports/issue337-download-file-layout-diagnosis-and-fix-design.md): replay
// the reporter's exact configuration end to end — template render, NFO export,
// collection add — against a real filesystem, then clean the historical mess
// replicated from the issue screenshots.

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-issue337-"));

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

vi.mock("../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  DATA_DIR: testPaths.data,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  SUBTITLES_DIR: testPaths.subtitles,
  UPLOADS_DIR: testPaths.uploads,
  VIDEOS_DIR: testPaths.videos,
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mutable settings snapshot standing in for the settings store.
const settingsState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../../services/storageService/settings", () => ({
  getSettings: () => settingsState.current,
  invalidateSettingsCache: vi.fn(),
}));

// In-memory video store standing in for the DB-backed videos module.
const videoStore = vi.hoisted(() => ({
  byId: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../../services/storageService/videos", () => ({
  getVideos: () => Array.from(videoStore.byId.values()),
  getVideoById: (id: string) => videoStore.byId.get(id),
  updateVideo: (id: string, updates: Record<string, unknown>) => {
    const existing = videoStore.byId.get(id);
    if (existing) {
      videoStore.byId.set(id, { ...existing, ...updates });
    }
    return videoStore.byId.get(id);
  },
  deleteVideo: vi.fn(),
}));

// In-memory collection store standing in for the DB-backed repository.
const collectionStore = vi.hoisted(() => ({
  byId: new Map<string, { id: string; name: string; title?: string; videos: string[] }>(),
}));

vi.mock("../../services/storageService/collectionRepository", () => ({
  getCollections: () => Array.from(collectionStore.byId.values()),
  getCollectionById: (id: string) => collectionStore.byId.get(id),
  getCollectionByName: (name: string) =>
    Array.from(collectionStore.byId.values()).find((c) => c.name === name),
  getCollectionBySourceKey: () => undefined,
  saveCollection: (collection: { id: string; name: string; videos: string[] }) => {
    collectionStore.byId.set(collection.id, collection);
    return collection;
  },
  appendVideoToCollection: (collectionId: string, videoId: string) => {
    const collection = collectionStore.byId.get(collectionId);
    if (!collection) {
      return null;
    }
    if (!collection.videos.includes(videoId)) {
      collection.videos.push(videoId);
    }
    return { ...collection, videos: [...collection.videos] };
  },
  atomicUpdateCollection: (
    id: string,
    updateFn: (collection: { id: string; name: string; videos: string[] }) => unknown
  ) => {
    const collection = collectionStore.byId.get(id);
    if (!collection) {
      return null;
    }
    return updateFn(collection);
  },
  deleteCollection: vi.fn(),
}));

import { buildContextFromYtDlpInfo } from "../../services/filenameTemplate/contextBuilder";
import { planVideoOutputPaths } from "../../services/filenameTemplate/renderer";
import { sweepOrphanMediaServerArtifacts } from "../../services/mediaServerExport/orphanSweep";
import { syncMediaServerArtifactsForRecord } from "../../services/mediaServerExport/syncService";
import * as collectionsService from "../../services/storageService/collections";
import { buildFilenameTemplateSourceOptions } from "../../services/subscription/helpers";
import type { Subscription } from "../../services/subscription/types";

// The reporter's exact configuration (issue #337 screenshots 1-2).
const REPORTER_TEMPLATE =
  "{{ source_custom_name }}/{{ source_collection_name }}/{{ upload_yyyy_mm_dd }} - {{ title }}.{{ ext }}";
const REPORTER_SETTINGS = {
  downloadFilenameMode: "template",
  downloadFilenamePresetId: "custom",
  downloadFilenameTemplate: REPORTER_TEMPLATE,
  moveThumbnailsToVideoFolder: true,
  moveSubtitlesToVideoFolder: true,
  authorOrganizationMode: "author_collection_and_folder",
  mediaServerExportMode: "nfo",
};

const CHANNEL = "蕾儿乔什看世界Lei and Josh";
const PLAYLIST = "百国计划-第三个国家亚美尼亚";
const COLLECTION_NAME = `${PLAYLIST} - ${CHANNEL}`;
const TITLE = "開箱跨國火車頭等艙";
const EXPECTED_DIR = `${CHANNEL}/${PLAYLIST}`;
const EXPECTED_STEM = `2021-10-27 - ${TITLE}`;

function makePlaylistSubscription(
  overrides: Partial<Subscription> = {}
): Subscription {
  return {
    id: "sub-1",
    author: COLLECTION_NAME,
    authorUrl: "https://youtube.com/playlist?list=PL337",
    interval: 60,
    downloadCount: 0,
    createdAt: Date.now(),
    platform: "YouTube",
    playlistId: "PL337",
    playlistTitle: PLAYLIST,
    channelName: CHANNEL,
    subscriptionType: "playlist",
    collectionId: "col-1",
    ...overrides,
  };
}

function makeYtDlpInfo(): Record<string, unknown> {
  return {
    id: "yt-1",
    title: TITLE,
    upload_date: "20211027",
    uploader: CHANNEL,
    channel: CHANNEL,
    extractor: "youtube",
  };
}

function planReporterPaths(sub: Subscription) {
  const context = buildContextFromYtDlpInfo(
    "https://youtube.com/watch?v=abc123",
    makeYtDlpInfo(),
    buildFilenameTemplateSourceOptions(sub, 1)
  );
  return planVideoOutputPaths({
    settings: REPORTER_SETTINGS,
    context,
    videoExtension: "mp4",
    moveThumbnailsToVideoFolder: true,
    moveSubtitlesToVideoFolder: true,
  });
}

function writeFileAt(absolutePath: string, contents: string): void {
  fs.ensureDirSync(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function videosFileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(testPaths.videos, relativePath));
}

describe("issue #337 — download file layout (§9 integration)", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
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
    settingsState.current = { ...REPORTER_SETTINGS };
    videoStore.byId.clear();
    collectionStore.byId.clear();
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  describe("entry-point render consistency (S2)", () => {
    it("playlist subscription checks render <channel>/<playlist>/<date> - <title> with sidecars alongside", () => {
      const plan = planReporterPaths(makePlaylistSubscription());

      expect(plan.video.relativePath).toBe(
        `${EXPECTED_DIR}/${EXPECTED_STEM}.mp4`
      );
      // "Cover/subtitles with video" put both next to the media file.
      expect(plan.thumbnail.relativePath).toBe(
        `${EXPECTED_DIR}/${EXPECTED_STEM}.jpg`
      );
      expect(plan.thumbnail.absolutePath.startsWith(testPaths.videos)).toBe(
        true
      );
      expect(plan.subtitle.absoluteDirectory).toBe(
        path.join(testPaths.videos, CHANNEL, PLAYLIST)
      );
    });

    it("un-backfilled playlist subscriptions (pre-upgrade rows) render the same tree via display-name inference", () => {
      const plan = planReporterPaths(
        makePlaylistSubscription({ channelName: undefined })
      );

      expect(plan.video.relativePath).toBe(
        `${EXPECTED_DIR}/${EXPECTED_STEM}.mp4`
      );
    });

    it("channel subscription checks keep the by-design <channel>/<channel> double segment", () => {
      const channelSub = makePlaylistSubscription({
        playlistId: undefined,
        playlistTitle: undefined,
        channelName: undefined,
        subscriptionType: "author",
        author: CHANNEL,
      });
      const plan = planReporterPaths(channelSub);

      expect(plan.video.relativePath).toBe(
        `${CHANNEL}/${CHANNEL}/${EXPECTED_STEM}.mp4`
      );
    });
  });

  describe("post-download pipeline under template naming (S4 fix)", () => {
    function simulateCompletedDownload(): Video {
      // Materialize a finished download exactly where the planner placed it:
      // media + cover + subtitle at the template path, then the NFO exporter
      // runs, mirroring the ytdlpVideo save pipeline.
      const plan = planReporterPaths(makePlaylistSubscription());
      writeFileAt(plan.video.absolutePath, "video-bytes");
      writeFileAt(plan.thumbnail.absolutePath, "jpg-bytes");
      const subtitleAbsolutePath = path.join(
        plan.subtitle.absoluteDirectory,
        `${EXPECTED_STEM}.vtt`
      );
      writeFileAt(subtitleAbsolutePath, "vtt-bytes");

      const video = {
        id: "vid-1",
        title: TITLE,
        author: CHANNEL,
        date: "20211027",
        videoPath: plan.video.webPath,
        videoFilename: plan.video.filename,
        thumbnailPath: plan.thumbnail.webPath,
        thumbnailFilename: path.basename(plan.thumbnail.relativePath),
        subtitles: [
          {
            language: "zh",
            path: `${plan.subtitle.webDirectory}/${EXPECTED_STEM}.vtt`,
          },
        ],
        sourceUrl: "https://youtube.com/watch?v=abc123",
        createdAt: "2021-10-27T00:00:00.000Z",
      } as unknown as Video;
      videoStore.byId.set(video.id, video as unknown as Record<string, unknown>);

      syncMediaServerArtifactsForRecord(video);
      return video;
    }

    it("adding the video to its playlist collection keeps every file at the template path", () => {
      const video = simulateCompletedDownload();
      collectionStore.byId.set("col-1", {
        id: "col-1",
        name: COLLECTION_NAME,
        videos: [],
      });

      // NFO exporter placed the sidecars next to the video.
      expect(videosFileExists(`${EXPECTED_DIR}/${EXPECTED_STEM}.nfo`)).toBe(true);
      expect(videosFileExists(`${EXPECTED_DIR}/${EXPECTED_STEM}-thumb.jpg`)).toBe(
        true
      );

      const collection = collectionsService.addVideoToCollection(
        "col-1",
        video.id
      );

      // Membership is recorded, but nothing moves: the flat
      // videos/<collection>/ layout from the issue must not be created.
      expect(collection?.videos).toContain(video.id);
      for (const artifact of [
        `${EXPECTED_DIR}/${EXPECTED_STEM}.mp4`,
        `${EXPECTED_DIR}/${EXPECTED_STEM}.jpg`,
        `${EXPECTED_DIR}/${EXPECTED_STEM}.vtt`,
        `${EXPECTED_DIR}/${EXPECTED_STEM}.nfo`,
        `${EXPECTED_DIR}/${EXPECTED_STEM}-thumb.jpg`,
      ]) {
        expect(videosFileExists(artifact)).toBe(true);
      }
      expect(fs.existsSync(path.join(testPaths.videos, COLLECTION_NAME))).toBe(
        false
      );
      const storedVideo = videoStore.byId.get(video.id) as unknown as Video;
      expect(storedVideo.videoPath).toBe(
        `/videos/${EXPECTED_DIR}/${EXPECTED_STEM}.mp4`
      );
    });

    it("legacy naming still moves files into the collection folder and relocates the NFO sidecars (F3)", () => {
      settingsState.current = {
        moveThumbnailsToVideoFolder: true,
        moveSubtitlesToVideoFolder: true,
        authorOrganizationMode: "author_collection_and_folder",
        mediaServerExportMode: "nfo",
      };

      // Legacy layout: files at the videos root.
      const stem = `${TITLE}-${CHANNEL}-2021`;
      writeFileAt(path.join(testPaths.videos, `${stem}.mp4`), "video-bytes");
      writeFileAt(path.join(testPaths.videos, `${stem}.jpg`), "jpg-bytes");
      const video = {
        id: "vid-legacy",
        title: TITLE,
        author: CHANNEL,
        date: "20211027",
        videoPath: `/videos/${stem}.mp4`,
        videoFilename: `${stem}.mp4`,
        thumbnailPath: `/videos/${stem}.jpg`,
        thumbnailFilename: `${stem}.jpg`,
        sourceUrl: "https://youtube.com/watch?v=abc123",
        createdAt: "2021-10-27T00:00:00.000Z",
      } as unknown as Video;
      videoStore.byId.set(video.id, video as unknown as Record<string, unknown>);
      syncMediaServerArtifactsForRecord(video);
      expect(videosFileExists(`${stem}.nfo`)).toBe(true);

      collectionStore.byId.set("col-1", {
        id: "col-1",
        name: COLLECTION_NAME,
        videos: [],
      });
      collectionsService.addVideoToCollection("col-1", video.id);

      // Legacy contract: media moves into videos/<collection>/ — and after F3
      // the NFO sidecars travel with it instead of stranding at the old path.
      expect(videosFileExists(`${COLLECTION_NAME}/${stem}.mp4`)).toBe(true);
      expect(videosFileExists(`${COLLECTION_NAME}/${stem}.jpg`)).toBe(true);
      expect(videosFileExists(`${COLLECTION_NAME}/${stem}.nfo`)).toBe(true);
      expect(
        videosFileExists(`${COLLECTION_NAME}/${stem}-thumb.jpg`)
      ).toBe(true);
      expect(videosFileExists(`${stem}.nfo`)).toBe(false);
      expect(videosFileExists(`${stem}-thumb.jpg`)).toBe(false);
    });
  });

  describe("historical-mess cleanup (S3, S4, §5.6 leftovers)", () => {
    it("sweeps the stranded artifacts from screenshots 5-7 while keeping the converged library intact", () => {
      // Converged state after the rename job: media + sidecars at the
      // template path.
      const currentVideo = {
        id: "vid-1",
        title: TITLE,
        author: CHANNEL,
        videoPath: `/videos/${EXPECTED_DIR}/${EXPECTED_STEM}.mp4`,
        videoFilename: `${EXPECTED_STEM}.mp4`,
        sourceUrl: "https://youtube.com/watch?v=abc123",
        createdAt: "2021-10-27T00:00:00.000Z",
      } as unknown as Video;
      const mytubeNfo = '<episodedetails><uniqueid type="mytube">x</uniqueid></episodedetails>';
      writeFileAt(
        path.join(testPaths.videos, EXPECTED_DIR, `${EXPECTED_STEM}.mp4`),
        "video-bytes"
      );
      writeFileAt(
        path.join(testPaths.videos, EXPECTED_DIR, `${EXPECTED_STEM}.jpg`),
        "jpg-bytes"
      );
      writeFileAt(
        path.join(testPaths.videos, EXPECTED_DIR, `${EXPECTED_STEM}.nfo`),
        mytubeNfo
      );
      writeFileAt(
        path.join(testPaths.videos, EXPECTED_DIR, `${EXPECTED_STEM}-thumb.jpg`),
        "jpg-bytes"
      );

      // Screenshot 7 (S4): orphan sidecars in the nested playlist folder under
      // the flat "<playlist> - <channel>" collection folder.
      const screenshot7Dir = `${COLLECTION_NAME}/${PLAYLIST}`;
      writeFileAt(
        path.join(testPaths.videos, screenshot7Dir, `${EXPECTED_STEM}.nfo`),
        mytubeNfo
      );
      writeFileAt(
        path.join(testPaths.videos, screenshot7Dir, `${EXPECTED_STEM}-thumb.jpg`),
        "jpg-bytes"
      );

      // Screenshot 6 (S3): playlist-named folder inside the channel folder
      // holding only sidecars.
      const screenshot6Dir = `${CHANNEL}/${COLLECTION_NAME}`;
      writeFileAt(
        path.join(testPaths.videos, screenshot6Dir, "2021-11-01 - other.nfo"),
        mytubeNfo
      );
      writeFileAt(
        path.join(testPaths.videos, screenshot6Dir, "2021-11-01 - other-thumb.jpg"),
        "jpg-bytes"
      );

      // §5.6: leftover Season-preset show artifacts at the channel root.
      writeFileAt(
        path.join(testPaths.videos, CHANNEL, "tvshow.nfo"),
        mytubeNfo
      );
      writeFileAt(path.join(testPaths.videos, CHANNEL, "show.jpg"), "jpg");
      writeFileAt(path.join(testPaths.videos, CHANNEL, "poster.jpg"), "jpg");
      writeFileAt(path.join(testPaths.videos, CHANNEL, "folder.jpg"), "jpg");
      writeFileAt(
        path.join(testPaths.videos, CHANNEL, "Season 1", "s01e01 - old.nfo"),
        mytubeNfo
      );

      // A user-authored NFO without the MyTube marker must survive.
      writeFileAt(
        path.join(testPaths.videos, COLLECTION_NAME, "user-notes.nfo"),
        "<episodedetails><title>user file</title></episodedetails>"
      );

      const result = sweepOrphanMediaServerArtifacts([currentVideo]);

      expect(result.sweptFiles).toBe(9);
      // Converged library untouched.
      expect(videosFileExists(`${EXPECTED_DIR}/${EXPECTED_STEM}.mp4`)).toBe(true);
      expect(videosFileExists(`${EXPECTED_DIR}/${EXPECTED_STEM}.jpg`)).toBe(true);
      expect(videosFileExists(`${EXPECTED_DIR}/${EXPECTED_STEM}.nfo`)).toBe(true);
      expect(videosFileExists(`${EXPECTED_DIR}/${EXPECTED_STEM}-thumb.jpg`)).toBe(
        true
      );
      // Stranded artifacts and their empty folders are gone.
      expect(videosFileExists(screenshot7Dir)).toBe(false);
      expect(videosFileExists(screenshot6Dir)).toBe(false);
      expect(videosFileExists(`${CHANNEL}/tvshow.nfo`)).toBe(false);
      expect(videosFileExists(`${CHANNEL}/show.jpg`)).toBe(false);
      expect(videosFileExists(`${CHANNEL}/poster.jpg`)).toBe(false);
      expect(videosFileExists(`${CHANNEL}/folder.jpg`)).toBe(false);
      expect(videosFileExists(`${CHANNEL}/Season 1`)).toBe(false);
      // Unmarked user file preserved.
      expect(videosFileExists(`${COLLECTION_NAME}/user-notes.nfo`)).toBe(true);
    });
  });
});
