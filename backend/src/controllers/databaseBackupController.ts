import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import * as databaseBackupService from "../services/databaseBackupService";
import { generateTimestamp } from "../utils/helpers";
import { successMessage } from "../utils/response";

/**
 * Export database as backup file
 * Errors are automatically handled by asyncHandler middleware
 */
export const exportDatabase = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const dbPath = databaseBackupService.exportDatabase();

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

  // Validate file extension using original filename
  if (!req.file.originalname.endsWith(".db")) {
    throw new ValidationError("Only .db files are allowed", "file");
  }

  databaseBackupService.importDatabase(req.file.path);

  res.json(
    successMessage(
      "Database imported successfully. Existing data has been overwritten with the backup data."
    )
  );
};

/**
 * Clean up backup database files
 * Errors are automatically handled by asyncHandler middleware
 */
export const cleanupBackupDatabases = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const result = databaseBackupService.cleanupBackupDatabases();

  if (result.deleted === 0 && result.failed === 0) {
    res.json({
      success: true,
      message: "No backup database files found to clean up.",
      deleted: result.deleted,
      failed: result.failed,
    });
  } else {
    res.json({
      success: true,
      message: `Cleaned up ${result.deleted} backup database file(s).${
        result.failed > 0 ? ` ${result.failed} file(s) failed to delete.` : ""
      }`,
      deleted: result.deleted,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
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
  const result = databaseBackupService.getLastBackupInfo();

  res.json({
    success: true,
    ...result,
  });
};

/**
 * Restore database from last backup file
 * Errors are automatically handled by asyncHandler middleware
 */
export const restoreFromLastBackup = async (
  _req: Request,
  res: Response
): Promise<void> => {
  databaseBackupService.restoreFromLastBackup();

  res.json(successMessage("Database restored successfully from backup file."));
};
