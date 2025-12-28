import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import * as cookieService from "../services/cookieService";
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

  cookieService.uploadCookies(req.file.path);
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

