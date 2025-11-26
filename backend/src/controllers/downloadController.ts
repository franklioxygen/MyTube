import { Request, Response } from "express";
import downloadManager from "../services/downloadManager";
import * as storageService from "../services/storageService";

// Cancel a download
export const cancelDownload = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    downloadManager.cancelDownload(id);
    res.status(200).json({ success: true, message: "Download cancelled" });
  } catch (error: any) {
    console.error("Error cancelling download:", error);
    res.status(500).json({ error: "Failed to cancel download", details: error.message });
  }
};

// Remove from queue
export const removeFromQueue = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    downloadManager.removeFromQueue(id);
    res.status(200).json({ success: true, message: "Removed from queue" });
  } catch (error: any) {
    console.error("Error removing from queue:", error);
    res.status(500).json({ error: "Failed to remove from queue", details: error.message });
  }
};

// Clear queue
export const clearQueue = (_req: Request, res: Response): any => {
  try {
    downloadManager.clearQueue();
    res.status(200).json({ success: true, message: "Queue cleared" });
  } catch (error: any) {
    console.error("Error clearing queue:", error);
    res.status(500).json({ error: "Failed to clear queue", details: error.message });
  }
};

// Get download history
export const getDownloadHistory = (_req: Request, res: Response): any => {
  try {
    const history = storageService.getDownloadHistory();
    res.status(200).json(history);
  } catch (error: any) {
    console.error("Error getting download history:", error);
    res.status(500).json({ error: "Failed to get download history", details: error.message });
  }
};

// Remove from history
export const removeDownloadHistory = (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    storageService.removeDownloadHistoryItem(id);
    res.status(200).json({ success: true, message: "Removed from history" });
  } catch (error: any) {
    console.error("Error removing from history:", error);
    res.status(500).json({ error: "Failed to remove from history", details: error.message });
  }
};

// Clear history
export const clearDownloadHistory = (_req: Request, res: Response): any => {
  try {
    storageService.clearDownloadHistory();
    res.status(200).json({ success: true, message: "History cleared" });
  } catch (error: any) {
    console.error("Error clearing history:", error);
    res.status(500).json({ error: "Failed to clear history", details: error.message });
  }
};
