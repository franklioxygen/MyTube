import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection } from "../../../services/storageService/types";

const saveCollectionMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/storageService", () => ({
  saveCollection: saveCollectionMock,
  getCollectionByName: vi.fn(),
  getCollectionById: vi.fn(),
  getCollectionBySourceKey: vi.fn(),
  generateUniqueCollectionName: vi.fn((name: string) => name),
  deleteCollection: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: loggerWarnMock, error: vi.fn(), debug: vi.fn() },
}));

import { applyPlaylistCollectionMetadata } from "../../../services/subscription/playlistResolution";

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "Space Time",
    title: "Space Time",
    videos: [],
    ...overrides,
  } as Collection;
}

/**
 * Issue #411: playlist/channel metadata is persisted separately from display
 * naming so the media-server exporter can build show and season NFOs offline.
 */
describe("applyPlaylistCollectionMetadata", () => {
  beforeEach(() => {
    saveCollectionMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it("persists metadata on first capture", () => {
    const updated = applyPlaylistCollectionMetadata(collection(), {
      description: "Everything about spacetime.",
      sourceUrl: "https://www.youtube.com/playlist?list=PL1",
      sourceChannelId: "UC123",
      sourceChannelUrl: "https://www.youtube.com/@kurzgesagt",
      sourceChannelName: "Kurzgesagt",
    });

    expect(saveCollectionMock).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({
      id: "c1",
      description: "Everything about spacetime.",
      sourceChannelId: "UC123",
      sourceChannelName: "Kurzgesagt",
    });
  });

  it("does not write when there is nothing new", () => {
    const existing = collection({
      description: "Blurb",
      sourceUrl: "https://x",
      sourceChannelId: "UC1",
      sourceChannelUrl: "https://y",
      sourceChannelName: "Name",
    });

    const updated = applyPlaylistCollectionMetadata(existing, {
      description: "Blurb",
      sourceUrl: "https://x",
      sourceChannelId: "UC1",
      sourceChannelUrl: "https://y",
      sourceChannelName: "Name",
    });

    expect(saveCollectionMock).not.toHaveBeenCalled();
    expect(updated).toBe(existing);
  });

  it("does not write when the probe carried no metadata at all", () => {
    const existing = collection({ description: "Blurb" });

    expect(applyPlaylistCollectionMetadata(existing, undefined)).toBe(existing);
    expect(applyPlaylistCollectionMetadata(existing, {})).toBe(existing);
    expect(saveCollectionMock).not.toHaveBeenCalled();
  });

  it("logs and skips a conflicting durable channel identity", () => {
    const updated = applyPlaylistCollectionMetadata(
      collection({ sourceChannelId: "UC-original" }),
      { sourceChannelId: "UC-other", sourceChannelName: "New Name" }
    );

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("durable playlist channel identity"),
      expect.objectContaining({ reasonCode: "ambiguous_collection_show" })
    );
    expect(updated.sourceChannelId).toBe("UC-original");
    // The non-conflicting field in the same candidate is still written.
    expect(updated.sourceChannelName).toBe("New Name");
  });
});
