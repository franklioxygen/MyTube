import fsExtra from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

type MirrorModule = typeof import("../../services/thumbnailMirrorService");

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fsExtra.mkdtempSync(path.join(os.tmpdir(), "mytube-mirror-"));
  tempRoots.push(root);
  fsExtra.ensureDirSync(path.join(root, "images"));
  fsExtra.ensureDirSync(path.join(root, "images-small"));
  fsExtra.ensureDirSync(path.join(root, "videos"));
  return root;
}

async function loadMirrorService(root: string): Promise<MirrorModule> {
  vi.resetModules();
  vi.doMock("../../config/paths", () => ({
    IMAGES_DIR: path.join(root, "images"),
    IMAGES_SMALL_DIR: path.join(root, "images-small"),
    VIDEOS_DIR: path.join(root, "videos"),
  }));
  // Stand in for ffmpeg: the real encode is not what these tests are about, so
  // just put a file where the encoder would have written one.
  vi.doMock("../../utils/security", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      execFileSafe: vi.fn(async (_bin: string, args: string[]) => {
        const target = args[args.length - 1];
        fsExtra.ensureDirSync(path.dirname(target));
        fsExtra.writeFileSync(target, "small");
        return { stdout: "", stderr: "" };
      }),
    };
  });
  return import("../../services/thumbnailMirrorService");
}

function smallMirrors(root: string): string[] {
  return fsExtra.readdirSync(path.join(root, "images-small"));
}

describe("small thumbnail mirrors across a staged thumbnail publish", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../config/paths");
    vi.doUnmock("../../utils/security");
    for (const root of tempRoots.splice(0)) {
      fsExtra.removeSync(root);
    }
  });

  it("carries the staging mirror onto the published name instead of stranding it", async () => {
    const root = makeTempRoot();
    const service = await loadMirrorService(root);

    // What the downloader does: the thumbnail lands on a staging name, and
    // downloadThumbnail mirrors whatever path it just wrote.
    const stagingAbsolute = path.join(
      root,
      "images",
      ".mytube-redownload-b84ebd18-008a-4a24-b787-e6af2c9c2dfd.jpg"
    );
    fsExtra.writeFileSync(stagingAbsolute, "thumb");
    await service.regenerateSmallThumbnailForThumbnailPath(stagingAbsolute);
    expect(smallMirrors(root)).toEqual([
      ".mytube-redownload-b84ebd18-008a-4a24-b787-e6af2c9c2dfd.jpg",
    ]);

    // Then the staged file is published onto its real name.
    const publishedAbsolute = path.join(root, "images", "Episode.jpg");
    fsExtra.moveSync(stagingAbsolute, publishedAbsolute);

    service.moveSmallThumbnailMirrorSync(stagingAbsolute, "/images/Episode.jpg");
    await service.ensureSmallThumbnailForThumbnailPath("/images/Episode.jpg");

    // The mirror follows the file. Nothing is left under the staging name,
    // which nothing would ever reference again.
    expect(smallMirrors(root)).toEqual(["Episode.jpg"]);
  });

  it("still produces a mirror when the staging name never had one", async () => {
    const root = makeTempRoot();
    const service = await loadMirrorService(root);

    const stagingAbsolute = path.join(root, "images", ".mytube-redownload-x.jpg");
    const publishedAbsolute = path.join(root, "images", "Episode.jpg");
    fsExtra.writeFileSync(publishedAbsolute, "thumb");
    expect(smallMirrors(root)).toEqual([]);

    // The move finds nothing to carry over, so ensure has to do the work.
    service.moveSmallThumbnailMirrorSync(stagingAbsolute, "/images/Episode.jpg");
    await service.ensureSmallThumbnailForThumbnailPath("/images/Episode.jpg");

    expect(smallMirrors(root)).toEqual(["Episode.jpg"]);
  });

  it("removes the staging mirror when a failed download discards the file", async () => {
    const root = makeTempRoot();
    const service = await loadMirrorService(root);

    const stagingAbsolute = path.join(root, "images", ".mytube-redownload-y.jpg");
    fsExtra.writeFileSync(stagingAbsolute, "thumb");
    await service.regenerateSmallThumbnailForThumbnailPath(stagingAbsolute);
    expect(smallMirrors(root)).toEqual([".mytube-redownload-y.jpg"]);

    // The download fails after the thumbnail landed; the staging file is
    // removed, and its mirror has to go with it.
    fsExtra.removeSync(stagingAbsolute);
    service.deleteSmallThumbnailMirrorSync(stagingAbsolute);

    expect(smallMirrors(root)).toEqual([]);
  });
});
