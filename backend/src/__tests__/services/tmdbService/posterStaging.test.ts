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

vi.mock("../../../config/paths", () => ({
  IMAGES_DIR: testPaths.images,
}));

vi.mock("../../../services/thumbnailMirrorService", () => ({
  regenerateSmallThumbnailForThumbnailPath: regenerateSmallThumbnailMock,
  deleteSmallThumbnailMirrorSync: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  publishStagedCollectionPoster,
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
