import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import {
    COLLECTIONS_DATA_PATH,
    STATUS_DATA_PATH,
    VIDEOS_DATA_PATH,
} from "../config/paths";
import downloadManager from "../services/downloadManager";
import * as storageService from "../services/storageService";

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

export const getSettings = async (_req: Request, res: Response) => {
  try {
    const settings = storageService.getSettings();

    // If empty (first run), save defaults
    if (Object.keys(settings).length === 0) {
      storageService.saveSettings(defaultSettings);
      return res.json(defaultSettings);
    }

    // Merge with defaults to ensure all fields exist
    const mergedSettings = { ...defaultSettings, ...settings };

    // Do not send the hashed password to the frontend
    const { password, ...safeSettings } = mergedSettings;
    res.json({ ...safeSettings, isPasswordSet: !!password });
  } catch (error) {
    console.error("Error reading settings:", error);
    res.status(500).json({ error: "Failed to read settings" });
  }
};

export const migrateData = async (_req: Request, res: Response) => {
  try {
    const { runMigration } = await import("../services/migrationService");
    const results = await runMigration();
    res.json({ success: true, results });
  } catch (error: any) {
    console.error("Error running migration:", error);
    res
      .status(500)
      .json({ error: "Failed to run migration", details: error.message });
  }
};

export const deleteLegacyData = async (_req: Request, res: Response) => {
  try {
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
          console.error(`Failed to delete ${file}:`, err);
          results.failed.push(path.basename(file));
        }
      }
    }

    res.json({ success: true, results });
  } catch (error: any) {
    console.error("Error deleting legacy data:", error);
    res
      .status(500)
      .json({ error: "Failed to delete legacy data", details: error.message });
  }
};

export const formatFilenames = async (_req: Request, res: Response) => {
  try {
    const results = storageService.formatLegacyFilenames();
    res.json({ success: true, results });
  } catch (error: any) {
    console.error("Error formatting filenames:", error);
    res
      .status(500)
      .json({ error: "Failed to format filenames", details: error.message });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
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
      console.log("Tags deleted:", deletedTags);
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
      console.log(`Removed deleted tags from ${videosUpdatedCount} videos`);
    }

    storageService.saveSettings(newSettings);

    // Apply settings immediately where possible
    downloadManager.setMaxConcurrentDownloads(
      newSettings.maxConcurrentDownloads
    );

    res.json({
      success: true,
      settings: { ...newSettings, password: undefined },
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
};

export const getPasswordEnabled = async (_req: Request, res: Response) => {
  try {
    const settings = storageService.getSettings();
    const mergedSettings = { ...defaultSettings, ...settings };

    // Return true only if login is enabled AND a password is set
    const isEnabled = mergedSettings.loginEnabled && !!mergedSettings.password;

    res.json({ enabled: isEnabled });
  } catch (error) {
    console.error("Error checking password status:", error);
    res.status(500).json({ error: "Failed to check password status" });
  }
};

export const verifyPassword = async (req: Request, res: Response) => {
  try {
    const { password } = req.body;

    const settings = storageService.getSettings();
    const mergedSettings = { ...defaultSettings, ...settings };

    if (!mergedSettings.loginEnabled) {
      return res.json({ success: true });
    }

    if (!mergedSettings.password) {
      // If no password set but login enabled, allow access
      return res.json({ success: true });
    }

    const isMatch = await bcrypt.compare(password, mergedSettings.password);

    if (isMatch) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: "Incorrect password" });
    }
  } catch (error) {
    console.error("Error verifying password:", error);
    res.status(500).json({ error: "Failed to verify password" });
  }
};

export const uploadCookies = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { DATA_DIR } = require("../config/paths");
    const targetPath = path.join(DATA_DIR, "cookies.txt");

    // Move the file to the target location
    fs.moveSync(req.file.path, targetPath, { overwrite: true });

    console.log(`Cookies uploaded and saved to ${targetPath}`);
    res.json({ success: true, message: "Cookies uploaded successfully" });
  } catch (error: any) {
    console.error("Error uploading cookies:", error);
    // Clean up temp file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res
      .status(500)
      .json({ error: "Failed to upload cookies", details: error.message });
  }
};

export const checkCookies = async (_req: Request, res: Response) => {
  try {
    const { DATA_DIR } = require("../config/paths");
    const cookiesPath = path.join(DATA_DIR, "cookies.txt");
    const exists = fs.existsSync(cookiesPath);
    res.json({ exists });
  } catch (error) {
    console.error("Error checking cookies:", error);
    res.status(500).json({ error: "Failed to check cookies" });
  }
};

export const deleteCookies = async (_req: Request, res: Response) => {
  try {
    const { DATA_DIR } = require("../config/paths");
    const cookiesPath = path.join(DATA_DIR, "cookies.txt");

    if (fs.existsSync(cookiesPath)) {
      fs.unlinkSync(cookiesPath);
      res.json({ success: true, message: "Cookies deleted successfully" });
    } else {
      res.status(404).json({ error: "Cookies file not found" });
    }
  } catch (error) {
    console.error("Error deleting cookies:", error);
    res.status(500).json({ error: "Failed to delete cookies" });
  }
};
