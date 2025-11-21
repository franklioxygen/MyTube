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

const downloadManager = require("../services/downloadManager");

// ... (imports remain the same)

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

    // Determine initial title for the download task
    let initialTitle = "Video";
    if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
      initialTitle = "YouTube Video";
    } else if (isBilibiliUrl(videoUrl)) {
      initialTitle = "Bilibili Video";
    }

    // Generate a unique ID for this download task
    const downloadId = Date.now().toString();

    // Define the download task function
    const downloadTask = async () => {
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
            throw new Error("Could not extract Bilibili video ID");
          }

          // Get video info to determine number of parts
          const partsInfo = await downloadService.checkBilibiliVideoParts(videoId);

          if (!partsInfo.success) {
            throw new Error("Failed to get video parts information");
          }

          const { videosNumber, title } = partsInfo;
          
          // Update title in storage
          storageService.addActiveDownload(downloadId, title);

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

          // Download the first part
          const firstPartResult = await downloadService.downloadSingleBilibiliPart(
            firstPartUrl,
            1,
            videosNumber,
            title
          );

          // Add to collection if needed
          if (collectionId && firstPartResult.videoData) {
            storageService.atomicUpdateCollection(collectionId, (collection) => {
              collection.videos.push(firstPartResult.videoData.id);
              return collection;
            });
          }

          // Set up background download for remaining parts
          // Note: We don't await this, it runs in background
          // But we should probably track it? For now, let's keep it simple
          // and only track the first part as the "main" download
          if (videosNumber > 1) {
            downloadService.downloadRemainingBilibiliParts(
              baseUrl,
              2,
              videosNumber,
              title,
              collectionId
            );
          }

          return {
            success: true,
            video: firstPartResult.videoData,
            isMultiPart: true,
            totalParts: videosNumber,
            collectionId,
          };
        } else {
          // Regular single video download for Bilibili
          console.log("Downloading single Bilibili video part");
          
          const result = await downloadService.downloadSingleBilibiliPart(
            videoUrl,
            1,
            1,
            "" // seriesTitle not used when totalParts is 1
          );

          if (result.success) {
            return { success: true, video: result.videoData };
          } else {
            throw new Error(result.error || "Failed to download Bilibili video");
          }
        }
      } else {
        // YouTube download
        const videoData = await downloadService.downloadYouTubeVideo(videoUrl);
        return { success: true, video: videoData };
      }
    };

    // Add to download manager
    // We don't await the result here because we want to return immediately
    // that the download has been queued/started
    downloadManager.addDownload(downloadTask, downloadId, initialTitle)
      .then(result => {
        console.log("Download completed successfully:", result);
      })
      .catch(error => {
        console.error("Download failed:", error);
      });

    // Return success immediately indicating the download is queued/started
    // We can't return the video object yet because it hasn't been downloaded
    // The frontend will need to refresh or listen for updates
    res.status(200).json({ 
      success: true, 
      message: "Download queued", 
      downloadId 
    });

  } catch (error) {
    console.error("Error queuing download:", error);
    res
      .status(500)
      .json({ error: "Failed to queue download", details: error.message });
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
