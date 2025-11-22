import axios from "axios";
import fs from "fs-extra";
import path from "path";
import youtubedl from "youtube-dl-exec";
// @ts-ignore
import { downloadByVedioPath } from "bilibili-save-nodejs";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import {
    extractBilibiliVideoId,
    sanitizeFilename,
} from "../utils/helpers";
import * as storageService from "./storageService";
import { Collection, Video } from "./storageService";

interface BilibiliVideoInfo {
  title: string;
  author: string;
  date: string;
  thumbnailUrl: string | null;
  thumbnailSaved: boolean;
  error?: string;
}

interface BilibiliPartsCheckResult {
  success: boolean;
  videosNumber: number;
  title?: string;
}

interface BilibiliCollectionCheckResult {
  success: boolean;
  type: 'collection' | 'series' | 'none';
  id?: number;
  title?: string;
  count?: number;
  mid?: number;
}

interface BilibiliVideoItem {
  bvid: string;
  title: string;
  aid: number;
}

interface BilibiliVideosResult {
  success: boolean;
  videos: BilibiliVideoItem[];
}

interface DownloadResult {
  success: boolean;
  videoData?: Video;
  error?: string;
}

interface CollectionDownloadResult {
  success: boolean;
  collectionId?: string;
  videosDownloaded?: number;
  error?: string;
}

// Helper function to download Bilibili video
export async function downloadBilibiliVideo(
  url: string,
  videoPath: string,
  thumbnailPath: string
): Promise<BilibiliVideoInfo> {
  const tempDir = path.join(VIDEOS_DIR, `temp_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
  
  try {
    // Create a unique temporary directory for the download
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

    const videoFile = files.find((file: string) => file.endsWith(".mp4"));

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
    let thumbnailUrl: string | null = null;
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

            await new Promise<void>((resolve, reject) => {
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
  } catch (error: any) {
    console.error("Error in downloadBilibiliVideo:", error);

    // Make sure we clean up the temp directory if it exists
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
export async function checkBilibiliVideoParts(videoId: string): Promise<BilibiliPartsCheckResult> {
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

// Helper function to check if a Bilibili video belongs to a collection or series
export async function checkBilibiliCollectionOrSeries(videoId: string): Promise<BilibiliCollectionCheckResult> {
  try {
    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
    console.log("Checking if video belongs to collection/series:", apiUrl);

    const response = await axios.get(apiUrl, {
      headers: {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (response.data && response.data.data) {
      const videoInfo = response.data.data;
      const mid = videoInfo.owner?.mid;

      // Check for collection (ugc_season)
      if (videoInfo.ugc_season) {
        const season = videoInfo.ugc_season;
        console.log(`Video belongs to collection: ${season.title}`);
        return {
          success: true,
          type: 'collection',
          id: season.id,
          title: season.title,
          count: season.ep_count || 0,
          mid: mid
        };
      }

      // If no collection found, return none
      return { success: true, type: 'none' };
    }

    return { success: false, type: 'none' };
  } catch (error) {
    console.error("Error checking collection/series:", error);
    return { success: false, type: 'none' };
  }
}

// Helper function to get all videos from a Bilibili collection
export async function getBilibiliCollectionVideos(mid: number, seasonId: number): Promise<BilibiliVideosResult> {
  try {
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;
    const pageSize = 30;
    let hasMore = true;

    console.log(`Fetching collection videos for mid=${mid}, season_id=${seasonId}`);

    while (hasMore) {
      const apiUrl = `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list`;
      const params = {
        mid: mid,
        season_id: seasonId,
        page_num: pageNum,
        page_size: pageSize,
        sort_reverse: false
      };

      console.log(`Fetching page ${pageNum} of collection...`);

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          'Referer': 'https://www.bilibili.com',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });

      if (response.data && response.data.data) {
        const data = response.data.data;
        const archives = data.archives || [];
        
        console.log(`Got ${archives.length} videos from page ${pageNum}`);

        archives.forEach((video: any) => {
          allVideos.push({
            bvid: video.bvid,
            title: video.title,
            aid: video.aid
          });
        });

        // Check if there are more pages
        const total = data.page?.total || 0;
        hasMore = allVideos.length < total;
        pageNum++;
      } else {
        hasMore = false;
      }
    }

    console.log(`Total videos in collection: ${allVideos.length}`);
    return { success: true, videos: allVideos };
  } catch (error) {
    console.error("Error fetching collection videos:", error);
    return { success: false, videos: [] };
  }
}

// Helper function to get all videos from a Bilibili series
export async function getBilibiliSeriesVideos(mid: number, seriesId: number): Promise<BilibiliVideosResult> {
  try {
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;
    const pageSize = 30;
    let hasMore = true;

    console.log(`Fetching series videos for mid=${mid}, series_id=${seriesId}`);

    while (hasMore) {
      const apiUrl = `https://api.bilibili.com/x/series/archives`;
      const params = {
        mid: mid,
        series_id: seriesId,
        pn: pageNum,
        ps: pageSize
      };

      console.log(`Fetching page ${pageNum} of series...`);

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          'Referer': 'https://www.bilibili.com',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });

      if (response.data && response.data.data) {
        const data = response.data.data;
        const archives = data.archives || [];
        
        console.log(`Got ${archives.length} videos from page ${pageNum}`);

        archives.forEach((video: any) => {
          allVideos.push({
            bvid: video.bvid,
            title: video.title,
            aid: video.aid
          });
        });

        // Check if there are more pages
        const page = data.page || {};
        hasMore = archives.length === pageSize && allVideos.length < (page.total || 0);
        pageNum++;
      } else {
        hasMore = false;
      }
    }

    console.log(`Total videos in series: ${allVideos.length}`);
    return { success: true, videos: allVideos };
  } catch (error) {
    console.error("Error fetching series videos:", error);
    return { success: false, videos: [] };
  }
}

