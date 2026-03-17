import { describe, expect, it } from "vitest";
import { buildManagedThumbnailWebPath } from "../../../services/downloaders/thumbnailPathUtils";

describe("thumbnailPathUtils", () => {
  it("builds video-folder thumbnail paths when moveThumbnailsToVideoFolder is enabled", () => {
    expect(
      buildManagedThumbnailWebPath("thumb.jpg", true),
    ).toBe("/videos/thumb.jpg");
    expect(
      buildManagedThumbnailWebPath("thumb.jpg", true, "Collection"),
    ).toBe("/videos/Collection/thumb.jpg");
  });

  it("builds central-image thumbnail paths when moveThumbnailsToVideoFolder is disabled", () => {
    expect(
      buildManagedThumbnailWebPath("thumb.jpg", false),
    ).toBe("/images/thumb.jpg");
    expect(
      buildManagedThumbnailWebPath("thumb.jpg", false, "Collection"),
    ).toBe("/images/Collection/thumb.jpg");
  });
});
