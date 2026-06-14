import { describe, expect, it } from "vitest";
import {
  canRestoreDetachedTask,
  createBilibiliRetryMetadata,
  mergeBilibiliRetryMetadata,
  parseRetryMetadata,
  requiresRetryMetadata,
  serializeRetryMetadata,
} from "../../services/downloadRetryMetadata";

describe("downloadRetryMetadata", () => {
  it("creates metadata for complex Bilibili download shapes", () => {
    expect(
      createBilibiliRetryMetadata({
        downloadAllParts: true,
        collectionName: "Series",
        normalizedSourceUrl: "https://www.bilibili.com/video/BV1xx",
      }),
    ).toEqual({
      shape: "bilibili_all_parts",
      collectionName: "Series",
      normalizedSourceUrl: "https://www.bilibili.com/video/BV1xx",
    });

    expect(
      createBilibiliRetryMetadata({
        downloadCollection: true,
        collectionName: "Season 1",
        collectionInfo: {
          success: true,
          type: "collection",
          id: 42,
          title: "Season 1",
        },
        normalizedSourceUrl: "https://www.bilibili.com/video/BVseason",
      }),
    ).toEqual({
      shape: "bilibili_collection",
      collectionName: "Season 1",
      normalizedSourceUrl: "https://www.bilibili.com/video/BVseason",
      collectionInfo: {
        success: true,
        type: "collection",
        id: 42,
        title: "Season 1",
      },
    });
  });

  it("round-trips serialized metadata", () => {
    const metadata = {
      shape: "bilibili_all_parts" as const,
      collectionName: "Series",
    };

    expect(parseRetryMetadata(serializeRetryMetadata(metadata))).toEqual(
      metadata,
    );
  });

  it("rejects invalid persisted metadata for Bilibili restores", () => {
    expect(canRestoreDetachedTask("youtube", "{invalid")).toBe(true);
    expect(canRestoreDetachedTask("bilibili", undefined)).toBe(true);
    expect(canRestoreDetachedTask("bilibili", "{invalid")).toBe(false);
    expect(
      canRestoreDetachedTask(
        "bilibili",
        serializeRetryMetadata({
          shape: "bilibili_all_parts",
        }),
      ),
    ).toBe(true);
  });

  it("identifies metadata that must be persisted", () => {
    expect(requiresRetryMetadata(undefined)).toBe(false);
    expect(
      requiresRetryMetadata({
        shape: "bilibili_collection",
        collectionInfo: { success: true, type: "collection" },
      }),
    ).toBe(true);
  });

  it("merges persisted Bilibili retry state for the same job shape", () => {
    expect(
      mergeBilibiliRetryMetadata(
        {
          shape: "bilibili_all_parts",
          collectionName: "Series",
          normalizedSourceUrl: "https://www.bilibili.com/video/BV1xx",
        },
        {
          shape: "bilibili_all_parts",
          collectionName: "Series",
          linkedCollectionId: "col-1",
          completedPartNumbers: [1, 2],
          failedPartNumbers: [3],
        },
      ),
    ).toEqual(
      expect.objectContaining({
        linkedCollectionId: "col-1",
        completedPartNumbers: [1, 2],
        failedPartNumbers: [3],
      }),
    );
  });
});
