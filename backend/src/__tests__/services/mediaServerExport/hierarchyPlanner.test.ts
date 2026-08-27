import { describe, expect, it, vi } from "vitest";
import type {
  MediaServerEpisodeAssignment,
  MediaServerShow,
  Video,
} from "../../../services/storageService/types";

const testPaths = vi.hoisted(() => {
  const path = require("path") as typeof import("path");
  const root = "/tmp/mytube-planner-fixture";

  return {
    root,
    videos: path.join(root, "videos"),
    images: path.join(root, "images"),
    imagesSmall: path.join(root, "images-small"),
    avatars: path.join(root, "avatars"),
    subtitles: path.join(root, "subtitles"),
    mediaLibrary: path.join(root, "media-library"),
  };
});

vi.mock("../../../config/paths", () => ({
  AVATARS_DIR: testPaths.avatars,
  IMAGES_DIR: testPaths.images,
  IMAGES_SMALL_DIR: testPaths.imagesSmall,
  VIDEOS_DIR: testPaths.videos,
  SUBTITLES_DIR: testPaths.subtitles,
  MEDIA_SERVER_LIBRARY_DIR: testPaths.mediaLibrary,
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { planMediaServerHierarchy } from "../../../services/mediaServerExport/hierarchyPlanner";
import type {
  MediaServerCatalogSnapshot,
  MediaServerSeason,
} from "../../../services/mediaServerExport/types";

/**
 * Everything the planner probes for is declared here, so planning runs against
 * fixture data with no real filesystem and no database.
 */
function probeFor(existingPaths: string[]) {
  const set = new Set(existingPaths);
  return { exists: (absolutePath: string) => set.has(absolutePath) };
}

function show(overrides: Partial<MediaServerShow> = {}): MediaServerShow {
  return {
    id: "show-1",
    identityKey: "youtube:channel-id:UC123",
    sourcePlatform: "youtube",
    title: "Kurzgesagt",
    description: "Optimistic nihilism.",
    directoryName: "Kurzgesagt",
    nextSeasonNumber: 3,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function assignment(
  overrides: Partial<MediaServerEpisodeAssignment> = {}
): MediaServerEpisodeAssignment {
  return {
    id: "assign-1",
    showId: "show-1",
    collectionId: "c1",
    videoId: "v1",
    seasonNumber: 1,
    episodeNumber: 1,
    exportStem: "S01E001 - Ants",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "v1",
    title: "Ants",
    sourceUrl: "https://example.com/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    videoPath: "/videos/Kurzgesagt/ants.mp4",
    date: "20260525",
    ...overrides,
  } as Video;
}

function snapshot(input: {
  shows?: MediaServerShow[];
  seasons?: MediaServerSeason[];
  assignments?: MediaServerEpisodeAssignment[];
  videos?: Video[];
}): MediaServerCatalogSnapshot {
  return {
    shows: input.shows ?? [show()],
    seasons: input.seasons ?? [
      {
        showId: "show-1",
        seasonNumber: 1,
        collectionId: "c1",
        title: "Space Time",
        plot: "Everything about spacetime.",
      },
    ],
    assignments: input.assignments ?? [assignment()],
    videosById: new Map((input.videos ?? [video()]).map((v) => [v.id, v])),
    artifactsByPath: new Map(),
  };
}

const antsMedia = `${testPaths.videos}/Kurzgesagt/ants.mp4`;

describe("mediaServerExport hierarchyPlanner", () => {
  it("plans the exact show / season / episode tree", () => {
    const plan = planMediaServerHierarchy(
      snapshot({}),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    expect(plan.skipped).toEqual([]);
    expect(plan.collisions).toEqual([]);
    expect(plan.shows).toHaveLength(1);

    const showPlan = plan.shows[0];
    expect(showPlan.rootRelativePath).toBe("Kurzgesagt");
    expect(showPlan.tvshowNfoRelativePath).toBe("Kurzgesagt/tvshow.nfo");
    expect(showPlan.posterRelativePath).toBe("Kurzgesagt/poster.jpg");
    expect(showPlan.showUniqueId).toBe("mytube:show:youtube:channel-id:UC123");
    expect(showPlan.premiered).toBe("2026-05-25");

    const seasonPlan = showPlan.seasons[0];
    expect(seasonPlan.directoryRelativePath).toBe("Kurzgesagt/Season 01");
    expect(seasonPlan.seasonNfoRelativePath).toBe(
      "Kurzgesagt/Season 01/season.nfo"
    );
    expect(seasonPlan.title).toBe("Space Time");
    expect(seasonPlan.seasonUniqueId).toBe("mytube:season:c1");

    const episodePlan = seasonPlan.episodes[0];
    expect(episodePlan.targetMediaRelativePath).toBe(
      "Kurzgesagt/Season 01/S01E001 - Ants.mp4"
    );
    expect(episodePlan.targetNfoRelativePath).toBe(
      "Kurzgesagt/Season 01/S01E001 - Ants.nfo"
    );
    expect(episodePlan.occurrenceId).toBe("mytube:episode:show-1:1:1:v1");
    // Source JSON is only planned in the richer mode.
    expect(episodePlan.targetSourceJsonRelativePath).toBeUndefined();

    expect([...plan.expectedRelativePaths].sort()).toEqual([
      "Kurzgesagt/Season 01/S01E001 - Ants.mp4",
      "Kurzgesagt/Season 01/S01E001 - Ants.nfo",
      "Kurzgesagt/Season 01/season.nfo",
      "Kurzgesagt/tvshow.nfo",
    ]);
  });

  it("plans source JSON only in nfo_and_source_json mode", () => {
    const plan = planMediaServerHierarchy(
      snapshot({}),
      { mode: "nfo_and_source_json" },
      probeFor([antsMedia])
    );

    expect(
      plan.shows[0].seasons[0].episodes[0].targetSourceJsonRelativePath
    ).toBe("Kurzgesagt/Season 01/S01E001 - Ants.info.json");
    expect(plan.expectedRelativePaths).toContain(
      "Kurzgesagt/Season 01/S01E001 - Ants.info.json"
    );
  });

  it("sorts shows by directory, seasons and episodes numerically", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        shows: [
          show({ id: "show-2", identityKey: "k2", directoryName: "Zebra" }),
          show({ id: "show-1", directoryName: "Alpha" }),
        ],
        seasons: [],
        assignments: [
          assignment({
            id: "a3",
            showId: "show-1",
            seasonNumber: 2,
            episodeNumber: 1,
            videoId: "v3",
            exportStem: "S02E001 - Third",
          }),
          assignment({
            id: "a2",
            showId: "show-1",
            seasonNumber: 1,
            episodeNumber: 9,
            videoId: "v2",
            exportStem: "S01E009 - Second",
          }),
          assignment({
            id: "a1",
            showId: "show-1",
            seasonNumber: 1,
            episodeNumber: 2,
            videoId: "v1",
            exportStem: "S01E002 - First",
          }),
          assignment({
            id: "a4",
            showId: "show-2",
            seasonNumber: 1,
            episodeNumber: 1,
            videoId: "v4",
            exportStem: "S01E001 - Zebra One",
          }),
        ],
        videos: [
          video({ id: "v1", videoPath: "/videos/a.mp4" }),
          video({ id: "v2", videoPath: "/videos/b.mp4" }),
          video({ id: "v3", videoPath: "/videos/c.mp4" }),
          video({ id: "v4", videoPath: "/videos/d.mp4" }),
        ],
      }),
      { mode: "nfo" },
      probeFor(
        ["a", "b", "c", "d"].map((name) => `${testPaths.videos}/${name}.mp4`)
      )
    );

    expect(plan.shows.map((entry) => entry.show.directoryName)).toEqual([
      "Alpha",
      "Zebra",
    ]);
    expect(plan.shows[0].seasons.map((entry) => entry.seasonNumber)).toEqual([
      1, 2,
    ]);
    expect(
      plan.shows[0].seasons[0].episodes.map(
        (entry) => entry.assignment.episodeNumber
      )
    ).toEqual([2, 9]);
  });

  it("gives one video two media targets across two seasons", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        seasons: [
          {
            showId: "show-1",
            seasonNumber: 1,
            collectionId: "c1",
            title: "One",
            plot: "",
          },
          {
            showId: "show-1",
            seasonNumber: 2,
            collectionId: "c2",
            title: "Two",
            plot: "",
          },
        ],
        assignments: [
          assignment({ id: "a1", seasonNumber: 1, exportStem: "S01E001 - Ants" }),
          assignment({
            id: "a2",
            seasonNumber: 2,
            collectionId: "c2",
            exportStem: "S02E001 - Ants",
          }),
        ],
      }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    const targets = plan.shows[0].seasons.flatMap((season) =>
      season.episodes.map((episode) => episode.targetMediaRelativePath)
    );

    expect(targets).toEqual([
      "Kurzgesagt/Season 01/S01E001 - Ants.mp4",
      "Kurzgesagt/Season 02/S02E001 - Ants.mp4",
    ]);
    // Both point at the same original file — the mirror never moves it.
    expect(
      plan.shows[0].seasons.flatMap((season) =>
        season.episodes.map((episode) => episode.sourceMediaAbsolutePath)
      )
    ).toEqual([antsMedia, antsMedia]);
  });

  it("pads season and episode tokens to a minimum, never truncating", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        seasons: [
          {
            showId: "show-1",
            seasonNumber: 12,
            collectionId: "c1",
            title: "Twelve",
            plot: "",
          },
        ],
        assignments: [
          assignment({
            seasonNumber: 12,
            episodeNumber: 1234,
            exportStem: "S12E1234 - Big",
          }),
        ],
      }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    expect(plan.shows[0].seasons[0].directoryRelativePath).toBe(
      "Kurzgesagt/Season 12"
    );
    expect(plan.shows[0].seasons[0].episodes[0].targetMediaRelativePath).toBe(
      "Kurzgesagt/Season 12/S12E1234 - Big.mp4"
    );
  });

  it("keeps the persisted stem after a title edit", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        videos: [video({ title: "A Completely Different Title" })],
      }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    expect(plan.shows[0].seasons[0].episodes[0].targetMediaRelativePath).toBe(
      "Kurzgesagt/Season 01/S01E001 - Ants.mp4"
    );
  });

  describe("skips", () => {
    const cases: Array<[string, Partial<Video>, string]> = [
      ["cloud paths", { videoPath: "cloud:remote/a.mp4" }, "cloud_path"],
      ["mount paths", { videoPath: "mount:/media/a.mp4" }, "mount_path"],
      [
        "external http paths",
        { videoPath: "https://example.com/a.mp4" },
        "external_http_path",
      ],
      ["missing paths", { videoPath: undefined }, "no_local_video_path"],
      ["audio media", { mediaType: "audio" }, "audio_media"],
    ];

    for (const [label, overrides, reason] of cases) {
      it(`skips ${label} with a typed reason`, () => {
        const plan = planMediaServerHierarchy(
          snapshot({ videos: [video(overrides)] }),
          { mode: "nfo" },
          probeFor([antsMedia])
        );

        expect(plan.shows).toHaveLength(0);
        expect(plan.skipped).toHaveLength(1);
        expect(plan.skipped[0].reason).toBe(reason);
        expect(plan.skipped[0].assignmentId).toBe("assign-1");
      });
    }

    it("skips a video whose file is gone", () => {
      const plan = planMediaServerHierarchy(
        snapshot({}),
        { mode: "nfo" },
        probeFor([])
      );

      expect(plan.skipped[0].reason).toBe("video_file_missing");
    });

    it("reports an assignment whose video row is missing", () => {
      const plan = planMediaServerHierarchy(
        snapshot({ videos: [] }),
        { mode: "nfo" },
        probeFor([antsMedia])
      );

      expect(plan.skipped[0].reason).toBe("invalid_catalog_assignment");
    });

    it("reports an assignment whose show row is missing", () => {
      const plan = planMediaServerHierarchy(
        snapshot({ shows: [] }),
        { mode: "nfo" },
        probeFor([antsMedia])
      );

      expect(plan.skipped.some((s) => s.reason === "invalid_catalog_assignment")).toBe(
        true
      );
      expect(plan.shows).toHaveLength(0);
    });

    it("rejects structurally invalid season and episode numbers", () => {
      for (const overrides of [
        { seasonNumber: -1 },
        { episodeNumber: 0 },
        { episodeNumber: 1.5 },
      ]) {
        const plan = planMediaServerHierarchy(
          snapshot({ assignments: [assignment(overrides)] }),
          { mode: "nfo" },
          probeFor([antsMedia])
        );

        expect(plan.skipped[0].reason).toBe("invalid_catalog_assignment");
      }
    });
  });

  it("never lets a stem or directory escape the mirror root", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        shows: [show({ directoryName: "../../escape" })],
        assignments: [assignment({ exportStem: "../../../etc/passwd" })],
      }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    for (const relativePath of plan.expectedRelativePaths) {
      expect(relativePath.startsWith("..")).toBe(false);
      expect(relativePath).not.toContain("../");
    }
    for (const showPlan of plan.shows) {
      expect(showPlan.rootAbsolutePath.startsWith(testPaths.mediaLibrary)).toBe(
        true
      );
      for (const season of showPlan.seasons) {
        for (const episode of season.episodes) {
          expect(
            episode.targetMediaAbsolutePath.startsWith(testPaths.mediaLibrary)
          ).toBe(true);
        }
      }
    }
  });

  it("reports a target collision with both assignment ids", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        assignments: [
          assignment({ id: "a1", episodeNumber: 1, videoId: "v1" }),
          // Same stem, different occurrence — the DB unique index normally
          // prevents this, so reaching the planner means catalog corruption.
          assignment({ id: "a2", episodeNumber: 2, videoId: "v2" }),
        ],
        videos: [video({ id: "v1" }), video({ id: "v2" })],
      }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0].relativePath).toBe(
      "Kurzgesagt/Season 01/S01E001 - Ants.mp4"
    );
    expect(plan.collisions[0].assignmentIds).toEqual(["a1", "a2"]);
    expect(plan.skipped[0].reason).toBe("artifact_path_collision");
    // The first claimant still plans; only the duplicate is dropped.
    expect(plan.shows[0].seasons[0].episodes).toHaveLength(1);
  });

  describe("artwork", () => {
    it("prefers the persisted poster, then avatars, then thumbnails", () => {
      const persisted = `${testPaths.images}/persisted.jpg`;
      const avatar = `${testPaths.avatars}/avatar.jpg`;
      const thumbnail = `${testPaths.images}/thumb.jpg`;

      const withPersisted = planMediaServerHierarchy(
        snapshot({
          shows: [show({ posterSourcePath: "/images/persisted.jpg" })],
          videos: [
            video({
              authorAvatarPath: "/avatars/avatar.jpg",
              thumbnailPath: "/images/thumb.jpg",
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, persisted, avatar, thumbnail])
      );
      expect(withPersisted.shows[0].posterSourceAbsolutePath).toBe(persisted);

      const withAvatar = planMediaServerHierarchy(
        snapshot({
          videos: [
            video({
              authorAvatarPath: "/avatars/avatar.jpg",
              thumbnailPath: "/images/thumb.jpg",
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, avatar, thumbnail])
      );
      expect(withAvatar.shows[0].posterSourceAbsolutePath).toBe(avatar);

      const withThumbnail = planMediaServerHierarchy(
        snapshot({ videos: [video({ thumbnailPath: "/images/thumb.jpg" })] }),
        { mode: "nfo" },
        probeFor([antsMedia, thumbnail])
      );
      expect(withThumbnail.shows[0].posterSourceAbsolutePath).toBe(thumbnail);
    });

    /**
     * A drama uploaded by a third-party channel must not be posterised with the
     * uploader's avatar — the complaint this whole feature exists to fix.
     */
    it("skips the author avatar for a collection show", () => {
      const avatar = `${testPaths.avatars}/avatar.jpg`;
      const thumbnail = `${testPaths.images}/thumb.jpg`;

      const plan = planMediaServerHierarchy(
        snapshot({
          shows: [show({ sourceCollectionId: "c1" })],
          videos: [
            video({
              authorAvatarPath: "/avatars/avatar.jpg",
              thumbnailPath: "/images/thumb.jpg",
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, avatar, thumbnail])
      );

      expect(plan.shows[0].posterSourceAbsolutePath).toBe(thumbnail);
    });

    it("still prefers a persisted poster for a collection show", () => {
      const persisted = `${testPaths.images}/persisted.jpg`;
      const thumbnail = `${testPaths.images}/thumb.jpg`;

      const plan = planMediaServerHierarchy(
        snapshot({
          shows: [
            show({
              sourceCollectionId: "c1",
              posterSourcePath: "/images/persisted.jpg",
            }),
          ],
          videos: [video({ thumbnailPath: "/images/thumb.jpg" })],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, persisted, thumbnail])
      );

      expect(plan.shows[0].posterSourceAbsolutePath).toBe(persisted);
    });

    it("keeps avatar fallback for author shows", () => {
      // Regression: the collection-show branch must not remove this globally.
      const avatar = `${testPaths.avatars}/avatar.jpg`;
      const thumbnail = `${testPaths.images}/thumb.jpg`;

      const plan = planMediaServerHierarchy(
        snapshot({
          videos: [
            video({
              authorAvatarPath: "/avatars/avatar.jpg",
              thumbnailPath: "/images/thumb.jpg",
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, avatar, thumbnail])
      );

      expect(plan.shows[0].posterSourceAbsolutePath).toBe(avatar);
    });

    it("plans no poster artifact when no artwork resolves", () => {
      const plan = planMediaServerHierarchy(
        snapshot({}),
        { mode: "nfo" },
        probeFor([antsMedia])
      );

      expect(plan.shows[0].posterSourceAbsolutePath).toBeUndefined();
      expect(plan.expectedRelativePaths).not.toContain("Kurzgesagt/poster.jpg");
    });

    it("picks artwork deterministically by video id", () => {
      const avatarA = `${testPaths.avatars}/a.jpg`;
      const avatarB = `${testPaths.avatars}/b.jpg`;
      const videos = [
        video({ id: "v2", authorAvatarPath: "/avatars/b.jpg" }),
        video({ id: "v1", authorAvatarPath: "/avatars/a.jpg" }),
      ];

      const plan = planMediaServerHierarchy(
        snapshot({
          assignments: [
            assignment({ id: "a1", videoId: "v1", episodeNumber: 1, exportStem: "S01E001 - A" }),
            assignment({ id: "a2", videoId: "v2", episodeNumber: 2, exportStem: "S01E002 - B" }),
          ],
          videos,
        }),
        { mode: "nfo" },
        probeFor([antsMedia, avatarA, avatarB])
      );

      expect(plan.shows[0].posterSourceAbsolutePath).toBe(avatarA);
    });
  });

  describe("subtitles", () => {
    it("names subtitles <stem>.<language>.<ext>", () => {
      const subtitlePath = `${testPaths.subtitles}/ants.en.vtt`;
      const plan = planMediaServerHierarchy(
        snapshot({
          videos: [
            video({
              subtitles: [
                {
                  language: "en",
                  filename: "ants.en.vtt",
                  path: "/subtitles/ants.en.vtt",
                },
              ],
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, subtitlePath])
      );

      expect(plan.shows[0].seasons[0].episodes[0].subtitles).toEqual([
        {
          language: "en",
          sourceAbsolutePath: subtitlePath,
          targetAbsolutePath: `${testPaths.mediaLibrary}/Kurzgesagt/Season 01/S01E001 - Ants.en.vtt`,
          targetRelativePath: "Kurzgesagt/Season 01/S01E001 - Ants.en.vtt",
        },
      ]);
    });

    it("drops subtitles with an unsupported extension or missing file", () => {
      const plan = planMediaServerHierarchy(
        snapshot({
          videos: [
            video({
              subtitles: [
                { language: "en", filename: "a.exe", path: "/subtitles/a.exe" },
                { language: "fr", filename: "b.vtt", path: "/subtitles/b.vtt" },
              ],
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, `${testPaths.subtitles}/a.exe`])
      );

      expect(plan.shows[0].seasons[0].episodes[0].subtitles).toEqual([]);
    });

    it("allowlists the language token rather than trusting it as a path", () => {
      const subtitlePath = `${testPaths.subtitles}/x.vtt`;
      const plan = planMediaServerHierarchy(
        snapshot({
          videos: [
            video({
              subtitles: [
                {
                  language: "../../en",
                  filename: "x.vtt",
                  path: "/subtitles/x.vtt",
                },
              ],
            }),
          ],
        }),
        { mode: "nfo" },
        probeFor([antsMedia, subtitlePath])
      );

      const [subtitle] = plan.shows[0].seasons[0].episodes[0].subtitles;
      expect(subtitle.language).toBe("en");
      expect(subtitle.targetRelativePath).toBe(
        "Kurzgesagt/Season 01/S01E001 - Ants.en.vtt"
      );
    });
  });

  it("plans nothing for a show whose every episode was skipped", () => {
    const plan = planMediaServerHierarchy(
      snapshot({ videos: [video({ mediaType: "audio" })] }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    expect(plan.shows).toHaveLength(0);
    expect(plan.expectedRelativePaths.size).toBe(0);
  });

  it("restricts planning to the requested show scope", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        shows: [
          show({ id: "show-1", directoryName: "Alpha" }),
          show({ id: "show-2", identityKey: "k2", directoryName: "Beta" }),
        ],
        seasons: [],
        assignments: [
          assignment({ id: "a1", showId: "show-1", videoId: "v1" }),
          assignment({
            id: "a2",
            showId: "show-2",
            videoId: "v2",
            exportStem: "S01E001 - Beta",
          }),
        ],
        videos: [
          video({ id: "v1", videoPath: "/videos/a.mp4" }),
          video({ id: "v2", videoPath: "/videos/b.mp4" }),
        ],
      }),
      { mode: "nfo", showIds: new Set(["show-2"]) },
      probeFor([`${testPaths.videos}/a.mp4`, `${testPaths.videos}/b.mp4`])
    );

    expect(plan.shows.map((entry) => entry.show.id)).toEqual(["show-2"]);
  });

  it("prefers a confirmed TMDB premiere date over the earliest episode date", () => {
    const plan = planMediaServerHierarchy(
      snapshot({
        shows: [show({ sourceCollectionId: "c1", premiered: "2017-03-28" })],
      }),
      { mode: "nfo" },
      probeFor([antsMedia])
    );

    // The episode uploaded 2026-05-25 must not override the real air date.
    expect(plan.shows[0].premiered).toBe("2017-03-28");
  });

  it("is deterministic across repeated runs", () => {
    const build = () =>
      planMediaServerHierarchy(snapshot({}), { mode: "nfo" }, probeFor([antsMedia]));

    expect([...build().expectedRelativePaths]).toEqual([
      ...build().expectedRelativePaths,
    ]);
  });
});
