import { describe, expect, it } from "vitest";
import { Video } from "../../types";
import {
  buildAuthorAvatarPathMap,
  withCanonicalAuthorAvatar,
  withCanonicalAuthorAvatars,
} from "../authorAvatar";

const createVideo = (overrides: Partial<Video>): Video =>
  ({
    id: "base",
    title: "Video",
    author: "Author",
    date: "20260101",
    source: "youtube",
    sourceUrl: "https://example.com/watch",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as Video;

describe('custom avatar isolation', () => {
  it('never shares custom avatars or replaces them with automatic channel avatars', () => {
    const common = { source: 'youtube' as const, channelUrl: 'https://youtube.com/channel/abc' };
    const custom = createVideo({ ...common, author: 'Alice', authorAvatarPath: '/avatars/custom-a.jpg', authorAvatarOrigin: 'custom' });
    const other = createVideo({ ...common, author: 'alice' });
    const automatic = createVideo({ ...common, author: 'Old Name', authorAvatarPath: '/avatars/auto.jpg' });
    expect(withCanonicalAuthorAvatars([custom, other])[1].authorAvatarPath).toBeUndefined();
    const result = withCanonicalAuthorAvatars([automatic, custom, other]);
    expect(result[1].authorAvatarPath).toBe('/avatars/custom-a.jpg');
    expect(result[2].authorAvatarPath).toBe('/avatars/auto.jpg');
    expect(withCanonicalAuthorAvatar(custom, buildAuthorAvatarPathMap([automatic])).authorAvatarPath).toBe('/avatars/custom-a.jpg');
  });
});

describe("authorAvatar", () => {
  it("shares the first available avatar across same-source author rows", () => {
    const videos = [
      createVideo({ id: "missing", author: "王志安" }),
      createVideo({
        id: "avatar",
        author: " 王志安 ",
        authorAvatarPath: "/avatars/youtube-wang.jpg",
      }),
    ];

    expect(withCanonicalAuthorAvatars(videos)).toEqual([
      expect.objectContaining({
        id: "missing",
        authorAvatarPath: "/avatars/youtube-wang.jpg",
        authorAvatarFilename: "youtube-wang.jpg",
      }),
      expect.objectContaining({
        id: "avatar",
        authorAvatarPath: "/avatars/youtube-wang.jpg",
      }),
    ]);
  });

  it("does not share avatars across different sources with the same author name", () => {
    const videos = [
      createVideo({
        id: "youtube",
        author: "Same Name",
        source: "youtube",
        authorAvatarPath: "/avatars/youtube-same.jpg",
      }),
      createVideo({
        id: "bilibili",
        author: "Same Name",
        source: "bilibili",
      }),
    ];

    expect(withCanonicalAuthorAvatars(videos)[1]).not.toHaveProperty(
      "authorAvatarPath"
    );
  });

  it("normalizes a fetched detail row using the list avatar map", () => {
    const listVideos = [
      createVideo({
        id: "list",
        author: "Author",
        channelUrl: "https://www.youtube.com/channel/abc/",
        authorAvatarPath: "/avatars/channel-avatar.jpg",
      }),
    ];
    const detailVideo = createVideo({
      id: "detail",
      author: "Author",
      channelUrl: "https://www.youtube.com/channel/abc?view=videos",
    });

    const avatarPathByKey = buildAuthorAvatarPathMap(listVideos);

    expect(withCanonicalAuthorAvatar(detailVideo, avatarPathByKey)).toEqual(
      expect.objectContaining({
        authorAvatarPath: "/avatars/channel-avatar.jpg",
        authorAvatarFilename: "channel-avatar.jpg",
      })
    );
  });

  it("does not fall back to author-name avatars for a different channel URL", () => {
    const videos = [
      createVideo({
        id: "channel-with-avatar",
        author: "Same Name",
        channelUrl: "https://www.youtube.com/channel/one",
        authorAvatarPath: "/avatars/channel-one.jpg",
      }),
      createVideo({
        id: "different-channel",
        author: "Same Name",
        channelUrl: "https://www.youtube.com/channel/two",
      }),
    ];

    expect(withCanonicalAuthorAvatars(videos)[1]).not.toHaveProperty(
      "authorAvatarPath"
    );
  });
});
