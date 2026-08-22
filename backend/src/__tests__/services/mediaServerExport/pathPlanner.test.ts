import { describe, expect, it, vi } from "vitest";
import type { Video } from "../../../services/storageService";

const testPaths = vi.hoisted(() => {
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const root = path.join(os.tmpdir(), "mytube-path-planner-fixture");

  return {
    root,
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    imagesSmall: path.join(root, "images-small"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
  };
});

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  VIDEOS_DIR: testPaths.videos,
  SUBTITLES_DIR: testPaths.subtitles,
}));

import {
  parseTvLayoutFromRelativeVideoPath,
  planMediaServerExportPaths,
} from "../../../services/mediaServerExport/pathPlanner";

function createVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: "video-1",
    title: "Episode",
    videoPath: "/videos/Kurzgesagt/Season 01/s01e001 - Episode.mp4",
    sourceUrl: "https://example.com/video",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as Video;
}

/**
 * Regression boundary for issue #411: the adjacent exporter derives TV identity
 * from the original media path. The playlist_tv layout must not change any of
 * this behavior.
 */
describe("mediaServerExport pathPlanner (adjacent regression boundary)", () => {
  describe("parseTvLayoutFromRelativeVideoPath", () => {
    it("reads the season number from the Season N folder", () => {
      expect(
        parseTvLayoutFromRelativeVideoPath("Kurzgesagt/Season 3/s03e012 - The Egg.mp4")
      ).toEqual({
        isTvCompatible: true,
        showRootName: "Kurzgesagt",
        showRootRelativeDir: "Kurzgesagt",
        seasonDirectoryName: "Season 3",
        seasonNumber: 3,
        episodeToken: "s03e012 - The Egg",
        episodeNumber: 12,
      });
    });

    it("treats a Specials folder as season 0", () => {
      const layout = parseTvLayoutFromRelativeVideoPath(
        "Kurzgesagt/Specials/s00e001 - Extra.mp4"
      );
      expect(layout.isTvCompatible).toBe(true);
      expect(layout.seasonNumber).toBe(0);
      expect(layout.episodeNumber).toBe(1);
    });

    it("is not TV compatible without a recognized season folder", () => {
      expect(
        parseTvLayoutFromRelativeVideoPath("Kurzgesagt/2026/s01e001 - Episode.mp4")
      ).toMatchObject({ isTvCompatible: false });
      expect(
        parseTvLayoutFromRelativeVideoPath("Kurzgesagt/episode.mp4")
      ).toEqual({ isTvCompatible: false });
    });

    it("falls back to the filename token season when the folder is unrecognized", () => {
      const layout = parseTvLayoutFromRelativeVideoPath(
        "Kurzgesagt/Uploads/s07e042 - Episode.mp4"
      );
      expect(layout.isTvCompatible).toBe(false);
      expect(layout.seasonNumber).toBe(7);
      expect(layout.episodeNumber).toBe(42);
    });
  });

  describe("planMediaServerExportPaths", () => {
    it("plans adjacent sidecars next to the original media file", () => {
      const plan = planMediaServerExportPaths(createVideo());

      expect(plan).not.toBeNull();
      expect(plan?.videoRelativePath).toBe(
        "Kurzgesagt/Season 01/s01e001 - Episode.mp4"
      );
      expect(plan?.basenameWithoutExt).toBe("s01e001 - Episode");
      expect(plan?.episodeNfoAbsolutePath.endsWith("s01e001 - Episode.nfo")).toBe(
        true
      );
      expect(
        plan?.episodeSourceJsonAbsolutePath.endsWith("s01e001 - Episode.info.json")
      ).toBe(true);
      expect(
        plan?.episodeThumbAliasAbsolutePath.endsWith(
          "s01e001 - Episode-thumb.jpg"
        )
      ).toBe(true);
      expect(plan?.showNfoAbsolutePath?.endsWith("Kurzgesagt/tvshow.nfo")).toBe(
        true
      );
      expect(
        plan?.showPosterAbsolutePaths.map((posterPath) =>
          posterPath.split(/[\\/]/).pop()
        )
      ).toEqual(["show.jpg", "poster.jpg", "folder.jpg"]);
    });

    it("omits show artifacts for a non-TV path", () => {
      const plan = planMediaServerExportPaths(
        createVideo({ videoPath: "/videos/loose-video.mp4" })
      );

      expect(plan?.tvLayout.isTvCompatible).toBe(false);
      expect(plan?.showNfoAbsolutePath).toBeUndefined();
      expect(plan?.showPosterAbsolutePaths).toEqual([]);
    });

    it("returns null for non-/videos sources", () => {
      expect(
        planMediaServerExportPaths(createVideo({ videoPath: "cloud:remote/video.mp4" }))
      ).toBeNull();
      expect(
        planMediaServerExportPaths(createVideo({ videoPath: "mount:/media/video.mp4" }))
      ).toBeNull();
      expect(
        planMediaServerExportPaths(
          createVideo({ videoPath: "https://example.com/video.mp4" })
        )
      ).toBeNull();
      expect(planMediaServerExportPaths(createVideo({ videoPath: undefined }))).toBeNull();
    });

    it("keeps every planned artifact under the managed videos root", () => {
      const plan = planMediaServerExportPaths(createVideo());
      const managedRoot = testPaths.videos;

      for (const targetPath of [
        plan?.episodeNfoAbsolutePath,
        plan?.episodeSourceJsonAbsolutePath,
        plan?.episodeThumbAliasAbsolutePath,
        plan?.showNfoAbsolutePath,
        ...(plan?.showPosterAbsolutePaths ?? []),
      ]) {
        expect(targetPath).toBeTruthy();
        expect(targetPath?.startsWith(managedRoot)).toBe(true);
      }
    });
  });
});
