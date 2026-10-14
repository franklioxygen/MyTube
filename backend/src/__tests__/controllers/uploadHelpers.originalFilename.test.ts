import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONTENT_HASH = `3f9a2c1b${"0".repeat(56)}`;
const VIDEO_ID = `upload-${CONTENT_HASH}`;
const STORED_FILENAME = "1760000000000-0123456789abcdef.mp4";
const tempRoots: string[] = [];

type Harness = {
  root: string;
  videosDir: string;
  imagesDir: string;
  imagesSmallDir: string;
  getUploadVideoPayload: typeof import("../../controllers/video/uploadHelpers").getUploadVideoPayload;
  storage: {
    getSettings: ReturnType<typeof vi.fn>;
    getVideoById: ReturnType<typeof vi.fn>;
    saveVideoIfAbsent: ReturnType<typeof vi.fn>;
  };
  execFileSafe: ReturnType<typeof vi.fn>;
  uploadedFileHasVideoStream: ReturnType<typeof vi.fn>;
  getVideoDuration: ReturnType<typeof vi.fn>;
  getVideoDimensions: ReturnType<typeof vi.fn>;
  regenerateSmallThumbnailForThumbnailPath: ReturnType<typeof vi.fn>;
};

const loadHarness = async (settings: Record<string, unknown>): Promise<Harness> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-upload-flow-"));
  tempRoots.push(root);
  const dirs = {
    UPLOADS_DIR: root,
    DATA_DIR: path.join(root, "data"),
    VIDEOS_DIR: path.join(root, "videos"),
    IMAGES_DIR: path.join(root, "images"),
    IMAGES_SMALL_DIR: path.join(root, "images-small"),
    SUBTITLES_DIR: path.join(root, "subtitles"),
  };
  for (const dir of Object.values(dirs)) {
    fs.ensureDirSync(dir);
  }

  const storage = {
    getSettings: vi.fn(() => settings),
    getVideoById: vi.fn(() => undefined),
    saveVideoIfAbsent: vi.fn(() => true),
  };
  // ffmpeg stand-in: write the thumbnail it was asked for.
  const execFileSafe = vi.fn(async (_cmd: string, args: string[]) => {
    fs.writeFileSync(args[args.length - 1], "thumb");
    return { stdout: "", stderr: "" };
  });
  const uploadedFileHasVideoStream = vi.fn(async () => true);
  const getVideoDuration = vi.fn(async () => 12);
  const getVideoDimensions = vi.fn(async () => ({ width: 640, height: 360 }));
  const regenerateSmallThumbnailForThumbnailPath = vi.fn(async (webPath: string) => {
    const mirrorPath = path.join(
      dirs.IMAGES_SMALL_DIR,
      webPath.replace(/^\/(?:images|videos)\//, "")
    );
    fs.writeFileSync(mirrorPath, "small-thumb");
    return mirrorPath;
  });

  vi.resetModules();
  vi.doMock("../../config/paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../config/paths")>()),
    ...dirs,
  }));
  vi.doMock("../../services/storageService", () => storage);
  vi.doMock("../../controllers/video/mediaProbe", () => ({
    execFileSafe,
    uploadedFileHasVideoStream,
    getVideoDuration,
    getVideoDimensions,
  }));
  vi.doMock("../../services/thumbnailMirrorService", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/thumbnailMirrorService")>()),
    regenerateSmallThumbnailForThumbnailPath,
  }));

  const allocator = await import(
    "../../services/filenameTemplate/outputPathAllocator"
  );
  allocator.setOutputPathAllocatorVideoProviderForTests(() => []);
  const { getUploadVideoPayload } = await import(
    "../../controllers/video/uploadHelpers"
  );

  fs.writeFileSync(path.join(dirs.VIDEOS_DIR, STORED_FILENAME), "uploaded-bytes");

  return {
    root,
    videosDir: dirs.VIDEOS_DIR,
    imagesDir: dirs.IMAGES_DIR,
    imagesSmallDir: dirs.IMAGES_SMALL_DIR,
    getUploadVideoPayload,
    storage,
    execFileSafe,
    uploadedFileHasVideoStream,
    getVideoDuration,
    getVideoDimensions,
    regenerateSmallThumbnailForThumbnailPath,
  };
};

