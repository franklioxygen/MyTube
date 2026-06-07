import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    addVideoToAuthorCollection,
    cleanupRedundantAuthorCollectionLinks,
    findOrCreateAuthorCollection,
    organizeVideoByAuthor,
    validateCollectionName,
} from "../authorCollectionUtils";
import * as collections from "../collections";
import * as collectionFileManager from "../collectionFileManager";
import { Collection } from "../types";
import * as videos from "../videos";

// Mock the collections module
vi.mock("../collections", () => ({
  deleteCollection: vi.fn(),
  generateUniqueCollectionName: vi.fn((name) => name),
  getCollectionById: vi.fn(),
  getCollections: vi.fn(() => []),
  getCollectionByName: vi.fn(),
  getCollectionsByVideoId: vi.fn(() => []),
  linkVideoToCollection: vi.fn(),
  removeVideoFromCollection: vi.fn(),
  saveCollection: vi.fn(),
}));

vi.mock("../collectionFileManager", () => ({
  moveAllFilesToCollection: vi.fn(),
}));

vi.mock("../videos", () => ({
  getVideoById: vi.fn(),
  updateVideo: vi.fn(),
}));

// Mock the logger
vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("authorCollectionUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateCollectionName", () => {
    it("should return null for empty or non-string input", () => {
      expect(validateCollectionName("")).toBeNull();
      // @ts-ignore
      expect(validateCollectionName(null)).toBeNull();
    });

    it("should sanitize invalid characters", () => {
      // Replaces : with _ and removes ?
      expect(validateCollectionName("Bad:Name?")).toBe("Bad_Name_");
      expect(validateCollectionName("Leading Space")).toBe("Leading Space");
    });

    it("should handle reserved names", () => {
      expect(validateCollectionName("CON")).toBe("CON_");
    });

    it("should truncate long names", () => {
      const longName = "a".repeat(250);
      const validated = validateCollectionName(longName);
      expect(validated?.length).toBe(200);
    });
  });

  describe("findOrCreateAuthorCollection", () => {
    it("should return existing collection if found", () => {
      const mockCollection: Collection = {
        id: "123",
        name: "TestAuthor",
        title: "TestAuthor",
        videos: [],
        createdAt: new Date().toISOString(),
      };
      (collections.getCollectionByName as any).mockReturnValue(
        mockCollection
      );

      const result = findOrCreateAuthorCollection("TestAuthor");
      expect(result).toBe(mockCollection);
      expect(collections.saveCollection).not.toHaveBeenCalled();
    });

    it("should create new collection if not found", () => {
      (collections.getCollectionByName as any).mockReturnValue(null);
      (collections.generateUniqueCollectionName as any).mockReturnValue(
        "NewAuthor"
      );

      const result = findOrCreateAuthorCollection("NewAuthor");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("NewAuthor");
      expect(collections.saveCollection).toHaveBeenCalled();
    });

    it("should return null for invalid author names", () => {
      expect(findOrCreateAuthorCollection("Unknown")).toBeNull();
      expect(findOrCreateAuthorCollection("")).toBeNull();
    });
  });

  describe("addVideoToAuthorCollection", () => {
    it("should do nothing if setting is disabled", () => {
      const result = addVideoToAuthorCollection("vid1", "TestAuthor", false);
      expect(result).toBeNull();
      // Should not even try to look up collection
      expect(collections.getCollectionByName).not.toHaveBeenCalled();
    });

    it("should do nothing if author is Unknown", () => {
        const result = addVideoToAuthorCollection("vid1", "Unknown", true);
        expect(result).toBeNull();
        expect(collections.getCollectionByName).not.toHaveBeenCalled();
    });

    it("should verify collection creation and adding video when setting is enabled", () => {
      const mockCollection: Collection = {
        id: "col1",
        name: "TestAuthor",
        title: "TestAuthor",
        videos: [],
        createdAt: "now",
      };
      const updatedCollection: Collection = {
        ...mockCollection,
        videos: ["vid1"],
      };

      (collections.getCollectionByName as any).mockReturnValue(
        mockCollection
      );
      (collections.linkVideoToCollection as any).mockReturnValue(
        updatedCollection
      );

      const result = addVideoToAuthorCollection("vid1", "TestAuthor", true);

      expect(result).toEqual(updatedCollection);
      expect(collections.getCollectionByName).toHaveBeenCalledWith(
        "TestAuthor"
      );
      expect(collections.linkVideoToCollection).toHaveBeenCalledWith(
        "col1",
        "vid1",
        { moveFiles: true }
      );
    });

    it("should allow callers to suppress file moves explicitly", () => {
      const mockCollection: Collection = {
        id: "col1",
        name: "TestAuthor",
        title: "TestAuthor",
        videos: [],
        createdAt: "now",
      };

      (collections.getCollectionByName as any).mockReturnValue(mockCollection);
      (collections.linkVideoToCollection as any).mockReturnValue({
        ...mockCollection,
        videos: ["vid1"],
      });

      addVideoToAuthorCollection(
        "vid1",
        "TestAuthor",
        true,
        "legacy",
        { moveFiles: false }
      );

      expect(collections.linkVideoToCollection).toHaveBeenCalledWith(
        "col1",
        "vid1",
        { moveFiles: false }
      );
    });

    it("should handle failure when finding collection", () => {
        // Mock findOrCreate to return null (should not happen in normal flow unless creation fails, but good to test)
        (collections.getCollectionByName as any).mockReturnValue(null);
        
        // This case covers where collection is meant to be created but fails partway or returns null
        // However validateCollectionName returning null is the easiest way to trigger findOrCreateAuthorCollection returning null
        // But since we can't easily mock inner function call from same module without more complex setup (like separate exports),
        // We will rely on the "empty name" case handling within addVideoToAuthorCollection calling findOrCreateAuthorCollection
        
        const result = addVideoToAuthorCollection("vid1", "", true);
        expect(result).toBeNull();
    });
  });

  describe("organizeVideoByAuthor", () => {
    it("should do nothing in root mode", () => {
      const result = organizeVideoByAuthor(
        "vid1",
        "TestAuthor",
        "root",
        "legacy"
      );

      expect(result).toBeNull();
      expect(collections.linkVideoToCollection).not.toHaveBeenCalled();
      expect(collectionFileManager.moveAllFilesToCollection).not.toHaveBeenCalled();
    });

    it("should move files to an author folder without linking a collection in legacy folder-only mode", () => {
      (videos.getVideoById as any).mockReturnValue({
        id: "vid1",
        videoFilename: "video.mp4",
      });
      (collectionFileManager.moveAllFilesToCollection as any).mockReturnValue({
        videoPath: "/videos/TestAuthor/video.mp4",
      });

      const result = organizeVideoByAuthor(
        "vid1",
        "TestAuthor",
        "author_folder_only",
        "legacy"
      );

      expect(result).toEqual({ collection: null, filesMoved: true });
      expect(collectionFileManager.moveAllFilesToCollection).toHaveBeenCalledWith(
        expect.objectContaining({ id: "vid1" }),
        "TestAuthor",
        []
      );
      expect(videos.updateVideo).toHaveBeenCalledWith("vid1", {
        videoPath: "/videos/TestAuthor/video.mp4",
      });
      expect(collections.linkVideoToCollection).not.toHaveBeenCalled();
    });

    it("should skip folder-only organization for template-based naming when file moves are disabled", () => {
      const result = organizeVideoByAuthor(
        "vid1",
        "TestAuthor",
        "author_folder_only",
        "channel_year_date_index"
      );

      expect(result).toBeNull();
      expect(collectionFileManager.moveAllFilesToCollection).not.toHaveBeenCalled();
      expect(videos.updateVideo).not.toHaveBeenCalled();
    });

    it("should link the author collection without moving files when explicitly disabled", () => {
      const mockCollection: Collection = {
        id: "col1",
        name: "TestAuthor",
        title: "TestAuthor",
        videos: [],
        createdAt: "now",
      };

      (collections.getCollectionByName as any).mockReturnValue(mockCollection);
      (collections.linkVideoToCollection as any).mockReturnValue({
        ...mockCollection,
        videos: ["vid1"],
      });

      const result = organizeVideoByAuthor(
        "vid1",
        "TestAuthor",
        "author_collection_linked",
        "legacy",
        { moveFiles: false }
      );

      expect(result).toEqual({
        collection: expect.objectContaining({ id: "col1" }),
        filesMoved: false,
      });
      expect(collections.linkVideoToCollection).toHaveBeenCalledWith(
        "col1",
        "vid1",
        { moveFiles: false }
      );
    });
  });

  describe("cleanupRedundantAuthorCollectionLinks", () => {
    it("should unlink redundant author collections without moving files and delete emptied collections", () => {
      const authorCollection: Collection = {
        id: "author-col",
        name: "Author One",
        title: "Author One",
        videos: ["vid1", "vid2"],
        createdAt: "now",
      };

      (collections.getCollections as any).mockReturnValue([authorCollection]);
      (videos.getVideoById as any).mockImplementation((videoId: string) => ({
        id: videoId,
        author: "Author One",
      }));
      (collections.getCollectionsByVideoId as any).mockImplementation((videoId: string) =>
        videoId === "vid1"
          ? [
              authorCollection,
              {
                id: "playlist-col",
                name: "Playlist",
                title: "Playlist",
                videos: ["vid1"],
                createdAt: "now",
              },
            ]
          : [authorCollection]
      );
      (collections.removeVideoFromCollection as any).mockReturnValue({
        ...authorCollection,
        videos: ["vid2"],
      });
      (collections.getCollectionById as any).mockReturnValue({
        ...authorCollection,
        videos: [],
      });

      const result = cleanupRedundantAuthorCollectionLinks();

      expect(collections.removeVideoFromCollection).toHaveBeenCalledWith(
        "author-col",
        "vid1",
        { moveFiles: false }
      );
      expect(collections.deleteCollection).toHaveBeenCalledWith("author-col");
      expect(result).toEqual(
        expect.objectContaining({
          scannedCollections: 1,
          matchedAuthorCollections: 1,
          removedMemberships: 1,
          affectedVideos: 1,
          deletedCollections: ["Author One"],
        })
      );
    });

    it("should skip collections that are not author-only matches", () => {
      (collections.getCollections as any).mockReturnValue([
        {
          id: "manual-col",
          name: "Manual Picks",
          title: "Manual Picks",
          videos: ["vid1"],
          createdAt: "now",
        },
      ]);
      (videos.getVideoById as any).mockReturnValue({
        id: "vid1",
        author: "Author One",
      });

      const result = cleanupRedundantAuthorCollectionLinks();

      expect(collections.removeVideoFromCollection).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          scannedCollections: 1,
          matchedAuthorCollections: 0,
          removedMemberships: 0,
        })
      );
    });
  });
});