// Helper function to download a single Bilibili part
export async function downloadSingleBilibiliPart(
  url: string,
  partNumber: number,
  totalParts: number,
  seriesTitle: string
): Promise<DownloadResult> {
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
    const videoPath = path.join(VIDEOS_DIR, videoFilename);
    const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

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
    const newVideoPath = path.join(VIDEOS_DIR, newVideoFilename);
    const newThumbnailPath = path.join(IMAGES_DIR, newThumbnailFilename);

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
    const videoData: Video = {
      id: timestamp.toString(),
      title: videoTitle,
      author: videoAuthor,
      date: videoDate,
      source: "bilibili",
      sourceUrl: url,
      videoFilename: finalVideoFilename,
      thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      videoPath: `/videos/${finalVideoFilename}`,
      thumbnailPath: thumbnailSaved
        ? `/images/${finalThumbnailFilename}`
        : null,
      addedAt: new Date().toISOString(),
      partNumber: partNumber,
      totalParts: totalParts,
      seriesTitle: seriesTitle,
      createdAt: new Date().toISOString(),
    };

    // Save the video using storage service
    storageService.saveVideo(videoData);

    console.log(`Part ${partNumber}/${totalParts} added to database`);

    return { success: true, videoData };
  } catch (error: any) {
    console.error(
      `Error downloading Bilibili part ${partNumber}/${totalParts}:`,
      error
    );
    return { success: false, error: error.message };
  }
}

