import { logger } from "../../../utils/logger";
import {
  executeYtDlpJson,
  getNetworkConfigFromUserConfig,
  getUserYtDlpConfig,
} from "../../../utils/ytDlpUtils";
import { VideoInfo } from "../BaseDownloader";
import { getProviderScript } from "./ytdlpHelpers";
import { extractXiaoHongShuAuthor } from "./ytdlpHelpers";

/**
 * Get video info without downloading
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  try {
    // Get user config for network options
    const userConfig = getUserYtDlpConfig(url);
    const networkConfig = getNetworkConfigFromUserConfig(userConfig);
    const PROVIDER_SCRIPT = getProviderScript();

    // Explicitly exclude format-related options when fetching metadata
    // Format restrictions should only apply during actual downloads, not metadata fetching
    const info = await executeYtDlpJson(
      url,
      {
        ...networkConfig,
        noWarnings: true,
        preferFreeFormats: true,
        ...(PROVIDER_SCRIPT
          ? {
              extractorArgs: `youtubepot-bgutilscript:script_path=${PROVIDER_SCRIPT}`,
            }
          : {}),
        // Explicitly exclude format options to avoid format availability errors
        formatSort: undefined,
        format: undefined,
        S: undefined,
        f: undefined,
      },
      true // Enable retry without format restrictions if format error occurs
    );

    return {
      title: info.title || "Video",
      author: info.uploader || "Unknown",
      date:
        info.upload_date ||
        new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: info.thumbnail,
      description: info.description, // Added description
    };
  } catch (error) {
    logger.error("Error fetching video info:", error);
    return {
      title: "Video",
      author: "Unknown",
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      thumbnailUrl: "",
    };
  }
}

/**
 * Extract video metadata from yt-dlp info
 */
export async function extractVideoMetadata(videoUrl: string, info: any) {
  let videoTitle = info.title || "Video";
  let videoAuthor = info.uploader || "Unknown";

  // If author is unknown and it's a XiaoHongShu video, try custom extraction
  if (
    (!info.uploader || info.uploader === "Unknown") &&
    info.extractor === "XiaoHongShu"
  ) {
    const customAuthor = await extractXiaoHongShuAuthor(videoUrl);
    if (customAuthor) {
      videoAuthor = customAuthor;
    }
  }

  const videoDescription = info.description || "";
  const videoDate =
    info.upload_date ||
    new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const thumbnailUrl = info.thumbnail;
  const source = info.extractor || "generic";

  return {
    videoTitle,
    videoAuthor,
    videoDate,
    videoDescription,
    thumbnailUrl,
    source,
  };
}

