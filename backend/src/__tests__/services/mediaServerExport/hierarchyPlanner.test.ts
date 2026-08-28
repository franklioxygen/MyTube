import path from "path";
import { describe, expect, it, vi } from "vitest";

const testPaths = vi.hoisted(() => {
  const path = require("path") as typeof import("path");
  const root = path.join("/tmp", "mytube-plan-root");
  return {
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
    mediaLibrary: path.join(root, "media-library"),
  };
});

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  IMAGES_DIR: testPaths.images,
  SUBTITLES_DIR: testPaths.subtitles,
  VIDEOS_DIR: testPaths.videos,
  MEDIA_SERVER_LIBRARY_DIR: testPaths.mediaLibrary,
}));

import {
  collectPlannedRelativePaths,
  planMediaServerHierarchy,
} from "../../../services/mediaServerExport/hierarchyPlanner";
import type {
  HierarchyPlan,
  MediaServerCatalogSnapshot,
  MediaServerEpisodeAssignment,
  MediaServerShow,
} from "../../../services/mediaServerExport/types";
import type { Video } from "../../../services/storageService";

const SHOW: MediaServerShow = {
  id: "show-1",
  identityKey: "youtube:channel-id:UC1",
  sourcePlatform: "youtube",
  sourceChannelId: "UC1",
  title: "Kurzgesagt",
  description: "Channel description",
  directoryName: "Kurzgesagt",
  nextSeasonNumber: 3,
};

function createVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: "video-1",
    title: "Human Origins",
    author: "Kurzgesagt",
    date: "20260115",
    duration: "600",
    videoPath: "/videos/Kurzgesagt/human-origins.mp4",
    thumbnailPath: "/images/Kurzgesagt/human-origins.jpg",
    authorAvatarPath: "/avatars/kurzgesagt.jpg",
    sourceUrl: "https://example.com/v1",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  } as unknown as Video;
}

function createAssignment(
  overrides: Partial<MediaServerEpisodeAssignment> = {}
): MediaServerEpisodeAssignment {
  return {
    id: "assign-1",
    showId: "show-1",
    collectionId: "col-1",
    videoId: "video-1",
    seasonNumber: 1,
    episodeNumber: 1,
    exportStem: "S01E001 - Human Origins",
    ...overrides,
  };
}

function buildSnapshot(
  overrides: Partial<MediaServerCatalogSnapshot> = {}
): MediaServerCatalogSnapshot {
  const videos = overrides.videosById ?? new Map([["video-1", createVideo()]]);
  return {
    shows: [SHOW],
    seasons: [
      {
        showId: "show-1",
        seasonNumber: 1,
        collectionId: "col-1",
        title: "Space Time",
        description: "Playlist plot",
      },
      {
        showId: "show-1",
        seasonNumber: 0,
        title: "Specials / Unassigned",
        description: "",
      },
    ],
    assignments: [createAssignment()],
    videosById: videos,
    ...overrides,
  };
}

function plan(
  snapshot: MediaServerCatalogSnapshot,
  options: { mode?: "nfo" | "nfo_and_source_json"; showIds?: string[] } = {}
): HierarchyPlan {
  return planMediaServerHierarchy({
    snapshot,
    mode: options.mode ?? "nfo",
    showIds: options.showIds,
    fileExists: () => true,
  });
}

