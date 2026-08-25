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
const getMediaServerExportLayoutMock = vi.hoisted(() => vi.fn());
const syncPlaylistTvLibraryMock = vi.hoisted(() => vi.fn());
const cleanupMediaServerMirrorAsyncMock = vi.hoisted(() => vi.fn());

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
  getMediaServerExportLayout: getMediaServerExportLayoutMock,
}));

vi.mock("../../../services/mediaServerExport/playlistTvSync", () => ({
  syncPlaylistTvLibrary: syncPlaylistTvLibraryMock,
}));

vi.mock("../../../services/mediaServerExport/hierarchyMaterializer", () => ({
  cleanupMediaServerMirrorAsync: cleanupMediaServerMirrorAsyncMock,
}));

vi.mock("../../../services/mediaServerExport/orphanSweep", () => ({
  sweepOrphanMediaServerArtifacts: sweepOrphanMediaServerArtifactsMock,
}));

// The playlist_tv modules are mocked above; this keeps anything they pull in
// from opening a real database.
vi.mock("../../../db", () => ({ db: {} }));

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
  getActiveMediaServerExportJob,
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
    getMediaServerExportLayoutMock.mockReset();
    syncPlaylistTvLibraryMock.mockReset();
    cleanupMediaServerMirrorAsyncMock.mockReset();
    // Cleanup now sweeps both layouts, so every cleanup test reaches this.
    cleanupMediaServerMirrorAsyncMock.mockResolvedValue({
      counts: { removedArtifacts: 0 },
      failures: [],
    });

    getMediaServerExportLayoutMock.mockReturnValue("adjacent");
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

  // Issue #411 regression boundary: the frontend reads these fields off the job
  // payload. New playlist_tv phase/count fields may only be added alongside them.
  it("keeps the job payload shape the frontend depends on", async () => {
    getVideosMock.mockReturnValue([createVideo("video-1")]);

    const job = await startMediaServerExportJob("nfo");
    await waitForJobCompletion(job.id);

    const completedJob = getMediaServerExportJobById(job.id);
    expect(completedJob).toMatchObject({
      id: expect.any(String),
      status: "completed",
      mode: "nfo",
      action: "rebuild",
      total: expect.any(Number),
      processed: expect.any(Number),
      succeeded: expect.any(Number),
      skipped: expect.any(Number),
      failed: expect.any(Number),
      sweptFiles: expect.any(Number),
      cancelRequested: false,
    });
    expect(Array.isArray(completedJob?.items)).toBe(true);
    expect(Array.isArray(completedJob?.sweptList)).toBe(true);
    expect(completedJob?.items[0]).toMatchObject({
      videoId: "video-1",
      title: "Video video-1",
      status: "success",
    });
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

  // Issue #411: the layout selects a completely different pipeline, and cleanup
  // in the wrong layout would delete the wrong set of files.
  describe("playlist_tv layout", () => {
    beforeEach(() => {
      getMediaServerExportLayoutMock.mockReturnValue("playlist_tv");
      syncPlaylistTvLibraryMock.mockReturnValue({
        counts: {
          shows: 2,
          seasons: 3,
          episodes: 10,
          linkedMedia: 8,
          copiedMedia: 2,
          unchangedArtifacts: 4,
          removedArtifacts: 1,
        },
        failures: [],
        affectedShowIds: new Set(["show-1", "show-2"]),
        plannerSkips: [],
        reconcileIssues: [],
      });
      cleanupMediaServerMirrorAsyncMock.mockResolvedValue({
        counts: {
          shows: 0,
          seasons: 0,
          episodes: 0,
          linkedMedia: 0,
          copiedMedia: 0,
          unchangedArtifacts: 0,
          removedArtifacts: 6,
        },
        failures: [],
      });
    });

    it("rebuilds through the mirror pipeline and reports counts", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);

      const job = await startMediaServerExportJob("nfo");
      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(completed?.layout).toBe("playlist_tv");
      expect(completed?.phase).toBe("completed");
      expect(completed?.counts).toMatchObject({
        shows: 2,
        seasons: 3,
        episodes: 10,
        linkedMedia: 8,
        copiedMedia: 2,
      });
      expect(completed?.succeeded).toBe(10);

      // The adjacent pipeline must not run at all.
      expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
      expect(sweepOrphanMediaServerArtifactsMock).not.toHaveBeenCalled();
    });

    it("reports reconcile issues as skips and materialization errors as failures", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      syncPlaylistTvLibraryMock.mockReturnValue({
        counts: {
          shows: 1,
          seasons: 1,
          episodes: 1,
          linkedMedia: 1,
          copiedMedia: 0,
          unchangedArtifacts: 0,
          removedArtifacts: 0,
        },
        failures: [
          {
            reason: "hard_link_failed_copy_disabled",
            detail: "no link",
            videoId: "video-2",
            title: "Second",
          },
        ],
        affectedShowIds: new Set(["show-1"]),
        plannerSkips: [],
        reconcileIssues: [
          {
            reason: "ambiguous_collection_show",
            detail: "two identities",
            collectionId: "c1",
          },
        ],
      });

      const job = await startMediaServerExportJob("nfo");
      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.skipped).toBe(1);
      expect(completed?.failed).toBe(1);
      expect(completed?.items).toEqual([
        expect.objectContaining({
          status: "skipped",
          skipReason: "ambiguous_collection_show",
        }),
        expect.objectContaining({
          status: "failed",
          errorCode: "hard_link_failed_copy_disabled",
        }),
      ]);
    });

    /**
     * Cleanup deliberately crosses layouts. "Off" means stop exporting, and
     * sweeping only the selected layout strands the other one's artifacts with
     * no route to remove them - after a switch away from the mirror that can be
     * a second full copy of every video that could not be hard linked.
     */
    it("sweeps the mirror and the adjacent sidecars together", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);

      const job = await startMediaServerExportJob("off");
      expect(job.action).toBe("cleanup");

      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(cleanupMediaServerMirrorAsyncMock).toHaveBeenCalledTimes(1);
      expect(completed?.counts.removedArtifacts).toBe(6);
      // Both sweeps contribute to the reported file count.
      expect(completed?.sweptFiles).toBe(6);
      expect(removeMediaServerArtifactsForVideoMock).toHaveBeenCalledTimes(1);
    });

    it("still completes when the mirror sweep throws", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      cleanupMediaServerMirrorAsyncMock.mockImplementation(async () => {
        throw new Error("mirror unreadable");
      });

      const job = await startMediaServerExportJob("off");
      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(completed?.status).toBe("completed");
      expect(
        completed?.items.some((item) => item.error?.includes("mirror unreadable"))
      ).toBe(true);
    });

    it("honors an explicitly requested layout over the saved one", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);

      const job = await startMediaServerExportJob("nfo", "adjacent");
      await waitForJobCompletion(job.id);

      expect(getMediaServerExportJobById(job.id)?.layout).toBe("adjacent");
      expect(syncPlaylistTvLibraryMock).not.toHaveBeenCalled();
      expect(syncMediaServerArtifactsForRecordMock).toHaveBeenCalledTimes(1);
    });
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

  /**
   * Cancellation and the inactive layout, PR #412 review round 4.
   */
  describe("cross-layout sweeps and cancellation", () => {
    it("does not sweep the mirror after a cancelled cleanup", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      // Cancel lands while the adjacent pass is still walking videos.
      removeMediaServerArtifactsForVideoMock.mockImplementation(() => {
        const running = getActiveMediaServerExportJob();
        if (running) cancelMediaServerExportJob(running.id);
      });

      const job = await startMediaServerExportJob("off");
      await waitForJobStatus(job.id, "cancelled");

      // The whole point: a cancelled cleanup must not delete the library.
      expect(cleanupMediaServerMirrorAsyncMock).not.toHaveBeenCalled();
    });

    it("sweeps the adjacent sidecars when rebuilding into the managed layout", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      getMediaServerExportLayoutMock.mockReturnValue("playlist_tv");
      syncPlaylistTvLibraryMock.mockReturnValue({
        counts: {
          shows: 1,
          seasons: 1,
          episodes: 1,
          linkedMedia: 1,
          copiedMedia: 0,
          unchangedArtifacts: 0,
          removedArtifacts: 0,
        },
        failures: [],
        plannerSkips: [],
        reconcileIssues: [],
        affectedShowIds: new Set<string>(),
      });

      const job = await startMediaServerExportJob("nfo");
      await waitForJobCompletion(job.id);

      expect(syncPlaylistTvLibraryMock).toHaveBeenCalled();
      // The layout the user switched away from is cleaned too.
      expect(removeMediaServerArtifactsForVideoMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "video-1" }),
        expect.objectContaining({ layoutOverride: "adjacent" })
      );
    });

    it("sweeps the mirror when rebuilding into the adjacent layout", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      getMediaServerExportLayoutMock.mockReturnValue("adjacent");

      const job = await startMediaServerExportJob("nfo");
      await waitForJobCompletion(job.id);

      expect(syncMediaServerArtifactsForRecordMock).toHaveBeenCalled();
      expect(cleanupMediaServerMirrorAsyncMock).toHaveBeenCalled();
    });
  });


  /**
   * A rebuild used to hold the event loop for its entire duration, so the
   * server answered nothing while it ran - including the cancel request, which
   * meant cancelRequested could not even become true during the run it was
   * meant to stop.
   */
  describe("rebuild yields to the event loop", () => {
    it("lets other work run while the library rebuild is in progress", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      getMediaServerExportLayoutMock.mockReturnValue("playlist_tv");

      let ranDuringRebuild = false;
      syncPlaylistTvLibraryMock.mockImplementation(async () => {
        // Stands in for the materializer's per-show yield.
        await new Promise<void>((resolve) => setImmediate(resolve));
        return {
          counts: {
            shows: 1,
            seasons: 1,
            episodes: 1,
            linkedMedia: 1,
            copiedMedia: 0,
            unchangedArtifacts: 0,
            removedArtifacts: 0,
          },
          failures: [],
          plannerSkips: [],
          reconcileIssues: [],
          affectedShowIds: new Set<string>(),
        };
      });

      const job = await startMediaServerExportJob("nfo");
      // Queued behind the rebuild: it only runs if the rebuild yields.
      setImmediate(() => {
        ranDuringRebuild = true;
      });

      await waitForJobCompletion(job.id);

      expect(ranDuringRebuild).toBe(true);
    });

    it("observes a cancel that arrives mid-rebuild", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      getMediaServerExportLayoutMock.mockReturnValue("playlist_tv");

      syncPlaylistTvLibraryMock.mockImplementation(async (options: any) => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        // The cancel below could only have landed if the rebuild yielded.
        expect(options.isCancelled?.()).toBe(true);
        return {
          counts: {
            shows: 0,
            seasons: 0,
            episodes: 0,
            linkedMedia: 0,
            copiedMedia: 0,
            unchangedArtifacts: 0,
            removedArtifacts: 0,
          },
          failures: [],
          plannerSkips: [],
          reconcileIssues: [],
          affectedShowIds: new Set<string>(),
        };
      });

      const job = await startMediaServerExportJob("nfo");
      cancelMediaServerExportJob(job.id);

      await waitForJobStatus(job.id, "cancelled");
    });
  });

});
