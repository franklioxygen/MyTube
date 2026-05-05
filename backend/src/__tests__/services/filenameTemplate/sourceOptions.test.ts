import { beforeEach, describe, expect, it, vi } from "vitest";

const getCollectionsMock = vi.fn();
const subscriptionsRowsMock = {
  current: [] as Array<Record<string, unknown>>,
};

vi.mock("../../../services/storageService", () => ({
  getCollections: () => getCollectionsMock(),
  getVideos: () => [],
}));

vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        all: () => subscriptionsRowsMock.current,
      })),
    })),
  },
}));

vi.mock("../../../db/schema", () => ({
  subscriptions: {
    collectionId: "collectionId",
    subscriptionType: "subscriptionType",
    playlistId: "playlistId",
  },
}));

import {
  assignDateCollisionIndexes,
  buildStoredSourceOptionsMap,
  enrichSourceOptionsForDownload,
  resetDownloadCollisionReservationsForTests,
} from "../../../services/filenameTemplate/sourceOptions";
import { FilenameTemplateSourceOptions } from "../../../services/filenameTemplate/types";

describe("filenameTemplate/sourceOptions", () => {
  beforeEach(() => {
    getCollectionsMock.mockReset();
    getCollectionsMock.mockReturnValue([]);
    subscriptionsRowsMock.current = [];
    resetDownloadCollisionReservationsForTests();
  });

  it("builds stored source options from collection membership and subscription type", () => {
    getCollectionsMock.mockReturnValue([
      {
        id: "col-pl",
        name: "My Playlist",
        videos: ["v1", "v2"],
      },
    ]);
    subscriptionsRowsMock.current = [
      {
        collectionId: "col-pl",
        subscriptionType: "playlist",
        playlistId: "PL123",
      },
    ];

    const result = buildStoredSourceOptionsMap([
      { id: "v1", author: "Creator" } as any,
      { id: "v2", author: "Creator" } as any,
    ]);

    expect(result.get("v1")).toMatchObject({
      sourceCollectionName: "My Playlist",
      sourceCollectionId: "col-pl",
      sourceCollectionType: "playlist",
      mediaPlaylistIndex: 1,
    });
    expect(result.get("v2")?.mediaPlaylistIndex).toBe(2);
  });

  it("assigns per-day collision indexes deterministically", () => {
    const videos = [
      {
        id: "v2",
        author: "Channel",
        date: "20260430",
        addedAt: "2026-04-30T11:00:00Z",
        createdAt: "2026-04-30T11:00:00Z",
      },
      {
        id: "v1",
        author: "Channel",
        date: "20260430",
        addedAt: "2026-04-30T10:00:00Z",
        createdAt: "2026-04-30T10:00:00Z",
      },
    ] as any[];
    const options = new Map<string, FilenameTemplateSourceOptions>([
      [
        "v1",
        {
          sourceCollectionName: "Channel",
          sourceCollectionType: "channel",
          mediaPlaylistIndex: 1,
        },
      ],
      [
        "v2",
        {
          sourceCollectionName: "Channel",
          sourceCollectionType: "channel",
          mediaPlaylistIndex: 2,
        },
      ],
    ]);

    assignDateCollisionIndexes(videos, options);

    expect(options.get("v1")?.mediaPlaylistIndexWithinDate).toBe(1);
    expect(options.get("v2")?.mediaPlaylistIndexWithinDate).toBe(2);
  });

  it("uses stable playlist index for playlist downloads", () => {
    const result = enrichSourceOptionsForDownload(
      {
        sourceCollectionType: "playlist",
        sourceCollectionName: "Playlist",
        mediaPlaylistIndex: 12,
      },
      {
        author: "Creator",
        uploadDate: "20260430",
        existingVideos: [],
      }
    );

    expect(result.mediaPlaylistIndexWithinDate).toBe(12);
  });

  it("counts existing same-day items for channel/single downloads", () => {
    const existingVideos = [
      {
        id: "v1",
        author: "Channel",
        date: "20260430",
      },
      {
        id: "v2",
        author: "Channel",
        date: "20260430",
      },
      {
        id: "v3",
        author: "Other Channel",
        date: "20260430",
      },
      {
        id: "v4",
        author: "Channel",
        date: "20260501",
      },
    ] as any[];

    const result = enrichSourceOptionsForDownload(
      {
        sourceCollectionType: "channel",
        sourceCollectionName: "Channel",
      },
      {
        author: "Channel",
        uploadDate: "20260430",
        existingVideos,
      }
    );

    expect(result.mediaPlaylistIndexWithinDate).toBe(3);
  });

  it("reserves unique same-day indexes for parallel channel/single downloads", () => {
    const existingVideos = [
      {
        id: "v1",
        author: "Channel",
        date: "20260430",
      },
      {
        id: "v2",
        author: "Channel",
        date: "20260430",
      },
    ] as any[];

    const firstResult = enrichSourceOptionsForDownload(
      {
        sourceCollectionType: "channel",
        sourceCollectionName: "Channel",
      },
      {
        author: "Channel",
        uploadDate: "20260430",
        existingVideos,
      }
    );
    const secondResult = enrichSourceOptionsForDownload(
      {
        sourceCollectionType: "channel",
        sourceCollectionName: "Channel",
      },
      {
        author: "Channel",
        uploadDate: "20260430",
        existingVideos,
      }
    );

    expect(firstResult.mediaPlaylistIndexWithinDate).toBe(3);
    expect(secondResult.mediaPlaylistIndexWithinDate).toBe(4);
  });
});