const visibleEntries = (dir: string): string[] =>
  fs.readdirSync(dir).filter((name) => !name.startsWith("."));

const libraryEntries = visibleEntries;

const uploadedFile = (originalname: string) =>
  ({
    filename: STORED_FILENAME,
    originalname,
    contentHash: CONTENT_HASH,
    size: 14,
  }) as any;

describe("getUploadVideoPayload filename modes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../config/paths");
    vi.doUnmock("../../services/storageService");
    vi.doUnmock("../../controllers/video/mediaProbe");
    vi.doUnmock("../../services/thumbnailMirrorService");
    for (const root of tempRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it.each([
    ["missing", {}],
    ["generated", { uploadFilenameMode: "generated" }],
    ["unknown", { uploadFilenameMode: "bogus" }],
  ])("keeps the generated filename when the mode is %s", async (_label, settings) => {
    const h = await loadHarness(settings);

    const result = await h.getUploadVideoPayload(uploadedFile("Family Trip.mp4"), "", "");

    expect(result.status).toBe("uploaded");
    expect(result.video).toMatchObject({
      videoFilename: STORED_FILENAME,
      videoPath: `/videos/${STORED_FILENAME}`,
      thumbnailPath: "/images/1760000000000-0123456789abcdef.jpg",
      title: "Family Trip",
    });
    expect(libraryEntries(h.videosDir)).toEqual([STORED_FILENAME]);
  });

  it("stores the upload under its original filename", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });

    const result = await h.getUploadVideoPayload(uploadedFile("Family Trip.MP4"), "", "");

    expect(result.status).toBe("uploaded");
    expect(result.video).toMatchObject({
      id: VIDEO_ID,
      videoFilename: "Family Trip.mp4",
      videoPath: "/videos/Family Trip.mp4",
      thumbnailFilename: "Family Trip.jpg",
      thumbnailPath: "/images/Family Trip.jpg",
    });
    expect(result.video).not.toHaveProperty("sourceVideoId");
    expect(libraryEntries(h.videosDir)).toEqual(["Family Trip.mp4"]);
    expect(
      fs.readFileSync(path.join(h.videosDir, "Family Trip.mp4"), "utf8")
    ).toBe("uploaded-bytes");
  });

  it("adds the upload ID on collision and never reuses another video's thumbnail", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });
    fs.writeFileSync(path.join(h.imagesDir, "clip.jpg"), "other-thumb");

    const result = await h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "");

    expect(result.video).toMatchObject({
      videoFilename: "clip [3f9a2c1b].mp4",
      thumbnailPath: "/images/clip [3f9a2c1b].jpg",
    });
    expect(fs.readFileSync(path.join(h.imagesDir, "clip.jpg"), "utf8")).toBe(
      "other-thumb"
    );
  });

  it("passes ffmpeg the absolute path even for a name that looks like an option", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });

    const result = await h.getUploadVideoPayload(uploadedFile("-y.mp4"), "", "");

    expect(result.video?.videoFilename).toBe("-y.mp4");
    const [, args] = h.execFileSafe.mock.calls[0];
    expect(args[1]).toBe(path.join(h.videosDir, "-y.mp4"));
    expect(path.isAbsolute(args[args.length - 1])).toBe(true);
  });

  it("falls back to the generated filename when the original is unusable", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });

    const result = await h.getUploadVideoPayload(uploadedFile("CON.mp4"), "", "");

    expect(result.status).toBe("uploaded");
    expect(result.video?.videoFilename).toBe(STORED_FILENAME);
  });

  it("deletes the renamed file, not the temp name, when a concurrent upload wins", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });
    const winner = { id: VIDEO_ID, title: "winner" };
    h.storage.saveVideoIfAbsent.mockReturnValue(false);
    h.storage.getVideoById
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(winner);

    const result = await h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "");

    expect(result.status).toBe("duplicate");
    expect(result.video).toBe(winner);
    expect(libraryEntries(h.videosDir)).toEqual([]);
    expect(libraryEntries(h.imagesDir)).toEqual([]);
    expect(libraryEntries(h.imagesSmallDir)).toEqual([]);
  });

  it.each([
    "regenerateSmallThumbnailForThumbnailPath",
    "getVideoDuration",
    "getVideoDimensions",
  ] as const)("cleans up the renamed video and thumbnails when %s fails", async (operation) => {
    const h = await loadHarness({ uploadFilenameMode: "original" });
    const failure = new Error(`${operation} failed`);
    const originalImplementation = h[operation].getMockImplementation() as (...args: unknown[]) => unknown;
    h[operation].mockImplementationOnce(async (...args) => {
      await originalImplementation(...args);
      throw failure;
    });

    await expect(
      h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "")
    ).rejects.toThrow(failure);

    expect(h.storage.saveVideoIfAbsent).not.toHaveBeenCalled();
    expect(libraryEntries(h.videosDir)).toEqual([]);
    expect(libraryEntries(h.imagesDir)).toEqual([]);
    expect(libraryEntries(h.imagesSmallDir)).toEqual([]);
    expect(fs.readdirSync(path.join(h.root, "data", "output-path-reservations"))).toEqual([]);
  });

  it.each([false, true])("preserves an existing small thumbnail when thumbnails are stored with videos: %s", async (moveThumbnailsToVideoFolder) => {
    const h = await loadHarness({ uploadFilenameMode: "original", moveThumbnailsToVideoFolder });
    fs.writeFileSync(path.join(h.imagesSmallDir, "clip.jpg"), "other-small-thumb");

    const result = await h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "");

    expect(result.video).toMatchObject({
      videoFilename: "clip [3f9a2c1b].mp4",
      thumbnailPath: `/${moveThumbnailsToVideoFolder ? "videos" : "images"}/clip [3f9a2c1b].jpg`,
    });
    expect(fs.readFileSync(path.join(h.imagesSmallDir, "clip.jpg"), "utf8")).toBe(
      "other-small-thumb"
    );
    expect(fs.readFileSync(path.join(h.imagesSmallDir, "clip [3f9a2c1b].jpg"), "utf8")).toBe(
      "small-thumb"
    );
  });

  it.each(["duplicate", "error"])("preserves an existing small thumbnail during cleanup after a database %s", async (outcome) => {
    const h = await loadHarness({ uploadFilenameMode: "original" });
    fs.writeFileSync(path.join(h.imagesSmallDir, "clip.jpg"), "other-small-thumb");
    if (outcome === "duplicate") {
      h.storage.saveVideoIfAbsent.mockReturnValue(false);
      h.storage.getVideoById
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ id: VIDEO_ID, title: "winner" });
      const result = await h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "");
      expect(result.status).toBe("duplicate");
    } else {
      h.storage.saveVideoIfAbsent.mockImplementationOnce(() => {
        throw new Error("Database failed");
      });
      await expect(
        h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "")
      ).rejects.toThrow("Database failed");
    }

    expect(libraryEntries(h.videosDir)).toEqual([]);
    expect(libraryEntries(h.imagesDir)).toEqual([]);
    expect(libraryEntries(h.imagesSmallDir)).toEqual(["clip.jpg"]);
    expect(fs.readFileSync(path.join(h.imagesSmallDir, "clip.jpg"), "utf8")).toBe(
      "other-small-thumb"
    );
    expect(fs.readdirSync(path.join(h.root, "data", "output-path-reservations"))).toEqual([]);
  });

  it("does not rename a file that has no video stream", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });
    h.uploadedFileHasVideoStream.mockResolvedValue(false);

    const result = await h.getUploadVideoPayload(uploadedFile("clip.mp4"), "", "");

    expect(result.status).toBe("failed");
    expect(libraryEntries(h.videosDir)).toEqual([]);
  });

  it("skips a duplicate before naming, leaving the existing file's name alone", async () => {
    const h = await loadHarness({ uploadFilenameMode: "original" });
    const existing = { id: VIDEO_ID, videoFilename: "first name.mp4" };
    h.storage.getVideoById.mockReturnValue(existing);

    const result = await h.getUploadVideoPayload(uploadedFile("second name.mp4"), "", "");

    expect(result.status).toBe("duplicate");
    expect(result.video).toBe(existing);
    expect(libraryEntries(h.videosDir)).toEqual([]);
  });
});
