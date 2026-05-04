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

vi.mock("../../../services/storageService", () => ({
  getVideos: () => getVideosMock(),
}));

import {
  cancelRenameJob,
  getActiveRenameJob,
  startRenameJob,
} from "../../../services/filenameTemplate/renameJobService";
import { releaseRenameLock } from "../../../services/filenameTemplate/renameLockService";

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
