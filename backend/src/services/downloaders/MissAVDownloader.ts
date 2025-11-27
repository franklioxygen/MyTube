import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";
import youtubedl from "youtube-dl-exec";
import { IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
import { sanitizeFilename } from "../../utils/helpers";
import * as storageService from "../storageService";
import { Video } from "../storageService";

export class MissAVDownloader {
    // Get video info without downloading
    static async getVideoInfo(url: string): Promise<{ title: string; author: string; date: string; thumbnailUrl: string }> {
        try {
            console.log("Fetching MissAV page content with Puppeteer...");

            const browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            const html = await page.content();
            await browser.close();

            const $ = cheerio.load(html);
            const pageTitle = $('meta[property="og:title"]').attr('content');
            const ogImage = $('meta[property="og:image"]').attr('content');

            return {
                title: pageTitle || "MissAV Video",
                author: "MissAV",
                date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
                thumbnailUrl: ogImage || "",
            };
        } catch (error) {
            console.error("Error fetching MissAV video info:", error);
            return {
                title: "MissAV Video",
                author: "MissAV",
                date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
                thumbnailUrl: "",
            };
        }
    }

    // Helper function to download MissAV video
    static async downloadVideo(url: string, downloadId?: string, onStart?: (cancel: () => void) => void): Promise<Video> {
        console.log("Detected MissAV URL:", url);

        const timestamp = Date.now();
        const safeBaseFilename = `video_${timestamp}`;
        const videoFilename = `${safeBaseFilename}.mp4`;
        const thumbnailFilename = `${safeBaseFilename}.jpg`;

        const videoPath = path.join(VIDEOS_DIR, videoFilename);
        const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

        let videoTitle = "MissAV Video";
        let videoAuthor = "MissAV";
        let videoDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        let thumbnailUrl: string | null = null;
        let thumbnailSaved = false;

        try {
            // 1. Fetch the page content using Puppeteer to bypass Cloudflare
            console.log("Fetching MissAV page content with Puppeteer...");

            const browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            // Set a real user agent
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            const html = await page.content();
            await browser.close();

            // 2. Extract metadata using cheerio
            const $ = cheerio.load(html);
            const pageTitle = $('meta[property="og:title"]').attr('content');
            if (pageTitle) {
                videoTitle = pageTitle;
            }

            const ogImage = $('meta[property="og:image"]').attr('content');
            if (ogImage) {
                thumbnailUrl = ogImage;
            }

            console.log("Extracted metadata:", { title: videoTitle, thumbnail: thumbnailUrl });

            // 3. Extract the m3u8 URL
            // Logic ported from: https://github.com/smalltownjj/yt-dlp-plugin-missav/blob/main/yt_dlp_plugins/extractor/missav.py

            // Look for the obfuscated string pattern
            // The pattern seems to be: m3u8|...|playlist|source
            const m3u8Match = html.match(/m3u8\|[^"]+\|playlist\|source/);

            if (!m3u8Match) {
                throw new Error("Could not find m3u8 URL pattern in page source");
            }

            const matchString = m3u8Match[0];
            // Remove "m3u8|" from start and "|playlist|source" from end
            const cleanString = matchString.replace("m3u8|", "").replace("|playlist|source", "");
            const urlWords = cleanString.split("|");

            // Find "video" index
            const videoIndex = urlWords.indexOf("video");
            if (videoIndex === -1) {
                throw new Error("Could not parse m3u8 URL structure");
            }

            const protocol = urlWords[videoIndex - 1];
            const videoFormat = urlWords[videoIndex + 1];

            // Reconstruct parts
            // m3u8_url_path = "-".join((url_words[0:5])[::-1])
            const m3u8UrlPath = urlWords.slice(0, 5).reverse().join("-");

            // base_url_path = ".".join((url_words[5:video_index-1])[::-1])
            const baseUrlPath = urlWords.slice(5, videoIndex - 1).reverse().join(".");

            // formatted_url = "{0}://{1}/{2}/{3}/{4}.m3u8".format(protocol, base_url_path, m3u8_url_path, video_format, url_words[video_index])
            const m3u8Url = `${protocol}://${baseUrlPath}/${m3u8UrlPath}/${videoFormat}/${urlWords[videoIndex]}.m3u8`;

            console.log("Reconstructed m3u8 URL:", m3u8Url);

            // 4. Download the video using yt-dlp
            console.log("Downloading video stream to:", videoPath);

            if (downloadId) {
                storageService.updateActiveDownload(downloadId, {
                    filename: videoTitle,
                    progress: 0
                });
            }

            const subprocess = youtubedl.exec(m3u8Url, {
                output: videoPath,
                format: "mp4",
                noCheckCertificates: true,
                // Add headers to mimic browser
                addHeader: [
                    'Referer:https://missav.ai/',
                    'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ]
            });

            if (onStart) {
                onStart(() => {
                    console.log("Killing subprocess for download:", downloadId);
                    subprocess.kill();
                    
                    // Clean up partial files
                    console.log("Cleaning up partial files...");
                    try {
                        // youtube-dl creates .part files during download
                        const partVideoPath = `${videoPath}.part`;
                        const partThumbnailPath = `${thumbnailPath}.part`;
                        
                        if (fs.existsSync(partVideoPath)) {
                            fs.unlinkSync(partVideoPath);
                            console.log("Deleted partial video file:", partVideoPath);
                        }
                        if (fs.existsSync(videoPath)) {
                            fs.unlinkSync(videoPath);
                            console.log("Deleted partial video file:", videoPath);
                        }
                        if (fs.existsSync(partThumbnailPath)) {
                            fs.unlinkSync(partThumbnailPath);
                            console.log("Deleted partial thumbnail file:", partThumbnailPath);
                        }
                        if (fs.existsSync(thumbnailPath)) {
                            fs.unlinkSync(thumbnailPath);
                            console.log("Deleted partial thumbnail file:", thumbnailPath);
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

            console.log("Video download complete");

            // 5. Download thumbnail
            if (thumbnailUrl) {
                try {
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
                    console.log("Thumbnail saved");
                } catch (err) {
                    console.error("Error downloading thumbnail:", err);
                }
            }

            // 6. Rename files with title
            let finalVideoFilename = videoFilename;
            let finalThumbnailFilename = thumbnailFilename;

            const newSafeBaseFilename = `${sanitizeFilename(videoTitle)}_${timestamp}`;
            const newVideoFilename = `${newSafeBaseFilename}.mp4`;
            const newThumbnailFilename = `${newSafeBaseFilename}.jpg`;

            const newVideoPath = path.join(VIDEOS_DIR, newVideoFilename);
            const newThumbnailPath = path.join(IMAGES_DIR, newThumbnailFilename);

            if (fs.existsSync(videoPath)) {
                fs.renameSync(videoPath, newVideoPath);
                finalVideoFilename = newVideoFilename;
            }

            if (thumbnailSaved && fs.existsSync(thumbnailPath)) {
                fs.renameSync(thumbnailPath, newThumbnailPath);
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
                console.error("Failed to extract duration from MissAV video:", e);
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

            // 7. Save metadata
            const videoData: Video = {
                id: timestamp.toString(),
                title: videoTitle,
                author: videoAuthor,
                date: videoDate,
                source: "missav",
                sourceUrl: url,
                videoFilename: finalVideoFilename,
                thumbnailFilename: thumbnailSaved ? finalThumbnailFilename : undefined,
                thumbnailUrl: thumbnailUrl || undefined,
                videoPath: `/videos/${finalVideoFilename}`,
                thumbnailPath: thumbnailSaved ? `/images/${finalThumbnailFilename}` : null,
                duration: duration,
                fileSize: fileSize,
                addedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            };

            storageService.saveVideo(videoData);
            console.log("MissAV video saved to database");

            return videoData;

        } catch (error: any) {
            console.error("Error in downloadMissAVVideo:", error);
            // Cleanup
            if (fs.existsSync(videoPath)) fs.removeSync(videoPath);
            if (fs.existsSync(thumbnailPath)) fs.removeSync(thumbnailPath);
            throw error;
        }
    }
}
