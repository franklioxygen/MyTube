const storageService = require("../services/storageService");

// Get all collections
const getCollections = (req, res) => {
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
const createCollection = (req, res) => {
  try {
    const { name, videoId } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, error: "Collection name is required" });
    }

    // Create a new collection
    const newCollection = {
      id: Date.now().toString(),
      name,
      videos: videoId ? [videoId] : [],
      createdAt: new Date().toISOString(),
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
const updateCollection = (req, res) => {
  try {
    const { id } = req.params;
    const { name, videoId, action } = req.body;

    const collection = storageService.getCollectionById(id);

    if (!collection) {
      return res
        .status(404)
        .json({ success: false, error: "Collection not found" });
    }

    // Update the collection
    if (name) {
      collection.name = name;
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

    collection.updatedAt = new Date().toISOString();

    // Save the updated collection
    const success = storageService.updateCollection(collection);

    if (!success) {
      return res
        .status(500)
        .json({ success: false, error: "Failed to update collection" });
    }

    res.json(collection);
  } catch (error) {
    console.error("Error updating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update collection" });
  }
};

// Delete a collection
const deleteCollection = (req, res) => {
  try {
    const { id } = req.params;

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

module.exports = {
  getCollections,
  createCollection,
  updateCollection,
  deleteCollection,
};
