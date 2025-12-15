import { Request, Response } from "express";
import downloadManager from "../services/downloadManager";
import * as storageService from "../services/storageService";
import { successMessage, successResponse } from "../utils/response";

/**
 * Cancel a download
 * Errors are automatically handled by asyncHandler middleware
 */
export const cancelDownload = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  downloadManager.cancelDownload(id);
  res.status(200).json(successMessage("Download cancelled"));
};

/**
 * Remove from queue
 * Errors are automatically handled by asyncHandler middleware
 */
export const removeFromQueue = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  downloadManager.removeFromQueue(id);
  res.status(200).json(successMessage("Removed from queue"));
};

/**
 * Clear queue
 * Errors are automatically handled by asyncHandler middleware
 */
export const clearQueue = async (
  _req: Request,
  res: Response
): Promise<void> => {
  downloadManager.clearQueue();
  res.status(200).json(successMessage("Queue cleared"));
};

/**
 * Get download history
 * Errors are automatically handled by asyncHandler middleware
 */
export const getDownloadHistory = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const history = storageService.getDownloadHistory();
  res.status(200).json(successResponse(history));
};

/**
 * Remove from history
 * Errors are automatically handled by asyncHandler middleware
 */
export const removeDownloadHistory = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  storageService.removeDownloadHistoryItem(id);
  res.status(200).json(successMessage("Removed from history"));
};

/**
 * Clear history
 * Errors are automatically handled by asyncHandler middleware
 */
export const clearDownloadHistory = async (
  _req: Request,
  res: Response
): Promise<void> => {
  storageService.clearDownloadHistory();
  res.status(200).json(successMessage("History cleared"));
};
