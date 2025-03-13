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
// Define path for status.json to track download status
const statusDataPath = path.join(dataDir, "status.json");

// Initialize status.json if it doesn't exist
if (!fs.existsSync(statusDataPath)) {
  fs.writeFileSync(
    statusDataPath,
    JSON.stringify({ isDownloading: false, title: "" }, null, 2)
  );
}

// Helper function to update download status
function updateDownloadStatus(isDownloading, title = "") {
  try {
    fs.writeFileSync(
      statusDataPath,
      JSON.stringify({ isDownloading, title, timestamp: Date.now() }, null, 2)
    );
    console.log(
      `Download status updated: isDownloading=${isDownloading}, title=${title}`
    );
  } catch (error) {
    console.error("Error updating download status:", error);
  }
}

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

// Helper function to check if a Bilibili video has multiple parts
async function checkBilibiliVideoParts(videoId) {
  try {
    // Try to get video info from Bilibili API
    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
    console.log("Fetching video info from API to check parts:", apiUrl);

    const response = await axios.get(apiUrl);

    if (response.data && response.data.data) {
      const videoInfo = response.data.data;
      const videosNumber = videoInfo.videos || 1;

      console.log(`Bilibili video has ${videosNumber} parts`);

      return {
        success: true,
        videosNumber,
        title: videoInfo.title || "Bilibili Video",
      };
    }

    return { success: false, videosNumber: 1 };
  } catch (error) {
    console.error("Error checking Bilibili video parts:", error);
    return { success: false, videosNumber: 1 };
  }
}

// Helper function to download a single Bilibili part
async function downloadSingleBilibiliPart(
  url,
  partNumber,
  totalParts,
  seriesTitle
) {
  try {
    console.log(
      `Downloading Bilibili part ${partNumber}/${totalParts}: ${url}`
    );

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

    // Download Bilibili video
    const bilibiliInfo = await downloadBilibiliVideo(
      url,
      videoPath,
      thumbnailPath
    );

    if (!bilibiliInfo) {
      throw new Error("Failed to get Bilibili video info");
    }

    console.log("Bilibili download info:", bilibiliInfo);

    // For multi-part videos, include the part number in the title
    videoTitle =
      totalParts > 1
        ? `${seriesTitle} - Part ${partNumber}/${totalParts}`
        : bilibiliInfo.title || "Bilibili Video";

    videoAuthor = bilibiliInfo.author || "Bilibili User";
    videoDate =
      bilibiliInfo.date ||
      new Date().toISOString().slice(0, 10).replace(/-/g, "");
    thumbnailUrl = bilibiliInfo.thumbnailUrl;
    thumbnailSaved = bilibiliInfo.thumbnailSaved;

    // Update the safe base filename with the actual title
    const newSafeBaseFilename = `${sanitizeFilename(videoTitle)}_${timestamp}`;
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

    // Create metadata for the video
    const videoData = {
      id: timestamp.toString(),
      title: videoTitle,
      author: videoAuthor,
      date: videoDate,
      source: "bilibili",
      sourceUrl: url,
      videoFilename: finalVideoFilename,
      thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : null,
      thumbnailUrl: thumbnailUrl,
      videoPath: `/videos/${finalVideoFilename}`,
      thumbnailPath: thumbnailSaved
        ? `/images/${finalThumbnailFilename}`
        : null,
      addedAt: new Date().toISOString(),
      partNumber: partNumber,
      totalParts: totalParts,
      seriesTitle: seriesTitle,
    };

    // Read existing videos data
    let videos = [];
    if (fs.existsSync(videosDataPath)) {
      videos = JSON.parse(fs.readFileSync(videosDataPath, "utf8"));
    }

    // Add new video to the list
    videos.unshift(videoData);

    // Save updated videos data
    fs.writeFileSync(videosDataPath, JSON.stringify(videos, null, 2));

    console.log(`Part ${partNumber}/${totalParts} added to database`);

    return { success: true, videoData };
  } catch (error) {
    console.error(
      `Error downloading Bilibili part ${partNumber}/${totalParts}:`,
      error
    );
    return { success: false, error: error.message };
  }
}

