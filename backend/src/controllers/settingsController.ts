import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import {
  COLLECTIONS_DATA_PATH,
  STATUS_DATA_PATH,
  VIDEOS_DATA_PATH,
} from "../config/paths";
import { NotFoundError, ValidationError } from "../errors/DownloadErrors";
import downloadManager from "../services/downloadManager";
import * as storageService from "../services/storageService";
import { logger } from "../utils/logger";
import { successMessage } from "../utils/response";

interface Settings {
  loginEnabled: boolean;
  password?: string;
  defaultAutoPlay: boolean;
  defaultAutoLoop: boolean;
  maxConcurrentDownloads: number;
  language: string;
  tags?: string[];
  cloudDriveEnabled?: boolean;
  openListApiUrl?: string;
  openListToken?: string;
  cloudDrivePath?: string;
  homeSidebarOpen?: boolean;
  subtitlesEnabled?: boolean;
  websiteName?: string;
  itemsPerPage?: number;
  ytDlpConfig?: string;
  showYoutubeSearch?: boolean;
  proxyOnlyYoutube?: boolean;
  moveSubtitlesToVideoFolder?: boolean;
  moveThumbnailsToVideoFolder?: boolean;
}

const defaultSettings: Settings = {
  loginEnabled: false,
  password: "",
  defaultAutoPlay: false,
  defaultAutoLoop: false,
  maxConcurrentDownloads: 3,
  language: "en",
  cloudDriveEnabled: false,
  openListApiUrl: "",
  openListToken: "",
  cloudDrivePath: "",
  homeSidebarOpen: true,
  subtitlesEnabled: true,
  websiteName: "MyTube",
  itemsPerPage: 12,
  showYoutubeSearch: true,
};

/**
 * Get application settings
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns data directly for backward compatibility with frontend
 */
export const getSettings = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const settings = storageService.getSettings();

  // If empty (first run), save defaults
  if (Object.keys(settings).length === 0) {
    storageService.saveSettings(defaultSettings);
    // Return data directly for backward compatibility
    res.json(defaultSettings);
    return;
  }

  // Merge with defaults to ensure all fields exist
  const mergedSettings = { ...defaultSettings, ...settings };

  // Do not send the hashed password to the frontend
  const { password, ...safeSettings } = mergedSettings;
  // Return data directly for backward compatibility
  res.json({ ...safeSettings, isPasswordSet: !!password });
};

/**
 * Run data migration
 * Errors are automatically handled by asyncHandler middleware
 */
export const migrateData = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { runMigration } = await import("../services/migrationService");
  const results = await runMigration();
  // Return format expected by frontend: { results: {...} }
  res.json({ results });
};

/**
 * Delete legacy data files
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteLegacyData = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const SETTINGS_DATA_PATH = path.join(
    path.dirname(VIDEOS_DATA_PATH),
    "settings.json"
  );
  const filesToDelete = [
    VIDEOS_DATA_PATH,
    COLLECTIONS_DATA_PATH,
    STATUS_DATA_PATH,
    SETTINGS_DATA_PATH,
  ];

  const results: { deleted: string[]; failed: string[] } = {
    deleted: [],
    failed: [],
  };

  for (const file of filesToDelete) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        results.deleted.push(path.basename(file));
      } catch (err) {
        logger.error(`Failed to delete ${file}:`, err);
        results.failed.push(path.basename(file));
      }
    }
  }

  // Return format expected by frontend: { results: { deleted: [], failed: [] } }
  res.json({ results });
};

/**
 * Format legacy filenames
 * Errors are automatically handled by asyncHandler middleware
 */
export const formatFilenames = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const results = storageService.formatLegacyFilenames();
  // Return format expected by frontend: { results: {...} }
  res.json({ results });
};

/**
 * Update application settings
 * Errors are automatically handled by asyncHandler middleware
 */
