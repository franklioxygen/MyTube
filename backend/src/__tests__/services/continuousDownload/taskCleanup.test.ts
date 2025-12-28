import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCleanup } from '../../../services/continuousDownload/taskCleanup';
import { ContinuousDownloadTask } from '../../../services/continuousDownload/types';
import { VideoUrlFetcher } from '../../../services/continuousDownload/videoUrlFetcher';
import * as storageService from '../../../services/storageService';
import { logger } from '../../../utils/logger';

// Mock dependencies
vi.mock('../../../services/continuousDownload/videoUrlFetcher');
vi.mock('../../../services/storageService');
vi.mock('../../../services/downloadService', () => ({
    getVideoInfo: vi.fn(),
}));
vi.mock('../../../utils/downloadUtils', () => ({
    cleanupVideoArtifacts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../utils/helpers', () => ({
    formatVideoFilename: vi.fn().mockReturnValue('formatted-name'),
}));
vi.mock('../../../config/paths', () => ({
    VIDEOS_DIR: '/tmp/videos',
    DATA_DIR: '/tmp/data'
}));
vi.mock('../../../utils/logger', () => ({
    logger: {
        info: vi.fn((msg) => console.log('[INFO]', msg)),
        error: vi.fn((msg, err) => console.error('[ERROR]', msg, err)),
        debug: vi.fn(),
    }
}));
vi.mock('path', () => {
    const mocks = {
        basename: vi.fn((name) => name.split('.')[0]),
        extname: vi.fn(() => '.mp4'),
        join: vi.fn((...args) => args.join('/')),
        resolve: vi.fn((...args) => args.join('/')),
    };
    return {
        default: mocks,
        ...mocks
    };
});
// Also mock fs-extra to prevent ensureDirSync failure
vi.mock('fs-extra', () => ({
    default: {
        ensureDirSync: vi.fn(),
        existsSync: vi.fn(),
    }
}));

import { getVideoInfo } from '../../../services/downloadService';
import { cleanupVideoArtifacts } from '../../../utils/downloadUtils';

describe('TaskCleanup', () => {
  let taskCleanup: TaskCleanup;
  let mockVideoUrlFetcher: any;
  
  const mockTask: ContinuousDownloadTask = {
    id: 'task-1',
    author: 'Author',
    authorUrl: 'url',
    platform: 'YouTube',
    status: 'active',
    createdAt: 0,
    currentVideoIndex: 1, // Must be > 0 to run cleanup
    totalVideos: 10,
    downloadedCount: 0,
    skippedCount: 0,
    failedCount: 0
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockVideoUrlFetcher = {
        getAllVideoUrls: vi.fn(),
    };
    taskCleanup = new TaskCleanup(mockVideoUrlFetcher as unknown as VideoUrlFetcher);

    // Default mocks
    (getVideoInfo as any).mockResolvedValue({ title: 'Video Title', author: 'Author' });
    (storageService.getDownloadStatus as any).mockReturnValue({ activeDownloads: [] });
  });

  describe('cleanupCurrentVideoTempFiles', () => {
    it('should do nothing if index is 0', async () => {
      await taskCleanup.cleanupCurrentVideoTempFiles({ ...mockTask, currentVideoIndex: 0 });
      expect(mockVideoUrlFetcher.getAllVideoUrls).not.toHaveBeenCalled();
    });

    it('should cleanup temp files for current video url', async () => {
      const urls = ['url0', 'url1'];
      mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(urls);
      
      await taskCleanup.cleanupCurrentVideoTempFiles(mockTask); // index 1 -> url1

      expect(mockVideoUrlFetcher.getAllVideoUrls).toHaveBeenCalled();
      expect(getVideoInfo).toHaveBeenCalledWith('url1');
      expect(cleanupVideoArtifacts).toHaveBeenCalledWith('formatted-name', '/tmp/videos');
    });

    it('should cancel active download if matches current video', async () => {
        const urls = ['url0', 'url1'];
        mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(urls);
        
        const activeDownload = { id: 'dl-1', sourceUrl: 'url1', filename: 'file.mp4' };
        (storageService.getDownloadStatus as any).mockReturnValue({ activeDownloads: [activeDownload] });
        
        await taskCleanup.cleanupCurrentVideoTempFiles(mockTask);

        expect(storageService.removeActiveDownload).toHaveBeenCalledWith('dl-1');
        // Check if cleanup was called for the active download file
        expect(cleanupVideoArtifacts).toHaveBeenCalledWith('file', '/tmp/videos');
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
       mockVideoUrlFetcher.getAllVideoUrls.mockRejectedValue(new Error('Fetch failed'));
       
       await expect(taskCleanup.cleanupCurrentVideoTempFiles(mockTask)).resolves.not.toThrow();
    });
  });
});