// Helper function to download remaining Bilibili parts in sequence
async function downloadRemainingBilibiliParts(
  baseUrl,
  startPart,
  totalParts,
  seriesTitle,
  collectionId
) {
  try {
    for (let part = startPart; part <= totalParts; part++) {
      // Update status to show which part is being downloaded
      updateDownloadStatus(
        true,
        `Downloading part ${part}/${totalParts}: ${seriesTitle}`
      );

      // Construct URL for this part
      const partUrl = `${baseUrl}?p=${part}`;

      // Download this part
      const result = await downloadSingleBilibiliPart(
        partUrl,
        part,
        totalParts,
        seriesTitle
      );

      // If download was successful and we have a collection ID, add to collection
      if (result.success && collectionId && result.videoData) {
        try {
          // Read existing collections
          const collectionsDataPath = path.join(dataDir, "collections.json");
          let collections = JSON.parse(
            fs.readFileSync(collectionsDataPath, "utf8")
          );

          // Find the collection
          const collectionIndex = collections.findIndex(
            (c) => c.id === collectionId
          );

          if (collectionIndex !== -1) {
            // Add video to collection
            collections[collectionIndex].videos.push(result.videoData.id);

            // Save updated collections
            fs.writeFileSync(
              collectionsDataPath,
              JSON.stringify(collections, null, 2)
            );

            console.log(
              `Added part ${part}/${totalParts} to collection ${collectionId}`
            );
          }
        } catch (collectionError) {
          console.error(
            `Error adding part ${part}/${totalParts} to collection:`,
            collectionError
          );
        }
      }

      // Small delay between downloads to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // All parts downloaded, update status
    updateDownloadStatus(false);
    console.log(
      `All ${totalParts} parts of "${seriesTitle}" downloaded successfully`
    );
  } catch (error) {
    console.error("Error downloading remaining Bilibili parts:", error);
    updateDownloadStatus(false);
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
    const { youtubeUrl, downloadAllParts, collectionName } = req.body;
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

    // Set download status to true with initial title
    let initialTitle = "Downloading video...";
    if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
      initialTitle = "Downloading YouTube video...";
    } else if (
      videoUrl.includes("bilibili.com") ||
      videoUrl.includes("b23.tv")
    ) {
      initialTitle = "Downloading Bilibili video...";
    }
    updateDownloadStatus(true, initialTitle);

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
          updateDownloadStatus(false);
          return res
            .status(400)
            .json({ error: "Could not extract Bilibili video ID" });
        }

        // Get video info to determine number of parts
        const partsInfo = await checkBilibiliVideoParts(videoId);

        if (!partsInfo.success) {
          updateDownloadStatus(false);
          return res
            .status(500)
            .json({ error: "Failed to get video parts information" });
        }

        const { videosNumber, title } = partsInfo;

        // Create a collection for the multi-part video if collectionName is provided
        let collectionId = null;
        if (collectionName) {
          // Read existing collections
          const collectionsDataPath = path.join(dataDir, "collections.json");
          let collections = [];

          if (fs.existsSync(collectionsDataPath)) {
            collections = JSON.parse(
              fs.readFileSync(collectionsDataPath, "utf8")
            );
          }

          // Create a new collection
          const newCollection = {
            id: Date.now().toString(),
            name: collectionName,
            videos: [],
            createdAt: new Date().toISOString(),
          };

          // Add the new collection
          collections.push(newCollection);

          // Save the updated collections
          fs.writeFileSync(
            collectionsDataPath,
            JSON.stringify(collections, null, 2)
          );

          collectionId = newCollection.id;
        }

        // Start downloading the first part
        const baseUrl = videoUrl.split("?")[0];
        const firstPartUrl = `${baseUrl}?p=1`;

        updateDownloadStatus(
          true,
          `Downloading part 1/${videosNumber}: ${title}`
        );

        // Download the first part
        const firstPartResult = await downloadSingleBilibiliPart(
          firstPartUrl,
          1,
          videosNumber,
          title
        );

        // Add to collection if needed
        if (collectionId && firstPartResult.videoData) {
          // Read existing collections
          const collectionsDataPath = path.join(dataDir, "collections.json");
          let collections = JSON.parse(
            fs.readFileSync(collectionsDataPath, "utf8")
          );

          // Find the collection
          const collectionIndex = collections.findIndex(
            (c) => c.id === collectionId
          );

          if (collectionIndex !== -1) {
            // Add video to collection
            collections[collectionIndex].videos.push(
              firstPartResult.videoData.id
            );

            // Save updated collections
            fs.writeFileSync(
              collectionsDataPath,
              JSON.stringify(collections, null, 2)
            );
          }
        }

        // Set up background download for remaining parts
        if (videosNumber > 1) {
          // We'll handle the remaining parts in the background
          // The client will poll the download status endpoint to check progress
          downloadRemainingBilibiliParts(
            baseUrl,
            2,
            videosNumber,
            title,
            collectionId
          );
        } else {
          // Only one part, we're done
          updateDownloadStatus(false);
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

        updateDownloadStatus(true, "Downloading Bilibili video...");

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

          // Update download status with actual title
          updateDownloadStatus(true, `Downloading: ${videoTitle}`);

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
          // Set download status to false on error
          updateDownloadStatus(false);
          return res.status(500).json({
            error: "Failed to download Bilibili video",
            details: bilibiliError.message,
          });
        }

        // Create metadata for the video
        const videoData = {
          id: timestamp.toString(),
          title: videoTitle || "Video",
          author: videoAuthor || "Unknown",
          date:
            videoDate ||
            new Date().toISOString().slice(0, 10).replace(/-/g, ""),
          source: "bilibili",
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

        // Read existing videos data
        let videos = [];
        if (fs.existsSync(videosDataPath)) {
          videos = JSON.parse(fs.readFileSync(videosDataPath, "utf8"));
        }

        // Add new video to the list
        videos.unshift(videoData);

        // Save updated videos data
        fs.writeFileSync(videosDataPath, JSON.stringify(videos, null, 2));

        // Set download status to false when complete
        updateDownloadStatus(false);

        return res.status(200).json({ success: true, video: videoData });
      }
    } else {
      console.log("Detected YouTube URL");
      updateDownloadStatus(true, "Downloading YouTube video...");

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

        // Update download status with actual title
        updateDownloadStatus(true, `Downloading: ${videoTitle}`);

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
        // Set download status to false on error
        updateDownloadStatus(false);
        return res.status(500).json({
          error: "Failed to download YouTube video",
          details: youtubeError.message,
        });
      }

      // Create metadata for the video
      const videoData = {
        id: timestamp.toString(),
        title: videoTitle || "Video",
        author: videoAuthor || "Unknown",
        date:
          videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        source: "youtube",
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

      // Set download status to false when complete
      updateDownloadStatus(false);

      return res.status(200).json({ success: true, video: videoData });
    }
  } catch (error) {
    console.error("Error downloading video:", error);
    // Set download status to false on error
    updateDownloadStatus(false);
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
    // Read collections from the JSON file
    const collectionsDataPath = path.join(dataDir, "collections.json");

    if (!fs.existsSync(collectionsDataPath)) {
      // If the file doesn't exist yet, return an empty array
      return res.json([]);
    }

    const collections = JSON.parse(
      fs.readFileSync(collectionsDataPath, "utf8")
    );
    res.json(collections);
  } catch (error) {
    console.error("Error getting collections:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to get collections" });
  }
});

