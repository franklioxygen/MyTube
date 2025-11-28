import axios from "axios";
import * as cheerio from "cheerio";
import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";
import { DATA_DIR, IMAGES_DIR, VIDEOS_DIR } from "../../config/paths";
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

        // Ensure directories exist
        fs.ensureDirSync(VIDEOS_DIR);
        fs.ensureDirSync(IMAGES_DIR);

        const videoPath = path.join(VIDEOS_DIR, videoFilename);
        const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);

        let videoTitle = "MissAV Video";
        let videoAuthor = "MissAV";
        let videoDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        let thumbnailUrl: string | null = null;
        let thumbnailSaved = false;
        let m3u8Url: string | null = null;

        try {
            // 1. Fetch the page content using Puppeteer to bypass Cloudflare and capture m3u8 URL
            console.log("Launching Puppeteer to capture m3u8 URL...");

            const browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            // Set a real user agent
            const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            await page.setUserAgent(userAgent);

            // Setup request listener to find m3u8
            page.on('request', (request) => {
                const reqUrl = request.url();
                if (reqUrl.includes('.m3u8') && !reqUrl.includes('preview')) {
                    console.log("Found m3u8 URL via network interception:", reqUrl);
                    if (!m3u8Url) {
                        m3u8Url = reqUrl;
                    }
                }
            });

            console.log("Navigating to:", url);
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

            // 3. If m3u8 URL was not found via network, try regex extraction as fallback
            if (!m3u8Url) {
                console.log("m3u8 URL not found via network, trying regex extraction...");
                
                // Logic ported from: https://github.com/smalltownjj/yt-dlp-plugin-missav/blob/main/yt_dlp_plugins/extractor/missav.py
                const m3u8Match = html.match(/m3u8\|[^"]+\|playlist\|source/);

                if (m3u8Match) {
                    const matchString = m3u8Match[0];
                    const cleanString = matchString.replace("m3u8|", "").replace("|playlist|source", "");
                    const urlWords = cleanString.split("|");

                    const videoIndex = urlWords.indexOf("video");
                    if (videoIndex !== -1) {
                        const protocol = urlWords[videoIndex - 1];
                        const videoFormat = urlWords[videoIndex + 1];
                        const m3u8UrlPath = urlWords.slice(0, 5).reverse().join("-");
                        const baseUrlPath = urlWords.slice(5, videoIndex - 1).reverse().join(".");
                        m3u8Url = `${protocol}://${baseUrlPath}/${m3u8UrlPath}/${videoFormat}/${urlWords[videoIndex]}.m3u8`;
                        console.log("Reconstructed m3u8 URL via regex:", m3u8Url);
                    }
                }
            }

            if (!m3u8Url) {
                const debugFile = path.join(DATA_DIR, `missav_debug_${timestamp}.html`);
                fs.writeFileSync(debugFile, html);
                console.error(`Could not find m3u8 URL. HTML dumped to ${debugFile}`);
                throw new Error("Could not find m3u8 URL in page source or network requests");
            }

            // 4. Download the video using ffmpeg directly
            console.log("Downloading video stream to:", videoPath);

            if (downloadId) {
                storageService.updateActiveDownload(downloadId, {
                    filename: videoTitle,
                    progress: 0
                });
            }

            await new Promise<void>((resolve, reject) => {
                const ffmpegArgs = [
                    '-user_agent', userAgent,
                    '-headers', 'Referer: https://missav.ai/',
                    '-i', m3u8Url!,
                    '-c', 'copy',
                    '-bsf:a', 'aac_adtstoasc',
                    '-y', // Overwrite output file
                    videoPath
                ];

                console.log("Spawning ffmpeg with args:", ffmpegArgs.join(" "));

                const ffmpeg = spawn('ffmpeg', ffmpegArgs);
                let totalDurationSec = 0;

                if (onStart) {
                    onStart(() => {
                        console.log("Killing ffmpeg process for download:", downloadId);
                        ffmpeg.kill('SIGKILL');
                        
                        // Cleanup
                        try {
                            if (fs.existsSync(videoPath)) {
                                fs.unlinkSync(videoPath);
                                console.log("Deleted partial video file:", videoPath);
                            }
                            if (fs.existsSync(thumbnailPath)) {
                                fs.unlinkSync(thumbnailPath);
                                console.log("Deleted partial thumbnail file:", thumbnailPath);
                            }
                        } catch (e) {
                            console.error("Error cleaning up partial files:", e);
                        }
                    });
                }

                ffmpeg.stderr.on('data', (data) => {
                    const output = data.toString();
                    // console.log("ffmpeg stderr:", output); // Uncomment for verbose debug

                    // Try to parse duration if not set
                    if (totalDurationSec === 0) {
                        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                        if (durationMatch) {
                            const hours = parseInt(durationMatch[1]);
                            const minutes = parseInt(durationMatch[2]);
                            const seconds = parseInt(durationMatch[3]);
                            totalDurationSec = hours * 3600 + minutes * 60 + seconds;
                            console.log("Detected total duration:", totalDurationSec);
                        }
                    }

                    // Parse progress
                    // size=   12345kB time=00:01:23.45 bitrate= 1234.5kbits/s speed=1.23x
                    const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                    const sizeMatch = output.match(/size=\s*(\d+)([kMG]?B)/);
                    const bitrateMatch = output.match(/bitrate=\s*(\d+\.?\d*)kbits\/s/);

                    if (timeMatch && downloadId) {
                        const hours = parseInt(timeMatch[1]);
                        const minutes = parseInt(timeMatch[2]);
                        const seconds = parseInt(timeMatch[3]);
                        const currentTimeSec = hours * 3600 + minutes * 60 + seconds;

                        let percentage = 0;
                        if (totalDurationSec > 0) {
                            percentage = Math.min(100, (currentTimeSec / totalDurationSec) * 100);
                        }

                        let totalSizeStr = "0B";
                        if (sizeMatch) {
                            totalSizeStr = `${sizeMatch[1]}${sizeMatch[2]}`;
                        }

                        let speedStr = "0 B/s";
                        if (bitrateMatch) {
                            const bitrateKbps = parseFloat(bitrateMatch[1]);
                            // Convert kbits/s to KB/s (approximate, usually bitrate is bits, so /8)
                            // But ffmpeg reports kbits/s. 1 byte = 8 bits.
                            const speedKBps = bitrateKbps / 8;
                            if (speedKBps > 1024) {
                                speedStr = `${(speedKBps / 1024).toFixed(2)} MB/s`;
                            } else {
                                speedStr = `${speedKBps.toFixed(2)} KB/s`;
                            }
                        }

                        storageService.updateActiveDownload(downloadId, {
                            progress: parseFloat(percentage.toFixed(1)),
                            totalSize: totalSizeStr,
                            speed: speedStr
                        });
                    }
                });

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log("ffmpeg process finished successfully");
                        resolve();
                    } else {
                        console.error(`ffmpeg process exited with code ${code}`);
                        // If killed (null code) or error
                        if (code === null) {
                             // Likely killed by user, reject? Or resolve if handled?
                             // If killed by onStart callback, we might want to reject to stop flow
                             reject(new Error("Download cancelled"));
                        } else {
                            reject(new Error(`ffmpeg exited with code ${code}`));
                        }
                    }
                });

                ffmpeg.on('error', (err) => {
                    console.error("Failed to start ffmpeg:", err);
                    reject(err);
                });
            });

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
