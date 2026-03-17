import path from "path";
import { describe, expect, it } from "vitest";
import { IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import {
  deriveSmallThumbnailWebPath,
  getThumbnailRelativePath,
} from "../../services/thumbnailMirrorService";

describe("thumbnailMirrorService", () => {
  describe("getThumbnailRelativePath", () => {
    it("rejects traversal-shaped relative paths", () => {
      expect(getThumbnailRelativePath("../secret.jpg")).toBeNull();
      expect(getThumbnailRelativePath("folder/../secret.jpg")).toBeNull();
      expect(getThumbnailRelativePath("./thumb.jpg")).toBeNull();
    });

    it("rejects traversal-shaped web paths", () => {
      expect(getThumbnailRelativePath("/images/../secret.jpg")).toBeNull();
      expect(getThumbnailRelativePath("/videos/folder/../secret.jpg")).toBeNull();
    });

    it("preserves valid relative paths from supported web prefixes", () => {
      expect(
        getThumbnailRelativePath("/images/Collection/thumb.jpg?t=123"),
      ).toBe("Collection/thumb.jpg");
      expect(
        getThumbnailRelativePath("/videos/Collection/thumb.jpg"),
      ).toBe("Collection/thumb.jpg");
    });

    it("preserves valid absolute paths inside thumbnail roots", () => {
      expect(
        getThumbnailRelativePath(path.join(IMAGES_DIR, "Collection", "thumb.jpg")),
      ).toBe(path.join("Collection", "thumb.jpg"));
      expect(
        getThumbnailRelativePath(path.join(VIDEOS_DIR, "Collection", "thumb.jpg")),
      ).toBe(path.join("Collection", "thumb.jpg"));
    });
  });

  describe("deriveSmallThumbnailWebPath", () => {
    it("maps valid thumbnail paths to the stable images-small mirror", () => {
      expect(
        deriveSmallThumbnailWebPath("/videos/Collection/thumb.jpg?t=123"),
      ).toBe("/images-small/Collection/thumb.jpg");
    });

    it("returns null for invalid traversal-shaped input", () => {
      expect(deriveSmallThumbnailWebPath("/images/../secret.jpg")).toBeNull();
    });
  });
});