app.post("/api/collections", (req, res) => {
  try {
    const { name, videoId } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, error: "Collection name is required" });
    }

    // Read existing collections
    const collectionsDataPath = path.join(dataDir, "collections.json");
    let collections = [];

    if (fs.existsSync(collectionsDataPath)) {
      collections = JSON.parse(fs.readFileSync(collectionsDataPath, "utf8"));
    }

    // Create a new collection
    const newCollection = {
      id: Date.now().toString(),
      name,
      videos: videoId ? [videoId] : [],
      createdAt: new Date().toISOString(),
    };

    // Add the new collection
    collections.push(newCollection);

    // Save the updated collections
    fs.writeFileSync(collectionsDataPath, JSON.stringify(collections, null, 2));

    res.status(201).json(newCollection);
  } catch (error) {
    console.error("Error creating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to create collection" });
  }
});

app.put("/api/collections/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, videoId, action } = req.body;

    // Read existing collections
    const collectionsDataPath = path.join(dataDir, "collections.json");

    if (!fs.existsSync(collectionsDataPath)) {
      return res
        .status(404)
        .json({ success: false, error: "Collections not found" });
    }

    let collections = JSON.parse(fs.readFileSync(collectionsDataPath, "utf8"));

    // Find the collection to update
    const collectionIndex = collections.findIndex((c) => c.id === id);

    if (collectionIndex === -1) {
      return res
        .status(404)
        .json({ success: false, error: "Collection not found" });
    }

    const collection = collections[collectionIndex];

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

    // Update the collection in the array
    collections[collectionIndex] = collection;

    // Save the updated collections
    fs.writeFileSync(collectionsDataPath, JSON.stringify(collections, null, 2));

    res.json(collection);
  } catch (error) {
    console.error("Error updating collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update collection" });
  }
});

