import { Request, Response } from "express";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import * as storageService from "../services/storageService";
import { Collection } from "../services/storageService";
import { successMessage } from "../utils/response";

/**
 * Get all collections
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getCollections = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const collections = storageService.getCollections();
  // Return array directly for backward compatibility (frontend expects response.data to be Collection[])
  res.json(collections);
};

/**
 * Create a new collection
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns collection object directly for backward compatibility with frontend
 */
export const createCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { name, videoId } = req.body;

  if (!name) {
    throw new ValidationError("Collection name is required", "name");
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
    const updatedCollection = storageService.addVideoToCollection(
      newCollection.id,
      videoId
    );
    if (updatedCollection) {
      // Return collection object directly for backward compatibility
      res.status(201).json(updatedCollection);
      return;
    }
  }

  // Return collection object directly for backward compatibility
  res.status(201).json(newCollection);
};

/**
 * Update a collection
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns collection object directly for backward compatibility with frontend
 */
export const updateCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { name, videoId, action } = req.body;

  let updatedCollection: Collection | null | undefined;

  // Handle name update first
  if (name) {
    updatedCollection = storageService.renameCollection(id, name);
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
    throw new NotFoundError("Collection", id);
  }

  // Return collection object directly for backward compatibility
  res.json(updatedCollection);
};

/**
 * Delete a collection
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteCollection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { deleteVideos } = req.query;

  let success = false;

  // If deleteVideos is true, delete all videos in the collection first
  if (deleteVideos === "true") {
    success = storageService.deleteCollectionAndVideos(id);
  } else {
    // Default: Move files back to root/other, then delete collection
    success = storageService.deleteCollectionWithFiles(id);
  }

  if (!success) {
    throw new NotFoundError("Collection", id);
  }

  res.json(successMessage("Collection deleted successfully"));
};
