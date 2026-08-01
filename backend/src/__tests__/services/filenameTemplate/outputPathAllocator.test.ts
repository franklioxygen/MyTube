import crypto from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

type AllocatorModule = typeof import("../../../services/filenameTemplate/outputPathAllocator");

const tempRoots: string[] = [];

type PathConfig = {
  DATA_DIR: string;
  VIDEOS_DIR: string;
  IMAGES_DIR: string;
  SUBTITLES_DIR: string;
};

function buildPathConfig(root: string): PathConfig {
  return {
    DATA_DIR: path.join(root, "data"),
    VIDEOS_DIR: path.join(root, "videos"),
    IMAGES_DIR: path.join(root, "images"),
    SUBTITLES_DIR: path.join(root, "subtitles"),
  };
}

async function loadAllocatorWithPaths(
  paths: PathConfig,
  videos: any[] = []
): Promise<AllocatorModule> {
  vi.resetModules();
  vi.doMock("../../../config/paths", () => paths);
  vi.doMock("../../../services/storageService/videoQueries", () => ({
    getVideos: vi.fn(() => videos),
  }));
  vi.doMock("../../../services/storageService/videos", () => ({
    getVideos: vi.fn(() => videos),
  }));
  const allocator = await import("../../../services/filenameTemplate/outputPathAllocator");
  allocator.setOutputPathAllocatorVideoProviderForTests(() => videos);
  return allocator;
}

async function loadAllocator(
  root: string,
  videos: any[] = []
): Promise<AllocatorModule> {
  return loadAllocatorWithPaths(buildPathConfig(root), videos);
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-allocator-"));
  tempRoots.push(root);
  fs.ensureDirSync(path.join(root, "videos"));
  fs.ensureDirSync(path.join(root, "images"));
  fs.ensureDirSync(path.join(root, "subtitles"));
  fs.ensureDirSync(path.join(root, "data"));
  return root;
}

