import fs from 'fs-extra';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGES_DIR, VIDEOS_DIR } from '../../config/paths';
import * as storageService from '../../services/storageService';
import { moveAllThumbnails } from '../../services/thumbnailService';

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  sqlite: {
    prepare: vi.fn(),
  },
}));

vi.mock('fs-extra');
vi.mock('../../services/storageService');
vi.mock('../../config/paths', () => ({
  IMAGES_DIR: '/test/images',
  VIDEOS_DIR: '/test/videos',
  DATA_DIR: '/test/data',
}));

describe('ThumbnailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('moveAllThumbnails', () => {
    it('should move thumbnails to video folders', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/images/thumb1.jpg',
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(true);
      (fs.moveSync as any).mockReturnValue(undefined);
      (storageService.updateVideo as any).mockReturnValue(undefined);

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).toHaveBeenCalledWith(
        path.join(IMAGES_DIR, 'thumb1.jpg'),
        path.join(VIDEOS_DIR, 'thumb1.jpg'),
        { overwrite: true }
      );
      expect(storageService.updateVideo).toHaveBeenCalledWith('video-1', {
        thumbnailPath: '/videos/thumb1.jpg',
      });
      expect(result.movedCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    it('should move thumbnails to central images folder', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/videos/thumb1.jpg',
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(true);
      (fs.ensureDirSync as any).mockReturnValue(undefined);
      (fs.moveSync as any).mockReturnValue(undefined);
      (storageService.updateVideo as any).mockReturnValue(undefined);

      const result = await moveAllThumbnails(false);

      expect(fs.moveSync).toHaveBeenCalledWith(
        path.join(VIDEOS_DIR, 'thumb1.jpg'),
        path.join(IMAGES_DIR, 'thumb1.jpg'),
        { overwrite: true }
      );
      expect(storageService.updateVideo).toHaveBeenCalledWith('video-1', {
        thumbnailPath: '/images/thumb1.jpg',
      });
      expect(result.movedCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    it('should handle videos in collection folders', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/MyCollection/video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/images/thumb1.jpg',
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(true);
      (fs.moveSync as any).mockReturnValue(undefined);
      (storageService.updateVideo as any).mockReturnValue(undefined);

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).toHaveBeenCalledWith(
        path.join(IMAGES_DIR, 'thumb1.jpg'),
        path.join(VIDEOS_DIR, 'MyCollection', 'thumb1.jpg'),
        { overwrite: true }
      );
      expect(storageService.updateVideo).toHaveBeenCalledWith('video-1', {
        thumbnailPath: '/videos/MyCollection/thumb1.jpg',
      });
    });

    it('should skip videos without thumbnails', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
        },
        {
          id: 'video-2',
          videoFilename: 'video2.mp4',
          thumbnailFilename: null,
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).not.toHaveBeenCalled();
      expect(storageService.updateVideo).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('should handle missing thumbnail files gracefully', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/video1.mp4',
          thumbnailFilename: 'missing.jpg',
          thumbnailPath: '/images/missing.jpg',
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(false);

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).not.toHaveBeenCalled();
      expect(storageService.updateVideo).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('should handle errors during move', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/images/thumb1.jpg',
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(true);
      (fs.moveSync as any).mockImplementation(() => {
        throw new Error('Move failed');
      });

      const result = await moveAllThumbnails(true);

      expect(result.movedCount).toBe(0);
      expect(result.errorCount).toBe(1);
    });

    it('should not move if already in correct location', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/videos/thumb1.jpg',
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(true);

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).not.toHaveBeenCalled();
      expect(result.movedCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    it('should update path even if file already in correct location but path is wrong', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          videoPath: '/videos/video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/images/thumb1.jpg', // Wrong path
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (fs.existsSync as any).mockReturnValue(true);
      // File is actually at /videos/thumb1.jpg
      (fs.existsSync as any).mockImplementation((p: string) => {
        return p === path.join(VIDEOS_DIR, 'thumb1.jpg');
      });

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).not.toHaveBeenCalled();
      expect(storageService.updateVideo).toHaveBeenCalledWith('video-1', {
        thumbnailPath: '/videos/thumb1.jpg',
      });
    });

    it('should handle videos with collection fallback', async () => {
      const mockVideos = [
        {
          id: 'video-1',
          videoFilename: 'video1.mp4',
          thumbnailFilename: 'thumb1.jpg',
          thumbnailPath: '/images/thumb1.jpg',
        },
      ];
      const mockCollections = [
        {
          id: 'col-1',
          name: 'MyCollection',
          videos: ['video-1'],
        },
      ];

      (storageService.getVideos as any).mockReturnValue(mockVideos);
      (storageService.getCollections as any).mockReturnValue(mockCollections);
      (fs.existsSync as any).mockReturnValue(true);
      (fs.moveSync as any).mockReturnValue(undefined);
      (storageService.updateVideo as any).mockReturnValue(undefined);

      const result = await moveAllThumbnails(true);

      expect(fs.moveSync).toHaveBeenCalledWith(
        path.join(IMAGES_DIR, 'thumb1.jpg'),
        path.join(VIDEOS_DIR, 'MyCollection', 'thumb1.jpg'),
        { overwrite: true }
      );
      expect(result.movedCount).toBe(1);
    });
  });
});

