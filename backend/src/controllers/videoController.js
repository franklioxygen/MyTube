const storageService = require("../services/storageService");
const downloadService = require("../services/downloadService");
const {
  isValidUrl,
  extractUrlFromText,
  resolveShortUrl,
  isBilibiliUrl,
  trimBilibiliUrl,
  extractBilibiliVideoId,
} = require("../utils/helpers");

// Search for videos
const searchVideos = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const results = await downloadService.searchYouTube(query);
    res.status(200).json({ results });
  } catch (error) {
    console.error("Error searching for videos:", error);
    res.status(500).json({
      error: "Failed to search for videos",
      details: error.message,
    });
  }
};

// Download video
const downloadVideo = async (req, res) => {
  try {
    const { youtubeUrl, downloadAllParts, collectionName } = req.body;
    let videoUrl = youtubeUrl;

    if (!videoUrl) {
      return res.status(400).json({ error: "Video URL is required" });
    }

    console.log("Processing download request for input:", videoUrl);

    // Extract URL if the input contains text with a URL
    videoUrl = extractUrlFromText(videoUrl);
    console.log("Extracted URL:", videoUrl);

    // Check if the input is a valid URL
    if (!isValidUrl(videoUrl)) {
      // If not a valid URL, treat it as a search term
      return res.status(400).json({
        error: "Not a valid URL",
        isSearchTerm: true,
        searchTerm: videoUrl,
      });
    }

    // Set download status to true with initial title
    let initialTitle = "Downloading video...";
    if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
      initialTitle = "Downloading YouTube video...";
    } else if (isBilibiliUrl(videoUrl)) {
      initialTitle = "Downloading Bilibili video...";
    }
    storageService.updateDownloadStatus(true, initialTitle);

    // Resolve shortened URLs (like b23.tv)
    if (videoUrl.includes("b23.tv")) {
      videoUrl = await resolveShortUrl(videoUrl);
      console.log("Resolved shortened URL to:", videoUrl);
    }

    // Trim Bilibili URL if needed
    if (isBilibiliUrl(videoUrl)) {
      videoUrl = trimBilibiliUrl(videoUrl);
      console.log("Using trimmed Bilibili URL:", videoUrl);

      // If downloadAllParts is true, handle multi-part download
      if (downloadAllParts) {
        const videoId = extractBilibiliVideoId(videoUrl);
        if (!videoId) {
          storageService.updateDownloadStatus(false);
          return res
            .status(400)
            .json({ error: "Could not extract Bilibili video ID" });
        }

        // Get video info to determine number of parts
        const partsInfo = await downloadService.checkBilibiliVideoParts(videoId);

        if (!partsInfo.success) {
          storageService.updateDownloadStatus(false);
          return res
            .status(500)
            .json({ error: "Failed to get video parts information" });
        }

        const { videosNumber, title } = partsInfo;

        // Create a collection for the multi-part video if collectionName is provided
        let collectionId = null;
        if (collectionName) {
          const newCollection = {
            id: Date.now().toString(),
            name: collectionName,
            videos: [],
            createdAt: new Date().toISOString(),
          };
          storageService.saveCollection(newCollection);
          collectionId = newCollection.id;
        }

        // Start downloading the first part
        const baseUrl = videoUrl.split("?")[0];
        const firstPartUrl = `${baseUrl}?p=1`;

        storageService.updateDownloadStatus(
          true,
          `Downloading part 1/${videosNumber}: ${title}`
        );

        // Download the first part
        const firstPartResult = await downloadService.downloadSingleBilibiliPart(
          firstPartUrl,
          1,
          videosNumber,
          title
        );

        // Add to collection if needed
        if (collectionId && firstPartResult.videoData) {
          const collection = storageService.getCollectionById(collectionId);
          if (collection) {
            collection.videos.push(firstPartResult.videoData.id);
            storageService.updateCollection(collection);
          }
        }

        // Set up background download for remaining parts
        if (videosNumber > 1) {
          downloadService.downloadRemainingBilibiliParts(
            baseUrl,
            2,
            videosNumber,
            title,
            collectionId
          );
        } else {
          storageService.updateDownloadStatus(false);
        }

        return res.status(200).json({
          success: true,
          video: firstPartResult.videoData,
          isMultiPart: true,
          totalParts: videosNumber,
          collectionId,
        });
      } else {
        // Regular single video download for Bilibili
        console.log("Downloading single Bilibili video part");
        storageService.updateDownloadStatus(true, "Downloading Bilibili video...");

        // Use downloadSingleBilibiliPart for consistency, but treat as single part
        // Or use the logic from server.js which called downloadBilibiliVideo directly
        // server.js logic for single video was slightly different (it handled renaming and saving)
        // I'll use downloadSingleBilibiliPart with part 1/1 to simplify
        // Wait, downloadSingleBilibiliPart adds "Part 1/1" to title if totalParts > 1.
        // If totalParts is 1, it uses original title.

        // We need to get the title first to pass to downloadSingleBilibiliPart?
        // No, downloadSingleBilibiliPart fetches info.

        // Let's use downloadSingleBilibiliPart with totalParts=1.
        // But we don't have seriesTitle.
        // downloadSingleBilibiliPart uses seriesTitle only if totalParts > 1.

        const result = await downloadService.downloadSingleBilibiliPart(
          videoUrl,
          1,
          1,
          "" // seriesTitle not used when totalParts is 1
        );

        storageService.updateDownloadStatus(false);

        if (result.success) {
          return res.status(200).json({ success: true, video: result.videoData });
        } else {
          throw new Error(result.error || "Failed to download Bilibili video");
        }
      }
    } else {
      // YouTube download
      const videoData = await downloadService.downloadYouTubeVideo(videoUrl);
      return res.status(200).json({ success: true, video: videoData });
    }
  } catch (error) {
    console.error("Error downloading video:", error);
    storageService.updateDownloadStatus(false);
    res
      .status(500)
      .json({ error: "Failed to download video", details: error.message });
  }
};

