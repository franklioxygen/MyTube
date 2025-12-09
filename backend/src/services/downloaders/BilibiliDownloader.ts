import axios from "axios";
import fs from "fs-extra";
import path from "path";
// @ts-ignore
import { downloadByVedioPath } from "bilibili-save-nodejs";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { bccToVtt } from "../../utils/bccToVtt";
import {
    extractBilibiliVideoId,
    formatVideoFilename
} from "../../utils/helpers";
import * as storageService from "../storageService";
import { Collection, Video } from "../storageService";

export interface BilibiliVideoInfo {
    title: string;
    author: string;
    date: string;
    thumbnailUrl: string | null;
    thumbnailSaved: boolean;
    description?: string;
    error?: string;
}

export interface BilibiliPartsCheckResult {
    success: boolean;
    videosNumber: number;
    title?: string;
}

export interface BilibiliCollectionCheckResult {
    success: boolean;
    type: 'collection' | 'series' | 'none';
    id?: number;
    title?: string;
    count?: number;
    mid?: number;
}

export interface BilibiliVideoItem {
    bvid: string;
    title: string;
    aid: number;
}

export interface BilibiliVideosResult {
    success: boolean;
    videos: BilibiliVideoItem[];
}

export interface DownloadResult {
    success: boolean;
    videoData?: Video;
    error?: string;
}

export interface CollectionDownloadResult {
    success: boolean;
    collectionId?: string;
    videosDownloaded?: number;
    error?: string;
}

export class BilibiliDownloader {
    // Get video info without downloading
    static async getVideoInfo(videoId: string): Promise<{ title: string; author: string; date: string; thumbnailUrl: string }> {
        try {
            const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
            const response = await axios.get(apiUrl);

            if (response.data && response.data.data) {
                const videoInfo = response.data.data;
                return {
                    title: videoInfo.title || "Bilibili Video",
                    author: videoInfo.owner?.name || "Bilibili User",
                    date: new Date(videoInfo.pubdate * 1000).toISOString().slice(0, 10).replace(/-/g, ""),
                    thumbnailUrl: videoInfo.pic,
                };
            }
            throw new Error("No data found");
        } catch (error) {
            console.error("Error fetching Bilibili video info:", error);
            return {
                title: "Bilibili Video",
                author: "Bilibili User",
                date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
                thumbnailUrl: "",
            };
        }
    }

