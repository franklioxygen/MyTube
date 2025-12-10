import { executeYtDlpJson } from "../utils/ytDlpUtils";
import * as storageService from "./storageService";

export interface Comment {
  id: string;
  author: string;
  content: string;
  date: string;
  avatar?: string;
}

// Fetch comments for a video
export const getComments = async (videoId: string): Promise<Comment[]> => {
  try {
    const video = storageService.getVideoById(videoId);
    if (!video) {
      throw new Error("Video not found");
    }

    // Use yt-dlp for both Bilibili and YouTube as it's more reliable
    return await getCommentsWithYtDlp(video.sourceUrl);
  } catch (error) {
    console.error("Error fetching comments:", error);
    return [];
  }
};

// Fetch comments using yt-dlp (works for YouTube and Bilibili)
const getCommentsWithYtDlp = async (url: string): Promise<Comment[]> => {
  try {
    console.log(`[CommentService] Fetching comments using yt-dlp for: ${url}`);
    const info = await executeYtDlpJson(url, {
      writeComments: true, // Include comments in JSON output
      noWarnings: true,
      playlistEnd: 1, // Ensure we only process one video
      extractorArgs: "youtube:max_comments=20,all_comments=false",
    });

    if (info.comments) {
      // Sort by date (newest first) and take top 10
      // Note: yt-dlp comments structure might vary
      return info.comments.slice(0, 10).map((comment: any) => ({
        id: comment.id || comment.comment_id || String(Math.random()),
        author: comment.author?.startsWith("@")
          ? comment.author.substring(1)
          : comment.author || "Unknown",
        content: comment.text || comment.content || "",
        date: comment.timestamp
          ? new Date(comment.timestamp * 1000).toISOString().split("T")[0]
          : comment.time || "Unknown",
      }));
    }

    return [];
  } catch (error) {
    console.error("Error fetching comments with yt-dlp:", error);
    return [];
  }
};