describe("mediaServerExport/hierarchyPlanner", () => {
  it("plans the documented show/season/episode tree", () => {
    const result = plan(buildSnapshot());
    expect(Array.from(collectPlannedRelativePaths(result)).sort()).toEqual([
      "Kurzgesagt/Season 01/S01E001 - Human Origins-thumb.jpg",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.mp4",
      "Kurzgesagt/Season 01/S01E001 - Human Origins.nfo",
      "Kurzgesagt/Season 01/season.nfo",
      "Kurzgesagt/poster.jpg",
      "Kurzgesagt/tvshow.nfo",
    ]);
    expect(result.skips).toEqual([]);
  });

  it("carries the persisted season title and plot into season.nfo", () => {
    const seasonNfo = plan(buildSnapshot()).shows[0].seasons[0].artifacts[0];
    expect(seasonNfo.content).toContain("<title>Space Time</title>");
    expect(seasonNfo.content).toContain("<plot>Playlist plot</plot>");
  });

  it("sources the show plot from the channel, never from an episode", () => {
    const showNfo = plan(buildSnapshot()).shows[0].artifacts[0];
    expect(showNfo.content).toContain("<plot>Channel description</plot>");
    expect(showNfo.content).toContain("<premiered>2026-01-15</premiered>");
  });

  it("gives one video in two seasons two media targets and two unique ids", () => {
    const snapshot = buildSnapshot({
      seasons: [
        {
          showId: "show-1",
          seasonNumber: 1,
          collectionId: "col-1",
          title: "Space Time",
          description: "",
        },
        {
          showId: "show-1",
          seasonNumber: 2,
          collectionId: "col-2",
          title: "Best Of",
          description: "",
        },
      ],
      assignments: [
        createAssignment(),
        createAssignment({
          id: "assign-2",
          collectionId: "col-2",
          seasonNumber: 2,
          episodeNumber: 4,
          exportStem: "S02E004 - Human Origins",
        }),
      ],
    });

    const paths = collectPlannedRelativePaths(plan(snapshot));
    expect(paths.has("Kurzgesagt/Season 01/S01E001 - Human Origins.mp4")).toBe(
      true
    );
    expect(paths.has("Kurzgesagt/Season 02/S02E004 - Human Origins.mp4")).toBe(
      true
    );

    const nfos = plan(snapshot)
      .shows[0].seasons.flatMap((season) =>
        season.episodes.flatMap((episode) => episode.artifacts)
      )
      .filter((artifact) => artifact.artifactType === "episode_nfo");
    expect(nfos[0].content).toContain("mytube:episode:show-1:1:1:video-1");
    expect(nfos[1].content).toContain("mytube:episode:show-1:2:4:video-1");
  });

  it("orders shows by directory and episodes by number", () => {
    const snapshot = buildSnapshot({
      shows: [
        { ...SHOW, id: "show-2", directoryName: "Zeta", identityKey: "z" },
        SHOW,
      ],
      seasons: [
        {
          showId: "show-1",
          seasonNumber: 1,
          collectionId: "col-1",
          title: "S",
          description: "",
        },
        {
          showId: "show-2",
          seasonNumber: 1,
          collectionId: "col-2",
          title: "Z",
          description: "",
        },
      ],
      assignments: [
        createAssignment({ id: "a3", episodeNumber: 9, exportStem: "S01E009 - c" }),
        createAssignment({
          id: "a2",
          videoId: "video-2",
          episodeNumber: 2,
          exportStem: "S01E002 - b",
        }),
        createAssignment({
          id: "a1",
          showId: "show-2",
          collectionId: "col-2",
          videoId: "video-3",
          exportStem: "S01E001 - a",
        }),
      ],
      videosById: new Map([
        ["video-1", createVideo()],
        ["video-2", createVideo({ id: "video-2" })],
        ["video-3", createVideo({ id: "video-3" })],
      ]),
    });

    const result = plan(snapshot);
    expect(result.shows.map((show) => show.directoryName)).toEqual([
      "Kurzgesagt",
      "Zeta",
    ]);
    expect(
      result.shows[0].seasons[0].episodes.map((episode) => episode.episodeNumber)
    ).toEqual([2, 9]);
  });

  it("plans source JSON only in nfo_and_source_json mode", () => {
    expect(
      Array.from(collectPlannedRelativePaths(plan(buildSnapshot()))).some(
        (relativePath) => relativePath.endsWith(".info.json")
      )
    ).toBe(false);
    expect(
      Array.from(
        collectPlannedRelativePaths(
          plan(buildSnapshot(), { mode: "nfo_and_source_json" })
        )
      )
    ).toContain("Kurzgesagt/Season 01/S01E001 - Human Origins.info.json");
  });

  it("layers a fresh download's raw info into the planned source JSON", () => {
    const snapshot = buildSnapshot({
      rawInfoByVideoId: new Map([
        ["video-1", { format_id: "248+251", _mytube: { ignored: true } }],
      ]),
    });
    const sourceJson = plan(snapshot, { mode: "nfo_and_source_json" })
      .shows[0].seasons[0].episodes[0].artifacts.find((artifact) =>
        artifact.relativePath.endsWith(".info.json")
      );
    const payload = JSON.parse(sourceJson?.content ?? "{}");

    expect(payload.format_id).toBe("248+251");
    expect(payload._mytube.rawSourcePreserved).toBe(true);
    expect(payload.title).toBe("Human Origins");
  });

  it("plans allowlisted subtitles and skips unusable ones", () => {
    const snapshot = buildSnapshot({
      videosById: new Map([
        [
          "video-1",
          createVideo({
            subtitles: [
              {
                language: "en",
                filename: "a.vtt",
                path: "/subtitles/Kurzgesagt/a.vtt",
              },
              {
                language: "../evil",
                filename: "b.vtt",
                path: "/subtitles/Kurzgesagt/b.vtt",
              },
              {
                language: "de",
                filename: "c.exe",
                path: "/subtitles/Kurzgesagt/c.exe",
              },
              {
                language: "fr",
                filename: "d.vtt",
                path: "/videos/Kurzgesagt/d.vtt",
              },
            ],
          }),
        ],
      ]),
    });

    const subtitlePaths = Array.from(
      collectPlannedRelativePaths(plan(snapshot))
    ).filter((relativePath) => relativePath.includes("Human Origins."));
    expect(subtitlePaths).toContain(
      "Kurzgesagt/Season 01/S01E001 - Human Origins.en.vtt"
    );
    expect(subtitlePaths).toContain(
      "Kurzgesagt/Season 01/S01E001 - Human Origins.fr.vtt"
    );
    expect(
      subtitlePaths.some((relativePath) => relativePath.includes("evil"))
    ).toBe(false);
    expect(
      subtitlePaths.some((relativePath) => relativePath.endsWith(".exe"))
    ).toBe(false);
  });

  it("skips non-local, missing, and unknown-video assignments with a reason", () => {
    const cloudSnapshot = buildSnapshot({
      videosById: new Map([
        ["video-1", createVideo({ videoPath: "cloud:/remote/a.mp4" })],
      ]),
    });
    expect(plan(cloudSnapshot).skips[0].reason).toBe("no_local_video_path");

    const missing = planMediaServerHierarchy({
      snapshot: buildSnapshot(),
      mode: "nfo",
      fileExists: (absolutePath) =>
        !absolutePath.endsWith(path.join("Kurzgesagt", "human-origins.mp4")),
    });
    expect(missing.skips[0].reason).toBe("video_file_missing");

    const unknown = buildSnapshot({ videosById: new Map() });
    expect(plan(unknown).skips[0].reason).toBe("invalid_catalog_assignment");
  });

  it("reports a season whose catalog metadata is missing", () => {
    const snapshot = buildSnapshot({ seasons: [] });
    const result = plan(snapshot);
    expect(result.shows).toEqual([]);
    expect(result.skips[0]).toMatchObject({
      reason: "invalid_catalog_assignment",
      detail: "season 1 has no catalog metadata",
    });
  });

  it("rejects a show directory that would escape the mirror root", () => {
    const snapshot = buildSnapshot({
      shows: [{ ...SHOW, directoryName: "../escape" }],
    });
    expect(plan(snapshot).skips[0]).toMatchObject({
      reason: "invalid_catalog_assignment",
      detail: "show directory escapes the managed mirror root",
    });
  });

  it("reports a target collision between two assignments deterministically", () => {
    const snapshot = buildSnapshot({
      assignments: [
        createAssignment(),
        createAssignment({ id: "assign-2", videoId: "video-2", episodeNumber: 2 }),
      ],
      videosById: new Map([
        ["video-1", createVideo()],
        ["video-2", createVideo({ id: "video-2" })],
      ]),
    });
    const result = plan(snapshot);
    expect(result.skips[0]).toMatchObject({
      videoId: "video-2",
      reason: "artifact_path_collision",
    });
    expect(result.skips[0].detail).toContain("assign-1");
  });

  it("prefers the author avatar and falls back to a thumbnail, deterministically", () => {
    const withAvatar = plan(buildSnapshot()).shows[0].artifacts[1];
    expect(withAvatar.sourceAbsolutePath).toBe(
      path.join(testPaths.avatars, "kurzgesagt.jpg")
    );

    const withoutAvatar = plan(
      buildSnapshot({
        videosById: new Map([
          ["video-1", createVideo({ authorAvatarPath: undefined })],
        ]),
      })
    ).shows[0].artifacts[1];
    expect(withoutAvatar.sourceAbsolutePath).toBe(
      path.join(testPaths.images, "Kurzgesagt", "human-origins.jpg")
    );
  });

  it("omits the poster when no artwork resolves", () => {
    const result = planMediaServerHierarchy({
      snapshot: buildSnapshot(),
      mode: "nfo",
      fileExists: (absolutePath) => absolutePath.endsWith(".mp4"),
    });
    expect(result.shows[0].artifacts).toHaveLength(1);
  });

  it("limits the plan to the requested shows", () => {
    const snapshot = buildSnapshot({
      shows: [SHOW, { ...SHOW, id: "show-2", directoryName: "Zeta", identityKey: "z" }],
    });
    expect(plan(snapshot, { showIds: ["show-2"] }).shows).toEqual([]);
    expect(
      plan(snapshot, { showIds: ["show-1"] }).shows.map((show) => show.showId)
    ).toEqual(["show-1"]);
  });

  it("is idempotent for an unchanged snapshot", () => {
    const snapshot = buildSnapshot();
    expect(plan(snapshot)).toEqual(plan(snapshot));
  });
});
