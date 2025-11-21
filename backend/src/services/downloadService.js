const fs = require("fs-extra");
const path = require("path");
const youtubedl = require("youtube-dl-exec");
const axios = require("axios");
const { downloadByVedioPath } = require("bilibili-save-nodejs");
const { VIDEOS_DIR, IMAGES_DIR } = require("../config/paths");
const {
  sanitizeFilename,
  extractBilibiliVideoId,
} = require("../utils/helpers");
const storageService = require("./storageService");

// Helper function to download Bilibili video
async function downloadBilibiliVideo(url, videoPath, thumbnailPath) {
  try {
    // Create a unique temporary directory for the download
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const tempDir = path.join(VIDEOS_DIR, `temp_${timestamp}_${random}`);
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

// Helper function to check if a Bilibili video belongs to a collection or series
async function checkBilibiliCollectionOrSeries(videoId) {
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
async function getBilibiliCollectionVideos(mid, seasonId) {
  try {
    const allVideos = [];
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

        archives.forEach(video => {
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
async function getBilibiliSeriesVideos(mid, seriesId) {
  try {
    const allVideos = [];
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

        archives.forEach(video => {
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

    // Save the video using storage service
    storageService.saveVideo(videoData);

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

// Helper function to download all videos from a Bilibili collection or series
async function downloadBilibiliCollection(
  collectionInfo,
  collectionName,
  downloadId
) {
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
    let videosResult;
    if (type === 'collection') {
      videosResult = await getBilibiliCollectionVideos(mid, id);
    } else if (type === 'series') {
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
    const mytubeCollection = {
      id: Date.now().toString(),
      name: collectionName || title,
      videos: [],
      createdAt: new Date().toISOString(),
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
          title
        );

        // If download was successful, add to collection
        if (result.success && result.videoData) {
          storageService.atomicUpdateCollection(mytubeCollectionId, (collection) => {
            collection.videos.push(result.videoData.id);
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
  } catch (error) {
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
async function downloadRemainingBilibiliParts(
  baseUrl,
  startPart,
  totalParts,
  seriesTitle,
  collectionId,
  downloadId
) {
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
            collection.videos.push(result.videoData.id);
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
async function searchYouTube(query) {
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
    return [];
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

  return formattedResults;
}

// Download YouTube video
async function downloadYouTubeVideo(videoUrl) {
  console.log("Detected YouTube URL");
  // storageService.updateDownloadStatus(true, "Downloading YouTube video..."); // Removed

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
    // storageService.updateDownloadStatus(true, `Downloading: ${videoTitle}`); // Removed

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
    // storageService.updateDownloadStatus(false); // Removed
    throw youtubeError;
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

  // Save the video
  storageService.saveVideo(videoData);

  console.log("Video added to database");

  // Set download status to false when complete
  // storageService.updateDownloadStatus(false); // Removed

  return videoData;
}

module.exports = {
  downloadBilibiliVideo,
  checkBilibiliVideoParts,
  checkBilibiliCollectionOrSeries,
  getBilibiliCollectionVideos,
  getBilibiliSeriesVideos,
  downloadBilibiliCollection,
  downloadSingleBilibiliPart,
  downloadRemainingBilibiliParts,
  searchYouTube,
  downloadYouTubeVideo,
};
