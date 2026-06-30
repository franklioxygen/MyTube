import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../errors/DownloadErrors";
import {
  createYtDlpOutputTemplate,
  isExpectedTwitchMetadataError,
  pathExistsWithAnyKnownVideoExtension,
  stripTrailingExtension,
} from "../../../services/downloaders/ytdlp/ytdlpVideoHelpers";
import * as security from "../../../utils/security";

vi.mock("../../../config/paths", () => ({
  VIDEOS_DIR: "/library/videos",
}));

vi.mock("../../../utils/security", () => ({
  pathExistsSafeSync: vi.fn(),
  resolveSafeChildPath: vi.fn((root: string, child: string) =>
    path.join(root, child)
  ),
}));

describe("ytdlpVideoHelpers", () => {
  const pathExistsSafeSyncMock = vi.mocked(security.pathExistsSafeSync);
  const resolveSafeChildPathMock = vi.mocked(security.resolveSafeChildPath);

  beforeEach(() => {
    vi.clearAllMocks();
    pathExistsSafeSyncMock.mockReturnValue(false);
  });

  describe("stripTrailingExtension", () => {
    it("removes only a matching trailing extension", () => {
      expect(stripTrailingExtension("/tmp/video.mp4", ".mp4")).toBe(
        "/tmp/video"
      );
      expect(stripTrailingExtension("/tmp/video.mp4", ".webm")).toBe(
        "/tmp/video.mp4"
      );
    });
  });

  describe("createYtDlpOutputTemplate", () => {
    it("replaces the concrete extension with yt-dlp extension placeholder", () => {
      expect(createYtDlpOutputTemplate("/library/videos/title.mp4")).toBe(
        "/library/videos/title.%(ext)s"
      );
      expect(resolveSafeChildPathMock).toHaveBeenCalledWith(
        "/library/videos",
        "title.%(ext)s"
      );
    });
  });

  describe("pathExistsWithAnyKnownVideoExtension", () => {
    it("checks each supported container under the managed video directory", () => {
      pathExistsSafeSyncMock.mockImplementation(
        (candidate: string) => candidate === "/library/videos/title.webm"
      );

      expect(pathExistsWithAnyKnownVideoExtension("/library/videos/title")).toBe(
        true
      );
      expect(pathExistsSafeSyncMock).toHaveBeenCalledWith(
        "/library/videos/title.mp4",
        "/library/videos"
      );
      expect(pathExistsSafeSyncMock).toHaveBeenCalledWith(
        "/library/videos/title.webm",
        "/library/videos"
      );
    });

    it("returns false when no known container exists", () => {
      expect(pathExistsWithAnyKnownVideoExtension("/library/videos/missing")).toBe(
        false
      );
    });
  });

  describe("isExpectedTwitchMetadataError", () => {
    it("treats validation, 429, and rate limit errors as expected", () => {
      expect(isExpectedTwitchMetadataError(new ValidationError("invalid"))).toBe(
        true
      );
      expect(
        isExpectedTwitchMetadataError({ response: { status: 429 } })
      ).toBe(true);
      expect(
        isExpectedTwitchMetadataError(
          new Error("Twitch API is temporarily rate limited")
        )
      ).toBe(true);
    });

    it("does not swallow unrelated Twitch enrichment errors", () => {
      expect(
        isExpectedTwitchMetadataError({ response: { status: 500 } })
      ).toBe(false);
      expect(isExpectedTwitchMetadataError(new Error("boom"))).toBe(false);
      expect(isExpectedTwitchMetadataError("boom")).toBe(false);
    });
  });
});
