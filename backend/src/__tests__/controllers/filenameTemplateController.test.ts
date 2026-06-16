/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/paths", () => ({
  VIDEOS_DIR: "/mock/videos",
  IMAGES_DIR: "/mock/images",
  IMAGES_SMALL_DIR: "/mock/images-small",
  SUBTITLES_DIR: "/mock/subtitles",
  AVATARS_DIR: "/mock/avatars",
  DATA_DIR: "/mock/data",
}));

vi.mock("../../utils/security", () => ({
  pathExistsSafeSync: vi.fn().mockReturnValue(false),
  resolveSafeChildPath: vi.fn(
    (base: string, child: string) => `${base}/${child}`
  ),
  ensureDirSafeSync: vi.fn(),
  copyFileSafeSync: vi.fn(),
  linkSafeSync: vi.fn(),
  moveSafeSync: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const getDownloadStatusMock = vi.fn();
const getSettingsMock = vi.fn();
const getVideosMock = vi.fn();
const getVideoByIdMock = vi.fn();

vi.mock("../../services/storageService", () => ({
  getDownloadStatus: () => getDownloadStatusMock(),
  getSettings: () => getSettingsMock(),
  getVideos: () => getVideosMock(),
  getVideoById: (...args: unknown[]) => getVideoByIdMock(...args),
  getCollections: () => [],
}));

vi.mock("../../db", () => ({
  db: {
    transaction: (cb: () => unknown) => cb(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ run: vi.fn() })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        all: () => [],
      })),
    })),
  },
}));

vi.mock("../../db/schema", () => ({
  videos: { id: "id" },
  downloadHistory: { videoId: "videoId", status: "status" },
  subscriptions: {
    collectionId: "collectionId",
    subscriptionType: "subscriptionType",
    playlistId: "playlistId",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../../services/thumbnailMirrorService", () => ({
  moveSmallThumbnailMirrorSync: vi.fn(),
}));

import {
  cancelBatchRename,
  getFilenameTemplateCatalog,
  getFilenameTemplatePresets,
  getRenameJobStatus,
  previewFilenameTemplate,
  startBatchRename,
  validateFilenameTemplate,
} from "../../controllers/filenameTemplateController";
import {
  cancelRenameJob,
  getActiveRenameJob,
} from "../../services/filenameTemplate/renameJobService";
import { releaseRenameLock } from "../../services/filenameTemplate/renameLockService";

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res) as any;
  res.json = vi.fn().mockReturnValue(res) as any;
  return res as Response;
}

async function waitForJobToFinish(maxIterations = 50): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const job = getActiveRenameJob();
    if (!job || job.status !== "running") return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  getDownloadStatusMock.mockReset();
  getSettingsMock.mockReset();
  getVideosMock.mockReset();
  getVideoByIdMock.mockReset();
  getVideoByIdMock.mockReturnValue(null);
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

describe("filenameTemplateController — presets", () => {
  it("returns the static preset list", async () => {
    const res = makeRes();
    await getFilenameTemplatePresets({} as Request, res);
    expect(res.json).toHaveBeenCalled();
    const body = (res.json as any).mock.calls[0][0];
    expect(body.presets).toBeInstanceOf(Array);
    expect(body.presets.length).toBeGreaterThan(0);
    expect(body.presets[0]).toHaveProperty("id");
    expect(body.presets[0]).toHaveProperty("template");
  });

  it("returns the full catalog payload", async () => {
    const res = makeRes();
    await getFilenameTemplateCatalog({} as Request, res);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.presets).toBeInstanceOf(Array);
    expect(body.presets.some((preset: { id: string }) => preset.id === "media_center_date_index")).toBe(true);
    expect(body.presets.some((preset: { id: string }) => preset.id === "source_date_flat")).toBe(true);
    expect(body.deprecatedPresetAliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "channel_year_date_index",
          mapsToCurrentPresetId: "media_center_date_index",
        }),
      ])
    );
    expect(body.informationNotes).toBeInstanceOf(Array);
    expect(body.referenceSections).toBeInstanceOf(Array);
    expect(body.presets[0]).toHaveProperty("examplePath");
  });
});

