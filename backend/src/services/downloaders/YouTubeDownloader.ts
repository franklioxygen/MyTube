import axios from "axios";
import fs from "fs-extra";
import path from "path";
import youtubedl from "youtube-dl-exec";
import { IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { sanitizeFilename } from "../../utils/helpers";
import * as storageService from "../storageService";
import { Video } from "../storageService";

export class YouTubeDownloader {
    // Search for videos on YouTube
    static async search(query: string): Promise<any[]> {
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
    static async downloadVideo(videoUrl: string, downloadId?: string): Promise<Video> {
        console.log("Detected YouTube URL");

        // Create a safe base filename (without extension)
        const timestamp = Date.now();
        const safeBaseFilename = `video_${timestamp}`;

        // Add extensions for video and thumbnail
        const videoFilename = `${safeBaseFilename}.mp4`;
        const thumbnailFilename = `${safeBaseFilename}.jpg`;

        // Set full paths for video and thumbnail



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

            if (downloadId) {
                storageService.updateActiveDownload(downloadId, {
                    filename: videoTitle,
                    progress: 0
                });
            }

            // Use exec to capture stdout for progress
            // Format selection prioritizes Safari-compatible codecs (H.264/AAC)
            // avc1 is the H.264 variant that Safari supports best
            // Use Android client to avoid SABR streaming issues and JS runtime requirements
            const subprocess = youtubedl.exec(videoUrl, {
                output: newVideoPath,
                format: "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec=aac]/bestvideo[ext=mp4][vcodec=h264]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                mergeOutputFormat: "mp4",
                'extractor-args': "youtube:player_client=android",
                addHeader: [
                    'Referer:https://www.youtube.com/',
                    'User-Agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
                ]
            } as any);

            subprocess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                // Parse progress: [download]  23.5% of 10.00MiB at  2.00MiB/s ETA 00:05
                const progressMatch = output.match(/(\d+\.?\d*)%\s+of\s+([~\d\w.]+)\s+at\s+([~\d\w.\/]+)/);

                if (progressMatch && downloadId) {
                    const percentage = parseFloat(progressMatch[1]);
                    const totalSize = progressMatch[2];
                    const speed = progressMatch[3];

                    storageService.updateActiveDownload(downloadId, {
                        progress: percentage,
                        totalSize: totalSize,
                        speed: speed
                    });
                }
            });

            await subprocess;

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
            duration: undefined, // Will be populated below
            addedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
        };

        // If duration is missing from info, try to extract it from file
        // We need to reconstruct the path because newVideoPath is not in scope here if we are outside the try block
        // But wait, finalVideoFilename is available.
        const finalVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);
        
        try {
             // Dynamic import to avoid circular dependency if any, though here it's fine
             const { getVideoDuration } = await import("../../services/metadataService");
             const duration = await getVideoDuration(finalVideoPath);
             if (duration) {
                 videoData.duration = duration.toString();
             }
        } catch (e) {
             console.error("Failed to extract duration from downloaded file:", e);
        }

        // Save the video
        storageService.saveVideo(videoData);

        console.log("Video added to database");

        return videoData;
    }
}
