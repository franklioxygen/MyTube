// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const youtubedl = require("youtube-dl-exec");
const axios = require("axios");
const { downloadByVedioPath } = require("bilibili-save-nodejs");
const VERSION = require("./version");

// Display version information
VERSION.displayVersion();

const app = express();
const PORT = process.env.PORT || 5551;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory and subdirectories if they don't exist
const uploadsDir = path.join(__dirname, "uploads");
const videosDir = path.join(uploadsDir, "videos");
const imagesDir = path.join(uploadsDir, "images");
const dataDir = path.join(__dirname, "data");

fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(videosDir);
fs.ensureDirSync(imagesDir);
fs.ensureDirSync(dataDir);

// Define path for videos.json in the data directory for persistence
const videosDataPath = path.join(dataDir, "videos.json");

// Serve static files from the uploads directory
app.use("/videos", express.static(videosDir));
app.use("/images", express.static(imagesDir));

// Helper function to check if a string is a valid URL
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Helper function to check if a URL is from Bilibili
function isBilibiliUrl(url) {
  return url.includes("bilibili.com") || url.includes("b23.tv");
}

// Helper function to extract URL from text that might contain a title and URL
function extractUrlFromText(text) {
  // Regular expression to find URLs in text
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);

  if (matches && matches.length > 0) {
    return matches[0];
  }

  return text; // Return original text if no URL found
}

// Helper function to resolve shortened URLs (like b23.tv)
async function resolveShortUrl(url) {
  try {
    console.log(`Resolving shortened URL: ${url}`);

    // Make a HEAD request to follow redirects
    const response = await axios.head(url, {
      maxRedirects: 5,
      validateStatus: null,
    });

    // Get the final URL after redirects
    const resolvedUrl = response.request.res.responseUrl || url;
    console.log(`Resolved to: ${resolvedUrl}`);

    return resolvedUrl;
  } catch (error) {
    console.error(`Error resolving shortened URL: ${error.message}`);
    return url; // Return original URL if resolution fails
  }
}

// Helper function to trim Bilibili URL by removing query parameters
function trimBilibiliUrl(url) {
  try {
    // First, extract the video ID (BV or av format)
    const videoIdMatch = url.match(/\/video\/(BV[\w]+|av\d+)/i);

    if (videoIdMatch && videoIdMatch[1]) {
      const videoId = videoIdMatch[1];
      // Construct a clean URL with just the video ID
      const cleanUrl = videoId.startsWith("BV")
        ? `https://www.bilibili.com/video/${videoId}`
        : `https://www.bilibili.com/video/${videoId}`;

      console.log(`Trimmed Bilibili URL from "${url}" to "${cleanUrl}"`);
      return cleanUrl;
    }

    // If we couldn't extract the video ID using the regex above,
    // try to clean the URL by removing query parameters
    try {
      const urlObj = new URL(url);
      const cleanUrl = `${urlObj.origin}${urlObj.pathname}`;
      console.log(`Trimmed Bilibili URL from "${url}" to "${cleanUrl}"`);
      return cleanUrl;
    } catch (urlError) {
      console.error("Error parsing URL:", urlError);
      return url;
    }
  } catch (error) {
    console.error("Error trimming Bilibili URL:", error);
    return url; // Return original URL if there's an error
  }
}

// Helper function to extract video ID from Bilibili URL
function extractBilibiliVideoId(url) {
  // Extract BV ID from URL - works for both desktop and mobile URLs
  const bvMatch = url.match(/\/video\/(BV[\w]+)/i);
  if (bvMatch && bvMatch[1]) {
    return bvMatch[1];
  }

  // Extract av ID from URL
  const avMatch = url.match(/\/video\/(av\d+)/i);
  if (avMatch && avMatch[1]) {
    return avMatch[1];
  }

  return null;
}