describe("outputPathAllocator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    for (const root of tempRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("uses an identity suffix for concurrent same-stem reservations", async () => {
    const root = makeTempRoot();
    const allocator = await loadAllocator(root);

    const first = allocator.allocateOutputFamilySync({
      videoRelativePath: "Author/Episode.mp4",
      thumbnailRelativePath: "Author/Episode.jpg",
      subtitleBaseRelativePath: "Author/Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "bilibili",
        sourceVideoId: "BV111",
        mediaType: "video",
      },
    });
    const second = allocator.allocateOutputFamilySync({
      videoRelativePath: "Author/Episode.mp4",
      thumbnailRelativePath: "Author/Episode.jpg",
      subtitleBaseRelativePath: "Author/Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "bilibili",
        sourceVideoId: "BV222",
        mediaType: "video",
      },
    });

    expect(first.videoRelativePath).toBe("Author/Episode.mp4");
    expect(second.videoRelativePath).toBe("Author/Episode [BV222].mp4");
    expect(second.thumbnailRelativePath).toBe("Author/Episode [BV222].jpg");
    expect(second.subtitleBaseRelativePath).toBe("Author/Episode [BV222]");

    first.release();
    second.release();
    expect(
      fs.readdirSync(path.join(root, "data", "output-path-reservations"))
    ).toEqual([]);
  });

  it("honors app-data lock files across isolated module instances", async () => {
    const root = makeTempRoot();
    const firstAllocator = await loadAllocator(root);
    const first = firstAllocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "abc",
        mediaType: "video",
      },
    });

    const secondAllocator = await loadAllocator(root);
    const second = secondAllocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "def",
        mediaType: "video",
      },
    });

    expect(first.videoRelativePath).toBe("Episode.mp4");
    expect(second.videoRelativePath).toBe("Episode [def].mp4");

    first.release();
    second.release();
  });

  it("reclaims same-host reservation locks left by dead processes", async () => {
    const root = makeTempRoot();
    const reservationDir = path.join(root, "data", "output-path-reservations");
    fs.ensureDirSync(reservationDir);
    const digest = crypto.createHash("sha256").update("episode").digest("hex");
    const staleLockPath = path.join(reservationDir, `${digest}.lock`);
    fs.writeJsonSync(staleLockPath, {
      version: 1,
      allocationId: "stale",
      canonicalFamilyStem: "episode",
      identityKey: "youtube:old:video:0",
      hostname: os.hostname(),
      processId: 123456789,
      createdAtMs: Date.now() - 60_000,
      heartbeatAtMs: Date.now() - 60_000,
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((
      processId: number,
      signal?: NodeJS.Signals | 0
    ) => {
      if (processId === 123456789 && signal === 0) {
        throw Object.assign(new Error("dead process"), { code: "ESRCH" });
      }
      return true;
    }) as typeof process.kill);
    const allocator = await loadAllocator(root);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "new",
        mediaType: "video",
      },
    });

    expect(reservation.videoRelativePath).toBe("Episode.mp4");
    const lockPayload = fs.readJsonSync(staleLockPath);
    expect(lockPayload.identityKey).toBe("youtube:new:video:0");

    reservation.release();
    killSpy.mockRestore();
  });

  it("reclaims an expired reservation left by a previous container", async () => {
    const root = makeTempRoot();
    const reservationDir = path.join(root, "data", "output-path-reservations");
    fs.ensureDirSync(reservationDir);
    const digest = crypto.createHash("sha256").update("episode").digest("hex");
    const staleLockPath = path.join(reservationDir, `${digest}.lock`);
    fs.writeJsonSync(staleLockPath, {
      version: 1,
      allocationId: "previous-container",
      canonicalFamilyStem: "episode",
      identityKey: "youtube:old:video:0",
      hostname: "retired-container-hostname",
      processId: 99,
      createdAtMs: Date.now() - 10 * 60_000,
      heartbeatAtMs: Date.now() - 10 * 60_000,
    });
    const allocator = await loadAllocator(root);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "new",
        mediaType: "video",
      },
    });

    expect(reservation.videoRelativePath).toBe("Episode.mp4");
    expect(fs.readJsonSync(staleLockPath).hostname).toBe(os.hostname());
    reservation.release();
  });

  it("reserves central subtitle stems owned by another row", async () => {
    const root = makeTempRoot();
    // The other row owns only a central subtitle. Its video uses a different
    // container and it has no thumbnail, so the preferred video and thumbnail
    // paths stay free and the subtitle stem is the only thing in the way.
    const allocator = await loadAllocator(root, [
      {
        id: "other",
        videoPath: "/videos/Episode.mp4",
        subtitles: [
          { language: "en", filename: "Episode.en.vtt", path: "/subtitles/Episode.en.vtt" },
        ],
      },
    ]);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mkv",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      subtitleBaseDir: path.join(root, "subtitles"),
      identity: {
        platform: "youtube",
        sourceVideoId: "new",
        mediaType: "video",
      },
      thumbnailRequired: true,
      subtitleRequired: true,
    });

    expect(reservation.videoRelativePath).toBe("Episode [new].mkv");
    expect(reservation.subtitleBaseRelativePath).toBe("Episode [new]");
    reservation.release();
  });

  it("keeps the preferred stem when the owning row is the redownload target", async () => {
    const root = makeTempRoot();
    const allocator = await loadAllocator(root, [
      {
        id: "self",
        videoPath: "/videos/Episode.mp4",
        subtitles: [
          { language: "en", filename: "Episode.en.vtt", path: "/subtitles/Episode.en.vtt" },
        ],
      },
    ]);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mkv",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      subtitleBaseDir: path.join(root, "subtitles"),
      identity: {
        platform: "youtube",
        sourceVideoId: "self",
        mediaType: "video",
        localVideoId: "self",
      },
      existingLocalVideoId: "self",
      thumbnailRequired: true,
      subtitleRequired: true,
    });

    expect(reservation.videoRelativePath).toBe("Episode.mkv");
    expect(reservation.subtitleBaseRelativePath).toBe("Episode");
    reservation.release();
  });

  it("reclaims an expired lock left by a restart onto the same pid", async () => {
    const root = makeTempRoot();
    const reservationDir = path.join(root, "data", "output-path-reservations");
    fs.ensureDirSync(reservationDir);
    const digest = crypto.createHash("sha256").update("episode").digest("hex");
    const staleLockPath = path.join(reservationDir, `${digest}.lock`);
    // A stable-hostname container that crashed and restarted onto the same pid:
    // the owner is gone, but a naive `processId === process.pid` guard would
    // read it as a live owner and reserve the family forever.
    fs.writeJsonSync(staleLockPath, {
      version: 2,
      allocationId: "previous-instance-same-pid",
      canonicalFamilyStem: "episode",
      identityKey: "youtube:old:video:0",
      hostname: os.hostname(),
      processId: process.pid,
      createdAtMs: Date.now() - 10 * 60_000,
      heartbeatAtMs: Date.now() - 10 * 60_000,
    });
    const allocator = await loadAllocator(root);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "new",
        mediaType: "video",
      },
    });

    expect(reservation.videoRelativePath).toBe("Episode.mp4");
    expect(fs.readJsonSync(staleLockPath).allocationId).not.toBe(
      "previous-instance-same-pid"
    );
    reservation.release();
  });

  it("keeps a fresh same-host lock held by this pid", async () => {
    const root = makeTempRoot();
    const reservationDir = path.join(root, "data", "output-path-reservations");
    fs.ensureDirSync(reservationDir);
    const digest = crypto.createHash("sha256").update("episode").digest("hex");
    const liveLockPath = path.join(reservationDir, `${digest}.lock`);
    // Same pid, but the lease is being renewed, so it must not be stolen.
    fs.writeJsonSync(liveLockPath, {
      version: 2,
      allocationId: "self-owned-live",
      canonicalFamilyStem: "episode",
      identityKey: "youtube:old:video:0",
      hostname: os.hostname(),
      processId: process.pid,
      createdAtMs: Date.now() - 60_000,
      heartbeatAtMs: Date.now() - 5_000,
    });
    const allocator = await loadAllocator(root);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "new",
        mediaType: "video",
      },
    });

    expect(reservation.videoRelativePath).toBe("Episode [new].mp4");
    expect(fs.readJsonSync(liveLockPath).allocationId).toBe("self-owned-live");
    reservation.release();
  });

  it("keeps an old same-host lock while its owner process is live", async () => {
    const root = makeTempRoot();
    const reservationDir = path.join(root, "data", "output-path-reservations");
    fs.ensureDirSync(reservationDir);
    const digest = crypto.createHash("sha256").update("episode").digest("hex");
    const liveLockPath = path.join(reservationDir, `${digest}.lock`);
    fs.writeJsonSync(liveLockPath, {
      version: 1,
      allocationId: "live-owner",
      canonicalFamilyStem: "episode",
      identityKey: "youtube:old:video:0",
      hostname: os.hostname(),
      processId: 987654321,
      createdAtMs: Date.now() - 24 * 60 * 60_000,
      heartbeatAtMs: Date.now() - 24 * 60 * 60_000,
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((
      processId: number,
      signal?: NodeJS.Signals | 0
    ) => {
      if (processId === 987654321 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);
    const allocator = await loadAllocator(root);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "new",
        mediaType: "video",
      },
    });

    expect(reservation.videoRelativePath).toBe("Episode [new].mp4");
    expect(fs.readJsonSync(liveLockPath).allocationId).toBe("live-owner");
    expect(killSpy).toHaveBeenCalledWith(987654321, 0);
    reservation.release();
  });

  it("renews a cross-host lease throughout a long reservation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    const root = makeTempRoot();
    const firstAllocator = await loadAllocator(root);
    const first = firstAllocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "first",
        mediaType: "video",
      },
    });
    const reservationDir = path.join(root, "data", "output-path-reservations");
    const lockName = fs
      .readdirSync(reservationDir)
      .find((entry) => entry.endsWith(".lock"));
    expect(lockName).toBeDefined();
    const lockPath = path.join(reservationDir, lockName!);
    const lockPayload = fs.readJsonSync(lockPath);
    lockPayload.hostname = "active-other-container";
    fs.writeJsonSync(lockPath, lockPayload);

    vi.advanceTimersByTime(10 * 60_000);

    const heartbeatName = fs
      .readdirSync(reservationDir)
      .find((entry) => entry.endsWith(".heartbeat"));
    expect(heartbeatName).toBeDefined();
    const heartbeat = fs.readJsonSync(
      path.join(reservationDir, heartbeatName!)
    );
    expect(heartbeat.allocationId).toBe(lockPayload.allocationId);
    expect(heartbeat.heartbeatAtMs).toBe(Date.now());

    const secondAllocator = await loadAllocator(root);
    const second = secondAllocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "second",
        mediaType: "video",
      },
    });

    expect(second.videoRelativePath).toBe("Episode [second].mp4");
    first.release();
    second.release();
  });

  it("skips an existing preferred file before reserving", async () => {
    const root = makeTempRoot();
    fs.outputFileSync(path.join(root, "videos", "Episode.mp4"), "existing");
    const allocator = await loadAllocator(root);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "abc",
        mediaType: "video",
      },
    });

    expect(reservation.videoRelativePath).toBe("Episode [abc].mp4");
    expect(reservation.collisionStrategy).toBe("source_id");
    reservation.release();
  });

  it("keeps the existing owned path for a same-row redownload", async () => {
    const root = makeTempRoot();
    fs.outputFileSync(path.join(root, "videos", "Episode.mp4"), "old-video");
    fs.outputFileSync(path.join(root, "images", "Episode.jpg"), "old-thumb");
    const allocator = await loadAllocator(root, [
      {
        id: "local-1",
        videoPath: "/videos/Episode.mp4",
        thumbnailPath: "/images/Episode.jpg",
        subtitles: [],
      },
    ]);

    const reservation = allocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: path.join(root, "images"),
      identity: {
        platform: "youtube",
        sourceVideoId: "abc",
        mediaType: "video",
        localVideoId: "local-1",
      },
      existingLocalVideoId: "local-1",
      thumbnailRequired: true,
    });

    expect(reservation.videoRelativePath).toBe("Episode.mp4");
    expect(reservation.thumbnailRelativePath).toBe("Episode.jpg");
    expect(reservation.collisionStrategy).toBe("none");
    reservation.release();
  });

  it("replaces an owned file with rollback if the replacement cannot be promoted", async () => {
    const root = makeTempRoot();
    const destPath = path.join(root, "videos", "Episode.mp4");
    const sourcePath = path.join(root, "videos", "new-download.mp4");
    fs.outputFileSync(destPath, "old-video");
    fs.outputFileSync(sourcePath, "new-video");
    const allocator = await loadAllocator(root, [
      {
        id: "local-1",
        videoPath: "/videos/Episode.mp4",
        thumbnailPath: null,
        subtitles: [],
      },
    ]);

    allocator.replaceOwnedFileWithBackupSync(
      sourcePath,
      path.join(root, "videos"),
      destPath,
      path.join(root, "videos"),
      "local-1"
    );
    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(fs.existsSync(sourcePath)).toBe(false);

    const failingSource = path.join(root, "videos", "missing-download.mp4");
    expect(() =>
      allocator.replaceOwnedFileWithBackupSync(
        failingSource,
        path.join(root, "videos"),
        destPath,
        path.join(root, "videos"),
        "local-1"
      )
    ).toThrow();
    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(
      fs.existsSync(path.join(root, "data", "output-family-journals"))
        ? fs.readdirSync(path.join(root, "data", "output-family-journals"))
        : []
    ).toEqual([]);
  });

  it("plans owned replacement staging beside nested managed destinations", async () => {
    const root = makeTempRoot();
    const destPath = path.join(root, "videos", "Series", "Episode.mp4");
    fs.outputFileSync(destPath, "old-video");
    const allocator = await loadAllocator(root, [
      {
        id: "local-1",
        videoPath: "/videos/Series/Episode.mp4",
        thumbnailPath: null,
        subtitles: [],
      },
    ]);

    const staging = allocator.planOwnedReplacementStagingPathSync(
      destPath,
      path.join(root, "videos"),
      "local-1"
    );

    expect(staging).not.toBeNull();
    expect(staging?.finalPath).toBe(destPath);
    expect(path.dirname(staging?.stagingPath || "")).toBe(
      path.join(root, "videos", "Series")
    );
    expect(path.basename(staging?.stagingPath || "")).toMatch(
      /^\.mytube-redownload-[\w-]+\.mp4$/
    );
  });

  it("does not treat a same-named file under another root as owned", async () => {
    const root = makeTempRoot();
    // The row's thumbnail still lives under /videos after a storage-settings
    // change. A redownload now targets /images/Show/poster.jpg, a distinct file
    // owned by nobody here — planning an owned replacement for it would let
    // replaceOwnedFileWithBackupSync overwrite it.
    const otherRootPath = path.join(root, "images", "Show", "poster.jpg");
    fs.outputFileSync(otherRootPath, "someone-elses-thumbnail");
    const allocator = await loadAllocator(root, [
      {
        id: "local-1",
        videoPath: "/videos/Show/Episode.mp4",
        thumbnailPath: "/videos/Show/poster.jpg",
        subtitles: [],
      },
    ]);

    expect(
      allocator.planOwnedReplacementStagingPathSync(
        otherRootPath,
        path.join(root, "images"),
        "local-1"
      )
    ).toBeNull();
    expect(fs.readFileSync(otherRootPath, "utf8")).toBe("someone-elses-thumbnail");
  });

  it("still treats the same-root thumbnail as owned by the selected row", async () => {
    const root = makeTempRoot();
    const ownedPath = path.join(root, "images", "Show", "poster.jpg");
    fs.outputFileSync(ownedPath, "own-thumbnail");
    const allocator = await loadAllocator(root, [
      {
        id: "local-1",
        videoPath: "/videos/Show/Episode.mp4",
        thumbnailPath: "/images/Show/poster.jpg",
        subtitles: [],
      },
    ]);

    const staging = allocator.planOwnedReplacementStagingPathSync(
      ownedPath,
      path.join(root, "images"),
      "local-1"
    );

    expect(staging).not.toBeNull();
    expect(staging?.finalPath).toBe(ownedPath);
  });

  it("rejects traversal while planning owned replacement staging", async () => {
    const root = makeTempRoot();
    const allocator = await loadAllocator(root);
    const escapedDestination = `${path.join(root, "videos")}${path.sep}..${
      path.sep
    }escape.mp4`;

    expect(() =>
      allocator.planOwnedReplacementStagingPathSync(
        escapedDestination,
        path.join(root, "videos"),
        "local-1"
      )
    ).toThrow("outside");
  });

  it("publishes new files through destination-local staging, claimed placeholder, and journal cleanup", async () => {
    const root = makeTempRoot();
    const scratchRoot = path.join(root, "scratch");
    fs.ensureDirSync(scratchRoot);
    const sourcePath = path.join(scratchRoot, "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    const allocator = await loadAllocator(root);

    allocator.promoteFileNoOverwriteSync(
      sourcePath,
      scratchRoot,
      destPath,
      path.join(root, "videos")
    );

    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(
      fs.existsSync(path.join(root, "data", "output-family-journals"))
        ? fs.readdirSync(path.join(root, "data", "output-family-journals"))
        : []
    ).toEqual([]);
    expect(
      fs.existsSync(path.join(root, "videos", ".mytube-staging", ".ignore"))
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(root, "videos", ".mytube-staging", ".embyignore"),
        "utf8"
      )
    ).toBe("*\n");
  });

  it("falls back to claimed rename publication when the hard-link probe reports EXDEV", async () => {
    const root = makeTempRoot();
    const scratchRoot = path.join(root, "scratch");
    fs.ensureDirSync(scratchRoot);
    const sourcePath = path.join(scratchRoot, "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    const allocator = await loadAllocator(root);
    const linkSpy = vi
      .spyOn(fs, "linkSync")
      .mockImplementation(() => {
        throw Object.assign(new Error("cross-device hard link"), {
          code: "EXDEV",
        });
      });
    const renameSpy = vi.spyOn(fs, "renameSync");

    allocator.promoteFileNoOverwriteSync(
      sourcePath,
      scratchRoot,
      destPath,
      path.join(root, "videos")
    );

    expect(linkSpy).toHaveBeenCalled();
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringContaining(".mytube-staging"),
      destPath
    );
    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(
      fs.existsSync(path.join(root, "data", "output-family-journals"))
        ? fs.readdirSync(path.join(root, "data", "output-family-journals"))
        : []
    ).toEqual([]);
  });

  it("falls back to claimed rename publication when hard-link publish reports EXDEV after a successful probe", async () => {
    const root = makeTempRoot();
    const scratchRoot = path.join(root, "scratch");
    fs.ensureDirSync(scratchRoot);
    const sourcePath = path.join(scratchRoot, "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    const allocator = await loadAllocator(root);
    const actualLinkSync = fs.linkSync.bind(fs);
    const linkSpy = vi
      .spyOn(fs, "linkSync")
      .mockImplementation((source, target) => {
        if (String(source).includes(".hardlink-probe")) {
          actualLinkSync(source, target);
          return;
        }
        throw Object.assign(new Error("cross-device publish"), {
          code: "EXDEV",
        });
      });
    const renameSpy = vi.spyOn(fs, "renameSync");

    allocator.promoteFileNoOverwriteSync(
      sourcePath,
      scratchRoot,
      destPath,
      path.join(root, "videos")
    );

    expect(linkSpy).toHaveBeenCalledWith(
      expect.stringContaining(".mytube-staging"),
      destPath
    );
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringContaining(".mytube-staging"),
      destPath
    );
    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(
      fs.existsSync(path.join(root, "data", "output-family-journals"))
        ? fs.readdirSync(path.join(root, "data", "output-family-journals"))
        : []
    ).toEqual([]);
  });

  it("preserves existing final files when the exclusive claim loses", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    fs.writeFileSync(destPath, "foreign-video");
    const allocator = await loadAllocator(root);

    expect(() =>
      allocator.promoteFileNoOverwriteSync(
        sourcePath,
        path.join(root, "videos"),
        destPath,
        path.join(root, "videos")
      )
    ).toThrow();

    expect(fs.readFileSync(destPath, "utf8")).toBe("foreign-video");
    expect(fs.readFileSync(sourcePath, "utf8")).toBe("new-video");
    expect(
      fs.readdirSync(path.join(root, "videos", ".mytube-staging")).filter(
        (entry) => !entry.startsWith(".")
      )
    ).toEqual([]);
    expect(
      fs.existsSync(path.join(root, "data", "output-family-journals"))
        ? fs.readdirSync(path.join(root, "data", "output-family-journals"))
        : []
    ).toEqual([]);
  });

  it("rolls back journaled family moves when a later move fails", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "Episode.mp4");
    const movedPath = path.join(root, "videos", "Series", "Episode.mp4");
    const missingPath = path.join(root, "images", "missing.jpg");
    const imageTarget = path.join(root, "images", "Series", "Episode.jpg");
    fs.outputFileSync(sourcePath, "video");
    const allocator = await loadAllocator(root);

    expect(() =>
      allocator.moveOutputFamilyWithJournalSync([
        {
          from: sourcePath,
          fromBase: path.join(root, "videos"),
          to: movedPath,
          toBase: path.join(root, "videos"),
          kind: "video",
        },
        {
          from: missingPath,
          fromBase: path.join(root, "images"),
          to: imageTarget,
          toBase: path.join(root, "images"),
          kind: "thumbnail",
        },
      ])
    ).toThrow();

    expect(fs.readFileSync(sourcePath, "utf8")).toBe("video");
    expect(fs.existsSync(movedPath)).toBe(false);
    expect(
      fs.existsSync(path.join(root, "data", "output-family-journals"))
        ? fs.readdirSync(path.join(root, "data", "output-family-journals"))
        : []
    ).toEqual([]);
  });

  it("reports success when hard-link publication journaling fails afterwards", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    const allocator = await loadAllocator(root);

    // By this journal step the destination is published and verified and the
    // source has been unlinked. Throwing here would make callers skip
    // persistence and orphan a complete file that cannot be rebuilt.
    const realWriteFileSync = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: any,
      data: any,
      options: any
    ) => {
      if (
        typeof data === "string" &&
        data.includes('"step": "committed"') &&
        data.includes('"purpose": "publication"')
      ) {
        throw new Error("journal disk full");
      }
      return (realWriteFileSync as any)(file, data, options);
    }) as typeof fs.writeFileSync);

    expect(() =>
      allocator.promoteFileNoOverwriteSync(
        sourcePath,
        path.join(root, "videos"),
        destPath,
        path.join(root, "videos")
      )
    ).not.toThrow();

    vi.restoreAllMocks();
    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(fs.existsSync(sourcePath)).toBe(false);
  });

  it("reports success when rename-fallback publication journaling fails afterwards", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    const allocator = await loadAllocator(root);

    // Failing linkSync makes the hard-link probe report no support, so the
    // claim-marker + rename fallback runs instead.
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw Object.assign(new Error("EXDEV: cross-device link"), {
        code: "EXDEV",
      });
    });
    const renameSpy = vi.spyOn(fs, "renameSync");
    const realWriteFileSync = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: any,
      data: any,
      options: any
    ) => {
      if (
        typeof data === "string" &&
        data.includes('"step": "committed"') &&
        data.includes('"purpose": "publication"')
      ) {
        throw new Error("journal disk full");
      }
      return (realWriteFileSync as any)(file, data, options);
    }) as typeof fs.writeFileSync);

    expect(() =>
      allocator.promoteFileNoOverwriteSync(
        sourcePath,
        path.join(root, "videos"),
        destPath,
        path.join(root, "videos")
      )
    ).not.toThrow();

    // Proves the fallback ran: the hard-link branch publishes via linkSync, so
    // only the rename branch renames the staging file onto the destination.
    expect(renameSpy).toHaveBeenCalledWith(
      expect.stringContaining(".mytube-staging"),
      destPath
    );
    vi.restoreAllMocks();
    expect(fs.readFileSync(destPath, "utf8")).toBe("new-video");
    expect(fs.existsSync(sourcePath)).toBe(false);
  });

  it("restores the destination when backup journaling fails", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "incoming.mp4");
    const destPath = path.join(root, "videos", "Episode.mp4");
    fs.writeFileSync(sourcePath, "new-video");
    fs.writeFileSync(destPath, "owned-original");
    const allocator = await loadAllocator(root, [
      {
        id: "local-1",
        videoPath: "/videos/Episode.mp4",
        thumbnailPath: null,
        subtitles: [],
      },
    ]);

    // Fail the journal write that immediately follows the backup rename. The
    // destination has been moved aside at that point, so without a rollback the
    // row would reference a path with no file.
    const realWriteFileSync = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: any,
      data: any,
      options: any
    ) => {
      if (typeof data === "string" && data.includes('"step": "backed_up"')) {
        throw new Error("journal disk full");
      }
      return (realWriteFileSync as any)(file, data, options);
    }) as typeof fs.writeFileSync);

    expect(() =>
      allocator.replaceOwnedFileWithBackupSync(
        sourcePath,
        path.join(root, "videos"),
        destPath,
        path.join(root, "videos"),
        "local-1"
      )
    ).toThrow();

    vi.restoreAllMocks();
    expect(fs.readFileSync(destPath, "utf8")).toBe("owned-original");
    expect(
      fs
        .readdirSync(path.join(root, "videos"))
        .filter((entry) => entry.includes("mytube-replace-backup"))
    ).toEqual([]);
    expect(
      fs.readdirSync(path.join(root, "videos", ".mytube-staging")).filter(
        (entry) => !entry.startsWith(".")
      )
    ).toEqual([]);
  });

  it("keeps moved files when only the post-commit journal write fails", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "Episode.mp4");
    const movedPath = path.join(root, "videos", "Series", "Episode.mp4");
    fs.outputFileSync(sourcePath, "video");
    const allocator = await loadAllocator(root);

    // The callback stands in for the batch-rename SQLite commit. Once it has
    // returned, the database references the new path, so a journal I/O failure
    // must not move the file back out from under it.
    let committed = false;
    const realWriteFileSync = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: any,
      data: any,
      options: any
    ) => {
      if (typeof data === "string" && data.includes('"step": "committed"')) {
        throw new Error("journal disk full");
      }
      return (realWriteFileSync as any)(file, data, options);
    }) as typeof fs.writeFileSync);

    expect(() =>
      allocator.moveOutputFamilyWithJournalSync(
        [
          {
            from: sourcePath,
            fromBase: path.join(root, "videos"),
            to: movedPath,
            toBase: path.join(root, "videos"),
            kind: "video",
          },
        ],
        () => {
          committed = true;
        }
      )
    ).not.toThrow();

    expect(committed).toBe(true);
    expect(fs.readFileSync(movedPath, "utf8")).toBe("video");
    expect(fs.existsSync(sourcePath)).toBe(false);
  });

  it("still rolls back when the commit callback itself throws", async () => {
    const root = makeTempRoot();
    const sourcePath = path.join(root, "videos", "Episode.mp4");
    const movedPath = path.join(root, "videos", "Series", "Episode.mp4");
    fs.outputFileSync(sourcePath, "video");
    const allocator = await loadAllocator(root);

    expect(() =>
      allocator.moveOutputFamilyWithJournalSync(
        [
          {
            from: sourcePath,
            fromBase: path.join(root, "videos"),
            to: movedPath,
            toBase: path.join(root, "videos"),
            kind: "video",
          },
        ],
        () => {
          throw new Error("sqlite commit failed");
        }
      )
    ).toThrow("sqlite commit failed");

    expect(fs.readFileSync(sourcePath, "utf8")).toBe("video");
    expect(fs.existsSync(movedPath)).toBe(false);
  });

  it("uses media existence when isolated lease directories cannot coordinate", async () => {
    const mediaRoot = makeTempRoot();
    const dataOne = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-allocator-data-"));
    const dataTwo = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-allocator-data-"));
    tempRoots.push(dataOne, dataTwo);
    const mediaPaths = buildPathConfig(mediaRoot);

    const firstAllocator = await loadAllocatorWithPaths({
      ...mediaPaths,
      DATA_DIR: dataOne,
    });
    const first = firstAllocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: mediaPaths.IMAGES_DIR,
      identity: {
        platform: "youtube",
        sourceVideoId: "abc",
        mediaType: "video",
      },
    });
    fs.outputFileSync(
      path.join(mediaPaths.VIDEOS_DIR, first.videoRelativePath),
      "first"
    );

    const secondAllocator = await loadAllocatorWithPaths({
      ...mediaPaths,
      DATA_DIR: dataTwo,
    });
    const second = secondAllocator.allocateOutputFamilySync({
      videoRelativePath: "Episode.mp4",
      thumbnailRelativePath: "Episode.jpg",
      subtitleBaseRelativePath: "Episode",
      thumbnailBaseDir: mediaPaths.IMAGES_DIR,
      identity: {
        platform: "youtube",
        sourceVideoId: "def",
        mediaType: "video",
      },
    });

    expect(first.videoRelativePath).toBe("Episode.mp4");
    expect(second.videoRelativePath).toBe("Episode [def].mp4");

    first.release();
    second.release();
  });
});
