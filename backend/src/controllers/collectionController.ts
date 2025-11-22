import { Request, Response } from "express";
import * as storageService from "../services/storageService";
import { Collection } from "../services/storageService";

// Get all collections
export const getCollections = (req: Request, res: Response): void => {
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
      videos: videoId ? [videoId] : [],
      createdAt: new Date().toISOString(),
      title: name, // Ensure title is also set as it's required by the interface
    };

    // Save the new collection
    storageService.saveCollection(newCollection);

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

    // Update the collection atomically
    const updatedCollection = storageService.atomicUpdateCollection(
      id,
      (collection) => {
        // Update the collection
        if (name) {
          collection.name = name;
          collection.title = name; // Update title as well
        }

        // Add or remove a video
        if (videoId) {
          if (action === "add") {
            // Add the video if it's not already in the collection
            if (!collection.videos.includes(videoId)) {
              collection.videos.push(videoId);
            }
          } else if (action === "remove") {
            // Remove the video
            collection.videos = collection.videos.filter((v) => v !== videoId);
          }
        }

        return collection;
      }
    );

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

    // If deleteVideos is true, delete all videos in the collection first
    if (deleteVideos === 'true') {
      const collection = storageService.getCollectionById(id);
      if (collection && collection.videos && collection.videos.length > 0) {
        collection.videos.forEach((videoId) => {
          storageService.deleteVideo(videoId);
        });
      }
    }

    const success = storageService.deleteCollection(id);

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