// Helper function to create a safe filename that preserves non-Latin characters
function sanitizeFilename(filename) {
  // Replace only unsafe characters for filesystems
  // This preserves non-Latin characters like Chinese, Japanese, Korean, etc.
  return filename
    .replace(/[\/\\:*?"<>|]/g, "_") // Replace unsafe filesystem characters
    .replace(/\s+/g, "_"); // Replace spaces with underscores
}

// Helper function to download Bilibili video
async function downloadBilibiliVideo(url, videoPath, thumbnailPath) {
  try {
    // Create a temporary directory for the download
    const tempDir = path.join(videosDir, "temp");
    fs.ensureDirSync(tempDir);

    console.log("Downloading Bilibili video to temp directory:", tempDir);

    // Download the video using the package
    await downloadByVedioPath({
      url: url,
      type: "mp4",
      folder: tempDir,
    });

    console.log("Download completed, checking for video file");

    // Find the downloaded file
    const files = fs.readdirSync(tempDir);
    console.log("Files in temp directory:", files);

    const videoFile = files.find((file) => file.endsWith(".mp4"));

    if (!videoFile) {
      throw new Error("Downloaded video file not found");
    }

    console.log("Found video file:", videoFile);

    // Move the file to the desired location
    const tempVideoPath = path.join(tempDir, videoFile);
    fs.moveSync(tempVideoPath, videoPath, { overwrite: true });

    console.log("Moved video file to:", videoPath);

    // Clean up temp directory
    fs.removeSync(tempDir);

    // Extract video title from filename (remove extension)
    const videoTitle = videoFile.replace(".mp4", "") || "Bilibili Video";

    // Try to get thumbnail from Bilibili
    let thumbnailSaved = false;
    let thumbnailUrl = null;
    const videoId = extractBilibiliVideoId(url);

    console.log("Extracted video ID:", videoId);

    if (videoId) {
      try {
        // Try to get video info from Bilibili API
        const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
        console.log("Fetching video info from API:", apiUrl);

        const response = await axios.get(apiUrl);

        if (response.data && response.data.data) {
          const videoInfo = response.data.data;
          thumbnailUrl = videoInfo.pic;

          console.log("Got video info from API:", {
            title: videoInfo.title,
            author: videoInfo.owner?.name,
            thumbnailUrl: thumbnailUrl,
          });

          if (thumbnailUrl) {
            // Download thumbnail
            console.log("Downloading thumbnail from:", thumbnailUrl);

            const thumbnailResponse = await axios({
              method: "GET",
              url: thumbnailUrl,
              responseType: "stream",
            });

            const thumbnailWriter = fs.createWriteStream(thumbnailPath);
            thumbnailResponse.data.pipe(thumbnailWriter);

            await new Promise((resolve, reject) => {
              thumbnailWriter.on("finish", () => {
                thumbnailSaved = true;
                resolve();
              });
              thumbnailWriter.on("error", reject);
            });

            console.log("Thumbnail saved to:", thumbnailPath);

            return {
              title: videoInfo.title || videoTitle,
              author: videoInfo.owner?.name || "Bilibili User",
              date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
              thumbnailUrl: thumbnailUrl,
              thumbnailSaved,
            };
          }
        }
      } catch (thumbnailError) {
        console.error("Error downloading Bilibili thumbnail:", thumbnailError);
      }
    }

    console.log("Using basic video info");

    // Return basic info if we couldn't get detailed info
    return {
      title: videoTitle,
      author: "Bilibili User",
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: null,
      thumbnailSaved: false,
    };
  } catch (error) {
    console.error("Error in downloadBilibiliVideo:", error);

    // Make sure we clean up the temp directory if it exists
    const tempDir = path.join(videosDir, "temp");
    if (fs.existsSync(tempDir)) {
      fs.removeSync(tempDir);
    }

    // Return a default object to prevent undefined errors
    return {
      title: "Bilibili Video",
      author: "Bilibili User",
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: null,
      thumbnailSaved: false,
      error: error.message,
    };
  }
}

// API endpoint to search for videos on YouTube
app.get("/api/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log("Processing search request for query:", query);

    // Use youtube-dl to search for videos
    const searchResults = await youtubedl(`ytsearch5:${query}`, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      skipDownload: true,
      playlistEnd: 5, // Limit to 5 results
    });

    if (!searchResults || !searchResults.entries) {
      return res.status(200).json({ results: [] });
    }

    // Format the search results
    const formattedResults = searchResults.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      author: entry.uploader,
      thumbnailUrl: entry.thumbnail,
      duration: entry.duration,
      viewCount: entry.view_count,
      sourceUrl: `https://www.youtube.com/watch?v=${entry.id}`,
      source: "youtube",
    }));

    console.log(
      `Found ${formattedResults.length} search results for "${query}"`
    );

    res.status(200).json({ results: formattedResults });
  } catch (error) {
    console.error("Error searching for videos:", error);
    res.status(500).json({
      error: "Failed to search for videos",
      details: error.message,
    });
  }
});

