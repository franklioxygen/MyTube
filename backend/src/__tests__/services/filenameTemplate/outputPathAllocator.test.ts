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
