import { describe, expect, it, vi } from "vitest";
import type { Collection, Video } from "../../../services/storageService/types";

vi.mock("../../../services/storageService/videos", () => ({
  getVideos: () => [],
  getVideoById: () => undefined,
}));

vi.mock("../../../services/storageService/collectionRepository", () => ({
  getCollections: () => [],
}));

import { previewMediaServerExportScope } from "../../../services/mediaServerExport/scopePreview";

function video(overrides: Partial<Video>): Video {
  return {
    id: "v1",
    title: "Episode",
    author: "Kurzgesagt",
    source: "youtube",
    videoPath: "/videos/a.mp4",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Video;
}

function collection(overrides: Partial<Collection>): Collection {
  return {
    id: "c1",
    name: "Playlist",
    title: "Playlist",
    videos: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Collection;
}

/**
 * The projection is shown to a user deciding whether to trigger a run that can
 * add dozens of shows to their media server, so it has to count the same way
 * the reconciler allocates - one show per channel identity, not per video and
 * not per author string.
 */
describe("previewMediaServerExportScope", () => {
  it("counts only local videos", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", videoPath: "/videos/a.mp4" }),
        video({ id: "v2", videoPath: undefined }),
      ],
      collections: [],
    });

    expect(scope.videoCount).toBe(1);
  });

  /**
   * planEpisode deterministically skips anything that is not a managed
   * /videos path, and the reconciler never assigns audio-only media, so
   * counting these inflated the confirmation with entries the rebuild cannot
   * materialize.
   */
  it("excludes nonlocal path kinds the planner would skip", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", videoPath: "/videos/a.mp4" }),
        video({ id: "v2", videoPath: "cloud:abc123" }),
        video({ id: "v3", videoPath: "mount:/nas/b.mp4" }),
        video({ id: "v4", videoPath: "https://example.com/c.mp4" }),
        video({ id: "v5", videoPath: "http://example.com/d.mp4" }),
      ],
      collections: [],
    });

    expect(scope.videoCount).toBe(1);
  });

  it("excludes audio-only media, which never receives an assignment", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1" }),
        video({ id: "v2", mediaType: "audio" } as Partial<Video>),
      ],
      collections: [],
    });

    expect(scope.videoCount).toBe(1);
  });

  it("does not count a show for a channel whose only video is nonlocal", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", channelUrl: "https://youtube.com/@kurzgesagt" }),
        video({
          id: "v2",
          author: "Cloud Only",
          channelUrl: "https://youtube.com/@cloudonly",
          videoPath: "cloud:abc123",
        }),
      ],
      collections: [],
    });

    expect(scope.videoCount).toBe(1);
    expect(scope.showCount).toBe(1);
  });

  it("collapses one channel's videos into a single show", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", channelUrl: "https://youtube.com/@kurzgesagt" }),
        video({ id: "v2", channelUrl: "https://youtube.com/@kurzgesagt" }),
        video({ id: "v3", channelUrl: "https://youtube.com/@kurzgesagt" }),
      ],
      collections: [],
    });

    expect(scope.videoCount).toBe(3);
    expect(scope.showCount).toBe(1);
  });

  it("counts separate channels separately", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", author: "A", channelUrl: "https://youtube.com/@a" }),
        video({ id: "v2", author: "B", channelUrl: "https://youtube.com/@b" }),
      ],
      collections: [],
    });

    expect(scope.showCount).toBe(2);
  });

  it("counts a marked collection as its own show", () => {
    const scope = previewMediaServerExportScope({
      videos: [video({ id: "v1", author: "CCTV" })],
      collections: [collection({ id: "c1", videos: ["v1"], exportAsShow: 1 })],
    });

    // One show total: the collection. The author show is not created, because
    // the only video belongs to the marked collection.
    expect(scope.showCount).toBe(1);
    expect(scope.collectionShowCount).toBe(1);
  });

  it("keeps the author show when only some videos are in a marked collection", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", author: "CCTV", channelUrl: "https://youtube.com/@cctv" }),
        video({ id: "v2", author: "CCTV", channelUrl: "https://youtube.com/@cctv" }),
      ],
      collections: [collection({ id: "c1", videos: ["v1"], exportAsShow: 1 })],
    });

    // The collection show plus the author show that still holds v2.
    expect(scope.showCount).toBe(2);
    expect(scope.collectionShowCount).toBe(1);
  });

  it("does not count an unmarked collection as a show", () => {
    const scope = previewMediaServerExportScope({
      videos: [video({ id: "v1", channelUrl: "https://youtube.com/@a" })],
      collections: [collection({ id: "c1", videos: ["v1"], exportAsShow: 0 })],
    });

    expect(scope.showCount).toBe(1);
    expect(scope.collectionShowCount).toBe(0);
  });

  /**
   * The reconciler does not stop at identity keys: a weaker author-fallback
   * identity joins a stronger show of the same title. Counting raw keys
   * therefore promised more folders than a rebuild actually creates.
   */
  it("merges an author-only video into the channel show of the same name", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", author: "News", channelUrl: "https://youtube.com/@news" }),
        video({ id: "v2", author: "News", channelUrl: undefined }),
      ],
      collections: [],
    });

    expect(scope.videoCount).toBe(2);
    expect(scope.showCount).toBe(1);
  });

  it("does not merge when the stronger title is ambiguous", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", author: "News", channelUrl: "https://youtube.com/@news-one" }),
        video({ id: "v2", author: "News", channelUrl: "https://youtube.com/@news-two" }),
        // Two strong candidates share this title, so the reconciler refuses to
        // pick one and allocates a third show. The preview must agree.
        video({ id: "v3", author: "News", channelUrl: undefined }),
      ],
      collections: [],
    });

    expect(scope.showCount).toBe(3);
  });

  it("keeps distinct author names apart", () => {
    const scope = previewMediaServerExportScope({
      videos: [
        video({ id: "v1", author: "News", channelUrl: "https://youtube.com/@news" }),
        video({ id: "v2", author: "Sports", channelUrl: undefined }),
      ],
      collections: [],
    });

    expect(scope.showCount).toBe(2);
  });

  it("reports an empty library as zero rather than throwing", () => {
    const scope = previewMediaServerExportScope({ videos: [], collections: [] });

    expect(scope).toEqual({
      videoCount: 0,
      showCount: 0,
      collectionShowCount: 0,
    });
  });
});