// API endpoint to download a video (YouTube or Bilibili)
app.post("/api/download", async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    let videoUrl = youtubeUrl; // Keep the parameter name for backward compatibility

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

    // Resolve shortened URLs (like b23.tv)
    if (videoUrl.includes("b23.tv")) {
      videoUrl = await resolveShortUrl(videoUrl);
      console.log("Resolved shortened URL to:", videoUrl);
    }

    // Trim Bilibili URL if needed
    if (isBilibiliUrl(videoUrl)) {
      videoUrl = trimBilibiliUrl(videoUrl);
      console.log("Using trimmed Bilibili URL:", videoUrl);
    }

    // Create a safe base filename (without extension)
    const timestamp = Date.now();
    const safeBaseFilename = `video_${timestamp}`;

    // Add extensions for video and thumbnail
    const videoFilename = `${safeBaseFilename}.mp4`;
    const thumbnailFilename = `${safeBaseFilename}.jpg`;

    // Set full paths for video and thumbnail
    const videoPath = path.join(videosDir, videoFilename);
    const thumbnailPath = path.join(imagesDir, thumbnailFilename);

    let videoTitle, videoAuthor, videoDate, thumbnailUrl, thumbnailSaved;
    let finalVideoFilename = videoFilename;
    let finalThumbnailFilename = thumbnailFilename;

    // Check if it's a Bilibili URL
    if (isBilibiliUrl(videoUrl)) {
      console.log("Detected Bilibili URL");

      try {
        // Download Bilibili video
        const bilibiliInfo = await downloadBilibiliVideo(
          videoUrl,
          videoPath,
          thumbnailPath
        );

        if (!bilibiliInfo) {
          throw new Error("Failed to get Bilibili video info");
        }

        console.log("Bilibili download info:", bilibiliInfo);

        videoTitle = bilibiliInfo.title || "Bilibili Video";
        videoAuthor = bilibiliInfo.author || "Bilibili User";
        videoDate =
          bilibiliInfo.date ||
          new Date().toISOString().slice(0, 10).replace(/-/g, "");
        thumbnailUrl = bilibiliInfo.thumbnailUrl;
        thumbnailSaved = bilibiliInfo.thumbnailSaved;

        // Update the safe base filename with the actual title
        const newSafeBaseFilename = `${sanitizeFilename(
          videoTitle
        )}_${timestamp}`;
        const newVideoFilename = `${newSafeBaseFilename}.mp4`;
        const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

        // Rename the files
        const newVideoPath = path.join(videosDir, newVideoFilename);
        const newThumbnailPath = path.join(imagesDir, newThumbnailFilename);

        if (fs.existsSync(videoPath)) {
          fs.renameSync(videoPath, newVideoPath);
          console.log("Renamed video file to:", newVideoFilename);
          finalVideoFilename = newVideoFilename;
        } else {
          console.log("Video file not found at:", videoPath);
        }

        if (thumbnailSaved && fs.existsSync(thumbnailPath)) {
          fs.renameSync(thumbnailPath, newThumbnailPath);
          console.log("Renamed thumbnail file to:", newThumbnailFilename);
          finalThumbnailFilename = newThumbnailFilename;
        }
      } catch (bilibiliError) {
        console.error("Error in Bilibili download process:", bilibiliError);
        return res.status(500).json({
          error: "Failed to download Bilibili video",
          details: bilibiliError.message,
        });
      }
    } else {
      console.log("Detected YouTube URL");

      try {
        // Get YouTube video info first
        const info = await youtubedl(videoUrl, {
          dumpSingleJson: true,
          noWarnings: true,
          noCallHome: true,
          preferFreeFormats: true,
          youtubeSkipDashManifest: true,
        });

        console.log("YouTube video info:", {
          title: info.title,
          uploader: info.uploader,
          upload_date: info.upload_date,
        });

        videoTitle = info.title || "YouTube Video";
        videoAuthor = info.uploader || "YouTube User";
        videoDate =
          info.upload_date ||
          new Date().toISOString().slice(0, 10).replace(/-/g, "");
        thumbnailUrl = info.thumbnail;

        // Update the safe base filename with the actual title
        const newSafeBaseFilename = `${sanitizeFilename(
          videoTitle
        )}_${timestamp}`;
        const newVideoFilename = `${newSafeBaseFilename}.mp4`;
        const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

        // Update the filenames
        finalVideoFilename = newVideoFilename;
        finalThumbnailFilename = newThumbnailFilename;

        // Update paths
        const newVideoPath = path.join(videosDir, finalVideoFilename);
        const newThumbnailPath = path.join(imagesDir, finalThumbnailFilename);

        // Download the YouTube video
        console.log("Downloading YouTube video to:", newVideoPath);

        await youtubedl(videoUrl, {
          output: newVideoPath,
          format: "mp4",
        });

        console.log("YouTube video downloaded successfully");

        // Download and save the thumbnail
        thumbnailSaved = false;

        // Download the thumbnail image
        if (thumbnailUrl) {
          try {
            console.log("Downloading thumbnail from:", thumbnailUrl);

            const thumbnailResponse = await axios({
              method: "GET",
              url: thumbnailUrl,
              responseType: "stream",
            });

            const thumbnailWriter = fs.createWriteStream(newThumbnailPath);
            thumbnailResponse.data.pipe(thumbnailWriter);

            await new Promise((resolve, reject) => {
              thumbnailWriter.on("finish", () => {
                thumbnailSaved = true;
                resolve();
              });
              thumbnailWriter.on("error", reject);
            });

            console.log("Thumbnail saved to:", newThumbnailPath);
          } catch (thumbnailError) {
            console.error("Error downloading thumbnail:", thumbnailError);
            // Continue even if thumbnail download fails
          }
        }
      } catch (youtubeError) {
        console.error("Error in YouTube download process:", youtubeError);
        return res.status(500).json({
          error: "Failed to download YouTube video",
          details: youtubeError.message,
        });
      }
    }

    // Create metadata for the video
    const videoData = {
      id: timestamp.toString(),
      title: videoTitle || "Video",
      author: videoAuthor || "Unknown",
      date:
        videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      source: isBilibiliUrl(videoUrl) ? "bilibili" : "youtube",
      sourceUrl: videoUrl,
      videoFilename: finalVideoFilename,
      thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : null,
      thumbnailUrl: thumbnailUrl,
      videoPath: `/videos/${finalVideoFilename}`,
      thumbnailPath: thumbnailSaved
        ? `/images/${finalThumbnailFilename}`
        : null,
      addedAt: new Date().toISOString(),
    };

    console.log("Video metadata:", videoData);

    // Read existing videos data
    let videos = [];
    if (fs.existsSync(videosDataPath)) {
      videos = JSON.parse(fs.readFileSync(videosDataPath, "utf8"));
    }

    // Add new video to the list
    videos.unshift(videoData);

    // Save updated videos data
    fs.writeFileSync(videosDataPath, JSON.stringify(videos, null, 2));

    console.log("Video added to database");

    res.status(200).json({ success: true, video: videoData });
  } catch (error) {
    console.error("Error downloading video:", error);
    res
      .status(500)
      .json({ error: "Failed to download video", details: error.message });
  }
});

