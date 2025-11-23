import youtubedl from "youtube-dl-exec";
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

    // Use youtube-dl for both Bilibili and YouTube as it's more reliable
    return await getCommentsWithYoutubeDl(video.sourceUrl);
  } catch (error) {
    console.error("Error fetching comments:", error);
    return [];
  }
};

// Fetch comments using youtube-dl (works for YouTube and Bilibili)
const getCommentsWithYoutubeDl = async (url: string): Promise<Comment[]> => {
  try {
    console.log(`[CommentService] Fetching comments using youtube-dl for: ${url}`);
    const output = await youtubedl(url, {
      getComments: true,
      dumpSingleJson: true,
      noWarnings: true,
      playlistEnd: 1, // Ensure we only process one video
      extractorArgs: "youtube:max_comments=20,all_comments=false",
    } as any);

    const info = output as any;
    
    if (info.comments) {
        // Sort by date (newest first) and take top 10
        // Note: youtube-dl comments structure might vary
        return info.comments
            .slice(0, 10)
            .map((comment: any) => ({
                id: comment.id,
                author: comment.author.startsWith('@') ? comment.author.substring(1) : comment.author,
                content: comment.text,
                date: comment.timestamp ? new Date(comment.timestamp * 1000).toISOString().split('T')[0] : 'Unknown',
            }));
    }

    return [];
  } catch (error) {
    console.error("Error fetching comments with youtube-dl:", error);
    return [];
  }
};
