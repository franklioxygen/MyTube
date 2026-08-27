import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const testPaths = vi.hoisted(() => {
  const fs = require("fs-extra") as typeof import("fs-extra");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-poster-"));
  return { root, images: path.join(root, "images") };
});

const regenerateSmallThumbnailMock = vi.hoisted(() => vi.fn());
const deleteSmallThumbnailMirrorMock = vi.hoisted(() => vi.fn());
const axiosGetMock = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({ default: { get: axiosGetMock } }));

vi.mock("../../../config/paths", () => ({
  IMAGES_DIR: testPaths.images,
}));

vi.mock("../../../services/thumbnailMirrorService", () => ({
  regenerateSmallThumbnailForThumbnailPath: regenerateSmallThumbnailMock,
  deleteSmallThumbnailMirrorSync: deleteSmallThumbnailMirrorMock,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  discardStagedCollectionPoster,
  publishStagedCollectionPoster,
  removeCollectionPoster,
  resolveCollectionPosterSaveLocation,
  stageCollectionPoster,
} from "../../../services/tmdbService/poster";

/**
 * The rename is the publication. Anything after it is derived convenience, and
 * reporting its failure as a failed publication made the caller commit a null
 * poster path for an image that is on disk - and delete the previous one.
 */
describe("publishStagedCollectionPoster", () => {
  const finalPath = () => path.join(testPaths.images, "tmdb/collections/h/tv-42.jpg");
  const stagedPath = () =>
    path.join(testPaths.images, "tmdb/collections/h/.staging-tv-42.jpg");

  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    fs.ensureDirSync(path.dirname(finalPath()));
    fs.writeFileSync(stagedPath(), "new-poster-bytes", "utf8");
    regenerateSmallThumbnailMock.mockReset();
    regenerateSmallThumbnailMock.mockResolvedValue(undefined);
  });

  afterAll(() => {
    fs.removeSync(testPaths.root);
  });

  it("publishes and reports success", async () => {
    await expect(
      publishStagedCollectionPoster(
        stagedPath(),
        finalPath(),
        "/images/tmdb/collections/h/tv-42.jpg"
      )
    ).resolves.toBe(true);

    expect(fs.readFileSync(finalPath(), "utf8")).toBe("new-poster-bytes");
    expect(fs.existsSync(stagedPath())).toBe(false);
  });

  it("still reports success when the small mirror fails", async () => {
    regenerateSmallThumbnailMock.mockRejectedValue(new Error("sharp exploded"));

    await expect(
      publishStagedCollectionPoster(
        stagedPath(),
        finalPath(),
        "/images/tmdb/collections/h/tv-42.jpg"
      )
    ).resolves.toBe(true);

    // The poster really is published, so the caller must be told so.
    expect(fs.readFileSync(finalPath(), "utf8")).toBe("new-poster-bytes");
  });

  it("reports failure and discards the staged file when the rename fails", async () => {
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename exploded");
    });

    try {
      await expect(
        publishStagedCollectionPoster(
          stagedPath(),
          finalPath(),
          "/images/tmdb/collections/h/tv-42.jpg"
        )
      ).resolves.toBe(false);
    } finally {
      renameSpy.mockRestore();
    }

    expect(fs.existsSync(finalPath())).toBe(false);
    expect(fs.existsSync(stagedPath())).toBe(false);
  });
});

/**
 * Staging exists so the live poster is never written before the maintenance
 * lock is held, and never observed half-written by a concurrent rebuild.
 */
describe("stageCollectionPoster", () => {
  const finalPath = () =>
    path.join(testPaths.images, "tmdb/collections/h/tv-42.jpg");

  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    fs.ensureDirSync(path.dirname(finalPath()));
    axiosGetMock.mockReset();
    axiosGetMock.mockResolvedValue({ data: Buffer.from("poster-bytes") });
  });

  it("writes beside the destination, never onto it", async () => {
    const staged = await stageCollectionPoster("/p.jpg", finalPath());

    expect(staged).toBeTruthy();
    expect(staged).not.toBe(finalPath());
    expect(path.dirname(staged as string)).toBe(path.dirname(finalPath()));
    expect(fs.readFileSync(staged as string, "utf8")).toBe("poster-bytes");
    // The live path is untouched.
    expect(fs.existsSync(finalPath())).toBe(false);
  });

  it("returns null when the download fails", async () => {
    axiosGetMock.mockRejectedValue(new Error("network down"));

    await expect(stageCollectionPoster("/p.jpg", finalPath())).resolves.toBeNull();
    expect(fs.existsSync(finalPath())).toBe(false);
  });

  it("refuses a poster path that is not a TMDB image path", async () => {
    // SSRF guard: rejected before any request is made.
    await expect(
      stageCollectionPoster("../../etc/passwd", finalPath())
    ).resolves.toBeNull();
    expect(axiosGetMock).not.toHaveBeenCalled();
  });
});

