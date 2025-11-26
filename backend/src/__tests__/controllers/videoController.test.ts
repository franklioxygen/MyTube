import { Request, Response } from 'express';
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    deleteVideo,
    downloadVideo,
    getVideoById,
    getVideos,
    rateVideo,
    searchVideos,
    updateVideoDetails,
} from '../../controllers/videoController';
import downloadManager from '../../services/downloadManager';
import * as downloadService from '../../services/downloadService';
import * as storageService from '../../services/storageService';

vi.mock('../../services/downloadService');
vi.mock('../../services/storageService');
vi.mock('../../services/downloadManager');
vi.mock('fs-extra');
vi.mock('child_process');
vi.mock('multer', () => {
  const multer = vi.fn(() => ({
    single: vi.fn(),
    array: vi.fn(),
  }));
  (multer as any).diskStorage = vi.fn(() => ({}));
  return { default: multer };
});

describe('VideoController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {};
    res = {
      json,
      status,
    };
  });

  describe('searchVideos', () => {
    it('should return search results', async () => {
      req.query = { query: 'test' };
      const mockResults = [{ id: '1', title: 'Test' }];
      (downloadService.searchYouTube as any).mockResolvedValue(mockResults);

      await searchVideos(req as Request, res as Response);

      expect(downloadService.searchYouTube).toHaveBeenCalledWith('test');
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ results: mockResults });
    });

    it('should return 400 if query is missing', async () => {
      req.query = {};

      await searchVideos(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Search query is required' });
    });
  });

  describe('downloadVideo', () => {
    it('should queue download for valid URL', async () => {
      req.body = { youtubeUrl: 'https://youtube.com/watch?v=123' };
      (downloadManager.addDownload as any).mockResolvedValue('success');

      await downloadVideo(req as Request, res as Response);

      expect(downloadManager.addDownload).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Download queued' }));
    });

    it('should return 400 for invalid URL', async () => {
      req.body = { youtubeUrl: 'not-a-url' };

      await downloadVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Not a valid URL' }));
    });

    it('should return 400 if url is missing', async () => {
      req.body = {};
      await downloadVideo(req as Request, res as Response);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('should handle Bilibili collection download', async () => {
      req.body = { 
        youtubeUrl: 'https://www.bilibili.com/video/BV1xx',
        downloadCollection: true,
        collectionName: 'Col',
        collectionInfo: {}
      };
      (downloadService.downloadBilibiliCollection as any).mockResolvedValue({ success: true, collectionId: '1' });

      await downloadVideo(req as Request, res as Response);

      // The actual download task runs async, we just check it queued successfully  
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Download queued' }));
    });

    it('should handle Bilibili multi-part download', async () => {
      req.body = { 
        youtubeUrl: 'https://www.bilibili.com/video/BV1xx',
        downloadAllParts: true,
        collectionName: 'Col'
      };
      (downloadService.checkBilibiliVideoParts as any).mockResolvedValue({ success: true, videosNumber: 2, title: 'Title' });
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({ success: true, videoData: { id: 'v1' } });
      (downloadService.downloadRemainingBilibiliParts as any).mockImplementation(() => {});
      (storageService.saveCollection as any).mockImplementation(() => {});
      (storageService.atomicUpdateCollection as any).mockImplementation((_id: string, fn: Function) => fn({ videos: [] }));

      await downloadVideo(req as Request, res as Response);

      // The actual download task runs async, we just check it queued successfully
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Download queued' }));
    });

    it('should handle MissAV download', async () => {
      req.body = { youtubeUrl: 'https://missav.com/v1' };
      (downloadService.downloadMissAVVideo as any).mockResolvedValue({ id: 'v1' });

      await downloadVideo(req as Request, res as Response);

      // The actual download task runs async, we just check it queued successfully
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Download queued' }));
    });

    it('should handle Bilibili single part download when checkParts returns 1 video', async () => {
      req.body = { 
        youtubeUrl: 'https://www.bilibili.com/video/BV1xx',
        downloadAllParts: true,
      };
      (downloadService.checkBilibiliVideoParts as any).mockResolvedValue({ success: true, videosNumber: 1, title: 'Title' });
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({ success: true, videoData: { id: 'v1' } });

      await downloadVideo(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Download queued' }));
    });

    it('should handle Bilibili single part download failure', async () => {
      req.body = { youtubeUrl: 'https://www.bilibili.com/video/BV1xx' };
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({ success: false, error: 'Failed' });
      (downloadManager.addDownload as any).mockImplementation((fn: Function) => fn());

      await downloadVideo(req as Request, res as Response);

      // Should still queue successfully even if the task itself might fail
      expect(status).toHaveBeenCalledWith(200);
    });

    it('should handle download task errors', async () => {
      req.body = { youtubeUrl: 'https://youtube.com/watch?v=123' };
      (downloadManager.addDownload as any).mockImplementation(() => {
        throw new Error('Queue error');
      });

      await downloadVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Failed to queue download' }));
    });

    it('should handle YouTube download', async () => {
      req.body = { youtubeUrl: 'https://www.youtube.com/watch?v=abc123' };
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({ id: 'v1' });
      (downloadManager.addDownload as any).mockResolvedValue('success');

      await downloadVideo(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, message: 'Download queued' }));
    });
  });

  describe('getVideos', () => {
    it('should return all videos', () => {
      const mockVideos = [{ id: '1' }];
      (storageService.getVideos as any).mockReturnValue(mockVideos);

      getVideos(req as Request, res as Response);

      expect(storageService.getVideos).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(mockVideos);
    });
  });

  describe('getVideoById', () => {
    it('should return video if found', () => {
      req.params = { id: '1' };
      const mockVideo = { id: '1' };
      (storageService.getVideoById as any).mockReturnValue(mockVideo);

      getVideoById(req as Request, res as Response);

      expect(storageService.getVideoById).toHaveBeenCalledWith('1');
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(mockVideo);
    });

    it('should return 404 if not found', () => {
      req.params = { id: '1' };
      (storageService.getVideoById as any).mockReturnValue(undefined);

      getVideoById(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteVideo', () => {
    it('should delete video', () => {
      req.params = { id: '1' };
      (storageService.deleteVideo as any).mockReturnValue(true);

      deleteVideo(req as Request, res as Response);

      expect(storageService.deleteVideo).toHaveBeenCalledWith('1');
      expect(status).toHaveBeenCalledWith(200);
    });

    it('should return 404 if delete fails', () => {
      req.params = { id: '1' };
      (storageService.deleteVideo as any).mockReturnValue(false);

      deleteVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('rateVideo', () => {
    it('should rate video', () => {
      req.params = { id: '1' };
      req.body = { rating: 5 };
      const mockVideo = { id: '1', rating: 5 };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      rateVideo(req as Request, res as Response);

      expect(storageService.updateVideo).toHaveBeenCalledWith('1', { rating: 5 });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Video rated successfully', video: mockVideo });
    });

    it('should return 400 for invalid rating', () => {
      req.params = { id: '1' };
      req.body = { rating: 6 };

      rateVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
    });

    it('should return 404 if video not found', () => {
      req.params = { id: '1' };
      req.body = { rating: 5 };
      (storageService.updateVideo as any).mockReturnValue(null);

      rateVideo(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('updateVideoDetails', () => {
    it('should update video details', () => {
      req.params = { id: '1' };
      req.body = { title: 'New Title' };
      const mockVideo = { id: '1', title: 'New Title' };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      updateVideoDetails(req as Request, res as Response);

      expect(storageService.updateVideo).toHaveBeenCalledWith('1', { title: 'New Title' });
      expect(status).toHaveBeenCalledWith(200);
    });

    it('should update tags field', () => {
      req.params = { id: '1' };
      req.body = { tags: ['tag1', 'tag2'] };
      const mockVideo = { id: '1', tags: ['tag1', 'tag2'] };
      (storageService.updateVideo as any).mockReturnValue(mockVideo);

      updateVideoDetails(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(200);
    });

    it('should return 404 if video not found', () => {
      req.params = { id: '1' };
      req.body = { title: 'New Title' };
      (storageService.updateVideo as any).mockReturnValue(null);

      updateVideoDetails(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(404);
    });

    it('should return 400 if no valid updates', () => {
      req.params = { id: '1' };
      req.body = { invalid: 'field' };

      updateVideoDetails(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
    });
  });

  describe('checkBilibiliParts', () => {
    it('should check bilibili parts', async () => {
      req.query = { url: 'https://www.bilibili.com/video/BV1xx' };
      (downloadService.checkBilibiliVideoParts as any).mockResolvedValue({ success: true });

      await import('../../controllers/videoController').then(m => m.checkBilibiliParts(req as Request, res as Response));

      expect(downloadService.checkBilibiliVideoParts).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it('should return 400 if url is missing', async () => {
      req.query = {};
      await import('../../controllers/videoController').then(m => m.checkBilibiliParts(req as Request, res as Response));
      expect(status).toHaveBeenCalledWith(400);
    });

    it('should return 400 if url is invalid', async () => {
      req.query = { url: 'invalid' };
      await import('../../controllers/videoController').then(m => m.checkBilibiliParts(req as Request, res as Response));
      expect(status).toHaveBeenCalledWith(400);
    });
  });

  describe('checkBilibiliCollection', () => {
    it('should check bilibili collection', async () => {
      req.query = { url: 'https://www.bilibili.com/video/BV1xx' };
      (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({ success: true });

      await import('../../controllers/videoController').then(m => m.checkBilibiliCollection(req as Request, res as Response));

      expect(downloadService.checkBilibiliCollectionOrSeries).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it('should return 400 if url is missing', async () => {
      req.query = {};
      await import('../../controllers/videoController').then(m => m.checkBilibiliCollection(req as Request, res as Response));
      expect(status).toHaveBeenCalledWith(400);
    });
  });

  describe('getVideoComments', () => {
    it('should get video comments', async () => {
      req.params = { id: '1' };
      // Mock commentService dynamically since it's imported dynamically in controller
      vi.mock('../../services/commentService', () => ({
        getComments: vi.fn().mockResolvedValue([]),
      }));

      await import('../../controllers/videoController').then(m => m.getVideoComments(req as Request, res as Response));

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith([]);
    });
  });

  describe('uploadVideo', () => {
    it('should upload video', async () => {
      req.file = { filename: 'vid.mp4', originalname: 'vid.mp4' } as any;
      req.body = { title: 'Title' };
      (fs.existsSync as any).mockReturnValue(true);
      
      const { exec } = await import('child_process');
      (exec as any).mockImplementation((_cmd: any, cb: any) => cb(null));

      await import('../../controllers/videoController').then(m => m.uploadVideo(req as Request, res as Response));

      expect(storageService.saveVideo).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
    });
  });

  describe('getDownloadStatus', () => {
    it('should return download status', async () => {
      (storageService.getDownloadStatus as any).mockReturnValue({ activeDownloads: [], queuedDownloads: [] });

      await import('../../controllers/videoController').then(m => m.getDownloadStatus(req as Request, res as Response));

      expect(status).toHaveBeenCalledWith(200);
    });
  });
});