    // Helper function to format bytes
    private static formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
    }

    // Helper function to download Bilibili video
    static async downloadVideo(
        url: string,
        videoPath: string,
        thumbnailPath: string,
        downloadId?: string
    ): Promise<BilibiliVideoInfo> {
        const tempDir = path.join(VIDEOS_DIR, `temp_${Date.now()}_${Math.floor(Math.random() * 10000)}`);

        try {
            // Create a unique temporary directory for the download
            fs.ensureDirSync(tempDir);

            console.log("Downloading Bilibili video to temp directory:", tempDir);

            // Start monitoring progress
            let progressInterval: NodeJS.Timeout | undefined;
            if (downloadId) {
                let lastSize = 0;
                let lastUpdateTime = Date.now();
                
                progressInterval = setInterval(() => {
                    try {
                        const files = fs.readdirSync(tempDir);
                        const videoFile = files.find((file: string) => file.endsWith(".mp4"));
                        
                        if (videoFile) {
                            const filePath = path.join(tempDir, videoFile);
                            if (fs.existsSync(filePath)) {
                                const stats = fs.statSync(filePath);
                                const currentSize = stats.size;
                                const currentTime = Date.now();
                                const timeDiff = (currentTime - lastUpdateTime) / 1000; // seconds

                                if (timeDiff > 0 && currentSize > lastSize) {
                                    // Calculate speed (bytes per second)
                                    const bytesPerSecond = (currentSize - lastSize) / timeDiff;
                                    
                                    // Format speed
                                    const speedStr = this.formatBytes(bytesPerSecond) + "/s";
                                    
                                    // Format downloaded size
                                    const downloadedSizeStr = this.formatBytes(currentSize);
                                    
                                    // Update progress
                                    storageService.updateActiveDownload(downloadId, {
                                        downloadedSize: downloadedSizeStr,
                                        speed: speedStr,
                                    });
                                }

                                lastSize = currentSize;
                                lastUpdateTime = currentTime;
                            }
                        }
                    } catch (error) {
                        // Ignore errors during monitoring
                    }
                }, 500);
            }

            // Download the video using the package
            await downloadByVedioPath({
                url: url,
                type: "mp4",
                folder: tempDir,
            });

            // Stop progress monitoring
            if (progressInterval) {
                clearInterval(progressInterval);
            }

            console.log("Download completed, checking for video file");

            // Find the downloaded file
            const files = fs.readdirSync(tempDir);
            console.log("Files in temp directory:", files);

            const videoFile = files.find((file: string) => file.endsWith(".mp4"));

            if (!videoFile) {
                throw new Error("Downloaded video file not found");
            }

            console.log("Found video file:", videoFile);

            // Get final file size for progress update
            const tempVideoPath = path.join(tempDir, videoFile);
            if (downloadId && fs.existsSync(tempVideoPath)) {
                const stats = fs.statSync(tempVideoPath);
                const finalSize = this.formatBytes(stats.size);
                storageService.updateActiveDownload(downloadId, {
                    downloadedSize: finalSize,
                    totalSize: finalSize,
                    progress: 100,
                    speed: "0 B/s",
                });
            }

            // Move the file to the desired location
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
                        const description = videoInfo.desc || "";

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
                                description,
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
    static async checkVideoParts(videoId: string): Promise<BilibiliPartsCheckResult> {
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
    static async checkCollectionOrSeries(videoId: string): Promise<BilibiliCollectionCheckResult> {
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
    static async getCollectionVideos(mid: number, seasonId: number): Promise<BilibiliVideosResult> {
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
    static async getSeriesVideos(mid: number, seriesId: number): Promise<BilibiliVideosResult> {
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
    static async downloadSinglePart(
        url: string,
        partNumber: number,
        totalParts: number,
        seriesTitle: string,
        downloadId?: string
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
            
            let videoTitle, videoAuthor, videoDate, videoDescription, thumbnailUrl, thumbnailSaved;
            let finalVideoFilename = videoFilename;
            let finalThumbnailFilename = thumbnailFilename;

            // Download Bilibili video
            const bilibiliInfo = await BilibiliDownloader.downloadVideo(
                url,
                videoPath,
                thumbnailPath,
                downloadId
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
            videoDescription = bilibiliInfo.description || "";
            thumbnailUrl = bilibiliInfo.thumbnailUrl;
            thumbnailSaved = bilibiliInfo.thumbnailSaved;

            // Update the safe base filename with the actual title
            // Update the safe base filename with the new format
            const newSafeBaseFilename = formatVideoFilename(videoTitle, videoAuthor, videoDate);
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

            // Get video duration
            let duration: string | undefined;
            try {
                const { getVideoDuration } = await import("../../services/metadataService");
                const durationSec = await getVideoDuration(newVideoPath);
                if (durationSec) {
                    duration = durationSec.toString();
                }
            } catch (e) {
                console.error("Failed to extract duration from Bilibili video:", e);
            }

            // Get file size
            let fileSize: string | undefined;
            try {
                if (fs.existsSync(newVideoPath)) {
                    const stats = fs.statSync(newVideoPath);
                    fileSize = stats.size.toString();
                }
            } catch (e) {
                console.error("Failed to get file size:", e);
            }

            // Download subtitles
            let subtitles: Array<{ language: string; filename: string; path: string }> = [];
            try {
                console.log("Attempting to download subtitles...");
                subtitles = await BilibiliDownloader.downloadSubtitles(url, newSafeBaseFilename);
                console.log(`Downloaded ${subtitles.length} subtitles`);
            } catch (e) {
                console.error("Error downloading subtitles:", e);
            }

            // Create metadata for the video
            const videoData: Video = {
                id: timestamp.toString(),
                title: videoTitle,
                author: videoAuthor,
                description: videoDescription,
                date: videoDate,
                source: "bilibili",
                sourceUrl: url,
                videoFilename: finalVideoFilename,
                thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
                subtitles: subtitles.length > 0 ? subtitles : undefined,
                thumbnailUrl: thumbnailUrl || undefined,
                videoPath: `/videos/${finalVideoFilename}`,
                thumbnailPath: thumbnailSaved
                    ? `/images/${finalThumbnailFilename}`
                    : null,
                duration: duration,
                fileSize: fileSize,
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
    static async downloadCollection(
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
                videosResult = await BilibiliDownloader.getCollectionVideos(mid, id);
            } else if (type === 'series' && mid && id) {
                videosResult = await BilibiliDownloader.getSeriesVideos(mid, id);
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
                    const result = await BilibiliDownloader.downloadSinglePart(
                        videoUrl,
                        videoNumber,
                        videos.length,
                        title || "Collection",
                        downloadId
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
    static async downloadRemainingParts(
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
                const result = await BilibiliDownloader.downloadSinglePart(
                    partUrl,
                    part,
                    totalParts,
                    seriesTitle,
                    downloadId
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

    // Helper function to get cookies from cookies.txt
    static getCookieHeader(): string {
        try {
            const { DATA_DIR } = require("../../config/paths");
            const cookiesPath = path.join(DATA_DIR, "cookies.txt");
            if (fs.existsSync(cookiesPath)) {
                const content = fs.readFileSync(cookiesPath, "utf8");
                const lines = content.split("\n");
                const cookies = [];
                for (const line of lines) {
                    if (line.startsWith("#") || !line.trim()) continue;
                    const parts = line.split("\t");
                    if (parts.length >= 7) {
                        const name = parts[5];
                        const value = parts[6].trim();
                        cookies.push(`${name}=${value}`);
                    }
                }
                return cookies.join("; ");
            }
        } catch (e) {
            console.error("Error reading cookies.txt:", e);
        }
        return "";
    }

    // Helper function to download subtitles
    static async downloadSubtitles(videoUrl: string, baseFilename: string): Promise<Array<{ language: string; filename: string; path: string }>> {
        try {
            const videoId = extractBilibiliVideoId(videoUrl);
            if (!videoId) return [];

            const cookieHeader = BilibiliDownloader.getCookieHeader();
            if (!cookieHeader) {
                console.warn("WARNING: No cookies found in cookies.txt. Bilibili subtitles usually require login.");
            } else {
                console.log(`Cookie header length: ${cookieHeader.length}`);
                // Log first few chars to verify it's not empty/malformed
                console.log(`Cookie header start: ${cookieHeader.substring(0, 20)}...`);
            }
            
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.bilibili.com',
                ...(cookieHeader ? { 'Cookie': cookieHeader } : {})
            };

            // Get CID first
            const viewApiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
            const viewResponse = await axios.get(viewApiUrl, { headers });
            const cid = viewResponse.data?.data?.cid;

            if (!cid) {
                console.log("Could not find CID for video");
                return [];
            }

            // Get subtitles
            const playerApiUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${videoId}&cid=${cid}`;
            console.log(`Fetching subtitles from: ${playerApiUrl}`);
            const playerResponse = await axios.get(playerApiUrl, { headers });
            
            if (cookieHeader && !cookieHeader.includes("SESSDATA")) {
                console.warn("WARNING: SESSDATA cookie not found! This is required for Bilibili authentication.");
            }

            let subtitlesData = playerResponse.data?.data?.subtitle?.subtitles;

            // Fallback: Check if subtitles are in the view response (sometimes they are)
            if (!subtitlesData || subtitlesData.length === 0) {
                console.log("No subtitles in player API, checking view API response...");
                // We already fetched viewResponse earlier to get CID
                const viewSubtitles = viewResponse.data?.data?.subtitle?.list;
                if (viewSubtitles && viewSubtitles.length > 0) {
                    console.log(`Found ${viewSubtitles.length} subtitles in view API`);
                    subtitlesData = viewSubtitles;
                }
            }

            if (!subtitlesData) {
                 console.log("No subtitle field in response data");
            } else if (!Array.isArray(subtitlesData)) {
                 console.log("Subtitles field is not an array");
            } else {
                 console.log(`Found ${subtitlesData.length} subtitles`);
            }

            if (!subtitlesData || !Array.isArray(subtitlesData)) {
                console.log("No subtitles found in API response");
                return [];
            }

            const savedSubtitles = [];

            // Ensure subtitles directory exists
            fs.ensureDirSync(SUBTITLES_DIR);

            for (const sub of subtitlesData) {
                const lang = sub.lan;
                const subUrl = sub.subtitle_url;
                if (!subUrl) continue;

                // Ensure URL is absolute (sometimes it starts with //)
                const absoluteSubUrl = subUrl.startsWith('//') ? `https:${subUrl}` : subUrl;

                console.log(`Downloading subtitle (${lang}): ${absoluteSubUrl}`);
                
                // Do NOT send cookies to the subtitle CDN (hdslb.com) as it can cause 400 Bad Request (Header too large)
                // and they are not needed for the CDN file itself.
                const cdnHeaders = {
                    'User-Agent': headers['User-Agent'],
                    'Referer': headers['Referer']
                };

                const subResponse = await axios.get(absoluteSubUrl, { headers: cdnHeaders });
                const vttContent = bccToVtt(subResponse.data);

                if (vttContent) {
                    const subFilename = `${baseFilename}.${lang}.vtt`;
                    const subPath = path.join(SUBTITLES_DIR, subFilename);

                    fs.writeFileSync(subPath, vttContent);

                    savedSubtitles.push({
                        language: lang,
                        filename: subFilename,
                        path: `/subtitles/${subFilename}`
                    });
                }
            }

            return savedSubtitles;

        } catch (error) {
            console.error("Error in downloadSubtitles:", error);
            return [];
        }
    }
}
