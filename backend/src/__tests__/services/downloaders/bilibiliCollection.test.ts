/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  getCollectionById: vi.fn(),
  getCollectionByName: vi.fn(),
  getCollectionBySourceKey: vi.fn(),
  getCollectionsByVideoId: vi.fn(),
  saveCollection: vi.fn(),
  updateActiveDownloadTitle: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  linkVideoToCollection: vi.fn(),
  getSettings: vi.fn(),
  cleanupCollectionDirectories: vi.fn(),
  downloadSinglePart: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("axios", () => ({
  default: {
    get: (...args: any[]) => mocks.axiosGet(...args),
  },
}));

vi.mock("../../../services/storageService", () => ({
  getCollectionById: (...args: any[]) => mocks.getCollectionById(...args),
  getCollectionByName: (...args: any[]) => mocks.getCollectionByName(...args),
  getCollectionBySourceKey: (...args: any[]) =>
    mocks.getCollectionBySourceKey(...args),
  getCollectionsByVideoId: (...args: any[]) => mocks.getCollectionsByVideoId(...args),
  saveCollection: (...args: any[]) => mocks.saveCollection(...args),
  updateActiveDownloadTitle: (...args: any[]) =>
    mocks.updateActiveDownloadTitle(...args),
  getVideoBySourceUrl: (...args: any[]) => mocks.getVideoBySourceUrl(...args),
  linkVideoToCollection: (...args: any[]) => mocks.linkVideoToCollection(...args),
  getSettings: (...args: any[]) => mocks.getSettings(...args),
  cleanupCollectionDirectories: (...args: any[]) =>
    mocks.cleanupCollectionDirectories(...args),
}));

vi.mock("../../../services/downloaders/bilibili/bilibiliVideo", () => ({
  downloadSinglePart: (...args: any[]) => mocks.downloadSinglePart(...args),
}));

vi.mock("../../../utils/logger", () => ({
  logger: mocks.logger,
}));

import { downloadCollection } from "../../../services/downloaders/bilibili/bilibiliCollection";