// Get all videos
const getVideos = (req, res) => {
  try {
    const videos = storageService.getVideos();
    res.status(200).json(videos);
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
};

// Get video by ID
const getVideoById = (req, res) => {
  try {
    const { id } = req.params;
    const video = storageService.getVideoById(id);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.status(200).json(video);
  } catch (error) {
    console.error("Error fetching video:", error);
    res.status(500).json({ error: "Failed to fetch video" });
  }
};

// Delete video
const deleteVideo = (req, res) => {
  try {
    const { id } = req.params;
    const success = storageService.deleteVideo(id);

    if (!success) {
      return res.status(404).json({ error: "Video not found" });
    }

    res
      .status(200)
      .json({ success: true, message: "Video deleted successfully" });
  } catch (error) {
    console.error("Error deleting video:", error);
    res.status(500).json({ error: "Failed to delete video" });
  }
};

// Get download status
const getDownloadStatus = (req, res) => {
  try {
    const status = storageService.getDownloadStatus();
    res.status(200).json(status);
  } catch (error) {
    console.error("Error fetching download status:", error);
    res.status(500).json({ error: "Failed to fetch download status" });
  }
};

// Check Bilibili parts
const checkBilibiliParts = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    if (!isBilibiliUrl(url)) {
      return res.status(400).json({ error: "Not a valid Bilibili URL" });
    }

    // Resolve shortened URLs (like b23.tv)
    let videoUrl = url;
    if (videoUrl.includes("b23.tv")) {
      videoUrl = await resolveShortUrl(videoUrl);
      console.log("Resolved shortened URL to:", videoUrl);
    }

    // Trim Bilibili URL if needed
    videoUrl = trimBilibiliUrl(videoUrl);

    // Extract video ID
    const videoId = extractBilibiliVideoId(videoUrl);

    if (!videoId) {
      return res
        .status(400)
        .json({ error: "Could not extract Bilibili video ID" });
    }

    const result = await downloadService.checkBilibiliVideoParts(videoId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error checking Bilibili video parts:", error);
    res.status(500).json({
      error: "Failed to check Bilibili video parts",
      details: error.message,
    });
  }
};

module.exports = {
  searchVideos,
  downloadVideo,
  getVideos,
  getVideoById,
  deleteVideo,
  getDownloadStatus,
  checkBilibiliParts,
};