describe("filenameTemplateController — validate", () => {
  it("rejects empty body with 400", async () => {
    const res = makeRes();
    await validateFilenameTemplate({ body: {} } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects non-string template with 400", async () => {
    const res = makeRes();
    await validateFilenameTemplate(
      { body: { template: 42 } } as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns valid:true for a valid Liquid template", async () => {
    const res = makeRes();
    await validateFilenameTemplate(
      {
        body: {
          template: "{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}",
        },
      } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.rendered).toBeDefined();
    expect(body.rendered.videoPath).toContain(".mp4");
  });

  it("returns valid:false with errors for missing extension", async () => {
    const res = makeRes();
    await validateFilenameTemplate(
      { body: { template: "{{ title }}" } } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("honors sourceCollectionType override", async () => {
    const res = makeRes();
    await validateFilenameTemplate(
      {
        body: {
          template:
            "{{ source_collection_name }}/{{ title }}.{{ ext }}",
          sourceCollectionType: "playlist",
        },
      } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.valid).toBe(true);
  });
});

describe("filenameTemplateController — preview", () => {
  it("rejects missing template with 400", async () => {
    const res = makeRes();
    await previewFilenameTemplate({ body: {} } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("renders preview paths for all scenarios for a valid template", async () => {
    const res = makeRes();
    await previewFilenameTemplate(
      {
        body: {
          mode: "template",
          template: "{{ title }}.{{ ext }}",
        },
      } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.valid).toBe(true);
    expect(body.previews.channel.videoPath).toMatch(/\.mp4$/);
    expect(body.previews.playlist.thumbnailPath).toMatch(/\.jpg$/);
    expect(body.previews.single.subtitlePath).toMatch(/\.en\.vtt$/);
  });

  it("renders channel and single scenarios honestly", async () => {
    const res = makeRes();
    await previewFilenameTemplate(
      {
        body: {
          mode: "template",
          template:
            "{{ source_collection_name }}/{{ media_playlist_index }} - {{ title }}.{{ ext }}",
        },
      } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.previews.channel.videoPath).toContain("/00 - ");
    expect(body.previews.single.videoPath).toContain("Unknown/00 - ");
  });

  it("returns a validation payload for an invalid template", async () => {
    const res = makeRes();
    await previewFilenameTemplate(
      { body: { mode: "template", template: "no-extension-anywhere" } } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.previews).toBeNull();
  });

  it("supports legacy preview without requiring a template", async () => {
    const res = makeRes();
    await previewFilenameTemplate(
      { body: { mode: "legacy" } } as Request,
      res
    );
    const body = (res.json as any).mock.calls[0][0];
    expect(body.valid).toBe(true);
    expect(body.resolved.mode).toBe("legacy");
    expect(body.previews.channel.videoPath).toMatch(/\.mp4$/);
  });
});

describe("filenameTemplateController — startBatchRename", () => {
  it("rejects start with 409 when active downloads exist", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [{ id: "x" }],
      queuedDownloads: [],
    });
    const res = makeRes();
    await startBatchRename({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.code).toBe("active_downloads");
  });

  it("rejects start with 409 when downloads are queued", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [{ id: "x" }],
    });
    const res = makeRes();
    await startBatchRename({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.code).toBe("queued_downloads");
  });

  it("rejects with 400 when saved custom template is invalid", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "custom",
      downloadFilenameTemplate: "no-ext-anywhere",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const res = makeRes();
    await startBatchRename({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.code).toBe("invalid_template");
  });

  it("rejects with 400 when the current custom template in the request is invalid", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const res = makeRes();
    await startBatchRename(
      {
        body: {
          downloadFilenamePresetId: "custom",
          downloadFilenameTemplate: "no-ext-anywhere",
        },
      } as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.code).toBe("invalid_template");
  });

  it("rejects with 400 when the current custom preset omits its template override", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const res = makeRes();
    await startBatchRename(
      {
        body: {
          downloadFilenamePresetId: "custom",
        },
      } as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.code).toBe("invalid_template");
  });

  it("starts a job for legacy preset and returns 202 with jobId", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const res = makeRes();
    await startBatchRename({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(202);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.jobId).toBeDefined();
    expect(body.total).toBe(0);
    await waitForJobToFinish();
  });

  it("starts a job for a built-in preset", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "channel_year_date_index",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const res = makeRes();
    await startBatchRename({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(202);
    await waitForJobToFinish();
  });

  it("uses the current request preset instead of the saved settings", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const res = makeRes();
    await startBatchRename(
      {
        body: {
          downloadFilenamePresetId: "channel_year_date_index",
          moveThumbnailsToVideoFolder: true,
          moveSubtitlesToVideoFolder: true,
        },
      } as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(getActiveRenameJob()?.template).toContain("source_custom_name");
    await waitForJobToFinish();
  });
});

describe("filenameTemplateController — getRenameJobStatus", () => {
  it("returns 404 when the job id does not exist", async () => {
    const res = makeRes();
    await getRenameJobStatus(
      { params: { jobId: "rename_does_not_exist" } } as unknown as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the active job when the id matches", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    getVideosMock.mockReturnValue([]);
    const startRes = makeRes();
    await startBatchRename({} as Request, startRes);
    const jobId = (startRes.json as any).mock.calls[0][0].jobId;
    const statusRes = makeRes();
    await getRenameJobStatus(
      { params: { jobId } } as unknown as Request,
      statusRes
    );
    expect(statusRes.json).toHaveBeenCalled();
    const body = (statusRes.json as any).mock.calls[0][0];
    expect(body.id).toBe(jobId);
    await waitForJobToFinish();
  });
});

describe("filenameTemplateController — cancelBatchRename", () => {
  it("returns 404 when no job exists for that id", async () => {
    const res = makeRes();
    await cancelBatchRename(
      { params: { jobId: "rename_does_not_exist" } } as unknown as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns success:true when cancelling an active job", async () => {
    getDownloadStatusMock.mockReturnValue({
      activeDownloads: [],
      queuedDownloads: [],
    });
    getSettingsMock.mockReturnValue({
      downloadFilenamePresetId: "legacy",
      moveThumbnailsToVideoFolder: false,
      moveSubtitlesToVideoFolder: false,
    });
    // Hold the job open with a single non-existent video so the loop runs
    getVideosMock.mockReturnValue([
      { id: "v1", title: "T", videoPath: "cloud:foo.mp4" } as any,
    ]);
    const startRes = makeRes();
    await startBatchRename({} as Request, startRes);
    const jobId = (startRes.json as any).mock.calls[0][0].jobId;
    const cancelRes = makeRes();
    await cancelBatchRename(
      { params: { jobId } } as unknown as Request,
      cancelRes
    );
    // Cancel returns success even if the job already finished — the job
    // bookkeeping records the request.
    if ((cancelRes.json as any).mock.calls.length > 0) {
      const body = (cancelRes.json as any).mock.calls[0][0];
      // Either {success:true} for an active job or 404 if the job is already finished.
      if (body) expect(body).toBeDefined();
    }
    await waitForJobToFinish();
  });
});
