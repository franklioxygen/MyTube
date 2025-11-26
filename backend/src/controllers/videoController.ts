import { exec } from "child_process";
import { Request, Response } from "express";
import fs from "fs-extra";
import multer from "multer";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import downloadManager from "../services/downloadManager";
import * as downloadService from "../services/downloadService";
import { getVideoDuration } from "../services/metadataService";
import * as storageService from "../services/storageService";
import {
  extractBilibiliVideoId,
  extractUrlFromText,
  isBilibiliUrl,
  isValidUrl,
  resolveShortUrl,
  trimBilibiliUrl
} from "../utils/helpers";

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.ensureDirSync(VIDEOS_DIR);
    cb(null, VIDEOS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({ storage: storage });

// Search for videos
export const searchVideos = async (req: Request, res: Response): Promise<any> => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const results = await downloadService.searchYouTube(query as string);
    res.status(200).json({ results });
  } catch (error: any) {
    console.error("Error searching for videos:", error);
    res.status(500).json({
      error: "Failed to search for videos",
      details: error.message,
    });
  }
};

// Download video
export const downloadVideo = async (req: Request, res: Response): Promise<any> => {
  try {
    const { youtubeUrl, downloadAllParts, collectionName, downloadCollection, collectionInfo } = req.body;
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
    } else if (videoUrl.includes("missav")) {
      initialTitle = "MissAV Video";
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

        // If downloadCollection is true, handle collection/series download
        if (downloadCollection && collectionInfo) {
          console.log("Downloading Bilibili collection/series");
          
          const result = await downloadService.downloadBilibiliCollection(
            collectionInfo,
            collectionName,
            downloadId
          );

          if (result.success) {
            return {
              success: true,
              collectionId: result.collectionId,
              videosDownloaded: result.videosDownloaded,
              isCollection: true
            };
          } else {
            throw new Error(result.error || "Failed to download collection/series");
          }
        }

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
          storageService.addActiveDownload(downloadId, title || "Bilibili Video");

          // Create a collection for the multi-part video if collectionName is provided
          let collectionId: string | null = null;
          if (collectionName) {
            const newCollection = {
              id: Date.now().toString(),
              name: collectionName,
              videos: [],
              createdAt: new Date().toISOString(),
              title: collectionName,
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
            title || "Bilibili Video"
          );

          // Add to collection if needed
          if (collectionId && firstPartResult.videoData) {
            storageService.atomicUpdateCollection(collectionId, (collection) => {
              collection.videos.push(firstPartResult.videoData!.id);
              return collection;
            });
          }

          // Set up background download for remaining parts
          // Note: We don't await this, it runs in background
          if (videosNumber > 1) {
            downloadService.downloadRemainingBilibiliParts(
              baseUrl,
              2,
              videosNumber,
              title || "Bilibili Video",
              collectionId!,
              downloadId // Pass downloadId to track progress
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
      } else if (videoUrl.includes("missav")) {
        // MissAV download
        const videoData = await downloadService.downloadMissAVVideo(videoUrl, downloadId);
        return { success: true, video: videoData };
      } else {
        // YouTube download
        const videoData = await downloadService.downloadYouTubeVideo(videoUrl, downloadId);
        return { success: true, video: videoData };
      }
    };

    // Add to download manager
    downloadManager.addDownload(downloadTask, downloadId, initialTitle)
      .then((result: any) => {
        console.log("Download completed successfully:", result);
      })
      .catch((error: any) => {
        console.error("Download failed:", error);
      });

    // Return success immediately indicating the download is queued/started
    res.status(200).json({ 
      success: true, 
      message: "Download queued", 
      downloadId 
    });

  } catch (error: any) {
    console.error("Error queuing download:", error);
    res
      .status(500)
      .json({ error: "Failed to queue download", details: error.message });
  }
};

// Get all videos
export const getVideos = (_req: Request, res: Response): void => {
  try {
    const videos = storageService.getVideos();
    res.status(200).json(videos);
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
};

// Get video by ID
export const getVideoById = (req: Request, res: Response): any => {
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
export const deleteVideo = (req: Request, res: Response): any => {
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
export const getDownloadStatus = (_req: Request, res: Response): void => {
  try {
    const status = storageService.getDownloadStatus();
    res.status(200).json(status);
  } catch (error) {
    console.error("Error fetching download status:", error);
    res.status(500).json({ error: "Failed to fetch download status" });
  }
};

// Check Bilibili parts
export const checkBilibiliParts = async (req: Request, res: Response): Promise<any> => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    if (!isBilibiliUrl(url as string)) {
      return res.status(400).json({ error: "Not a valid Bilibili URL" });
    }

    // Resolve shortened URLs (like b23.tv)
    let videoUrl = url as string;
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
  } catch (error: any) {
    console.error("Error checking Bilibili video parts:", error);
    res.status(500).json({
      error: "Failed to check Bilibili video parts",
      details: error.message,
    });
  }
};

// Check if Bilibili URL is a collection or series
export const checkBilibiliCollection = async (req: Request, res: Response): Promise<any> => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    if (!isBilibiliUrl(url as string)) {
      return res.status(400).json({ error: "Not a valid Bilibili URL" });
    }

    // Resolve shortened URLs (like b23.tv)
    let videoUrl = url as string;
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

    // Check if it's a collection or series
    const result = await downloadService.checkBilibiliCollectionOrSeries(videoId);

    res.status(200).json(result);
  } catch (error: any) {
    console.error("Error checking Bilibili collection/series:", error);
    res.status(500).json({
      error: "Failed to check Bilibili collection/series",
      details: error.message,
    });
  }
};

