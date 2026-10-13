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
  getUploadVideoPayload: typeof import("../../controllers/video/uploadHelpers").getUploadVideoPayload;
  storage: {
    getSettings: ReturnType<typeof vi.fn>;
    getVideoById: ReturnType<typeof vi.fn>;
    saveVideoIfAbsent: ReturnType<typeof vi.fn>;
  };
  execFileSafe: ReturnType<typeof vi.fn>;
  uploadedFileHasVideoStream: ReturnType<typeof vi.fn>;
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

  vi.resetModules();
  vi.doMock("../../config/paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../config/paths")>()),
    ...dirs,
  }));
  vi.doMock("../../services/storageService", () => storage);
  vi.doMock("../../controllers/video/mediaProbe", () => ({
    execFileSafe,
    uploadedFileHasVideoStream,
    getVideoDuration: vi.fn(async () => 12),
    getVideoDimensions: vi.fn(async () => ({ width: 640, height: 360 })),
  }));
  vi.doMock("../../services/thumbnailMirrorService", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/thumbnailMirrorService")>()),
    regenerateSmallThumbnailForThumbnailPath: vi.fn(async () => undefined),
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
    getUploadVideoPayload,
    storage,
    execFileSafe,
    uploadedFileHasVideoStream,
  };
};

const visibleEntries = (dir: string): string[] =>
  fs.readdirSync(dir).filter((name) => !name.startsWith("."));

// The shared no-overwrite promote keeps a .mytube-staging directory (holding
// only its media-server ignore markers) in the library root; downloads leave
// the same one and scans skip dot entries. Nothing may be left staged in it.
const libraryEntries = (dir: string): string[] => {
  const stagingDir = path.join(dir, ".mytube-staging");
  if (fs.existsSync(stagingDir)) {
    expect(visibleEntries(stagingDir)).toEqual([]);
  }
  return visibleEntries(dir);
};

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
