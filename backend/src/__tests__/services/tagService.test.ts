import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import * as settingsService from "../../services/storageService/settings";
import { deleteTagsFromVideos, renameTag } from "../../services/tagService";

// Mock dependencies
vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((cb) => cb()),
  },
}));

vi.mock("../../services/storageService/settings", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("TagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("renameTag", () => {
    it("should rename tag in settings and videos", () => {
      // Mock settings
      vi.mocked(settingsService.getSettings).mockReturnValue({
        tags: ["oldTag", "otherTag"],
      } as any);

      // Mock DB videos
      const mockVideos = [
        { id: "1", tags: JSON.stringify(["oldTag", "tag2"]) }, // Should update
        { id: "2", tags: JSON.stringify(["tag3"]) },       // Should not update
      ];

      // Setup DB chain mocks
      const mockAll = vi.fn().mockReturnValue(mockVideos);
      const mockFrom = vi.fn().mockReturnValue({ all: mockAll });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

      const mockRun = vi.fn();
      const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

      const result = renameTag("oldTag", "newTag");

      // Verify settings update
      expect(settingsService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["newTag", "otherTag"] })
      );
      expect(result.settingsUpdated).toBe(true);

      // Verify video update
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith({ tags: JSON.stringify(["newTag", "tag2"]) });
      expect(result.updatedVideosCount).toBe(1);
    });

    it("should dedup tags when renaming", () => {
      vi.mocked(settingsService.getSettings).mockReturnValue({
        tags: ["oldTag", "newTag"], // newTag already exists
      } as any);

      const mockVideos = [
        { id: "1", tags: JSON.stringify(["oldTag", "newTag"]) },
      ];

      const mockAll = vi.fn().mockReturnValue(mockVideos);
      const mockFrom = vi.fn().mockReturnValue({ all: mockAll });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

      // mocks for update
      const mockRun = vi.fn();
      const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

      renameTag("oldTag", "newTag");

      // Settings should dedup
      expect(settingsService.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["newTag"] }) // Deduplicated
      );

      // Video tags should dedup
      expect(mockSet).toHaveBeenCalledWith({ tags: JSON.stringify(["newTag"]) });
    });
    
    it("should handle error gracefully", () => {
         vi.mocked(settingsService.getSettings).mockImplementation(() => {
             throw new Error("Settings error");
         });
         
         expect(() => renameTag("old", "new")).toThrow("Failed to rename tag");
    });
  });

  describe("deleteTagsFromVideos", () => {
    it("should delete tags from videos", () => {
      const mockVideos = [
        { id: "1", tags: JSON.stringify(["tagToDelete", "keepTag"]) },
        { id: "2", tags: JSON.stringify(["keepTag"]) },
      ];

      const mockAll = vi.fn().mockReturnValue(mockVideos);
      const mockFrom = vi.fn().mockReturnValue({ all: mockAll });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

      const mockRun = vi.fn();
      const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

      const count = deleteTagsFromVideos(["tagToDelete"]);

      expect(count).toBe(1);
      expect(mockSet).toHaveBeenCalledWith({ tags: JSON.stringify(["keepTag"]) });
    });

    it("should return 0 if tagsToDelete is empty", () => {
        expect(deleteTagsFromVideos([])).toBe(0);
    });
  });
});
