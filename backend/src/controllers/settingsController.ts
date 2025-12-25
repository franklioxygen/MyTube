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
import { cloudflaredService } from "../services/cloudflaredService";
import downloadManager from "../services/downloadManager";
import * as loginAttemptService from "../services/loginAttemptService";
import * as storageService from "../services/storageService";
import { generateTimestamp } from "../utils/helpers";
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
  openListPublicUrl?: string;
  cloudDrivePath?: string;
  cloudDriveScanPaths?: string;
  homeSidebarOpen?: boolean;
  subtitlesEnabled?: boolean;
  websiteName?: string;
  itemsPerPage?: number;
  ytDlpConfig?: string;
  showYoutubeSearch?: boolean;
  proxyOnlyYoutube?: boolean;
  moveSubtitlesToVideoFolder?: boolean;
  moveThumbnailsToVideoFolder?: boolean;
  visitorMode?: boolean;
  infiniteScroll?: boolean;
  videoColumns?: number;
  cloudflaredTunnelEnabled?: boolean;
  cloudflaredToken?: string;
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
  openListPublicUrl: "",
  cloudDrivePath: "",
  cloudDriveScanPaths: "",
  homeSidebarOpen: true,
  subtitlesEnabled: true,
  websiteName: "MyTube",
  itemsPerPage: 12,
  showYoutubeSearch: true,
  visitorMode: false,
  infiniteScroll: false,
  videoColumns: 4,
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
  const existingSettings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...existingSettings };

  // Check if visitor mode is enabled
  // If visitor mode is enabled, only allow disabling it (setting visitorMode to false)
  if (mergedSettings.visitorMode === true) {
    // If visitorMode is being explicitly set to false, allow the update
    if (newSettings.visitorMode === false) {
      // Allow disabling visitor mode - merge with existing settings
      const updatedSettings = { ...mergedSettings, ...newSettings };
      storageService.saveSettings(updatedSettings);
      res.json({
        success: true,
        settings: { ...updatedSettings, password: undefined },
      });
      return;
    }
    // If visitorMode is explicitly set to true (already enabled), allow but ignore other changes
    if (newSettings.visitorMode === true) {
      // Allow enabling visitor mode (though it's already enabled)
      // But block all other changes - only update visitorMode
      const allowedSettings: Settings = {
        ...mergedSettings,
        visitorMode: true,
      };
      storageService.saveSettings(allowedSettings);
      res.json({
        success: true,
        settings: { ...allowedSettings, password: undefined },
      });
      return;
    }
    // If visitor mode is enabled and trying to change other settings (without explicitly disabling visitor mode), block it
    res.status(403).json({
      success: false,
      error: "Visitor mode is enabled. Only disabling visitor mode is allowed.",
    });
    return;
  }

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
    newSettings.password = existingSettings.password;
  }

  // Preserve existing tags if tags are not explicitly provided or are empty when tags existed
  const oldTags: string[] = existingSettings.tags || [];

  // If tags is undefined, preserve existing tags
  // If tags is an empty array but there were existing tags, preserve them (likely frontend sent empty by mistake)
  // Only update tags if they are explicitly provided and non-empty, or if explicitly clearing (empty array when no existing tags)
  if (newSettings.tags === undefined) {
    // Preserve existing tags by not including tags in the save
    delete newSettings.tags;
  } else if (
    Array.isArray(newSettings.tags) &&
    newSettings.tags.length === 0 &&
    oldTags.length > 0
  ) {
    // Empty array sent but existing tags exist - likely a bug where frontend sent empty array
    // Preserve existing tags to prevent accidental deletion
    logger.warn(
      "Received empty tags array but existing tags exist. Preserving existing tags to prevent data loss."
    );
    delete newSettings.tags;
  } else {
    // Tags are explicitly provided (non-empty or intentionally clearing), process deletions
    const newTagsList: string[] = Array.isArray(newSettings.tags)
      ? newSettings.tags
      : [];
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

  // Handle Cloudflare Tunnel settings changes
  if (
    newSettings.cloudflaredTunnelEnabled !==
      existingSettings.cloudflaredTunnelEnabled ||
    newSettings.cloudflaredToken !== existingSettings.cloudflaredToken
  ) {
    // If we are enabling it (or it was enabled and config changed)
    if (newSettings.cloudflaredTunnelEnabled) {
      // Determine port
      const port = process.env.PORT ? parseInt(process.env.PORT) : 5551;
      
      const shouldRestart = existingSettings.cloudflaredTunnelEnabled;

      if (shouldRestart) {
         // If it was already enabled, we need to restart to apply changes (Token -> No Token, or vice versa)
         if (newSettings.cloudflaredToken) {
            cloudflaredService.restart(newSettings.cloudflaredToken);
         } else {
            cloudflaredService.restart(undefined, port);
         }
      } else {
         // It was disabled, now enabling -> just start
         if (newSettings.cloudflaredToken) {
            cloudflaredService.start(newSettings.cloudflaredToken);
         } else {
            cloudflaredService.start(undefined, port);
         }
      }
    } else {
      // If disabled, stop
      cloudflaredService.stop();
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

  // Check for remaining wait time
  const remainingWaitTime = loginAttemptService.canAttemptLogin();

  // Return format expected by frontend: { enabled: boolean, waitTime?: number }
  res.json({
    enabled: isEnabled,
    waitTime: remainingWaitTime > 0 ? remainingWaitTime : undefined,
  });
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

  // Check removed: We want to verify password if one exists, regardless of loginEnabled
  // This allows visitor mode toggle protection even if login protection is off
  /*
  if (!mergedSettings.loginEnabled) {
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
    return;
  }
  */

  if (!mergedSettings.password) {
    // If no password set but login enabled, allow access
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
    return;
  }

  // Check if user can attempt login (wait time check)
  const remainingWaitTime = loginAttemptService.canAttemptLogin();
  if (remainingWaitTime > 0) {
    // User must wait before trying again
    res.status(429).json({
      success: false,
      waitTime: remainingWaitTime,
      message: "Too many failed attempts. Please wait before trying again.",
    });
    return;
  }

  const isMatch = await bcrypt.compare(password, mergedSettings.password);

  if (isMatch) {
    // Reset failed attempts on successful login
    loginAttemptService.resetFailedAttempts();
    // Return format expected by frontend: { success: boolean }
    res.json({ success: true });
  } else {
    // Record failed attempt and get wait time
    const waitTime = loginAttemptService.recordFailedAttempt();
    const failedAttempts = loginAttemptService.getFailedAttempts();

    // Return wait time information
    res.status(401).json({
      success: false,
      waitTime,
      failedAttempts,
      message: "Incorrect password",
    });
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

/**
 * Reset password to a random 8-character string
 * Errors are automatically handled by asyncHandler middleware
 */
export const resetPassword = async (
  _req: Request,
  res: Response
): Promise<void> => {
  // Generate random 8-character password
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let newPassword = "";
  for (let i = 0; i < 8; i++) {
    newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Hash the new password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  // Update settings with new password
  const settings = storageService.getSettings();
  const mergedSettings = { ...defaultSettings, ...settings };
  mergedSettings.password = hashedPassword;
  mergedSettings.loginEnabled = true; // Ensure login is enabled

  storageService.saveSettings(mergedSettings);

  // Log the new password (as requested)
  logger.info(`Password has been reset. New password: ${newPassword}`);

  // Reset failed login attempts
  loginAttemptService.resetFailedAttempts();

  // Return success (but don't send password to frontend for security)
  res.json({
    success: true,
    message:
      "Password has been reset. Check backend logs for the new password.",
  });
};

/**
 * Export database as backup file
 * Errors are automatically handled by asyncHandler middleware
 */
export const exportDatabase = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { DATA_DIR } = require("../config/paths");
  const dbPath = path.join(DATA_DIR, "mytube.db");

  if (!fs.existsSync(dbPath)) {
    throw new NotFoundError("Database file", "mytube.db");
  }

  // Generate filename with date and time
  const filename = `mytube-backup-${generateTimestamp()}.db`;

  // Set headers for file download
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // Send the database file
  res.sendFile(dbPath);
};

/**
 * Import database from backup file
 * Errors are automatically handled by asyncHandler middleware
 */
export const importDatabase = async (
  req: Request,
  res: Response
): Promise<void> => {
  if (!req.file) {
    throw new ValidationError("No file uploaded", "file");
  }

  const Database = require("better-sqlite3");
  const { DATA_DIR } = require("../config/paths");
  const dbPath = path.join(DATA_DIR, "mytube.db");

  // Generate backup filename with date and time
  const backupFilename = `mytube-backup-${generateTimestamp()}.db.backup`;
  const backupPath = path.join(DATA_DIR, backupFilename);

  let sourceDb: any = null;

  try {
    // Validate file extension
    if (!req.file.originalname.endsWith(".db")) {
      throw new ValidationError("Only .db files are allowed", "file");
    }

    // Validate the uploaded file is a valid SQLite database
    sourceDb = new Database(req.file.path, { readonly: true });
    try {
      // Try to query the database to verify it's valid
      sourceDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
        .get();
    } catch (validationError) {
      sourceDb.close();
      throw new ValidationError(
        "Invalid database file. The file is not a valid SQLite database.",
        "file"
      );
    }
    sourceDb.close();
    sourceDb = null;

    // Create backup of current database before import
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
      logger.info(`Created backup of current database at ${backupPath}`);
    }

    // Close the current database connection before replacing the file
    const { sqlite } = require("../db");
    sqlite.close();
    logger.info("Closed current database connection for import");

    // Simply copy the uploaded file to replace the database
    // Since we've closed the connection and validated the file, this is safe
    fs.copyFileSync(req.file.path, dbPath);
    logger.info(
      `Database file replaced successfully from ${req.file.originalname}`
    );

    // Reinitialize the database connection with the new file
    const { reinitializeDatabase } = require("../db");
    reinitializeDatabase();
    logger.info("Database connection reinitialized after import");

    // Clean up uploaded temp file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json(
      successMessage(
        "Database imported successfully. Existing data has been overwritten with the backup data."
      )
    );
  } catch (error: any) {
    // Close connection if still open
    if (sourceDb) {
      try {
        sourceDb.close();
      } catch (e) {
        logger.error("Error closing source database:", e);
      }
    }

    // Clean up uploaded temp file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        logger.error("Error cleaning up temp file:", e);
      }
    }

    // Restore backup if import failed
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, dbPath);
        logger.info("Restored database from backup after failed import");
      } catch (restoreError) {
        logger.error("Failed to restore database from backup:", restoreError);
      }
    }

    // Log the actual error for debugging
    logger.error(
      "Database import failed:",
      error instanceof Error ? error : new Error(String(error))
    );

    throw error;
  }
};

