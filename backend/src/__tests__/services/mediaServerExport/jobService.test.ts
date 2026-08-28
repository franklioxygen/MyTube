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
const runPlaylistTvExportMock = vi.hoisted(() => vi.fn());
const cleanupPlaylistTvLibraryMock = vi.hoisted(() => vi.fn());

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
  getMediaServerExportLayout: getMediaServerExportLayoutMock,
  getMediaServerCopyFallback: () => true,
  syncMediaServerArtifactsForRecord: syncMediaServerArtifactsForRecordMock,
  removeMediaServerArtifactsForVideo: removeMediaServerArtifactsForVideoMock,
}));

// Stubbed so this suite stays free of the database the mirror modules open at
// import time; the mirror pipeline itself is covered end to end elsewhere.
vi.mock("../../../services/mediaServerExport/playlistTvSync", () => ({
  runPlaylistTvExport: runPlaylistTvExportMock,
  cleanupPlaylistTvLibrary: cleanupPlaylistTvLibraryMock,
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
    getMediaServerExportLayoutMock.mockReset();
    runPlaylistTvExportMock.mockReset();
    cleanupPlaylistTvLibraryMock.mockReset();

    getMediaServerExportLayoutMock.mockImplementation(
      (override?: string) => override ?? "adjacent"
    );
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

  describe("playlist_tv layout", () => {
    function mirrorResult(overrides: Record<string, unknown> = {}) {
      return {
        counts: {
          shows: 1,
          seasons: 2,
          episodes: 3,
          linkedMedia: 3,
          copiedMedia: 0,
          unchangedArtifacts: 4,
          removedArtifacts: 1,
        },
        failures: [],
        removedPaths: ["Show/Season 01/old.mp4"],
        cancelled: false,
        issues: [],
        plan: { shows: [], skips: [] },
        ...overrides,
      };
    }

    it("reports mirror phases, counts, and per-episode progress", async () => {
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      runPlaylistTvExportMock.mockImplementation((options: any) => {
        options.onPhase("catalog_reconcile");
        options.onPhase("materialize", {
          shows: [
            {
              seasons: [
                { episodes: [{}, {}] },
                { episodes: [{}] },
              ],
            },
          ],
        });
        options.onEpisodeStart("video-1", "Ants");
        options.onEpisodeFinished({ videoId: "video-1", title: "Ants" });
        return mirrorResult();
      });

      const job = await startMediaServerExportJob("nfo", "playlist_tv");
      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(completed?.layout).toBe("playlist_tv");
      expect(completed?.phase).toBe("completed");
      // Episode occurrences, not library videos.
      expect(completed?.total).toBe(3);
      expect(completed?.processed).toBe(1);
      expect(completed?.succeeded).toBe(1);
      expect(completed?.counts.linkedMedia).toBe(3);
      expect(completed?.sweptFiles).toBe(1);
      expect(sweepOrphanMediaServerArtifactsMock).not.toHaveBeenCalled();
      expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
    });

    it("separates catalog issues and plan skips from materialization failures", async () => {
      getVideosMock.mockReturnValue([]);
      runPlaylistTvExportMock.mockImplementation((options: any) => {
        const episodeFailure = {
          videoId: "video-2",
          title: "Broken",
          reason: "hard_link_failed_copy_disabled",
        };
        options.onPhase("materialize", { shows: [] });
        options.onEpisodeFinished({
          videoId: "video-2",
          title: "Broken",
          failure: episodeFailure,
        });
        return mirrorResult({
          failures: [
            episodeFailure,
            {
              title: "Show/Season 01/season.nfo",
              reason: "artifact_ownership_mismatch",
              detail: "Refusing to delete a replaced symlink.",
            },
          ],
          issues: [
            { collectionId: "col-1", title: "Mixed", reason: "ambiguous_collection_show" },
          ],
          plan: {
            shows: [],
            skips: [
              { videoId: "video-3", title: "Cloud", reason: "cloud_path" },
            ],
          },
        });
      });

      const job = await startMediaServerExportJob("nfo", "playlist_tv");
      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(completed?.failed).toBe(2);
      expect(completed?.skipped).toBe(2);
      expect(completed?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "failed",
            errorCode: "hard_link_failed_copy_disabled",
          }),
          expect.objectContaining({
            status: "failed",
            errorCode: "artifact_ownership_mismatch",
          }),
          expect.objectContaining({
            status: "skipped",
            skipReason: "ambiguous_collection_show",
          }),
          expect.objectContaining({ status: "skipped", skipReason: "cloud_path" }),
        ])
      );
    });

    it("cleans the mirror without touching the adjacent sweep", async () => {
      getSettingsMock.mockReturnValue({ mediaServerExportMode: "off" });
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      cleanupPlaylistTvLibraryMock.mockReturnValue({
        removedPaths: ["Show/tvshow.nfo", "Show/poster.jpg"],
        failures: [],
      });

      const job = await startMediaServerExportJob("off", "playlist_tv");
      await waitForJobCompletion(job.id);

      const completed = getMediaServerExportJobById(job.id);
      expect(completed?.action).toBe("cleanup");
      expect(completed?.sweptFiles).toBe(2);
      expect(completed?.counts.removedArtifacts).toBe(2);
      expect(completed?.total).toBe(2);
      expect(completed?.processed).toBe(2);
      expect(completed?.succeeded).toBe(2);
      expect(removeMediaServerArtifactsForVideoMock).not.toHaveBeenCalled();
      expect(sweepOrphanMediaServerArtifactsMock).not.toHaveBeenCalled();
    });

    it("uses the saved layout when the request does not name one", async () => {
      getMediaServerExportLayoutMock.mockReturnValue("playlist_tv");
      getVideosMock.mockReturnValue([createVideo("video-1")]);
      runPlaylistTvExportMock.mockReturnValue(mirrorResult());

      const job = await startMediaServerExportJob("nfo");
      await waitForJobCompletion(job.id);

      expect(runPlaylistTvExportMock).toHaveBeenCalled();
    });
  });
});