app.delete("/api/collections/:id", (req, res) => {
  try {
    const { id } = req.params;

    // Read existing collections
    const collectionsDataPath = path.join(dataDir, "collections.json");

    if (!fs.existsSync(collectionsDataPath)) {
      return res
        .status(404)
        .json({ success: false, error: "Collections not found" });
    }

    let collections = JSON.parse(fs.readFileSync(collectionsDataPath, "utf8"));

    // Filter out the collection to delete
    const updatedCollections = collections.filter((c) => c.id !== id);

    // If the length is the same, the collection wasn't found
    if (updatedCollections.length === collections.length) {
      return res
        .status(404)
        .json({ success: false, error: "Collection not found" });
    }

    // Save the updated collections
    fs.writeFileSync(
      collectionsDataPath,
      JSON.stringify(updatedCollections, null, 2)
    );

    res.json({ success: true, message: "Collection deleted successfully" });
  } catch (error) {
    console.error("Error deleting collection:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete collection" });
  }
});

// API endpoint to get download status
app.get("/api/download-status", (req, res) => {
  try {
    if (!fs.existsSync(statusDataPath)) {
      updateDownloadStatus(false);
      return res.status(200).json({ isDownloading: false, title: "" });
    }

    const status = JSON.parse(fs.readFileSync(statusDataPath, "utf8"));

    // Check if the status is stale (older than 5 minutes)
    const now = Date.now();
    if (status.timestamp && now - status.timestamp > 5 * 60 * 1000) {
      console.log("Download status is stale, resetting to false");
      updateDownloadStatus(false);
      return res.status(200).json({ isDownloading: false, title: "" });
    }

    res.status(200).json(status);
  } catch (error) {
    console.error("Error fetching download status:", error);
    res.status(500).json({ error: "Failed to fetch download status" });
  }
});

// API endpoint to check if a Bilibili video has multiple parts
app.get("/api/check-bilibili-parts", async (req, res) => {
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

    const result = await checkBilibiliVideoParts(videoId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error checking Bilibili video parts:", error);
    res.status(500).json({
      error: "Failed to check Bilibili video parts",
      details: error.message,
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