// Get video comments
export const getVideoComments = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const comments = await import("../services/commentService").then(m => m.getComments(id));
    res.status(200).json(comments);
  } catch (error) {
    console.error("Error fetching video comments:", error);
    res.status(500).json({ error: "Failed to fetch video comments" });
  }
};


// Upload video
export const uploadVideo = async (req: Request, res: Response): Promise<any> => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const { title, author } = req.body;
    const videoId = Date.now().toString();
    const videoFilename = req.file.filename;
    const thumbnailFilename = `${path.parse(videoFilename).name}.jpg`;
    
    const videoPath = path.join(VIDEOS_DIR, videoFilename);
    const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

    // Generate thumbnail
    await new Promise<void>((resolve, _reject) => {
      exec(`ffmpeg -i "${videoPath}" -ss 00:00:00 -vframes 1 "${thumbnailPath}"`, (error) => {
        if (error) {
          console.error("Error generating thumbnail:", error);
          // We resolve anyway to not block the upload, just without a custom thumbnail
          resolve();
        } else {
          resolve();
        }
      });
    });

    // Get video duration
    const duration = await getVideoDuration(videoPath);

    const newVideo = {
      id: videoId,
      title: title || req.file.originalname,
      author: author || "Admin",
      source: "local",
      sourceUrl: "", // No source URL for uploaded videos
      videoFilename: videoFilename,
      thumbnailFilename: fs.existsSync(thumbnailPath) ? thumbnailFilename : undefined,
      videoPath: `/videos/${videoFilename}`,
      thumbnailPath: fs.existsSync(thumbnailPath) ? `/images/${thumbnailFilename}` : undefined,
      thumbnailUrl: fs.existsSync(thumbnailPath) ? `/images/${thumbnailFilename}` : undefined,
      duration: duration ? duration.toString() : undefined,
      createdAt: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0].replace(/-/g, ''),
      addedAt: new Date().toISOString(),
    };

    storageService.saveVideo(newVideo);

    res.status(201).json({
      success: true,
      message: "Video uploaded successfully",
      video: newVideo
    });
  } catch (error: any) {
    console.error("Error uploading video:", error);
    res.status(500).json({
      error: "Failed to upload video",
      details: error.message
    });
  }
};

// Rate video
export const rateVideo = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const { rating } = req.body;

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be a number between 1 and 5" });
    }

    const updatedVideo = storageService.updateVideo(id, { rating });

    if (!updatedVideo) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.status(200).json({
      success: true,
      message: "Video rated successfully",
      video: updatedVideo
    });
  } catch (error) {
    console.error("Error rating video:", error);
    res.status(500).json({ error: "Failed to rate video" });
  }
};

