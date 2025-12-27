import { Request, Response } from "express";
import downloadManager from "../services/downloadManager";
import * as storageService from "../services/storageService";
import { sendData, sendSuccessMessage } from "../utils/response";

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
  sendSuccessMessage(res, "Download cancelled");
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
  sendSuccessMessage(res, "Removed from queue");
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
  sendSuccessMessage(res, "Queue cleared");
};

/**
 * Get download history
 * Errors are automatically handled by asyncHandler middleware
 * Note: Returns array directly for backward compatibility with frontend
 */
export const getDownloadHistory = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const history = storageService.getDownloadHistory();
  // Return array directly for backward compatibility (frontend expects response.data to be DownloadHistoryItem[])
  sendData(res, history);
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
  sendSuccessMessage(res, "Removed from history");
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
  sendSuccessMessage(res, "History cleared");
};
