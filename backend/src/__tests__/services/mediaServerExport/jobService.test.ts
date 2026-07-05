import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Video } from "../../../services/storageService";

const getSettingsMock = vi.hoisted(() => vi.fn());
const getVideosMock = vi.hoisted(() => vi.fn());
const pathExistsSafeSyncMock = vi.hoisted(() => vi.fn());
const resolveManagedWebPathMock = vi.hoisted(() => vi.fn());
const syncMediaServerArtifactsForRecordMock = vi.hoisted(() => vi.fn());
const removeMediaServerArtifactsForVideoMock = vi.hoisted(() => vi.fn());
const sweepOrphanMediaServerArtifactsMock = vi.hoisted(() => vi.fn());
const acquireRenameLockMock = vi.hoisted(() => vi.fn());
const releaseRenameLockMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/storageService", () => ({
  getSettings: getSettingsMock,
  getVideos: getVideosMock,
}));

vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: pathExistsSafeSyncMock,
}));

vi.mock("../../../services/filenameTemplate/pathHelpers", () => ({
  resolveManagedWebPath: resolveManagedWebPathMock,
}));

vi.mock("../../../services/mediaServerExport/syncService", () => ({
  syncMediaServerArtifactsForRecord: syncMediaServerArtifactsForRecordMock,
  removeMediaServerArtifactsForVideo: removeMediaServerArtifactsForVideoMock,
}));

vi.mock("../../../services/mediaServerExport/orphanSweep", () => ({
  sweepOrphanMediaServerArtifacts: sweepOrphanMediaServerArtifactsMock,
}));

vi.mock("../../../services/filenameTemplate/renameLockService", () => ({
  acquireRenameLock: acquireRenameLockMock,
  releaseRenameLock: releaseRenameLockMock,
}));

vi.mock("../../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  cancelMediaServerExportJob,
  getMediaServerExportJobById,
  startMediaServerExportJob,
} from "../../../services/mediaServerExport/jobService";

function createVideo(id: string): Video {
  return {
    id,
    title: `Video ${id}`,
    videoPath: `/videos/Show/Season 01/${id}.mp4`,
    videoFilename: `${id}.mp4`,
    sourceUrl: `https://example.com/${id}`,
    createdAt: "2026-05-27T00:00:00.000Z",
  } as unknown as Video;
}

async function waitForJobCompletion(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = getMediaServerExportJobById(jobId);
    if (job?.status === "completed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for job ${jobId} to complete`);
}

async function waitForJobStatus(
  jobId: string,
  status: "completed" | "cancelled" | "failed"
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = getMediaServerExportJobById(jobId);
    if (job?.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${status}`);
}

describe("mediaServerExport jobService", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    getVideosMock.mockReset();
    pathExistsSafeSyncMock.mockReset();
    resolveManagedWebPathMock.mockReset();
    syncMediaServerArtifactsForRecordMock.mockReset();
    removeMediaServerArtifactsForVideoMock.mockReset();
    sweepOrphanMediaServerArtifactsMock.mockReset();
    acquireRenameLockMock.mockReset();
    releaseRenameLockMock.mockReset();

    acquireRenameLockMock.mockReturnValue(true);
    sweepOrphanMediaServerArtifactsMock.mockReturnValue({
      sweptFiles: 0,
      sweptList: [],
    });
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo" });
    pathExistsSafeSyncMock.mockReturnValue(true);
    resolveManagedWebPathMock.mockImplementation((webPath: string) => ({
      prefix: "/videos",
      rootDir: "/tmp/videos",
      relativePath: webPath.replace(/^\/videos\//, ""),
      absolutePath: `/tmp/videos/${webPath.replace(/^\/videos\//, "")}`,
    }));
  });

  it("starts rebuild jobs asynchronously and reports completed counts", async () => {
    getVideosMock.mockReturnValue([createVideo("video-1")]);

    const job = await startMediaServerExportJob("nfo");

    expect(job.status).toBe("running");
    expect(job.action).toBe("rebuild");
    expect(job.succeeded).toBe(0);

    await waitForJobCompletion(job.id);

    const completedJob = getMediaServerExportJobById(job.id);
    expect(completedJob?.processed).toBe(1);
    expect(completedJob?.succeeded).toBe(1);
    expect(completedJob?.sweptFiles).toBe(0);
    expect(syncMediaServerArtifactsForRecordMock).toHaveBeenCalledTimes(1);
    expect(removeMediaServerArtifactsForVideoMock).not.toHaveBeenCalled();
  });

  it("records orphan sweep counters before processing videos", async () => {
    getVideosMock.mockReturnValue([createVideo("video-1")]);
    sweepOrphanMediaServerArtifactsMock.mockReturnValue({
      sweptFiles: 2,
      sweptList: ["Old/video.nfo", "Old/video-thumb.jpg"],
    });

    const job = await startMediaServerExportJob("nfo");
    await waitForJobCompletion(job.id);

    const completedJob = getMediaServerExportJobById(job.id);
    expect(sweepOrphanMediaServerArtifactsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "video-1" }),
    ]);
    expect(completedJob?.sweptFiles).toBe(2);
    expect(completedJob?.sweptList).toEqual([
      "Old/video.nfo",
      "Old/video-thumb.jpg",
    ]);
  });

  it("does not run orphan sweep when cancelled before the worker starts", async () => {
    getVideosMock.mockReturnValue([createVideo("video-1")]);

    const job = await startMediaServerExportJob("nfo");
    expect(cancelMediaServerExportJob(job.id)).toBe(true);

    await waitForJobStatus(job.id, "cancelled");

    expect(sweepOrphanMediaServerArtifactsMock).not.toHaveBeenCalled();
    expect(releaseRenameLockMock).toHaveBeenCalled();
  });

  it("treats off mode as cleanup and removes generated artifacts", async () => {
    getVideosMock.mockReturnValue([createVideo("video-2")]);

    const job = await startMediaServerExportJob("off");

    expect(job.action).toBe("cleanup");

    await waitForJobCompletion(job.id);

    const completedJob = getMediaServerExportJobById(job.id);
    expect(completedJob?.processed).toBe(1);
    expect(completedJob?.succeeded).toBe(1);
    expect(removeMediaServerArtifactsForVideoMock).toHaveBeenCalledTimes(1);
    expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
  });
});
