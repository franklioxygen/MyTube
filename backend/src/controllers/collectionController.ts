import { Request, Response } from "express";
import * as storageService from "../services/storageService";
import { Collection } from "../services/storageService";

// Get all collections
export const getCollections = (_req: Request, res: Response): void => {
  try {
    const collections = storageService.getCollections();
    res.json(collections);
  } catch (error) {
    console.error("Error getting collections:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to get collections" });
  }
};

// Create a new collection
export const createCollection = (req: Request, res: Response): any => {
  try {
    const { name, videoId } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, error: "Collection name is required" });
    }

    // Create a new collection
    const newCollection: Collection = {
      id: Date.now().toString(),
      name,
      videos: [], // Initialize with empty videos
      createdAt: new Date().toISOString(),
      title: name, // Ensure title is also set as it's required by the interface
    };

    // Save the new collection
    storageService.saveCollection(newCollection);

    // If videoId is provided, add it to the collection (this handles file moving)
    if (videoId) {
      const updatedCollection = storageService.addVideoToCollection(newCollection.id, videoId);
      if (updatedCollection) {
        return res.status(201).json(updatedCollection);
      }
    }

    res.status(201).json(newCollection);
  } catch (error) {
    console.error("Error creating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create collection" });
  }
};

// Update a collection
export const updateCollection = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const { name, videoId, action } = req.body;

    let updatedCollection: Collection | null | undefined;

    // Handle name update first
    if (name) {
      updatedCollection = storageService.atomicUpdateCollection(id, (collection) => {
        collection.name = name;
        collection.title = name;
        return collection;
      });
    }

    // Handle video add/remove
    if (videoId) {
      if (action === "add") {
        updatedCollection = storageService.addVideoToCollection(id, videoId);
      } else if (action === "remove") {
        updatedCollection = storageService.removeVideoFromCollection(id, videoId);
      }
    }

    // If no changes requested but id exists, return current collection
    if (!name && !videoId) {
      updatedCollection = storageService.getCollectionById(id);
    }

    if (!updatedCollection) {
      return res
        .status(404)
        .json({ success: false, error: "Collection not found or update failed" });
    }

    res.json(updatedCollection);
  } catch (error) {
    console.error("Error updating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update collection" });
  }
};

// Delete a collection
export const deleteCollection = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const { deleteVideos } = req.query;

    let success = false;

    // If deleteVideos is true, delete all videos in the collection first
    if (deleteVideos === 'true') {
      success = storageService.deleteCollectionAndVideos(id);
    } else {
      // Default: Move files back to root/other, then delete collection
      success = storageService.deleteCollectionWithFiles(id);
    }

    if (!success) {
      return res
        .status(404)
        .json({ success: false, error: "Collection not found" });
    }

    res.json({ success: true, message: "Collection deleted successfully" });
  } catch (error) {
    console.error("Error deleting collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete collection" });
  }
};
