import axios from "axios";
import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { VERSION } from "../version";

interface GithubReleaseResponse {
  tag_name: string;
  html_url: string;
  body: string;
  published_at: string;
}

interface GithubTag {
  name: string;
}

interface LatestVersionResponse {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  hasUpdate: boolean;
}

// Helper to compare semantic versions (v1 > v2)
const isNewerVersion = (latest: string, current: string): boolean => {
  try {
    const latestParts = latest.split(".").map(Number);
    const currentParts = current.split(".").map(Number);

    while (latestParts.length > 0 || currentParts.length > 0) {
      const latestPart = latestParts.shift() ?? 0;
      const currentPart = currentParts.shift() ?? 0;

      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }

    return false;
  } catch {
    // Fallback to string comparison if parsing fails
    return latest !== current;
  }
};

const createVersionResponse = (
  latestVersion: string,
  releaseUrl: string
): LatestVersionResponse => {
  const currentVersion = VERSION.number;

  return {
    currentVersion,
    latestVersion,
    releaseUrl,
    hasUpdate: isNewerVersion(latestVersion, currentVersion),
  };
};

const getTagReleaseUrl = (tag: GithubTag): string => {
  return `https://github.com/franklioxygen/mytube/releases/tag/${tag.name}`;
};

export const getLatestVersion = async (req: Request, res: Response) => {
  try {
    const response = await axios.get<GithubReleaseResponse>(
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

    res.json(createVersionResponse(latestVersion, releaseUrl));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      // Fallback: Try to get tags if no release is published
      try {
        const tagsResponse = await axios.get<GithubTag[]>(
          "https://api.github.com/repos/franklioxygen/mytube/tags",
          {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "MyTube-App",
            },
            timeout: 5000,
          }
        );

        if (tagsResponse.data.length > 0) {
          const latestTag = tagsResponse.data[0];
          const latestVersion = latestTag.name.replace(/^v/, "");
          const releaseUrl = getTagReleaseUrl(latestTag);

          return res.json(createVersionResponse(latestVersion, releaseUrl));
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
