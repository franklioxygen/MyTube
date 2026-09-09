import axios from "axios";
import path from "path";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../../../config/paths";
import { bccToVtt } from "../../../utils/bccToVtt";
import { extractBilibiliVideoId } from "../../../utils/helpers";
import { logger } from "../../../utils/logger";
import {
  buildAllowlistedHttpUrl,
  ensureDirSafeSync,
  resolveSafeChildPath,
  resolveSafePathInDirectories,
  writeFileSafeSync,
} from "../../../utils/security";
import { buildBilibiliApiHeaders } from "./bilibiliHeaders";

type SubtitleDownloadConfig = Record<string, unknown>;
const BILIBILI_ALLOWED_HOSTS = ["bilibili.com", "hdslb.com"];

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

/**
 * Download subtitles for a Bilibili video
 */
export async function downloadSubtitles(
  videoUrl: string,
  baseFilename: string,
  subtitleDir: string,
  subtitlePathPrefix: string,
  axiosConfig: SubtitleDownloadConfig = {}
): Promise<Array<{ language: string; filename: string; path: string }>> {
  try {
    const videoId = extractBilibiliVideoId(videoUrl);
    if (!videoId) return [];

    // Get CID first
    const viewApiUrl = buildAllowlistedHttpUrl(
      `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`,
      BILIBILI_ALLOWED_HOSTS
    );
    // Built per request rather than once for both: the shared builder selects
    // cookies for the exact URL, so reusing one header set across two endpoints
    // would send view-scoped cookies to the player path and drop the ones
    // scoped to it - and the player response is what carries the subtitle URLs.
    // The module-local reader this replaced had no such scoping at all: it sent
    // every cookie in the file to Bilibili, YouTube's included, and dropped any
    // exported with the #HttpOnly_ prefix, SESSDATA among them.
    const viewHeaders = buildBilibiliApiHeaders(viewApiUrl);
    if (!viewHeaders.Cookie) {
      logger.warn(
        "WARNING: No cookies found in cookies.txt. Bilibili subtitles usually require login."
      );
    }

    let viewResponse;
    try {
      viewResponse = await axios.get(viewApiUrl, { headers: viewHeaders, ...axiosConfig }); // nosemgrep
    } catch (viewError: unknown) {
      logger.error(
        `Failed to fetch view API: ${
          viewError instanceof Error ? viewError.message : String(viewError)
        }`
      );
      return [];
    }

    const cid = viewResponse.data?.data?.cid;

    if (!cid) {
      logger.info("Could not find CID for video");
      return [];
    }

    // Get subtitles from player API first (player API has actual URLs)
    const playerApiUrl = buildAllowlistedHttpUrl(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${videoId}&cid=${cid}`,
      BILIBILI_ALLOWED_HOSTS
    );
    logger.info(`Fetching subtitles from: ${playerApiUrl}`);
    const playerHeaders = buildBilibiliApiHeaders(playerApiUrl);
    let playerResponse;
    try {
      playerResponse = await axios.get(playerApiUrl, { headers: playerHeaders, ...axiosConfig }); // nosemgrep
    } catch (playerError: unknown) {
      logger.warn(
        `Player API failed: ${
          playerError instanceof Error ? playerError.message : String(playerError)
        }`
      );
      // Continue to check view API fallback
      playerResponse = null;
    }

    // Checked on the player request: it is the one that returns the subtitle
    // URLs, so it is the one whose authentication matters here.
    if (playerHeaders.Cookie && !playerHeaders.Cookie.includes("SESSDATA")) {
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

    // Write subtitles into the same directory as the video (mirroring the
    // author/season or collection subfolder), not the storage root (issue #295).
    // subtitlePathPrefix decides which storage root we live under (videos vs
    // subtitles); subtitleDir is the actual target directory the caller resolved.
    const normalizedPrefix = subtitlePathPrefix.replace(/\\/g, "/");
    const useVideoRoot = normalizedPrefix.startsWith("/videos");
    const rootDir = useVideoRoot ? VIDEOS_DIR : SUBTITLES_DIR;
    // Validate the caller-provided directory stays within the chosen root; fall
    // back to the root only if it is missing or invalid.
    let targetSubtitleDir = rootDir;
    if (subtitleDir) {
      try {
        targetSubtitleDir = resolveSafePathInDirectories(subtitleDir, [rootDir]);
      } catch {
        logger.warn(
          `Subtitle directory "${subtitleDir}" is outside the allowed root; writing to root instead.`
        );
        targetSubtitleDir = rootDir;
      }
    }
    // Web path prefix preserves the subdirectory (e.g. /videos/<collection> or
    // a planned author/season path). Strip any trailing slash.
    const safePathPrefix =
      trimTrailingSlashes(normalizedPrefix) ||
      (useVideoRoot ? "/videos" : "/subtitles");
    ensureDirSafeSync(targetSubtitleDir, rootDir);

    // Process subtitles (matching v1.5.14 approach - simple and direct)
    for (const sub of subtitlesData) {
      const lang = sub.lan;
      const subUrl = sub.subtitle_url;

      // Skip subtitles without URL
      if (!subUrl) continue;

      // Ensure URL is absolute (sometimes it starts with //)
      const absoluteSubUrl = buildAllowlistedHttpUrl(
        subUrl.startsWith("//")
          ? `https:${subUrl}`
          : subUrl,
        BILIBILI_ALLOWED_HOSTS
      );

      logger.info(`Downloading subtitle (${lang}): ${absoluteSubUrl}`);

      // Do NOT send cookies to the subtitle CDN (hdslb.com) as it can cause 400 Bad Request (Header too large)
      // and they are not needed for the CDN file itself.
      const cdnHeaders = {
        "User-Agent": viewHeaders["User-Agent"],
        Referer: viewHeaders["Referer"],
      };

      try {
        const subResponse = await axios.get(absoluteSubUrl, { // nosemgrep
          headers: cdnHeaders,
          ...axiosConfig,
        });
        const vttContent = bccToVtt(subResponse.data);

        if (vttContent) {
          const subFilename = `${baseFilename}.${lang}.vtt`;
          const subPath = resolveSafeChildPath(targetSubtitleDir, subFilename);

          writeFileSafeSync(subPath, rootDir, vttContent);
          logger.info(`Saved subtitle file: ${subPath}`);

          savedSubtitles.push({
            language: lang,
            filename: subFilename,
            path: `${safePathPrefix}/${subFilename}`,
          });
        } else {
          logger.warn(`Failed to convert subtitle to VTT format for ${lang}`);
        }
      } catch (subError: unknown) {
        logger.error(
          `Failed to download subtitle (${lang}): ${
            subError instanceof Error ? subError.message : String(subError)
          }`
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
