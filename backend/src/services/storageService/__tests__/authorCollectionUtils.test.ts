import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    addVideoToAuthorCollection,
    findOrCreateAuthorCollection,
    validateCollectionName,
} from "../authorCollectionUtils";
import * as collections from "../collections";
import { Collection } from "../types";

// Mock the collections module
vi.mock("../collections", () => ({
  addVideoToCollection: vi.fn(),
  generateUniqueCollectionName: vi.fn((name) => name),
  getCollectionByName: vi.fn(),
  saveCollection: vi.fn(),
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
      (collections.addVideoToCollection as any).mockReturnValue(
        updatedCollection
      );

      const result = addVideoToAuthorCollection("vid1", "TestAuthor", true);

      expect(result).toEqual(updatedCollection);
      expect(collections.getCollectionByName).toHaveBeenCalledWith(
        "TestAuthor"
      );
      expect(collections.addVideoToCollection).toHaveBeenCalledWith(
        "col1",
        "vid1"
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
});
