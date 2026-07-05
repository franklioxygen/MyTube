import { describe, expect, it } from "vitest";
import { buildFilenameTemplateSourceOptions } from "../../../services/subscription/helpers";

describe("subscription helpers", () => {
  it("uses the clean channel name for playlist subscription templates", () => {
    const result = buildFilenameTemplateSourceOptions({
      id: "sub-1",
      author: "Travel Playlist - Channel A",
      authorUrl: "https://youtube.com/playlist?list=PL123",
      interval: 60,
      downloadCount: 0,
      createdAt: Date.now(),
      platform: "YouTube",
      playlistId: "PL123",
      playlistTitle: "Travel Playlist",
      subscriptionType: "playlist",
      collectionId: "col-1",
    });

    expect(result).toMatchObject({
      sourceCustomName: "Channel A",
      sourceCollectionName: "Travel Playlist",
      sourceCollectionId: "PL123",
      sourceCollectionType: "playlist",
    });
  });

  it("falls back to the stored author when a playlist display name was customized", () => {
    const result = buildFilenameTemplateSourceOptions({
      id: "sub-1",
      author: "My Custom Label",
      authorUrl: "https://youtube.com/playlist?list=PL123",
      interval: 60,
      downloadCount: 0,
      createdAt: Date.now(),
      platform: "YouTube",
      playlistId: "PL123",
      playlistTitle: "Travel Playlist",
      subscriptionType: "playlist",
      collectionId: "col-1",
    });

    expect(result.sourceCustomName).toBe("My Custom Label");
    expect(result.sourceCollectionName).toBe("Travel Playlist");
  });
});

