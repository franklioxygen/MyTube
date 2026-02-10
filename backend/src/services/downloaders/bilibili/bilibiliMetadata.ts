import axios from "axios";
import { IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { logger } from "../../../utils/logger";
import { resolveSafePathInDirectories } from "../../../utils/security";
import { extractBilibiliVideoId } from "../../../utils/helpers";
import { BilibiliVideoInfo } from "./types";

export interface PartMetadata {
  channelUrl?: string;
  partTitle: string;
}

/**
 * Extract channel URL and part-specific title from Bilibili API
 */
export async function extractPartMetadata(
  url: string,
  partNumber: number,
  totalParts: number,
  seriesTitle: string,
  bilibiliInfo: BilibiliVideoInfo
): Promise<PartMetadata> {
  let channelUrl: string | undefined;
  let partTitle = bilibiliInfo.title || "Bilibili Video";

  try {
    const videoId = extractBilibiliVideoId(url);
    if (!videoId) {
      logger.warn("Could not extract video ID from URL, using yt-dlp title");
      return { partTitle, channelUrl };
    }

    const isBvId = videoId.startsWith("BV");
    const apiUrl = isBvId
      ? `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`
      : `https://api.bilibili.com/x/web-interface/view?aid=${videoId.replace(
          "av",
          ""
        )}`;

    const response = await axios.get(apiUrl, {
      headers: {
        Referer: "https://www.bilibili.com",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (response.data?.data) {
      // Extract channel URL
      if (response.data.data.owner?.mid) {
        const mid = response.data.data.owner.mid;
        channelUrl = `https://space.bilibili.com/${mid}`;
      }

      // For multi-part videos, get the part-specific title from the pages array
      if (
        totalParts > 1 &&
        response.data.data.pages &&
        Array.isArray(response.data.data.pages)
      ) {
        const page = response.data.data.pages.find(
          (p: any) => p.page === partNumber
        );
        if (page && page.part) {
          partTitle = page.part;
          logger.info(`Found part-specific title: ${partTitle}`);
        } else {
          // Fall back: try to remove collection name from yt-dlp title
          if (seriesTitle && bilibiliInfo.title?.includes(seriesTitle)) {
            partTitle = bilibiliInfo.title.replace(seriesTitle, "").trim();
            partTitle = partTitle
              .replace(/^\s*[-–—]\s*/, "")
              .replace(/^\s*p\d+\s*/i, "")
              .trim();
          }
        }
      }
    }
  } catch (error) {
    logger.warn(
      "Error fetching part-specific title from API, using yt-dlp title:",
      error
    );
    // Fall back to using yt-dlp title, but try to remove collection name if present
    if (
      totalParts > 1 &&
      seriesTitle &&
      bilibiliInfo.title?.includes(seriesTitle)
    ) {
      partTitle = bilibiliInfo.title.replace(seriesTitle, "").trim();
      partTitle = partTitle
        .replace(/^\s*[-–—]\s*/, "")
        .replace(/^\s*p\d+\s*/i, "")
        .trim();
    }
  }

  return { channelUrl, partTitle };
}

/**
 * Get video duration from file
 */
export async function getVideoDuration(
  videoPath: string
): Promise<string | undefined> {
  try {
    const { getVideoDuration } = await import(
      "../../../services/metadataService"
    );
    const durationSec = await getVideoDuration(videoPath);
    if (durationSec) {
      return durationSec.toString();
    }
  } catch (e) {
    logger.error("Failed to extract duration from Bilibili video:", e);
  }
  return undefined;
}

/**
 * Get file size from file
 */
export function getFileSize(filePath: string): string | undefined {
  try {
    const safeFilePath = resolveSafePathInDirectories(filePath, [
      VIDEOS_DIR,
      IMAGES_DIR,
      SUBTITLES_DIR,
    ]);
    const fs = require("fs-extra");
    if (fs.existsSync(safeFilePath)) {
      const stats = fs.statSync(safeFilePath);
      return stats.size.toString();
    }
  } catch (e) {
    logger.error("Failed to get file size:", e);
  }
  return undefined;
}
