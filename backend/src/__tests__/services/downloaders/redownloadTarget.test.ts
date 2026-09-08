import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkVideoDownloadBySourceId: vi.fn(),
  getVideoById: vi.fn(),
}));

vi.mock("../../../services/storageService", () => ({
  checkVideoDownloadBySourceId: mocks.checkVideoDownloadBySourceId,
  getVideoById: mocks.getVideoById,
}));

import { findRedownloadTargetBySourceIdentity } from "../../../services/downloaders/redownloadTarget";

const STORED_URL = "https://missav.ws/dm3/sone-192#frag_mobile-watch-next";
const OTHER_MIRROR_URL = "https://missav.ai/dm3/cn/sone-192";

function libraryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "local-1",
    sourceUrl: STORED_URL,
    mediaType: "video",
    videoPath: "/videos/Episode.mp4",
    ...overrides,
  } as any;
}

describe("findRedownloadTargetBySourceIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds the row a different URL spelling points at", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({
      found: true,
      status: "exists",
      videoId: "local-1",
    });
    mocks.getVideoById.mockReturnValue(libraryRow());

    // The stored row carries a missav.ws URL with a fragment; the request comes
    // in on the .ai mirror. Exact URL equality misses; the identity key does not.
    const found = findRedownloadTargetBySourceIdentity(OTHER_MIRROR_URL, "video");

    expect(found?.id).toBe("local-1");
    expect(mocks.checkVideoDownloadBySourceId).toHaveBeenCalledWith(
      "sone-192",
      "missav",
      "video"
    );
  });

  it("keys on the same identity the duplicate gate uses for youtube", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({ found: false });

    findRedownloadTargetBySourceIdentity(
      "https://youtu.be/dQw4w9WgXcQ?t=30",
      "video"
    );

    expect(mocks.checkVideoDownloadBySourceId).toHaveBeenCalledWith(
      "dQw4w9WgXcQ",
      "youtube",
      "video"
    );
  });

  it("scopes the lookup to the requested media type", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({ found: false });

    findRedownloadTargetBySourceIdentity("https://youtu.be/dQw4w9WgXcQ", "audio");

    expect(mocks.checkVideoDownloadBySourceId).toHaveBeenCalledWith(
      "dQw4w9WgXcQ",
      "youtube",
      "audio"
    );
  });

  it("declines a tracking row whose download was deleted", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({
      found: true,
      status: "deleted",
      videoId: "local-1",
    });

    expect(
      findRedownloadTargetBySourceIdentity(OTHER_MIRROR_URL, "video")
    ).toBeUndefined();
    expect(mocks.getVideoById).not.toHaveBeenCalled();
  });

  it("declines a tracking row pointing at a video that is gone", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({
      found: true,
      status: "exists",
      videoId: "local-gone",
    });
    mocks.getVideoById.mockReturnValue(undefined);

    expect(
      findRedownloadTargetBySourceIdentity(OTHER_MIRROR_URL, "video")
    ).toBeUndefined();
  });

  it("declines a row of the other media type", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({
      found: true,
      status: "exists",
      videoId: "local-1",
    });
    mocks.getVideoById.mockReturnValue(libraryRow({ mediaType: "audio" }));

    expect(
      findRedownloadTargetBySourceIdentity(OTHER_MIRROR_URL, "video")
    ).toBeUndefined();
  });

  it("treats a legacy null media type as video", () => {
    mocks.checkVideoDownloadBySourceId.mockReturnValue({
      found: true,
      status: "exists",
      videoId: "local-1",
    });
    mocks.getVideoById.mockReturnValue(libraryRow({ mediaType: null }));

    expect(
      findRedownloadTargetBySourceIdentity(OTHER_MIRROR_URL, "video")?.id
    ).toBe("local-1");
  });

  it("returns undefined without consulting tracking when no id can be read", () => {
    expect(
      findRedownloadTargetBySourceIdentity(
        "https://www.youtube.com/results?search_query=nothing",
        "video"
      )
    ).toBeUndefined();
    expect(mocks.checkVideoDownloadBySourceId).not.toHaveBeenCalled();
  });
});