// Helper function to download all videos from a Bilibili collection or series
export async function downloadBilibiliCollection(
  collectionInfo: BilibiliCollectionCheckResult,
  collectionName: string,
  downloadId: string
): Promise<CollectionDownloadResult> {
  try {
    const { type, id, mid, title, count } = collectionInfo;
    
    console.log(`Starting download of ${type}: ${title} (${count} videos)`);

    // Add to active downloads
    if (downloadId) {
      storageService.addActiveDownload(
        downloadId,
        `Downloading ${type}: ${title}`
      );
    }

    // Fetch all videos from the collection/series
    let videosResult: BilibiliVideosResult;
    if (type === 'collection' && mid && id) {
      videosResult = await getBilibiliCollectionVideos(mid, id);
    } else if (type === 'series' && mid && id) {
      videosResult = await getBilibiliSeriesVideos(mid, id);
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    if (!videosResult.success || videosResult.videos.length === 0) {
      throw new Error(`Failed to fetch videos from ${type}`);
    }

    const videos = videosResult.videos;
    console.log(`Found ${videos.length} videos to download`);

    // Create a MyTube collection for these videos
    const mytubeCollection: Collection = {
      id: Date.now().toString(),
      name: collectionName || title || "Collection",
      videos: [],
      createdAt: new Date().toISOString(),
      title: collectionName || title || "Collection",
    };
    storageService.saveCollection(mytubeCollection);
    const mytubeCollectionId = mytubeCollection.id;

    console.log(`Created MyTube collection: ${mytubeCollection.name}`);

    // Download each video sequentially
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const videoNumber = i + 1;

      // Update status
      if (downloadId) {
        storageService.addActiveDownload(
          downloadId,
          `Downloading ${videoNumber}/${videos.length}: ${video.title}`
        );
      }

      console.log(`Downloading video ${videoNumber}/${videos.length}: ${video.title}`);

      // Construct video URL
      const videoUrl = `https://www.bilibili.com/video/${video.bvid}`;

      try {
        // Download this video
        const result = await downloadSingleBilibiliPart(
          videoUrl,
          videoNumber,
          videos.length,
          title || "Collection"
        );

        // If download was successful, add to collection
        if (result.success && result.videoData) {
          storageService.atomicUpdateCollection(mytubeCollectionId, (collection) => {
            collection.videos.push(result.videoData!.id);
            return collection;
          });

          console.log(`Added video ${videoNumber}/${videos.length} to collection`);
        } else {
          console.error(`Failed to download video ${videoNumber}/${videos.length}: ${video.title}`);
        }
      } catch (videoError) {
        console.error(`Error downloading video ${videoNumber}/${videos.length}:`, videoError);
        // Continue with next video even if one fails
      }

      // Small delay between downloads to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // All videos downloaded, remove from active downloads
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }

    console.log(`Finished downloading ${type}: ${title}`);

    return {
      success: true,
      collectionId: mytubeCollectionId,
      videosDownloaded: videos.length
    };
  } catch (error: any) {
    console.error(`Error downloading ${collectionInfo.type}:`, error);
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to download remaining Bilibili parts in sequence
export async function downloadRemainingBilibiliParts(
  baseUrl: string,
  startPart: number,
  totalParts: number,
  seriesTitle: string,
  collectionId: string,
  downloadId: string
): Promise<void> {
  try {
    // Add to active downloads if ID is provided
    if (downloadId) {
      storageService.addActiveDownload(downloadId, `Downloading ${seriesTitle}`);
    }

    for (let part = startPart; part <= totalParts; part++) {
      // Update status to show which part is being downloaded
      if (downloadId) {
        storageService.addActiveDownload(
          downloadId,
          `Downloading part ${part}/${totalParts}: ${seriesTitle}`
        );
      }

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
          storageService.atomicUpdateCollection(collectionId, (collection) => {
            collection.videos.push(result.videoData!.id);
            return collection;
          });

          console.log(
            `Added part ${part}/${totalParts} to collection ${collectionId}`
          );
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

    // All parts downloaded, remove from active downloads
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }
    console.log(
      `All ${totalParts} parts of "${seriesTitle}" downloaded successfully`
    );
  } catch (error) {
    console.error("Error downloading remaining Bilibili parts:", error);
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }
  }
}

// Search for videos on YouTube
export async function searchYouTube(query: string): Promise<any[]> {
  console.log("Processing search request for query:", query);

  // Use youtube-dl to search for videos
  const searchResults = await youtubedl(`ytsearch5:${query}`, {
    dumpSingleJson: true,
    noWarnings: true,
    noCallHome: true,
    skipDownload: true,
    playlistEnd: 5, // Limit to 5 results
  } as any);

  if (!searchResults || !(searchResults as any).entries) {
    return [];
  }

  // Format the search results
  const formattedResults = (searchResults as any).entries.map((entry: any) => ({
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

  return formattedResults;
}

// Download YouTube video
export async function downloadYouTubeVideo(videoUrl: string): Promise<Video> {
  console.log("Detected YouTube URL");

  // Create a safe base filename (without extension)
  const timestamp = Date.now();
  const safeBaseFilename = `video_${timestamp}`;

  // Add extensions for video and thumbnail
  const videoFilename = `${safeBaseFilename}.mp4`;
  const thumbnailFilename = `${safeBaseFilename}.jpg`;

  // Set full paths for video and thumbnail
  const videoPath = path.join(VIDEOS_DIR, videoFilename);
  const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

  let videoTitle, videoAuthor, videoDate, thumbnailUrl, thumbnailSaved;
  let finalVideoFilename = videoFilename;
  let finalThumbnailFilename = thumbnailFilename;

  try {
    // Get YouTube video info first
    const info = await youtubedl(videoUrl, {
      dumpSingleJson: true,
      noWarnings: true,
      callHome: false,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    } as any);

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
    const newVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);
    const newThumbnailPath = path.join(IMAGES_DIR, finalThumbnailFilename);

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

        await new Promise<void>((resolve, reject) => {
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
    throw youtubeError;
  }

  // Create metadata for the video
  const videoData: Video = {
    id: timestamp.toString(),
    title: videoTitle || "Video",
    author: videoAuthor || "Unknown",
    date:
      videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    source: "youtube",
    sourceUrl: videoUrl,
    videoFilename: finalVideoFilename,
    thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    videoPath: `/videos/${finalVideoFilename}`,
    thumbnailPath: thumbnailSaved
      ? `/images/${finalThumbnailFilename}`
      : null,
    addedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  // Save the video
  storageService.saveVideo(videoData);

  console.log("Video added to database");

  return videoData;
}