/**
 * Clean up backup database files
 * Errors are automatically handled by asyncHandler middleware
 */
export const cleanupBackupDatabases = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { DATA_DIR } = require("../config/paths");
  const backupPattern = /^mytube-backup-.*\.db\.backup$/;

  let deletedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  try {
    const files = fs.readdirSync(DATA_DIR);

    for (const file of files) {
      if (backupPattern.test(file)) {
        const filePath = path.join(DATA_DIR, file);
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
          logger.info(`Deleted backup database file: ${file}`);
        } catch (error: any) {
          failedCount++;
          const errorMsg = `Failed to delete ${file}: ${error.message}`;
          errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }
    }

    if (deletedCount === 0 && failedCount === 0) {
      res.json({
        success: true,
        message: "No backup database files found to clean up.",
        deleted: deletedCount,
        failed: failedCount,
      });
    } else {
      res.json({
        success: true,
        message: `Cleaned up ${deletedCount} backup database file(s).${
          failedCount > 0 ? ` ${failedCount} file(s) failed to delete.` : ""
        }`,
        deleted: deletedCount,
        failed: failedCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    }
  } catch (error: any) {
    logger.error("Error cleaning up backup databases:", error);
    throw error;
  }
};

/**
 * Get last backup database file info
 * Errors are automatically handled by asyncHandler middleware
 */
export const getLastBackupInfo = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const { DATA_DIR } = require("../config/paths");
  const backupPattern = /^mytube-backup-(.+)\.db\.backup$/;

  try {
    const files = fs.readdirSync(DATA_DIR);
    const backupFiles: Array<{
      filename: string;
      timestamp: string;
      mtime: number;
    }> = [];

    for (const file of files) {
      const match = file.match(backupPattern);
      if (match) {
        const timestamp = match[1];
        const filePath = path.join(DATA_DIR, file);
        const stats = fs.statSync(filePath);
        backupFiles.push({
          filename: file,
          timestamp,
          mtime: stats.mtimeMs,
        });
      }
    }

    if (backupFiles.length === 0) {
      res.json({
        success: true,
        exists: false,
      });
      return;
    }

    // Sort by modification time (most recent first)
    backupFiles.sort((a, b) => b.mtime - a.mtime);
    const lastBackup = backupFiles[0];

    res.json({
      success: true,
      exists: true,
      filename: lastBackup.filename,
      timestamp: lastBackup.timestamp,
    });
  } catch (error: any) {
    logger.error("Error getting last backup info:", error);
    throw error;
  }
};

