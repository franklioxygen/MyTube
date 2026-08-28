import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection } from "../../../services/storageService";

const saveCollectionMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/storageService", () => ({
  saveCollection: saveCollectionMock,
  generateUniqueCollectionName: vi.fn(),
  getCollectionByName: vi.fn(),
  getCollectionById: vi.fn(),
  getCollectionBySourceKey: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: warnMock, info: vi.fn() },
}));

import { applyPlaylistCollectionMetadata } from "../../../services/subscription/playlistResolution";

function createCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "col-1",
    name: "Space Time",
    title: "Space Time",
    videos: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Collection;
}

describe("applyPlaylistCollectionMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fills missing source metadata and persists it once", () => {
    const updated = applyPlaylistCollectionMetadata(createCollection(), {
      sourceUrl: "https://youtube.com/playlist?list=PL1",
      description: "  Everything about space.  ",
      sourceChannelId: "UC1",
      sourceChannelUrl: "https://youtube.com/channel/UC1",
      sourceChannelName: "Kurzgesagt",
      sourceChannelDescription: "Channel plot",
    });

    expect(updated).toMatchObject({
      sourceUrl: "https://youtube.com/playlist?list=PL1",
      description: "Everything about space.",
      sourceChannelId: "UC1",
      sourceChannelName: "Kurzgesagt",
      sourceChannelDescription: "Channel plot",
    });
    expect(saveCollectionMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes a changed description but never clears a captured one", () => {
    const existing = createCollection({ description: "Old plot" });

    expect(
      applyPlaylistCollectionMetadata(existing, { description: "New plot" })
        .description
    ).toBe("New plot");

    saveCollectionMock.mockClear();
    expect(
      applyPlaylistCollectionMetadata(existing, { description: undefined })
        .description
    ).toBe("Old plot");
    expect(saveCollectionMock).not.toHaveBeenCalled();
  });

  it("writes nothing when there is nothing new", () => {
    applyPlaylistCollectionMetadata(
      createCollection({ sourceChannelName: "Kurzgesagt" }),
      { sourceChannelName: "Kurzgesagt" }
    );
    expect(saveCollectionMock).not.toHaveBeenCalled();
  });

  it("refuses to replace a conflicting durable channel identity", () => {
    const existing = createCollection({ sourceChannelId: "UC1" });

    const result = applyPlaylistCollectionMetadata(existing, {
      sourceChannelId: "UC2",
      description: "Would-be new plot",
    });

    expect(result.sourceChannelId).toBe("UC1");
    expect(result.description).toBeUndefined();
    expect(saveCollectionMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reasonCode: "ambiguous_collection_show" })
    );
  });
});
