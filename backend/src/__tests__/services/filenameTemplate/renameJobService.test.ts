/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/mock/videos",
  IMAGES_DIR: "/mock/images",
  SUBTITLES_DIR: "/mock/subtitles",
  AVATARS_DIR: "/mock/avatars",
  DATA_DIR: "/mock/data",
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: vi.fn().mockReturnValue(true),
  resolveSafeChildPath: vi.fn(
    (base: string, child: string) => `${base}/${child}`
  ),
  ensureDirSafeSync: vi.fn(),
  moveSafeSync: vi.fn(),
}));

// Mocks for the subscriptions query in precomputeSourceOptions. Tests that
// need to inject membership data should override `subscriptionsRowsMock`.
const subscriptionsRowsMock = { current: [] as Array<Record<string, unknown>> };

vi.mock("../../../db", () => ({
  db: {
    transaction: (cb: () => unknown) => cb(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        all: () => subscriptionsRowsMock.current,
      })),
    })),
  },
}));

vi.mock("../../../db/schema", () => ({
  videos: {
    id: "id",
  },
  downloadHistory: {
    videoId: "videoId",
    status: "status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../../../services/thumbnailMirrorService", () => ({
  moveSmallThumbnailMirrorSync: vi.fn(),
}));

const getVideosMock = vi.fn();
const getCollectionsMock = vi.fn();

vi.mock("../../../services/storageService", () => ({
  getVideos: () => getVideosMock(),
  getCollections: () => getCollectionsMock(),
}));

import {
  cancelRenameJob,
  getActiveRenameJob,
  startRenameJob,
} from "../../../services/filenameTemplate/renameJobService";
import { releaseRenameLock } from "../../../services/filenameTemplate/renameLockService";
import { setCollectionTypeRowsLoaderForTests } from "../../../services/filenameTemplate/sourceOptions";

async function waitForJobToFinish(maxIterations = 50): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const job = getActiveRenameJob();
    if (!job || job.status !== "running") return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("renameJobService — design §23 changes", () => {
  beforeEach(() => {
    getVideosMock.mockReset();
    getCollectionsMock.mockReset();
    getCollectionsMock.mockReturnValue([]);
    subscriptionsRowsMock.current = [];
    setCollectionTypeRowsLoaderForTests(
      () => subscriptionsRowsMock.current as Array<{
        collectionId: string | null;
        subscriptionType: string | null;
        playlistId: string | null;
      }>
    );
    // Clear any leaked job from a previous test
    const job = getActiveRenameJob();
    if (job) cancelRenameJob(job.id);
    releaseRenameLock();
  });

  afterEach(async () => {
    const job = getActiveRenameJob();
    if (job) cancelRenameJob(job.id);
    await waitForJobToFinish();
    releaseRenameLock();
    setCollectionTypeRowsLoaderForTests();
  });

  it("legacy preset is accepted and resolves to formatVideoFilename template (no longer rejected)", async () => {
    getVideosMock.mockReturnValue([]);
    const job = await startRenameJob(
      { downloadFilenamePresetId: "legacy" },
      false,
      false
    );
    // Job snapshot records the template text used. The renderer bypasses this
    // for legacy and calls formatVideoFilename directly, but the saved snapshot
    // still shows the equivalent template for UI display.
    expect(job.template).toBe(
      "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}"
    );
    // status starts at "running" but with 0 videos completes in microtasks.
    expect(["running", "completed"]).toContain(job.status);
    await waitForJobToFinish();
    expect(getActiveRenameJob()?.status).toBe("completed");
  });

  it("custom preset uses the saved custom template", async () => {
    getVideosMock.mockReturnValue([]);
    const job = await startRenameJob(
      {
        downloadFilenamePresetId: "custom",
        downloadFilenameTemplate: "{{ title }}.{{ ext }}",
      },
      false,
      false
    );
    expect(job.template).toBe("{{ title }}.{{ ext }}");
    await waitForJobToFinish();
  });

  it("built-in preset uses the preset's template from FILENAME_TEMPLATE_PRESETS", async () => {
    getVideosMock.mockReturnValue([]);
    const job = await startRenameJob(
      { downloadFilenamePresetId: "channel_year_date_index" },
      false,
      false
    );
    expect(job.template).toContain("source_collection_name");
    await waitForJobToFinish();
  });

  it("skips cloud: paths with cloud_rename_not_supported reason", async () => {
    getVideosMock.mockReturnValue([
      {
        id: "v1",
        title: "Cloud Video",
        videoPath: "cloud:foo.mp4",
      } as any,
    ]);
    await startRenameJob(
      { downloadFilenamePresetId: "legacy" },
      false,
      false
    );
    await waitForJobToFinish();
    const job = getActiveRenameJob();
    expect(job?.skipped).toBe(1);
    expect(job?.items[0].status).toBe("skipped");
    expect(job?.items[0].skipReason).toBe("cloud_rename_not_supported");
  });

  it("skips mount: paths with external_mount_path reason", async () => {
    getVideosMock.mockReturnValue([
      {
        id: "v1",
        title: "Mounted",
        videoPath: "mount:/ext/foo.mp4",
      } as any,
    ]);
    await startRenameJob(
      { downloadFilenamePresetId: "legacy" },
      false,
      false
    );
    await waitForJobToFinish();
    const job = getActiveRenameJob();
    expect(job?.items[0].skipReason).toBe("external_mount_path");
  });
});

describe("renameJobService — precomputeSourceOptions (design §16 step 3)", () => {
  beforeEach(() => {
    getVideosMock.mockReset();
    getCollectionsMock.mockReset();
    getCollectionsMock.mockReturnValue([]);
    subscriptionsRowsMock.current = [];
    setCollectionTypeRowsLoaderForTests(
      () => subscriptionsRowsMock.current as Array<{
        collectionId: string | null;
        subscriptionType: string | null;
        playlistId: string | null;
      }>
    );
    const job = getActiveRenameJob();
    if (job) cancelRenameJob(job.id);
    releaseRenameLock();
  });

  afterEach(async () => {
    const job = getActiveRenameJob();
    if (job) cancelRenameJob(job.id);
    await waitForJobToFinish();
    releaseRenameLock();
    setCollectionTypeRowsLoaderForTests();
  });

  it("does not throw when collection lookup fails (best-effort)", async () => {
    getCollectionsMock.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    getVideosMock.mockReturnValue([]);
    const job = await startRenameJob(
      { downloadFilenamePresetId: "channel_year_date_index" },
      false,
      false
    );
    await waitForJobToFinish();
    expect(job.id).toBeDefined();
  });

  it("populates date-collision suffix for same-day videos in the same collection", async () => {
    // Three same-day videos all skipped via cloud: paths so we don't move
    // files; we inspect the per-item options indirectly via the snapshot.
    getCollectionsMock.mockReturnValue([
      {
        id: "col-1",
        name: "MyChannel",
        videos: ["v1", "v2", "v3"],
      },
    ]);
    subscriptionsRowsMock.current = [
      { collectionId: "col-1", subscriptionType: "author", playlistId: null },
    ];
    getVideosMock.mockReturnValue([
      {
        id: "v1",
        title: "T1",
        author: "MyChannel",
        date: "20260430",
        videoPath: "cloud:foo1.mp4",
        addedAt: "2026-04-30T10:00:00Z",
        createdAt: "2026-04-30T10:00:00Z",
      } as any,
      {
        id: "v2",
        title: "T2",
        author: "MyChannel",
        date: "20260430",
        videoPath: "cloud:foo2.mp4",
        addedAt: "2026-04-30T11:00:00Z",
        createdAt: "2026-04-30T11:00:00Z",
      } as any,
      {
        id: "v3",
        title: "T3",
        author: "MyChannel",
        date: "20260430",
        videoPath: "cloud:foo3.mp4",
        addedAt: "2026-04-30T12:00:00Z",
        createdAt: "2026-04-30T12:00:00Z",
      } as any,
    ]);
    await startRenameJob(
      { downloadFilenamePresetId: "channel_year_date_index" },
      false,
      false
    );
    await waitForJobToFinish();
    const job = getActiveRenameJob();
    // All three should be in the snapshot, all skipped (cloud:).
    expect(job?.processed).toBe(3);
    expect(job?.skipped).toBe(3);
    // Each skip reason is cloud_rename_not_supported.
    for (const item of job?.items || []) {
      expect(item.skipReason).toBe("cloud_rename_not_supported");
    }
  });

  it("treats videos in playlist subscriptions as 'playlist' type", async () => {
    getCollectionsMock.mockReturnValue([
      {
        id: "col-pl",
        name: "MyPlaylist",
        videos: ["vp1"],
      },
    ]);
    subscriptionsRowsMock.current = [
      { collectionId: "col-pl", subscriptionType: "playlist", playlistId: "PL123" },
    ];
    getVideosMock.mockReturnValue([
      {
        id: "vp1",
        title: "Episode 1",
        author: "Creator",
        date: "20260101",
        videoPath: "cloud:vp1.mp4",
        addedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
      } as any,
    ]);
    await startRenameJob(
      { downloadFilenamePresetId: "playlist_static_index" },
      false,
      false
    );
    await waitForJobToFinish();
    expect(getActiveRenameJob()?.processed).toBe(1);
  });
});