/**
 * Restore database from last backup file
 * Errors are automatically handled by asyncHandler middleware
 */
export const restoreFromLastBackup = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const Database = require("better-sqlite3");
  const { DATA_DIR } = require("../config/paths");
  const dbPath = path.join(DATA_DIR, "mytube.db");
  const backupPattern = /^mytube-backup-(.+)\.db\.backup$/;

  try {
    const files = fs.readdirSync(DATA_DIR);
    const backupFiles: Array<{
      filename: string;
      timestamp: string;
      mtime: number;
    }> = [];

    for (const file of files) {
      const match = file.match(backupPattern);
      if (match) {
        const timestamp = match[1];
        const filePath = path.join(DATA_DIR, file);
        const stats = fs.statSync(filePath);
        backupFiles.push({
          filename: file,
          timestamp,
          mtime: stats.mtimeMs,
        });
      }
    }

    if (backupFiles.length === 0) {
      throw new NotFoundError(
        "Backup database file",
        "mytube-backup-*.db.backup"
      );
    }

    // Sort by modification time (most recent first)
    backupFiles.sort((a, b) => b.mtime - a.mtime);
    const lastBackup = backupFiles[0];
    const backupPath = path.join(DATA_DIR, lastBackup.filename);

    // Validate the backup file is a valid SQLite database
    let sourceDb: any = null;
    try {
      sourceDb = new Database(backupPath, { readonly: true });
      // Try to query the database to verify it's valid
      sourceDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
        .get();
      sourceDb.close();
      sourceDb = null;
    } catch (validationError) {
      if (sourceDb) {
        sourceDb.close();
      }
      throw new ValidationError(
        "Invalid backup database file. The file is not a valid SQLite database.",
        "backup"
      );
    }

    // Create backup of current database before restore
    const currentBackupFilename = `mytube-backup-${generateTimestamp()}.db.backup`;
    const currentBackupPath = path.join(DATA_DIR, currentBackupFilename);
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, currentBackupPath);
      logger.info(`Created backup of current database at ${currentBackupPath}`);
    }

    // Close the current database connection before replacing the file
    const { sqlite } = require("../db");
    sqlite.close();
    logger.info("Closed current database connection for restore");

    // Copy the backup file to replace the database
    fs.copyFileSync(backupPath, dbPath);
    logger.info(
      `Database file restored successfully from ${lastBackup.filename}`
    );

    // Reinitialize the database connection with the restored file
    const { reinitializeDatabase } = require("../db");
    reinitializeDatabase();
    logger.info("Database connection reinitialized after restore");

    res.json(
      successMessage(
        `Database restored successfully from backup file: ${lastBackup.filename}`
      )
    );
  } catch (error: any) {
    logger.error("Error restoring from last backup:", error);
    throw error;
  }
};

/**
 * Get Cloudflare Tunnel status
 * Errors are automatically handled by asyncHandler middleware
 */
export const getCloudflaredStatus = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const status = cloudflaredService.getStatus();
  res.json(status);
};

