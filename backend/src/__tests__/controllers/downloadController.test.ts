import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelDownload,
  clearDownloadHistory,
  clearQueue,
  getDownloadHistory,
  removeDownloadHistory,
  removeFromQueue,
} from '../../controllers/downloadController';
import downloadManager from '../../services/downloadManager';
import * as storageService from '../../services/storageService';

vi.mock('../../services/downloadManager');
vi.mock('../../services/storageService');

describe('DownloadController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {
      params: {},
    };
    res = {
      json,
      status,
    };
  });

  describe('cancelDownload', () => {
    it('should cancel a download', async () => {
      req.params = { id: 'download-123' };
      (downloadManager.cancelDownload as any).mockReturnValue(undefined);

      await cancelDownload(req as Request, res as Response);

      expect(downloadManager.cancelDownload).toHaveBeenCalledWith('download-123');
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Download cancelled' });
    });
  });

  describe('removeFromQueue', () => {
    it('should remove download from queue', async () => {
      req.params = { id: 'download-123' };
      (downloadManager.removeFromQueue as any).mockReturnValue(undefined);

      await removeFromQueue(req as Request, res as Response);

      expect(downloadManager.removeFromQueue).toHaveBeenCalledWith('download-123');
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Removed from queue' });
    });
  });

  describe('clearQueue', () => {
    it('should clear the download queue', async () => {
      (downloadManager.clearQueue as any).mockReturnValue(undefined);

      await clearQueue(req as Request, res as Response);

      expect(downloadManager.clearQueue).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Queue cleared' });
    });
  });

  describe('getDownloadHistory', () => {
    it('should return download history', async () => {
      const mockHistory = [
        { id: '1', url: 'https://example.com', status: 'completed' },
        { id: '2', url: 'https://example2.com', status: 'failed' },
      ];
      (storageService.getDownloadHistory as any).mockReturnValue(mockHistory);

      await getDownloadHistory(req as Request, res as Response);

      expect(storageService.getDownloadHistory).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(mockHistory);
    });

    it('should return empty array when no history', async () => {
      (storageService.getDownloadHistory as any).mockReturnValue([]);

      await getDownloadHistory(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith([]);
    });
  });

  describe('removeDownloadHistory', () => {
    it('should remove item from download history', async () => {
      req.params = { id: 'history-123' };
      (storageService.removeDownloadHistoryItem as any).mockReturnValue(undefined);

      await removeDownloadHistory(req as Request, res as Response);

      expect(storageService.removeDownloadHistoryItem).toHaveBeenCalledWith('history-123');
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Removed from history' });
    });
  });

  describe('clearDownloadHistory', () => {
    it('should clear download history', async () => {
      (storageService.clearDownloadHistory as any).mockReturnValue(undefined);

      await clearDownloadHistory(req as Request, res as Response);

      expect(storageService.clearDownloadHistory).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, message: 'History cleared' });
    });
  });
});