describe("discardStagedCollectionPoster", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    fs.ensureDirSync(path.join(testPaths.images, "tmdb/collections/h"));
  });

  it("removes the staged file", () => {
    const staged = path.join(testPaths.images, "tmdb/collections/h/.staging-x.jpg");
    fs.writeFileSync(staged, "bytes", "utf8");

    discardStagedCollectionPoster(staged);

    expect(fs.existsSync(staged)).toBe(false);
  });

  it("tolerates a missing file and a null path", () => {
    expect(() =>
      discardStagedCollectionPoster(
        path.join(testPaths.images, "tmdb/collections/h/.staging-gone.jpg")
      )
    ).not.toThrow();
    expect(() => discardStagedCollectionPoster(null)).not.toThrow();
    expect(() => discardStagedCollectionPoster(undefined)).not.toThrow();
  });
});

/**
 * `mediaServerPosterPath` is a free-form column, so removal is deliberately
 * confined to the namespace this module writes into - an image the user
 * pointed at themselves must never be deleted by an activation.
 */
describe("removeCollectionPoster", () => {
  beforeEach(() => {
    fs.emptyDirSync(testPaths.root);
    fs.ensureDirSync(path.join(testPaths.images, "tmdb/collections/h"));
    fs.ensureDirSync(path.join(testPaths.images, "user"));
    deleteSmallThumbnailMirrorMock.mockReset();
  });

  it("removes a poster it owns, and its small mirror", () => {
    const owned = path.join(testPaths.images, "tmdb/collections/h/tv-42.jpg");
    fs.writeFileSync(owned, "bytes", "utf8");

    removeCollectionPoster("/images/tmdb/collections/h/tv-42.jpg");

    expect(fs.existsSync(owned)).toBe(false);
    expect(deleteSmallThumbnailMirrorMock).toHaveBeenCalledWith(
      "/images/tmdb/collections/h/tv-42.jpg"
    );
  });

  it("refuses a path outside its own namespace", () => {
    const userImage = path.join(testPaths.images, "user/my-art.jpg");
    fs.writeFileSync(userImage, "USER DATA", "utf8");

    removeCollectionPoster("/images/user/my-art.jpg");

    expect(fs.readFileSync(userImage, "utf8")).toBe("USER DATA");
    expect(deleteSmallThumbnailMirrorMock).not.toHaveBeenCalled();
  });

  it("ignores empty and non-image web paths", () => {
    expect(() => removeCollectionPoster(null)).not.toThrow();
    expect(() => removeCollectionPoster(undefined)).not.toThrow();
    expect(() => removeCollectionPoster("/videos/x.mp4")).not.toThrow();
    expect(deleteSmallThumbnailMirrorMock).not.toHaveBeenCalled();
  });
});

describe("resolveCollectionPosterSaveLocation", () => {
  it("keeps one collection's posters together and names them per TMDB id", () => {
    const tv = resolveCollectionPosterSaveLocation("c1", "tv", 42);
    const movie = resolveCollectionPosterSaveLocation("c1", "movie", 42);

    expect(tv?.relativePath).toMatch(/^tmdb\/collections\/[0-9a-f]{32}\/tv-42\.jpg$/);
    // Same collection, same directory - so a re-resolution can replace them.
    expect(path.dirname(tv!.relativePath)).toBe(path.dirname(movie!.relativePath));
    // Different match, different file: the active one is never clobbered.
    expect(tv?.relativePath).not.toBe(movie?.relativePath);
    expect(tv?.webPath).toBe(`/images/${tv?.relativePath}`);
  });

  it("never derives a path from an id it cannot validate", () => {
    expect(resolveCollectionPosterSaveLocation("", "tv", 42)).toBeNull();
    expect(
      resolveCollectionPosterSaveLocation("c1", "series" as "tv", 42)
    ).toBeNull();
    expect(resolveCollectionPosterSaveLocation("c1", "tv", 0)).toBeNull();
    expect(resolveCollectionPosterSaveLocation("c1", "tv", -3)).toBeNull();
    expect(resolveCollectionPosterSaveLocation("c1", "tv", 1.5)).toBeNull();
  });
});