describe("bilibiliCollection.downloadCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.axiosGet.mockResolvedValue({
      data: {
        data: {
          archives: [
            { bvid: "BV1", title: "Episode 1", aid: 1 },
            { bvid: "BV2", title: "Episode 2", aid: 2 },
          ],
          page: { total: 2 },
        },
      },
    });
    mocks.getCollectionById.mockReturnValue({
      id: "col-existing",
      name: "Series",
      title: "Series",
      videos: [],
    });
    mocks.getCollectionByName.mockReturnValue(undefined);
    mocks.getCollectionBySourceKey.mockReturnValue(undefined);
    mocks.getCollectionsByVideoId.mockReturnValue([]);
    mocks.saveCollection.mockImplementation((collection: any) => collection);
    mocks.linkVideoToCollection.mockReturnValue(undefined);
    mocks.getSettings.mockReturnValue({});
    mocks.downloadSinglePart.mockResolvedValue({
      success: true,
      videoData: { id: "video-2" },
    });
  });

  it("reuses the linked collection and downloads only missing videos", async () => {
    mocks.getVideoBySourceUrl.mockImplementation((sourceUrl: string) => {
      if (sourceUrl.endsWith("/BV1")) {
        return { id: "video-1", sourceUrl };
      }
      return undefined;
    });

    const retryMetadata: any = {
      shape: "bilibili_collection" as const,
      collectionName: "Series",
      collectionInfo: {
        success: true,
        type: "collection" as const,
        id: 42,
        mid: 9,
        title: "Series",
      },
      linkedCollectionId: "col-existing",
      completedVideoBvids: ["BV1"],
      failedVideoBvids: ["BV2"],
    };

    const result = await downloadCollection(
      retryMetadata.collectionInfo,
      "Series",
      "download-1",
      undefined,
      retryMetadata,
    );

    expect(mocks.saveCollection).toHaveBeenCalledTimes(1);
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "col-existing",
        sourcePlatform: "bilibili",
        sourceType: "collection",
        sourceMid: "9",
        sourceId: "42",
      }),
    );
    expect(mocks.downloadSinglePart).toHaveBeenCalledTimes(1);
    expect(mocks.downloadSinglePart).toHaveBeenCalledWith(
      "https://www.bilibili.com/video/BV2",
      2,
      2,
      "Series",
      "download-1",
      undefined,
      "Series",
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        partial: false,
        collectionId: "col-existing",
        expectedCount: 2,
        downloadedCount: 1,
        skippedCount: 1,
      }),
    );
    expect(retryMetadata.linkedCollectionId).toBe("col-existing");
    expect(retryMetadata.expectedVideoBvids).toEqual(["BV1", "BV2"]);
    expect(retryMetadata.completedVideoBvids).toEqual(["BV1", "BV2"]);
    expect(retryMetadata.failedVideoBvids).toBeUndefined();
    expect(mocks.linkVideoToCollection).toHaveBeenNthCalledWith(
      1,
      "col-existing",
      "video-1",
      { moveFiles: false, order: 1 },
    );
    expect(mocks.linkVideoToCollection).toHaveBeenNthCalledWith(
      2,
      "col-existing",
      "video-2",
      { moveFiles: false, order: 2 },
    );
  });

  it("reuses an existing manual collection when prior retry metadata is unavailable", async () => {
    mocks.getCollectionById.mockReturnValue(undefined);
    mocks.getVideoBySourceUrl.mockImplementation((sourceUrl: string) => {
      if (sourceUrl.endsWith("/BV1")) {
        return { id: "video-1", sourceUrl };
      }
      return undefined;
    });
    mocks.getCollectionsByVideoId.mockReturnValue([
      {
        id: "col-existing",
        name: "Series",
        title: "Series",
        origin: "manual",
        videos: ["video-1"],
      },
      {
        id: "author-auto",
        name: "Uploader",
        title: "Uploader",
        origin: "author_auto",
        videos: ["video-1"],
      },
    ]);

    const result = await downloadCollection(
      {
        success: true,
        type: "collection",
        id: 42,
        mid: 9,
        title: "Series",
      },
      "Series",
      "download-2",
    );

    expect(mocks.saveCollection).toHaveBeenCalledTimes(1);
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "col-existing",
        sourcePlatform: "bilibili",
        sourceType: "collection",
        sourceMid: "9",
        sourceId: "42",
      }),
    );
    expect(result.collectionId).toBe("col-existing");
    expect(mocks.linkVideoToCollection).toHaveBeenNthCalledWith(
      1,
      "col-existing",
      "video-1",
      { moveFiles: false, order: 1 },
    );
  });

  it("reuses the collection found by stable source key instead of creating a duplicate (issue #295)", async () => {
    // No retry metadata link, and the name/membership resolver finds nothing,
    // but the stable source key (type+mid+id) matches an existing collection.
    mocks.getCollectionById.mockReturnValue(undefined);
    mocks.getCollectionByName.mockReturnValue(undefined);
    mocks.getCollectionsByVideoId.mockReturnValue([]);
    mocks.getVideoBySourceUrl.mockImplementation((sourceUrl: string) => {
      if (sourceUrl.endsWith("/BV1")) {
        return { id: "video-1", sourceUrl };
      }
      return undefined;
    });
    mocks.getCollectionBySourceKey.mockImplementation(
      (platform: string, type: string, mid: string, id: string) => {
        if (
          platform === "bilibili" &&
          type === "collection" &&
          mid === "9" &&
          id === "42"
        ) {
          return {
            id: "col-existing",
            name: "Series",
            title: "Series",
            origin: "manual",
            videos: ["video-1"],
            sourcePlatform: "bilibili",
            sourceType: "collection",
            sourceMid: "9",
            sourceId: "42",
          };
        }
        return undefined;
      },
    );

    const result = await downloadCollection(
      {
        success: true,
        type: "collection",
        id: 42,
        mid: 9,
        title: "Series",
      },
      "Series",
      "download-3",
    );

    // Reused the existing collection by key, did not create a new one.
    expect(result.collectionId).toBe("col-existing");
    expect(mocks.getCollectionBySourceKey).toHaveBeenCalledWith(
      "bilibili",
      "collection",
      "9",
      "42",
    );
    // Key already present on the matched collection, so no backfill write is needed.
    expect(mocks.saveCollection).not.toHaveBeenCalled();
    // Only the missing episode is downloaded; the existing one is linked.
    expect(mocks.downloadSinglePart).toHaveBeenCalledTimes(1);
    expect(mocks.linkVideoToCollection).toHaveBeenNthCalledWith(
      1,
      "col-existing",
      "video-1",
      { moveFiles: false, order: 1 },
    );
  });

  it("does not reuse a same-named Bilibili collection with a different source key", async () => {
    mocks.getCollectionById.mockReturnValue(undefined);
    mocks.getVideoBySourceUrl.mockReturnValue(undefined);
    mocks.getCollectionsByVideoId.mockReturnValue([]);
    mocks.getCollectionByName.mockReturnValue({
      id: "col-other-source",
      name: "Series",
      title: "Series",
      origin: "manual",
      videos: [],
      sourcePlatform: "bilibili",
      sourceType: "collection",
      sourceMid: "99",
      sourceId: "100",
    });

    const result = await downloadCollection(
      {
        success: true,
        type: "collection",
        id: 42,
        mid: 9,
        title: "Series",
      },
      "Series",
      "download-same-name-conflict",
    );

    expect(result.collectionId).not.toBe("col-other-source");
    expect(mocks.saveCollection).toHaveBeenCalledTimes(1);
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Series",
        sourcePlatform: "bilibili",
        sourceType: "collection",
        sourceMid: "9",
        sourceId: "42",
      }),
    );
    expect(mocks.saveCollection).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: "col-other-source",
        sourceMid: "9",
        sourceId: "42",
      }),
    );
  });

  it("marks collection retries as partial when existing videos are skipped and a missing video still fails", async () => {
    mocks.getCollectionById.mockReturnValue({
      id: "col-existing",
      name: "Series",
      title: "Series",
      videos: [],
    });
    mocks.getVideoBySourceUrl.mockImplementation((sourceUrl: string) => {
      if (sourceUrl.endsWith("/BV1")) {
        return { id: "video-1", sourceUrl };
      }
      return undefined;
    });
    mocks.downloadSinglePart.mockResolvedValueOnce({
      success: false,
      error: "network error",
    });

    const retryMetadata: any = {
      shape: "bilibili_collection" as const,
      collectionName: "Series",
      collectionInfo: {
        success: true,
        type: "collection" as const,
        id: 42,
        mid: 9,
        title: "Series",
      },
      linkedCollectionId: "col-existing",
      completedVideoBvids: ["BV1"],
      failedVideoBvids: ["BV2"],
    };

    const result = await downloadCollection(
      retryMetadata.collectionInfo,
      "Series",
      "download-3",
      undefined,
      retryMetadata,
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        partial: true,
        expectedCount: 2,
        downloadedCount: 0,
        skippedCount: 1,
        failedPartNumbers: [2],
      }),
    );
  });

  it("cleans up the residual collection folder under author_folder_only (issue #295 2-2)", async () => {
    mocks.getCollectionById.mockReturnValue(undefined);
    mocks.getVideoBySourceUrl.mockReturnValue(undefined);
    mocks.getSettings.mockReturnValue({
      authorOrganizationMode: "author_folder_only",
    });

    await downloadCollection(
      { success: true, type: "collection", id: 42, mid: 9, title: "Series" },
      "Series",
      "download-cleanup",
    );

    expect(mocks.cleanupCollectionDirectories).toHaveBeenCalledWith("Series");
  });

  it("does not clean up collection folders in non-author_folder_only modes", async () => {
    mocks.getCollectionById.mockReturnValue(undefined);
    mocks.getVideoBySourceUrl.mockReturnValue(undefined);
    mocks.getSettings.mockReturnValue({ authorOrganizationMode: "root" });

    await downloadCollection(
      { success: true, type: "collection", id: 42, mid: 9, title: "Series" },
      "Series",
      "download-no-cleanup",
    );

    expect(mocks.cleanupCollectionDirectories).not.toHaveBeenCalled();
  });
});
