/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // helpers
  extractBilibiliVideoId: vi.fn(),
  isBilibiliUrl: vi.fn(),
  trimBilibiliUrl: vi.fn(),
  // downloadService
  checkBilibiliVideoParts: vi.fn(),
  downloadSingleBilibiliPart: vi.fn(),
  downloadRemainingBilibiliParts: vi.fn(),
  downloadBilibiliCollection: vi.fn(),
  // storageService
  getActiveDownload: vi.fn(),
  addActiveDownload: vi.fn(),
  updateActiveDownloadTitle: vi.fn(),
  getVideoBySourceUrl: vi.fn(),
  getCollectionById: vi.fn(),
  getCollectionByName: vi.fn(),
  getCollectionBySourceKey: vi.fn(),
  getCollectionsByVideoId: vi.fn(),
  saveCollection: vi.fn(),
  linkVideoToCollection: vi.fn(),
  getSettings: vi.fn(),
  cleanupCollectionDirectories: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../utils/helpers", () => ({
  extractBilibiliVideoId: (...a: any[]) => mocks.extractBilibiliVideoId(...a),
  isBilibiliUrl: (...a: any[]) => mocks.isBilibiliUrl(...a),
  trimBilibiliUrl: (...a: any[]) => mocks.trimBilibiliUrl(...a),
}));

vi.mock("../../utils/logger", () => ({ logger: mocks.logger }));

vi.mock("../../services/downloadService", () => ({
  checkBilibiliVideoParts: (...a: any[]) => mocks.checkBilibiliVideoParts(...a),
  downloadSingleBilibiliPart: (...a: any[]) =>
    mocks.downloadSingleBilibiliPart(...a),
  downloadRemainingBilibiliParts: (...a: any[]) =>
    mocks.downloadRemainingBilibiliParts(...a),
  downloadBilibiliCollection: (...a: any[]) =>
    mocks.downloadBilibiliCollection(...a),
}));

vi.mock("../../services/storageService", () => ({
  getActiveDownload: (...a: any[]) => mocks.getActiveDownload(...a),
  addActiveDownload: (...a: any[]) => mocks.addActiveDownload(...a),
  updateActiveDownloadTitle: (...a: any[]) =>
    mocks.updateActiveDownloadTitle(...a),
  getVideoBySourceUrl: (...a: any[]) => mocks.getVideoBySourceUrl(...a),
  getCollectionById: (...a: any[]) => mocks.getCollectionById(...a),
  getCollectionByName: (...a: any[]) => mocks.getCollectionByName(...a),
  getCollectionBySourceKey: (...a: any[]) =>
    mocks.getCollectionBySourceKey(...a),
  getCollectionsByVideoId: (...a: any[]) => mocks.getCollectionsByVideoId(...a),
  saveCollection: (...a: any[]) => mocks.saveCollection(...a),
  linkVideoToCollection: (...a: any[]) => mocks.linkVideoToCollection(...a),
  getSettings: (...a: any[]) => mocks.getSettings(...a),
  cleanupCollectionDirectories: (...a: any[]) =>
    mocks.cleanupCollectionDirectories(...a),
}));

import { buildBilibiliDownloadTask } from "../../services/bilibiliDownloadTask";

const SERIES_URL = "https://www.bilibili.com/video/BV1xx";

function runMultipartTask() {
  return buildBilibiliDownloadTask({
    downloadUrl: SERIES_URL,
    downloadId: "dl-1",
    downloadAllParts: true,
    collectionName: "My Series",
  })(() => {});
}

describe("buildBilibiliDownloadTask multipart collection handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBilibiliUrl.mockReturnValue(true);
    mocks.trimBilibiliUrl.mockImplementation((url: string) => url);
    mocks.extractBilibiliVideoId.mockReturnValue("BV1xx");
    mocks.checkBilibiliVideoParts.mockResolvedValue({
      success: true,
      videosNumber: 2,
      title: "My Series",
    });
    mocks.getActiveDownload.mockReturnValue(undefined);
    mocks.getVideoBySourceUrl.mockReturnValue(undefined);
    mocks.getCollectionByName.mockReturnValue(undefined);
    mocks.getCollectionBySourceKey.mockReturnValue(undefined);
    mocks.getCollectionsByVideoId.mockReturnValue([]);
    mocks.saveCollection.mockImplementation((c: any) => c);
    mocks.linkVideoToCollection.mockReturnValue(undefined);
    // author_folder_only is the mode that exposed the residual-folder bug
    mocks.getSettings.mockReturnValue({
      authorOrganizationMode: "author_folder_only",
    });
    mocks.downloadSingleBilibiliPart.mockResolvedValue({
      success: true,
      videoData: { id: "v1" },
    });
    mocks.downloadRemainingBilibiliParts.mockResolvedValue({
      success: true,
      partial: false,
      expectedCount: 1,
      downloadedCount: 1,
      skippedCount: 0,
      failedPartNumbers: [],
      firstVideo: { id: "v2" },
    });
  });

  it("creates exactly one collection stamped with a stable source key", async () => {
    // getCollectionById is consulted for cleanup naming; echo the created collection.
    mocks.getCollectionById.mockImplementation((id: string) => ({
      id,
      name: "My Series",
      title: "My Series",
      videos: [],
    }));

    const result = await runMultipartTask();

    expect(result.success).toBe(true);
    expect(mocks.saveCollection).toHaveBeenCalledTimes(1);
    expect(mocks.saveCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Series",
        sourcePlatform: "bilibili",
        sourceType: "multipart",
        sourceMid: "BV1xx",
        sourceId: "BV1xx",
      }),
    );
    // Residual empty collection folder is cleaned up under author_folder_only.
    expect(mocks.cleanupCollectionDirectories).toHaveBeenCalledWith("My Series");
  });

  it("reuses an existing source-keyed collection instead of creating a duplicate", async () => {
    const existing = {
      id: "col-existing",
      name: "My Series",
      title: "My Series",
      videos: [],
      sourcePlatform: "bilibili",
      sourceType: "multipart",
      sourceMid: "BV1xx",
      sourceId: "BV1xx",
    };
    mocks.getCollectionBySourceKey.mockReturnValue(existing);
    mocks.getCollectionById.mockReturnValue(existing);

    const result = await runMultipartTask();

    expect(result.success).toBe(true);
    // No new collection created, and no needless backfill save (key already matches).
    expect(mocks.saveCollection).not.toHaveBeenCalled();
    expect(result.collectionId).toBe("col-existing");
    // Parts are linked to the reused collection.
    expect(mocks.linkVideoToCollection).toHaveBeenCalledWith(
      "col-existing",
      "v1",
      expect.objectContaining({ order: 1 }),
    );
  });
});
