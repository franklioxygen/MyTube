import { describe, expect, it, vi } from "vitest";
import { ArtifactReferenceIndex } from "../../../services/mediaServerExport/artifactReferenceIndex";
import * as planner from "../../../services/mediaServerExport/pathPlanner";
import type { Video } from "../../../services/storageService/types";

const videoRecord = (id: string, videoPath: string): Video => ({
  id, videoPath, title: id, sourceUrl: `https://example.com/${id}`, createdAt: "2026-01-01T00:00:00Z",
});

describe("sidecar ownership during batch deletion", () => {
  it("plans unchanged paths once and reflects deletions, moves and new owners", () => {
    let library = Array.from({ length: 30 }, (_, i) => videoRecord(String(i), `/videos/group/file-${i}.mp4`));
    const shared = videoRecord("shared", library[29].videoPath);
    library.push(shared);
    const targetPath = planner.planMediaServerExportPaths(shared)!.episodeNfoAbsolutePath;
    const plan = vi.spyOn(planner, "planMediaServerExportPaths");
    const index = new ArtifactReferenceIndex();
    try {
      for (let i = 0; i < 29; i++) {
        index.update(library, String(i));
        library = library.filter((row) => row.id !== String(i));
        expect(index.has(targetPath)).toBe(true);
      }
      expect(plan).toHaveBeenCalledTimes(30);
      shared.videoPath = "/videos/moved/file.mp4";
      index.update(library, "29");
      expect(index.has(targetPath)).toBe(false);
      expect(plan).toHaveBeenCalledTimes(31);
      library = [shared];
      index.update(library, "shared");
      expect(index.has(targetPath)).toBe(false);
      library.push(videoRecord("new", "/videos/group/file-29.mp4"));
      index.update(library, "shared");
      expect(index.has(targetPath)).toBe(true);
    } finally { plan.mockRestore(); }
  });
});
