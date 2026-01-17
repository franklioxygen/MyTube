import { Request, Response } from "express";
import path from "path";
import { ValidationError } from "../errors/DownloadErrors";
import * as cookieService from "../services/cookieService";
import { resolveSafePath } from "../utils/security";
import { DATA_DIR } from "../config/paths";
import { successMessage } from "../utils/response";

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

  // Validate file path to prevent path traversal
  // Multer uploads to a temp directory, but we should still validate
  let safeFilePath: string;
  try {
    safeFilePath = path.resolve(req.file.path);
    if (!safeFilePath || !safeFilePath.includes(path.sep)) {
      throw new ValidationError("Invalid file path", "file");
    }
  } catch (error) {
    throw new ValidationError("Invalid file path", "file");
  }

  cookieService.uploadCookies(safeFilePath);
  res.json(successMessage("Cookies uploaded successfully"));
};

/**
 * Check if cookies file exists
 * Errors are automatically handled by asyncHandler middleware
 */
export const checkCookies = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const result = cookieService.checkCookies();
  // Return format expected by frontend: { exists: boolean }
  res.json(result);
};

/**
 * Delete cookies file
 * Errors are automatically handled by asyncHandler middleware
 */
export const deleteCookies = async (
  _req: Request,
  res: Response
): Promise<void> => {
  cookieService.deleteCookies();
  res.json(successMessage("Cookies deleted successfully"));
};