// API endpoint to get all videos
app.get("/api/videos", (req, res) => {
  try {
    if (!fs.existsSync(videosDataPath)) {
      return res.status(200).json([]);
    }

    const videos = JSON.parse(fs.readFileSync(videosDataPath, "utf8"));
    res.status(200).json(videos);
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

// API endpoint to get a single video by ID
app.get("/api/videos/:id", (req, res) => {
  try {
    const { id } = req.params;

    if (!fs.existsSync(videosDataPath)) {
      return res.status(404).json({ error: "Video not found" });
    }

    const videos = JSON.parse(fs.readFileSync(videosDataPath, "utf8"));
    const video = videos.find((v) => v.id === id);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.status(200).json(video);
  } catch (error) {
    console.error("Error fetching video:", error);
    res.status(500).json({ error: "Failed to fetch video" });
  }
});

// API endpoint to delete a video
app.delete("/api/videos/:id", (req, res) => {
  try {
    const { id } = req.params;

    if (!fs.existsSync(videosDataPath)) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Read existing videos
    let videos = JSON.parse(fs.readFileSync(videosDataPath, "utf8"));

    // Find the video to delete
    const videoToDelete = videos.find((v) => v.id === id);

    if (!videoToDelete) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Remove the video file from the videos directory
    if (videoToDelete.videoFilename) {
      const videoFilePath = path.join(videosDir, videoToDelete.videoFilename);
      if (fs.existsSync(videoFilePath)) {
        fs.unlinkSync(videoFilePath);
      }
    }

    // Remove the thumbnail file from the images directory
    if (videoToDelete.thumbnailFilename) {
      const thumbnailFilePath = path.join(
        imagesDir,
        videoToDelete.thumbnailFilename
      );
      if (fs.existsSync(thumbnailFilePath)) {
        fs.unlinkSync(thumbnailFilePath);
      }
    }

    // Filter out the deleted video from the videos array
    videos = videos.filter((v) => v.id !== id);

    // Save the updated videos array
    fs.writeFileSync(videosDataPath, JSON.stringify(videos, null, 2));

    res
      .status(200)
      .json({ success: true, message: "Video deleted successfully" });
  } catch (error) {
    console.error("Error deleting video:", error);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

// Collections API endpoints
app.get("/api/collections", (req, res) => {
  try {
    // Collections are stored client-side in localStorage
    // This endpoint is just a placeholder for future server-side implementation
    res.json({ success: true, message: "Collections are managed client-side" });
  } catch (error) {
    console.error("Error getting collections:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to get collections" });
  }
});

app.post("/api/collections", (req, res) => {
  try {
    // Collections are stored client-side in localStorage
    // This endpoint is just a placeholder for future server-side implementation
    res.json({ success: true, message: "Collection created (client-side)" });
  } catch (error) {
    console.error("Error creating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create collection" });
  }
});

app.put("/api/collections/:id", (req, res) => {
  try {
    // Collections are stored client-side in localStorage
    // This endpoint is just a placeholder for future server-side implementation
    res.json({ success: true, message: "Collection updated (client-side)" });
  } catch (error) {
    console.error("Error updating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update collection" });
  }
});

app.delete("/api/collections/:id", (req, res) => {
  try {
    // Collections are stored client-side in localStorage
    // This endpoint is just a placeholder for future server-side implementation
    res.json({ success: true, message: "Collection deleted (client-side)" });
  } catch (error) {
    console.error("Error deleting collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete collection" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
