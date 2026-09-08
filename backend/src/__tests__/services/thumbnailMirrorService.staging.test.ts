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
  // Stand in for ffmpeg. It writes a marker derived from the source so a test
  // can tell which thumbnail a mirror was actually encoded from - the argument
  // layout is ["-y", "-i", <source>, ..., <target>].
  vi.doMock("../../utils/security", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
      ...actual,
      execFileSafe: vi.fn(async (_bin: string, args: string[]) => {
        const source = args[2];
        const target = args[args.length - 1];
        fsExtra.ensureDirSync(path.dirname(target));
        fsExtra.writeFileSync(target, `small:${fsExtra.readFileSync(source, "utf8")}`);
        return { stdout: "", stderr: "" };
      }),
    };
  });
  return import("../../services/thumbnailMirrorService");
}

function smallMirrors(root: string): string[] {
  return fsExtra.readdirSync(path.join(root, "images-small")).sort();
}

function mirrorContent(root: string, name: string): string {
  return fsExtra.readFileSync(path.join(root, "images-small", name), "utf8");
}

const STAGING_NAME = ".mytube-redownload-b84ebd18-008a-4a24-b787-e6af2c9c2dfd.jpg";

describe("small thumbnail mirrors across a staged thumbnail publish", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../config/paths");
    vi.doUnmock("../../utils/security");
    for (const root of tempRoots.splice(0)) {
      fsExtra.removeSync(root);
    }
  });

  it("leaves nothing behind under the staging name", async () => {
    const root = makeTempRoot();
    const service = await loadMirrorService(root);

    // What a downloader does: the thumbnail lands on a staging name, and
    // downloadThumbnail mirrors whatever path it has just written.
    const stagingAbsolute = path.join(root, "images", STAGING_NAME);
    fsExtra.writeFileSync(stagingAbsolute, "new-thumb");
    await service.regenerateSmallThumbnailForThumbnailPath(stagingAbsolute);
    expect(smallMirrors(root)).toEqual([STAGING_NAME]);

    // Then the staged file is published onto its real name.
    fsExtra.moveSync(stagingAbsolute, path.join(root, "images", "Episode.jpg"));

    service.deleteSmallThumbnailMirrorSync(stagingAbsolute);
    await service.regenerateSmallThumbnailForThumbnailPath("/images/Episode.jpg");

    expect(smallMirrors(root)).toEqual(["Episode.jpg"]);
    expect(mirrorContent(root, "Episode.jpg")).toBe("small:new-thumb");
  });

  it("replaces a mirror left by the download this one supersedes", async () => {
    const root = makeTempRoot();
    const service = await loadMirrorService(root);

    // An owned replacement re-downloads over a thumbnail that is already
    // published, so images-small already holds a mirror of the old image.
    const publishedAbsolute = path.join(root, "images", "Episode.jpg");
    fsExtra.writeFileSync(publishedAbsolute, "old-thumb");
    await service.regenerateSmallThumbnailForThumbnailPath(publishedAbsolute);
    expect(mirrorContent(root, "Episode.jpg")).toBe("small:old-thumb");

    // The new thumbnail lands on a staging name, but its mirror never gets
    // made - downloadThumbnail only warns when generation fails.
    const stagingAbsolute = path.join(root, "images", STAGING_NAME);
    fsExtra.writeFileSync(stagingAbsolute, "new-thumb");
    fsExtra.moveSync(stagingAbsolute, publishedAbsolute, { overwrite: true });

    service.deleteSmallThumbnailMirrorSync(stagingAbsolute);
    await service.regenerateSmallThumbnailForThumbnailPath("/images/Episode.jpg");

    // Regeneration must be forced. A non-forcing ensure would accept the
    // mirror already sitting there and leave the preview on the old image.
    expect(smallMirrors(root)).toEqual(["Episode.jpg"]);
    expect(mirrorContent(root, "Episode.jpg")).toBe("small:new-thumb");
  });

  it("removes the staging mirror when a failed download discards the file", async () => {
    const root = makeTempRoot();
    const service = await loadMirrorService(root);

    const stagingAbsolute = path.join(root, "images", STAGING_NAME);
    fsExtra.writeFileSync(stagingAbsolute, "new-thumb");
    await service.regenerateSmallThumbnailForThumbnailPath(stagingAbsolute);
    expect(smallMirrors(root)).toEqual([STAGING_NAME]);

    // The download fails after the thumbnail landed; the staging file is
    // removed, and its mirror has to go with it.
    fsExtra.removeSync(stagingAbsolute);
    service.deleteSmallThumbnailMirrorSync(stagingAbsolute);

    expect(smallMirrors(root)).toEqual([]);
  });
});