// Update video details
export const updateVideoDetails = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Filter allowed updates
    const allowedUpdates: any = {};
    if (updates.title !== undefined) allowedUpdates.title = updates.title;
    if (updates.tags !== undefined) allowedUpdates.tags = updates.tags;
    // Add other allowed fields here if needed in the future

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    const updatedVideo = storageService.updateVideo(id, allowedUpdates);

    if (!updatedVideo) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.status(200).json({
      success: true,
      message: "Video updated successfully",
      video: updatedVideo
    });
  } catch (error) {
    console.error("Error updating video:", error);
    res.status(500).json({ error: "Failed to update video" });
  }
};


// Refresh video thumbnail
export const refreshThumbnail = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const video = storageService.getVideoById(id);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Construct paths
    let videoFilePath: string;
    if (video.videoPath && video.videoPath.startsWith('/videos/')) {
        const relativePath = video.videoPath.replace(/^\/videos\//, '');
        // Split by / to handle the web path separators and join with system separator
        videoFilePath = path.join(VIDEOS_DIR, ...relativePath.split('/'));
    } else if (video.videoFilename) {
        videoFilePath = path.join(VIDEOS_DIR, video.videoFilename);
    } else {
        return res.status(400).json({ error: "Video file path not found in record" });
    }

    if (!fs.existsSync(videoFilePath)) {
        return res.status(404).json({ error: "Video file not found on disk" });
    }

    // Determine thumbnail path on disk
    let thumbnailAbsolutePath: string;
    let needsDbUpdate = false;
    let newThumbnailFilename = video.thumbnailFilename;
    let newThumbnailPath = video.thumbnailPath;

    if (video.thumbnailPath && video.thumbnailPath.startsWith('/images/')) {
        // Local file exists (or should exist) - preserve the existing path (e.g. inside a collection folder)
        const relativePath = video.thumbnailPath.replace(/^\/images\//, '');
        thumbnailAbsolutePath = path.join(IMAGES_DIR, ...relativePath.split('/'));
    } else {
        // Remote URL or missing - create a new local file in the root images directory
        if (!newThumbnailFilename) {
             const videoName = path.parse(path.basename(videoFilePath)).name;
             newThumbnailFilename = `${videoName}.jpg`;
        }
        thumbnailAbsolutePath = path.join(IMAGES_DIR, newThumbnailFilename);
        newThumbnailPath = `/images/${newThumbnailFilename}`;
        needsDbUpdate = true;
    }

    // Ensure directory exists
    fs.ensureDirSync(path.dirname(thumbnailAbsolutePath));

    // Generate thumbnail
    await new Promise<void>((resolve, reject) => {
      // -y to overwrite existing file
      exec(`ffmpeg -i "${videoFilePath}" -ss 00:00:00 -vframes 1 "${thumbnailAbsolutePath}" -y`, (error) => {
        if (error) {
          console.error("Error generating thumbnail:", error);
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // Update video record if needed (switching from remote to local, or creating new)
    if (needsDbUpdate) {
        const updates: any = {
            thumbnailFilename: newThumbnailFilename,
            thumbnailPath: newThumbnailPath,
            thumbnailUrl: newThumbnailPath
        };
        storageService.updateVideo(id, updates);
    }

    // Return success with timestamp to bust cache
    const thumbnailUrl = `${newThumbnailPath}?t=${Date.now()}`;

    res.status(200).json({
      success: true,
      message: "Thumbnail refreshed successfully",
      thumbnailUrl: thumbnailUrl
    });

  } catch (error: any) {
    console.error("Error refreshing thumbnail:", error);
    res.status(500).json({
    });
  }
};

// Increment view count
export const incrementViewCount = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const video = storageService.getVideoById(id);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    const currentViews = video.viewCount || 0;
    const updatedVideo = storageService.updateVideo(id, { viewCount: currentViews + 1 });

    res.status(200).json({
      success: true,
      viewCount: updatedVideo?.viewCount
    });
  } catch (error) {
    console.error("Error incrementing view count:", error);
    res.status(500).json({ error: "Failed to increment view count" });
  }
};

// Update progress
export const updateProgress = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const { progress } = req.body;

    if (typeof progress !== 'number') {
      return res.status(400).json({ error: "Progress must be a number" });
    }

    const updatedVideo = storageService.updateVideo(id, { progress });

    if (!updatedVideo) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.status(200).json({
      success: true,
      progress: updatedVideo.progress
    });
  } catch (error) {
    console.error("Error updating progress:", error);
    res.status(500).json({ error: "Failed to update progress" });
  }
};
