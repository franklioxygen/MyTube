import { describe, expect, it } from "vitest";
import { Collection, Video } from "../../types";
import { DEFAULT_WEIGHTS, getRecommendations } from "../recommendations";

describe("recommendations", () => {
  const createMockVideo = (id: string, overrides?: Partial<Video>): Video => ({
    id,
    title: `Video ${id}`,
    author: `Author ${id}`,
    videoPath: `/videos/${id}.mp4`,
    date: "20230101",
    duration: "10:00",
    viewCount: 100,
    width: 1920,
    height: 1080,
    ext: "mp4",
    format_id: "137",
    format_note: "1080p",
    filesize: 1000,
    fps: 30,
    url: `http://example.com/video${id}.mp4`,
    source: "youtube",
    sourceUrl: `http://example.com/video${id}`,
    addedAt: "2023-01-01",
    ...overrides,
  });

  const createMockCollection = (
    id: string,
    videoIds: string[]
  ): Collection => ({
    id,
    name: `Collection ${id}`,
    videos: videoIds,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  });

  describe("getRecommendations", () => {
    it("should exclude current video from recommendations", () => {
      const currentVideo = createMockVideo("1");
      const allVideos = [
        currentVideo,
        createMockVideo("2"),
        createMockVideo("3"),
      ];

      const recommendations = getRecommendations({
        currentVideo,
        allVideos,
        collections: [],
      });

      expect(recommendations).not.toContainEqual(currentVideo);
      expect(recommendations.length).toBe(2);
    });

    it("should return empty array when only one video exists", () => {
      const currentVideo = createMockVideo("1");
      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo],
        collections: [],
      });

      expect(recommendations).toEqual([]);
    });

    it("should prioritize videos in same collection", () => {
      const currentVideo = createMockVideo("1");
      const sameCollectionVideo = createMockVideo("2");
      const differentVideo = createMockVideo("3");

      const collections = [createMockCollection("col1", ["1", "2"])];

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, sameCollectionVideo, differentVideo],
        collections,
      });

      expect(recommendations[0]).toEqual(sameCollectionVideo);
    });

    it("should prioritize videos with same author", () => {
      const currentVideo = createMockVideo("1", { author: "Author A" });
      const sameAuthorVideo = createMockVideo("2", { author: "Author A" });
      const differentAuthorVideo = createMockVideo("3", { author: "Author B" });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, sameAuthorVideo, differentAuthorVideo],
        collections: [],
      });

      // Same author video should be ranked higher
      const sameAuthorIndex = recommendations.findIndex((v) => v.id === "2");
      const differentAuthorIndex = recommendations.findIndex(
        (v) => v.id === "3"
      );
      expect(sameAuthorIndex).toBeLessThan(differentAuthorIndex);
    });

    it("should prioritize videos with matching tags", () => {
      const currentVideo = createMockVideo("1", { tags: ["tag1", "tag2"] });
      const matchingTagsVideo = createMockVideo("2", {
        tags: ["tag1", "tag3"],
      });
      const noTagsVideo = createMockVideo("3", { tags: [] });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, matchingTagsVideo, noTagsVideo],
        collections: [],
      });

      // Video with matching tags should be ranked higher
      const matchingIndex = recommendations.findIndex((v) => v.id === "2");
      const noTagsIndex = recommendations.findIndex((v) => v.id === "3");
      expect(matchingIndex).toBeLessThan(noTagsIndex);
    });

    it("should match tags case-insensitively", () => {
      const currentVideo = createMockVideo("1", { tags: ["React", " Tutorial "] });
      const matchingTagsVideo = createMockVideo("2", {
        tags: ["react", "frontend"],
      });
      const noTagsVideo = createMockVideo("3", { tags: ["cooking"] });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, matchingTagsVideo, noTagsVideo],
        collections: [],
      });

      expect(recommendations[0]).toEqual(matchingTagsVideo);
    });

    it("should prioritize same source and similar title for non-collection videos", () => {
      const currentVideo = createMockVideo("1", {
        title: "React Router Advanced Tutorial",
        source: "youtube",
        viewCount: 5,
      });
      const similarVideo = createMockVideo("2", {
        title: "Advanced React Router Patterns",
        source: "youtube",
        viewCount: 0,
      });
      const popularDifferentVideo = createMockVideo("3", {
        title: "Completely Different Topic",
        source: "bilibili",
        viewCount: 10000,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, similarVideo, popularDifferentVideo],
        collections: [],
      });

      expect(recommendations[0]).toEqual(similarVideo);
    });

    it("should prefer unwatched videos over completed videos when relevance is comparable", () => {
      const currentVideo = createMockVideo("1", {
        title: "TypeScript Basics",
        duration: "10:00",
        source: "youtube",
      });
      const unwatchedVideo = createMockVideo("2", {
        title: "TypeScript Generics",
        duration: "10:00",
        source: "youtube",
        viewCount: 0,
        progress: 0,
      });
      const completedVideo = createMockVideo("3", {
        title: "TypeScript Interfaces",
        duration: "10:00",
        source: "youtube",
        viewCount: 20,
        progress: 590,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, completedVideo, unwatchedVideo],
        collections: [],
      });

      expect(recommendations[0]).toEqual(unwatchedVideo);
    });

    it("should prioritize resumable in-progress videos over already completed videos", () => {
      const currentVideo = createMockVideo("1", {
        title: "CSS Layout",
        duration: "20:00",
      });
      const inProgressVideo = createMockVideo("2", {
        title: "CSS Grid Layout",
        duration: "20:00",
        progress: 300,
        viewCount: 1,
      });
      const completedVideo = createMockVideo("3", {
        title: "CSS Flex Layout",
        duration: "20:00",
        progress: 1190,
        viewCount: 10,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, completedVideo, inProgressVideo],
        collections: [],
      });

      expect(recommendations[0]).toEqual(inProgressVideo);
    });

    it("should not reward recently completed videos during the re-watch cooldown", () => {
      const now = Date.now();
      const currentVideo = createMockVideo("1");
      const recentlyPlayed = createMockVideo("2", {
        title: "Video Topic",
        duration: "10:00",
        progress: 600,
        viewCount: 5,
        lastPlayedAt: now - 1000 * 60 * 60, // 1 hour ago
      });
      const neverPlayed = createMockVideo("3", {
        title: "Video Topic",
        duration: "10:00",
        progress: 0,
        viewCount: 0,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, recentlyPlayed, neverPlayed],
        collections: [],
      });

      const recentIndex = recommendations.findIndex((v) => v.id === "2");
      const neverPlayedIndex = recommendations.findIndex((v) => v.id === "3");
      expect(neverPlayedIndex).toBeLessThan(recentIndex);
    });

    it("should use rating affinity when relevance is comparable", () => {
      const currentVideo = createMockVideo("1");
      const highRated = createMockVideo("2", {
        title: "Comparable Topic",
        rating: 5,
        viewCount: 0,
      });
      const lowRated = createMockVideo("3", {
        title: "Comparable Topic",
        rating: 2,
        viewCount: 0,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, lowRated, highRated],
        collections: [],
      });

      expect(recommendations[0]).toEqual(highRated);
    });

    it("should prioritize exact next episodes using part numbers", () => {
      const currentVideo = createMockVideo("1", {
        seriesTitle: "Course",
        partNumber: 1,
        totalParts: 3,
      });
      const nextEpisode = createMockVideo("2", {
        seriesTitle: "Course",
        partNumber: 2,
        totalParts: 3,
      });
      const otherVideo = createMockVideo("3", {
        seriesTitle: "Course",
        partNumber: 3,
        totalParts: 3,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, otherVideo, nextEpisode],
        collections: [],
      });

      expect(recommendations[0]).toEqual(nextEpisode);
    });

    it("should scope filename-adjacent sequence recommendations to the same author and title stem", () => {
      const currentVideo = createMockVideo("1", {
        author: "Author A",
        title: "Course 001",
        videoFilename: "course_001.mp4",
      });
      const sameAuthorNext = createMockVideo("2", {
        author: "Author A",
        title: "Course 002",
        videoFilename: "course_002.mp4",
      });
      const globalAlphabeticNext = createMockVideo("3", {
        author: "Author B",
        title: "Course 001b",
        videoFilename: "course_001b.mp4",
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, globalAlphabeticNext, sameAuthorNext],
        collections: [],
      });

      expect(recommendations[0]).toEqual(sameAuthorNext);
      expect(recommendations[0]).not.toEqual(globalAlphabeticNext);
    });

    it("should prioritize remaining videos from the source collection queue", () => {
      const currentVideo = createMockVideo("1", {
        videoFilename: "episode_001.mp4",
      });
      const nextCollectionVideo = createMockVideo("2", {
        videoFilename: "episode_002.mp4",
      });
      const laterCollectionVideo = createMockVideo("3", {
        videoFilename: "episode_003.mp4",
      });
      const globalSequenceVideo = createMockVideo("4", {
        videoFilename: "episode_001b.mp4",
        viewCount: 10000,
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [
          currentVideo,
          nextCollectionVideo,
          laterCollectionVideo,
          globalSequenceVideo,
        ],
        collections: [createMockCollection("col1", ["1", "2", "3"])],
        sourceCollectionId: "col1",
      });

      expect(recommendations.slice(0, 2)).toEqual([
        nextCollectionVideo,
        laterCollectionVideo,
      ]);
    });

    it("should use the supplied playback queue order before falling back", () => {
      const currentVideo = createMockVideo("1");
      const firstQueuedVideo = createMockVideo("3");
      const secondQueuedVideo = createMockVideo("2");
      const fallbackVideo = createMockVideo("4", { viewCount: 10000 });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [
          currentVideo,
          firstQueuedVideo,
          secondQueuedVideo,
          fallbackVideo,
        ],
        collections: [createMockCollection("col1", ["1", "2", "3"])],
        sourceCollectionId: "col1",
        playbackQueueVideoIds: ["1", "3", "2"],
      });

      expect(recommendations.slice(0, 2)).toEqual([
        firstQueuedVideo,
        secondQueuedVideo,
      ]);
      expect(recommendations).toContain(fallbackVideo);
    });

    it("should use custom weights when provided", () => {
      const currentVideo = createMockVideo("1", { author: "Author A" });
      const sameAuthorVideo = createMockVideo("2", { author: "Author A" });
      const differentAuthorVideo = createMockVideo("3", {
        author: "Author B",
        viewCount: 10000,
      });

      // Give author weight 0 and frequency weight 1
      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, sameAuthorVideo, differentAuthorVideo],
        collections: [],
        weights: {
          author: 0,
          frequency: 1,
        },
      });

      // With author weight 0 and frequency weight 1, higher view count should win
      expect(recommendations[0]).toEqual(differentAuthorVideo);
    });

    it("should handle videos with same series title", () => {
      const currentVideo = createMockVideo("1", { seriesTitle: "Series 1" });
      const sameSeriesVideo = createMockVideo("2", { seriesTitle: "Series 1" });
      const differentSeriesVideo = createMockVideo("3", {
        seriesTitle: "Series 2",
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, sameSeriesVideo, differentSeriesVideo],
        collections: [],
      });

      // Same series should be ranked higher
      expect(recommendations[0]).toEqual(sameSeriesVideo);
    });

    it("should prefer the next unwatched video by shared collection order", () => {
      const currentVideo = createMockVideo("1");
      const nextCollectionVideo = createMockVideo("2", { viewCount: 0 });
      const laterCollectionVideo = createMockVideo("3", { viewCount: 0 });
      const outsideVideo = createMockVideo("4", { rating: 5 });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [
          currentVideo,
          laterCollectionVideo,
          outsideVideo,
          nextCollectionVideo,
        ],
        collections: [createMockCollection("col1", ["1", "2", "3"])],
      });

      expect(recommendations[0]).toEqual(nextCollectionVideo);
    });

    it("should apply author diversity caps across the slate", () => {
      const currentVideo = createMockVideo("1", {
        author: "Author A",
        title: "Current Topic",
      });
      const sameAuthorVideos = Array.from({ length: 5 }, (_, index) =>
        createMockVideo(`${index + 2}`, {
          author: "Author A",
          title: `Same Author ${index}`,
          addedAt: `2023-01-0${index + 2}`,
        })
      );
      const differentAuthorVideo = createMockVideo("7", {
        author: "Author B",
        title: "Different Author",
        addedAt: "2023-01-08",
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, ...sameAuthorVideos, differentAuthorVideo],
        collections: [],
      });

      expect(recommendations.slice(0, 4)).toContain(differentAuthorVideo);
      expect(
        recommendations.filter(video => video.author === "Author A").length
      ).toBeLessThanOrEqual(3);
    });

    it("should boost co-play neighbors when recommendation signals are available", () => {
      const currentVideo = createMockVideo("1", {
        title: "Current Topic",
        source: "youtube",
      });
      const coPlayVideo = createMockVideo("2", {
        title: "Related Topic",
        source: "youtube",
      });
      const comparableVideo = createMockVideo("3", {
        title: "Related Topic",
        source: "youtube",
      });

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: [currentVideo, comparableVideo, coPlayVideo],
        collections: [],
        signals: {
          computedAt: Date.now(),
          perVideo: {
            "1": {
              ws: 120,
              cr: 1,
              ar: 0,
              lf: null,
              rw: 0,
              nb: [["2", 0.8]],
            },
          },
          authorAffinity: {},
          tagAffinity: {},
          durationBands: [0, 1, 0, 0],
        },
      });

      expect(recommendations[0]).toEqual(coPlayVideo);
    });

    it("should return all candidates when no specific criteria match", () => {
      const currentVideo = createMockVideo("1");
      const videos = [
        currentVideo,
        createMockVideo("2"),
        createMockVideo("3"),
        createMockVideo("4"),
      ];

      const recommendations = getRecommendations({
        currentVideo,
        allVideos: videos,
        collections: [],
      });

      expect(recommendations.length).toBe(3);
      expect(recommendations.every((v) => v.id !== "1")).toBe(true);
    });
  });

  describe("DEFAULT_WEIGHTS", () => {
    it("should have all required weight properties", () => {
      expect(DEFAULT_WEIGHTS).toHaveProperty("recency");
      expect(DEFAULT_WEIGHTS).toHaveProperty("frequency");
      expect(DEFAULT_WEIGHTS).toHaveProperty("collection");
      expect(DEFAULT_WEIGHTS).toHaveProperty("tags");
      expect(DEFAULT_WEIGHTS).toHaveProperty("author");
      expect(DEFAULT_WEIGHTS).toHaveProperty("filename");
      expect(DEFAULT_WEIGHTS).toHaveProperty("sequence");
      expect(DEFAULT_WEIGHTS).toHaveProperty("rating");
    });

    it("should have numeric weight values", () => {
      Object.values(DEFAULT_WEIGHTS).forEach((weight) => {
        expect(typeof weight).toBe("number");
        expect(weight).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
