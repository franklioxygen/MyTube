import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { SUBTITLES_DIR } from "../../../config/paths";
import { bccToVtt } from "../../../utils/bccToVtt";
import { extractBilibiliVideoId } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import { getCookieHeader } from "./bilibiliCookie";

/**
 * Download subtitles for a Bilibili video
 */
export async function downloadSubtitles(
  videoUrl: string,
  baseFilename: string,
  collectionName?: string
): Promise<Array<{ language: string; filename: string; path: string }>> {
  try {
    const videoId = extractBilibiliVideoId(videoUrl);
    if (!videoId) return [];

    const cookieHeader = getCookieHeader();
    if (!cookieHeader) {
      logger.warn(
        "WARNING: No cookies found in cookies.txt. Bilibili subtitles usually require login."
      );
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.bilibili.com",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    // Get CID first
    const viewApiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
    let viewResponse;
    try {
      viewResponse = await axios.get(viewApiUrl, { headers });
    } catch (viewError: any) {
      logger.error(`Failed to fetch view API: ${viewError.message}`);
      return [];
    }

    const cid = viewResponse.data?.data?.cid;

    if (!cid) {
      logger.info("Could not find CID for video");
      return [];
    }

    // Get subtitles from player API first (player API has actual URLs)
    const playerApiUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${videoId}&cid=${cid}`;
    logger.info(`Fetching subtitles from: ${playerApiUrl}`);
    let playerResponse;
    try {
      playerResponse = await axios.get(playerApiUrl, { headers });
    } catch (playerError: any) {
      logger.warn(`Player API failed: ${playerError.message}`);
      // Continue to check view API fallback
      playerResponse = null;
    }

    if (cookieHeader && !cookieHeader.includes("SESSDATA")) {
      logger.warn(
        "WARNING: SESSDATA cookie not found! This is required for Bilibili authentication."
      );
    }

    let subtitlesData = playerResponse?.data?.data?.subtitle?.subtitles;

    // Fallback: Check if subtitles are in the view response (sometimes they are)
    if (!subtitlesData || subtitlesData.length === 0) {
      logger.info("No subtitles in player API, checking view API response...");
      const viewSubtitles = viewResponse.data?.data?.subtitle?.list;
      if (viewSubtitles && viewSubtitles.length > 0) {
        logger.info(`Found ${viewSubtitles.length} subtitles in view API`);
        subtitlesData = viewSubtitles;
      }
    }

    if (!subtitlesData) {
      logger.info("No subtitle field in response data");
    } else if (!Array.isArray(subtitlesData)) {
      logger.info("Subtitles field is not an array");
    } else {
      logger.info(`Found ${subtitlesData.length} subtitles`);
    }

    if (!subtitlesData || !Array.isArray(subtitlesData)) {
      logger.info("No subtitles found in API response");
      return [];
    }

    const savedSubtitles = [];

    // Determine subtitle directory based on collection name
    const subtitleDir = collectionName
      ? path.join(SUBTITLES_DIR, collectionName)
      : SUBTITLES_DIR;
    const subtitlePathPrefix = collectionName
      ? `/subtitles/${collectionName}`
      : `/subtitles`;

    // Ensure subtitles directory exists
    fs.ensureDirSync(subtitleDir);

    // Process subtitles (matching v1.5.14 approach - simple and direct)
    for (const sub of subtitlesData) {
      const lang = sub.lan;
      const subUrl = sub.subtitle_url;

      // Skip subtitles without URL
      if (!subUrl) continue;

      // Ensure URL is absolute (sometimes it starts with //)
      const absoluteSubUrl = subUrl.startsWith("//")
        ? `https:${subUrl}`
        : subUrl;

      logger.info(`Downloading subtitle (${lang}): ${absoluteSubUrl}`);

      // Do NOT send cookies to the subtitle CDN (hdslb.com) as it can cause 400 Bad Request (Header too large)
      // and they are not needed for the CDN file itself.
      const cdnHeaders = {
        "User-Agent": headers["User-Agent"],
        Referer: headers["Referer"],
      };

      try {
        const subResponse = await axios.get(absoluteSubUrl, {
          headers: cdnHeaders,
        });
        const vttContent = bccToVtt(subResponse.data);

        if (vttContent) {
          const subFilename = `${baseFilename}.${lang}.vtt`;
          const subPath = path.join(subtitleDir, subFilename);

          fs.writeFileSync(subPath, vttContent);
          logger.info(`Saved subtitle file: ${subPath}`);

          savedSubtitles.push({
            language: lang,
            filename: subFilename,
            path: `${subtitlePathPrefix}/${subFilename}`,
          });
        } else {
          logger.warn(`Failed to convert subtitle to VTT format for ${lang}`);
        }
      } catch (subError: any) {
        logger.error(
          `Failed to download subtitle (${lang}): ${subError.message}`
        );
        continue;
      }
    }

    return savedSubtitles;
  } catch (error) {
    logger.error("Error in downloadSubtitles:", error);
    return [];
  }
}
