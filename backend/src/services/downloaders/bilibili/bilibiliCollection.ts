import axios from "axios";
import { logger } from "../../../utils/logger";
import * as storageService from "../../storageService";
import { Collection } from "../../storageService";
import { downloadSinglePart } from "./bilibiliVideo";
import {
  BilibiliCollectionCheckResult,
  BilibiliVideoItem,
  BilibiliVideosResult,
  CollectionDownloadResult,
} from "./types";

/**
 * Get all videos from a Bilibili collection
 */
export async function getCollectionVideos(
  mid: number,
  seasonId: number
): Promise<BilibiliVideosResult> {
  try {
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;
    const pageSize = 30;
    let hasMore = true;

    logger.info(
      `Fetching collection videos for mid=${mid}, season_id=${seasonId}`
    );

    while (hasMore) {
      const apiUrl = `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list`;
      const params = {
        mid: mid,
        season_id: seasonId,
        page_num: pageNum,
        page_size: pageSize,
        sort_reverse: false,
      };

      logger.info(`Fetching page ${pageNum} of collection...`);

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (response.data && response.data.data) {
        const data = response.data.data;
        const archives = data.archives || [];

        logger.info(`Got ${archives.length} videos from page ${pageNum}`);

        archives.forEach((video: any) => {
          allVideos.push({
            bvid: video.bvid,
            title: video.title,
            aid: video.aid,
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

    logger.info(`Total videos in collection: ${allVideos.length}`);
    return { success: true, videos: allVideos };
  } catch (error) {
    logger.error("Error fetching collection videos:", error);
    return { success: false, videos: [] };
  }
}

/**
 * Get all videos from a Bilibili series
 */
export async function getSeriesVideos(
  mid: number,
  seriesId: number
): Promise<BilibiliVideosResult> {
  try {
    const allVideos: BilibiliVideoItem[] = [];
    let pageNum = 1;
    const pageSize = 30;
    let hasMore = true;

    logger.info(`Fetching series videos for mid=${mid}, series_id=${seriesId}`);

    while (hasMore) {
      const apiUrl = `https://api.bilibili.com/x/series/archives`;
      const params = {
        mid: mid,
        series_id: seriesId,
        pn: pageNum,
        ps: pageSize,
      };

      logger.info(`Fetching page ${pageNum} of series...`);

      const response = await axios.get(apiUrl, {
        params,
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });

      if (response.data && response.data.data) {
        const data = response.data.data;
        const archives = data.archives || [];

        logger.info(`Got ${archives.length} videos from page ${pageNum}`);

        archives.forEach((video: any) => {
          allVideos.push({
            bvid: video.bvid,
            title: video.title,
            aid: video.aid,
          });
        });

        // Check if there are more pages
        const page = data.page || {};
        hasMore =
          archives.length === pageSize && allVideos.length < (page.total || 0);
        pageNum++;
      } else {
        hasMore = false;
      }
    }

    logger.info(`Total videos in series: ${allVideos.length}`);
    return { success: true, videos: allVideos };
  } catch (error) {
    logger.error("Error fetching series videos:", error);
    return { success: false, videos: [] };
  }
}

/**
 * Download all videos from a Bilibili collection or series
 */
export async function downloadCollection(
  collectionInfo: BilibiliCollectionCheckResult,
  collectionName: string,
  downloadId: string
): Promise<CollectionDownloadResult> {
  try {
    const { type, id, mid, title, count } = collectionInfo;

    logger.info(`Starting download of ${type}: ${title} (${count} videos)`);

    // Add to active downloads
    if (downloadId) {
      storageService.addActiveDownload(
        downloadId,
        `Downloading ${type}: ${title}`
      );
    }

    // Fetch all videos from the collection/series
    let videosResult: BilibiliVideosResult;
    if (type === "collection" && mid && id) {
      videosResult = await getCollectionVideos(mid, id);
    } else if (type === "series" && mid && id) {
      videosResult = await getSeriesVideos(mid, id);
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    if (!videosResult.success || videosResult.videos.length === 0) {
      throw new Error(`Failed to fetch videos from ${type}`);
    }

    const videos = videosResult.videos;
    logger.info(`Found ${videos.length} videos to download`);

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

    logger.info(`Created MyTube collection: ${mytubeCollection.name}`);

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

      logger.info(
        `Downloading video ${videoNumber}/${videos.length}: ${video.title}`
      );

      // Construct video URL
      const videoUrl = `https://www.bilibili.com/video/${video.bvid}`;

      try {
        // Download this video
        const result = await downloadSinglePart(
          videoUrl,
          videoNumber,
          videos.length,
          title || "Collection",
          downloadId
        );

        // If download was successful, add to collection
        if (result.success && result.videoData) {
          storageService.atomicUpdateCollection(
            mytubeCollectionId,
            (collection: Collection) => {
              collection.videos.push(result.videoData!.id);
              return collection;
            }
          );

          logger.info(
            `Added video ${videoNumber}/${videos.length} to collection`
          );
        } else {
          logger.error(
            `Failed to download video ${videoNumber}/${videos.length}: ${video.title}`
          );
        }
      } catch (videoError) {
        logger.error(
          `Error downloading video ${videoNumber}/${videos.length}:`,
          videoError
        );
        // Continue with next video even if one fails
      }

      // Small delay between downloads to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // All videos downloaded, remove from active downloads
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }

    logger.info(`Finished downloading ${type}: ${title}`);

    return {
      success: true,
      collectionId: mytubeCollectionId,
      videosDownloaded: videos.length,
    };
  } catch (error: any) {
    logger.error(`Error downloading ${collectionInfo.type}:`, error);
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Download remaining Bilibili parts in sequence
 */
export async function downloadRemainingParts(
  baseUrl: string,
  startPart: number,
  totalParts: number,
  seriesTitle: string,
  collectionId: string | null,
  downloadId: string
): Promise<void> {
  try {
    logger.info(
      `Starting download of remaining parts: ${startPart} to ${totalParts} of "${seriesTitle}"`
    );
    
    // Add to active downloads if ID is provided
    if (downloadId) {
      storageService.addActiveDownload(
        downloadId,
        `Downloading ${seriesTitle}`
      );
    }

    let successCount = 0;
    let failedParts: number[] = [];

    for (let part = startPart; part <= totalParts; part++) {
      logger.info(`Starting download of part ${part}/${totalParts}`);
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
      const result = await downloadSinglePart(
        partUrl,
        part,
        totalParts,
        seriesTitle,
        downloadId
      );

      if (result.success && result.videoData) {
        successCount++;
        // If download was successful and we have a collection ID, add to collection
        if (collectionId) {
          try {
            storageService.atomicUpdateCollection(
              collectionId,
              (collection: Collection) => {
                collection.videos.push(result.videoData!.id);
                return collection;
              }
            );

            logger.info(
              `Added part ${part}/${totalParts} to collection ${collectionId}`
            );
          } catch (collectionError) {
            logger.error(
              `Error adding part ${part}/${totalParts} to collection:`,
              collectionError
            );
          }
        }
        logger.info(`Successfully downloaded part ${part}/${totalParts}`);
      } else {
        failedParts.push(part);
        logger.error(
          `Failed to download part ${part}/${totalParts}: ${result.error || "Unknown error"}`
        );
      }

      // Small delay between downloads to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // All parts processed, remove from active downloads
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }

    // Log appropriate message based on results
    const remainingPartsCount = totalParts - startPart + 1;
    if (failedParts.length === 0) {
      logger.info(
        `All remaining parts (${startPart}-${totalParts}) of "${seriesTitle}" downloaded successfully`
      );
    } else {
      logger.warn(
        `Downloaded ${successCount}/${remainingPartsCount} remaining parts (${startPart}-${totalParts}) of "${seriesTitle}". Failed parts: ${failedParts.join(", ")}`
      );
    }
  } catch (error) {
    logger.error("Error downloading remaining Bilibili parts:", error);
    if (downloadId) {
      storageService.removeActiveDownload(downloadId);
    }
  }
}
