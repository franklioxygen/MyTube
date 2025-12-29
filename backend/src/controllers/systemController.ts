import axios from "axios";
import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { VERSION } from "../version";

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string;
  published_at: string;
}


// Helper to compare semantic versions (v1 > v2)
const isNewerVersion = (latest: string, current: string): boolean => {
  try {
    const v1 = latest.split('.').map(Number);
    const v2 = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const num1 = v1[i] || 0;
      const num2 = v2[i] || 0;
      if (num1 > num2) return true;
      if (num1 < num2) return false;
    }
    return false;
  } catch (e) {
    // Fallback to string comparison if parsing fails
    return latest !== current;
  }
};

export const getLatestVersion = async (req: Request, res: Response) => {
  try {
    const currentVersion = VERSION.number;
    const response = await axios.get<GithubRelease>(
      "https://api.github.com/repos/franklioxygen/mytube/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "MyTube-App",
        },
        timeout: 5000, // 5 second timeout
      }
    );

    const latestVersion = response.data.tag_name.replace(/^v/, "");
    const releaseUrl = response.data.html_url;

    res.json({
      currentVersion,
      latestVersion,
      releaseUrl,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      // Fallback: Try to get tags if no release is published
      try {
        const tagsResponse = await axios.get<any[]>(
          "https://api.github.com/repos/franklioxygen/mytube/tags",
          {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "MyTube-App",
            },
            timeout: 5000,
          }
        );

        if (tagsResponse.data && tagsResponse.data.length > 0) {
          const latestTag = tagsResponse.data[0];
          const latestVersion = latestTag.name.replace(/^v/, "");
          const releaseUrl = `https://github.com/franklioxygen/mytube/releases/tag/${latestTag.name}`;
          const currentVersion = VERSION.number;

          return res.json({
            currentVersion,
            latestVersion,
            releaseUrl,
            hasUpdate: isNewerVersion(latestVersion, currentVersion),
          });
        }
      } catch (tagError) {
        logger.warn("Failed to fetch tags as fallback:", tagError);
      }
    }

    logger.error("Failed to check for updates:", error);
    // Return current version if check fails
    res.json({
      currentVersion: VERSION.number,
      latestVersion: VERSION.number,
      releaseUrl: "",
      hasUpdate: false,
      error: "Failed to check for updates",
    });
  }
};
