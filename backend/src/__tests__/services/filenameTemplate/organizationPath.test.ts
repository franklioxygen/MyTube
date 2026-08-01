import { describe, expect, it } from "vitest";
import { applyPhysicalOrganization } from "../../../services/filenameTemplate/organizationPath";

describe("applyPhysicalOrganization", () => {
  it.each(["author_folder_only", "author_collection_linked"] as const)(
    "places template output under the author folder for %s",
    (mode) => {
      expect(
        applyPhysicalOrganization("Season 01/episode.mp4", {
          mode,
          author: "Sample Author",
        })
      ).toEqual({
        relativePath: "Sample Author/Season 01/episode.mp4",
        warnings: [],
      });
    }
  );

  it("does not duplicate an existing author prefix", () => {
    expect(
      applyPhysicalOrganization("sample author/episode.mp4", {
        mode: "author_collection_linked",
        author: "Sample Author",
      })
    ).toEqual({
      relativePath: "sample author/episode.mp4",
      warnings: [],
    });
  });

  it("leaves root-mode output unchanged", () => {
    expect(
      applyPhysicalOrganization("Season 01/episode.mp4", {
        mode: "root",
        author: "Sample Author",
      })
    ).toEqual({
      relativePath: "Season 01/episode.mp4",
      warnings: [],
    });
  });
});