export const updateSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  const newSettings: Settings = req.body;

  // Validate settings if needed
  if (newSettings.maxConcurrentDownloads < 1) {
    newSettings.maxConcurrentDownloads = 1;
  }

  if (newSettings.websiteName && newSettings.websiteName.length > 15) {
    newSettings.websiteName = newSettings.websiteName.substring(0, 15);
  }

  if (newSettings.itemsPerPage && newSettings.itemsPerPage < 1) {
    newSettings.itemsPerPage = 12; // Default fallback if invalid
  }

  // Handle password hashing
  if (newSettings.password) {
    // If password is provided, hash it
    const salt = await bcrypt.genSalt(10);
    newSettings.password = await bcrypt.hash(newSettings.password, salt);
  } else {
    // If password is empty/not provided, keep existing password
    const existingSettings = storageService.getSettings();
    newSettings.password = existingSettings.password;
  }

  // Check for deleted tags and remove them from all videos
  const existingSettings = storageService.getSettings();
  const oldTags: string[] = existingSettings.tags || [];
  const newTagsList: string[] = newSettings.tags || [];

  const deletedTags = oldTags.filter((tag) => !newTagsList.includes(tag));

  if (deletedTags.length > 0) {
    logger.info("Tags deleted:", deletedTags);
    const allVideos = storageService.getVideos();
    let videosUpdatedCount = 0;

    for (const video of allVideos) {
      if (video.tags && video.tags.some((tag) => deletedTags.includes(tag))) {
        const updatedTags = video.tags.filter(
          (tag) => !deletedTags.includes(tag)
        );
        storageService.updateVideo(video.id, { tags: updatedTags });
        videosUpdatedCount++;
      }
    }
    logger.info(`Removed deleted tags from ${videosUpdatedCount} videos`);
  }

  storageService.saveSettings(newSettings);

  // Check for moveSubtitlesToVideoFolder change
  if (
    newSettings.moveSubtitlesToVideoFolder !==
    existingSettings.moveSubtitlesToVideoFolder
  ) {
    if (newSettings.moveSubtitlesToVideoFolder !== undefined) {
      // Run asynchronously
      const { moveAllSubtitles } = await import("../services/subtitleService");
      moveAllSubtitles(newSettings.moveSubtitlesToVideoFolder).catch((err) =>
        logger.error("Error moving subtitles in background:", err)
      );
    }
  }

  // Check for moveThumbnailsToVideoFolder change
  if (
    newSettings.moveThumbnailsToVideoFolder !==
    existingSettings.moveThumbnailsToVideoFolder
  ) {
    if (newSettings.moveThumbnailsToVideoFolder !== undefined) {
      // Run asynchronously
      const { moveAllThumbnails } = await import(
        "../services/thumbnailService"
      );
      moveAllThumbnails(newSettings.moveThumbnailsToVideoFolder).catch((err) =>
        logger.error("Error moving thumbnails in background:", err)
      );
    }
  }

  // Apply settings immediately where possible
  downloadManager.setMaxConcurrentDownloads(newSettings.maxConcurrentDownloads);

  // Return format expected by frontend: { success: true, settings: {...} }
  res.json({
    success: true,
    settings: { ...newSettings, password: undefined },
  });
};

/**
 * Check if password authentication is enabled
 * Errors are automatically handled by asyncHandler middleware
 */
export const getPasswordEnabled = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  // Return true only if login is enabled AND a password is set
  const isEnabled = mergedSettings.loginEnabled && !!mergedSettings.password;

  // Return format expected by frontend: { enabled: boolean }
  res.json({ enabled: isEnabled });
};

/**
 * Verify password for authentication
 * Errors are automatically handled by asyncHandler middleware
 */
export const verifyPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { password } = req.body;

  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };

  if (!mergedSettings.loginEnabled) {
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
    return;
  }

  if (!mergedSettings.password) {
    // If no password set but login enabled, allow access
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
    return;
  }

  const isMatch = await bcrypt.compare(password, mergedSettings.password);

  if (isMatch) {
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
  } else {
    throw new ValidationError("Incorrect password", "password");
  }
};

/**
 * Upload cookies file
 * Errors are automatically handled by asyncHandler middleware
 */
export const uploadCookies = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!req.file) {
    throw new ValidationError("No file uploaded", "file");
  }

  const { DATA_DIR } = require("../config/paths");
  const targetPath = path.join(DATA_DIR, "cookies.txt");

  try {
    // Move the file to the target location
    fs.moveSync(req.file.path, targetPath, { overwrite: true });

    logger.info(`Cookies uploaded and saved to ${targetPath}`);
    res.json(successMessage("Cookies uploaded successfully"));
  } catch (error: any) {
    // Clean up temp file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    throw error;
  }
};

/**
 * Check if cookies file exists
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkCookies = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { DATA_DIR } = require("../config/paths");
  const cookiesPath = path.join(DATA_DIR, "cookies.txt");
  const exists = fs.existsSync(cookiesPath);
  // Return format expected by frontend: { exists: boolean }
  res.json({ exists });
};

/**
 * Delete cookies file
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteCookies = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { DATA_DIR } = require("../config/paths");
  const cookiesPath = path.join(DATA_DIR, "cookies.txt");

  if (fs.existsSync(cookiesPath)) {
    fs.unlinkSync(cookiesPath);
    res.json(successMessage("Cookies deleted successfully"));
  } else {
    throw new NotFoundError("Cookies file", "cookies.txt");
  }
};
