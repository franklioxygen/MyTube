import axios from "axios";
import fs from "fs-extra";
import path from "path";
import youtubedl from "youtube-dl-exec";
import { IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { sanitizeFilename } from "../../utils/helpers";
import * as storageService from "../storageService";
import { Video } from "../storageService";

// Helper function to extract author from XiaoHongShu page when yt-dlp doesn't provide it
async function extractXiaoHongShuAuthor(url: string): Promise<string | null> {
    try {
        console.log("Attempting to extract XiaoHongShu author from webpage...");
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        const html = response.data;
        
        // Try to find author name in the JSON data embedded in the page
        // XiaoHongShu embeds data in window.__INITIAL_STATE__
        const match = html.match(/"nickname":"([^"]+)"/);
        if (match && match[1]) {
            console.log("Found XiaoHongShu author:", match[1]);
            return match[1];
        }
        
        // Alternative: try to find in user info
        const userMatch = html.match(/"user":\{[^}]*"nickname":"([^"]+)"/);
        if (userMatch && userMatch[1]) {
            console.log("Found XiaoHongShu author (user):", userMatch[1]);
            return userMatch[1];
        }
        
        console.log("Could not extract XiaoHongShu author from webpage");
        return null;
    } catch (error) {
        console.error("Error extracting XiaoHongShu author:", error);
        return null;
    }
}

export class YtDlpDownloader {
    // Search for videos (primarily for YouTube, but could be adapted)
    static async search(query: string): Promise<any[]> {
        console.log("Processing search request for query:", query);

        // Use ytsearch for searching
        const searchResults = await youtubedl(`ytsearch5:${query}`, {
            dumpSingleJson: true,
            noWarnings: true,
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
            sourceUrl: `https://www.youtube.com/watch?v=${entry.id}`, // Default to YT for search results
            source: "youtube",
        }));

        console.log(
            `Found ${formattedResults.length} search results for "${query}"`
        );

        return formattedResults;
    }

    // Get video info without downloading
    static async getVideoInfo(url: string): Promise<{ title: string; author: string; date: string; thumbnailUrl: string }> {
        try {
            const info = await youtubedl(url, {
                dumpSingleJson: true,
                noWarnings: true,
                preferFreeFormats: true,
                // youtubeSkipDashManifest: true, // Specific to YT, might want to keep or make conditional
            } as any);

            return {
                title: info.title || "Video",
                author: info.uploader || "Unknown",
                date: info.upload_date || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
                thumbnailUrl: info.thumbnail,
            };
        } catch (error) {
            console.error("Error fetching video info:", error);
            return {
                title: "Video",
                author: "Unknown",
                date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
                thumbnailUrl: "",
            };
        }
    }

    // Download video
    static async downloadVideo(videoUrl: string, downloadId?: string, onStart?: (cancel: () => void) => void): Promise<Video> {
        console.log("Detected URL:", videoUrl);

        // Create a safe base filename (without extension)
        const timestamp = Date.now();
        const safeBaseFilename = `video_${timestamp}`;

        // Add extensions for video and thumbnail
        const videoFilename = `${safeBaseFilename}.mp4`;
        const thumbnailFilename = `${safeBaseFilename}.jpg`;

        let videoTitle, videoAuthor, videoDate, thumbnailUrl, thumbnailSaved, source;
        let finalVideoFilename = videoFilename;
        let finalThumbnailFilename = thumbnailFilename;

        try {
            // Get video info first
            const info = await youtubedl(videoUrl, {
                dumpSingleJson: true,
                noWarnings: true,
                preferFreeFormats: true,
            } as any);

            console.log("Video info:", {
                title: info.title,
                uploader: info.uploader,
                upload_date: info.upload_date,
                extractor: info.extractor,
            });

            videoTitle = info.title || "Video";
            videoAuthor = info.uploader || "Unknown";
            
            // If author is unknown and it's a XiaoHongShu video, try custom extraction
            if ((!info.uploader || info.uploader === "Unknown") && info.extractor === "XiaoHongShu") {
                const customAuthor = await extractXiaoHongShuAuthor(videoUrl);
                if (customAuthor) {
                    videoAuthor = customAuthor;
                }
            }
            videoDate =
                info.upload_date ||
                new Date().toISOString().slice(0, 10).replace(/-/g, "");
            thumbnailUrl = info.thumbnail;
            source = info.extractor || "generic";

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

            // Download the video
            console.log("Downloading video to:", newVideoPath);

            if (downloadId) {
                storageService.updateActiveDownload(downloadId, {
                    filename: videoTitle,
                    progress: 0
                });
            }

            // Prepare flags
            const flags: any = {
                output: newVideoPath,
                format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                mergeOutputFormat: "mp4",
            };

            // Add YouTube specific flags if it's a YouTube URL
            if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
                 flags.format = "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a][acodec=aac]/bestvideo[ext=mp4][vcodec=h264]+bestaudio[ext=m4a]/best[ext=mp4]/best";
                 flags['extractor-args'] = "youtube:player_client=android";
                 flags.addHeader = [
                    'Referer:https://www.youtube.com/',
                    'User-Agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
                ];
            }

            // Use exec to capture stdout for progress
            const subprocess = youtubedl.exec(videoUrl, flags);

            if (onStart) {
                onStart(() => {
                    console.log("Killing subprocess for download:", downloadId);
                    subprocess.kill();
                    
                    // Clean up partial files
                    console.log("Cleaning up partial files...");
                    try {
                        const partVideoPath = `${newVideoPath}.part`;
                        const partThumbnailPath = `${newThumbnailPath}.part`;
                        
                        if (fs.existsSync(partVideoPath)) {
                            fs.unlinkSync(partVideoPath);
                            console.log("Deleted partial video file:", partVideoPath);
                        }
                        if (fs.existsSync(newVideoPath)) {
                            fs.unlinkSync(newVideoPath);
                            console.log("Deleted partial video file:", newVideoPath);
                        }
                        if (fs.existsSync(partThumbnailPath)) {
                            fs.unlinkSync(partThumbnailPath);
                            console.log("Deleted partial thumbnail file:", partThumbnailPath);
                        }
                        if (fs.existsSync(newThumbnailPath)) {
                            fs.unlinkSync(newThumbnailPath);
                            console.log("Deleted partial thumbnail file:", newThumbnailPath);
                        }
                    } catch (cleanupError) {
                        console.error("Error cleaning up partial files:", cleanupError);
                    }
                });
            }

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

            console.log("Video downloaded successfully");

            // Download and save the thumbnail
            thumbnailSaved = false;

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
        } catch (error) {
            console.error("Error in download process:", error);
            throw error;
        }

        // Create metadata for the video
        const videoData: Video = {
            id: timestamp.toString(),
            title: videoTitle || "Video",
            author: videoAuthor || "Unknown",
            date:
                videoDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
            source: source, // Use extracted source
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
        const finalVideoPath = path.join(VIDEOS_DIR, finalVideoFilename);
        
        try {
             const { getVideoDuration } = await import("../../services/metadataService");
             const duration = await getVideoDuration(finalVideoPath);
             if (duration) {
                 videoData.duration = duration.toString();
             }
        } catch (e) {
             console.error("Failed to extract duration from downloaded file:", e);
        }

        // Get file size
        try {
            if (fs.existsSync(finalVideoPath)) {
                const stats = fs.statSync(finalVideoPath);
                videoData.fileSize = stats.size.toString();
            }
        } catch (e) {
            console.error("Failed to get file size:", e);
        }

        // Save the video
        storageService.saveVideo(videoData);

        console.log("Video added to database");

        return videoData;
    }
}
