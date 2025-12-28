import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskProcessor } from '../../../services/continuousDownload/taskProcessor';
import { TaskRepository } from '../../../services/continuousDownload/taskRepository';
import { ContinuousDownloadTask } from '../../../services/continuousDownload/types';
import { VideoUrlFetcher } from '../../../services/continuousDownload/videoUrlFetcher';
import * as downloadService from '../../../services/downloadService';
import * as storageService from '../../../services/storageService';

// Mock dependencies
vi.mock('../../../services/continuousDownload/taskRepository');
vi.mock('../../../services/continuousDownload/videoUrlFetcher');
vi.mock('../../../services/downloadService');
vi.mock('../../../services/storageService');
vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('TaskProcessor', () => {
  let taskProcessor: TaskProcessor;
  let mockTaskRepository: any;
  let mockVideoUrlFetcher: any;

  const mockTask: ContinuousDownloadTask = {
    id: 'task-1',
    author: 'Test Author',
    authorUrl: 'https://youtube.com/channel/test',
    platform: 'YouTube',
    status: 'active',
    createdAt: Date.now(),
    currentVideoIndex: 0,
    totalVideos: 0,
    downloadedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockTaskRepository = {
      getTaskById: vi.fn().mockResolvedValue(mockTask),
      updateTotalVideos: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
      completeTask: vi.fn().mockResolvedValue(undefined),
    };

    mockVideoUrlFetcher = {
      getAllVideoUrls: vi.fn().mockResolvedValue([]),
      getVideoUrlsIncremental: vi.fn().mockResolvedValue([]),
      getVideoCount: vi.fn().mockResolvedValue(0),
    };

    taskProcessor = new TaskProcessor(
      mockTaskRepository as unknown as TaskRepository,
      mockVideoUrlFetcher as unknown as VideoUrlFetcher
    );
  });

  it('should initialize total videos and process all urls for non-incremental task', async () => {
    const videoUrls = ['http://vid1', 'http://vid2'];
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({ 
        videoData: { id: 'v1', title: 'Video 1', videoPath: '/tmp/1', thumbnailPath: '/tmp/t1' } 
    });
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);

    await taskProcessor.processTask({ ...mockTask });

    expect(mockVideoUrlFetcher.getAllVideoUrls).toHaveBeenCalledWith(mockTask.authorUrl, mockTask.platform);
    expect(mockTaskRepository.updateTotalVideos).toHaveBeenCalledWith(mockTask.id, 2);
    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledTimes(2);
    expect(mockTaskRepository.completeTask).toHaveBeenCalledWith(mockTask.id);
  });

  it('should skip videos that already exist', async () => {
    const videoUrls = ['http://vid1'];
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
    (storageService.getVideoBySourceUrl as any).mockReturnValue({ id: 'existing-id' });

    await taskProcessor.processTask({ ...mockTask });

    expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
    expect(mockTaskRepository.updateProgress).toHaveBeenCalledWith(mockTask.id, expect.objectContaining({
        skippedCount: 1,
        currentVideoIndex: 1
    }));
  });

  it('should handle download errors gracefully', async () => {
    const videoUrls = ['http://vid1'];
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockRejectedValue(new Error('Download failed'));

    await taskProcessor.processTask({ ...mockTask });

    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalled();
    expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        error: 'Download failed'
    }));
    expect(mockTaskRepository.updateProgress).toHaveBeenCalledWith(mockTask.id, expect.objectContaining({
        failedCount: 1,
        currentVideoIndex: 1
    }));
  });

  it('should stop processing if task is cancelled', async () => {
     // Return cancelled logic:
     // If we return 'cancelled' immediately, the loop breaks at check #1.
     // Then validation check at the end should also see 'cancelled' and not complete.
     
     // Override the default mock implementation to always return cancelled for this test
     mockTaskRepository.getTaskById.mockResolvedValue({ ...mockTask, status: 'cancelled' });

     const videoUrls = ['http://vid1', 'http://vid2'];
     mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);

     await taskProcessor.processTask({ ...mockTask });

     expect(mockTaskRepository.completeTask).not.toHaveBeenCalled();
  });

  it('should use incremental fetching for YouTube playlists', async () => {
    vi.useFakeTimers();
    
    const playlistTask = { ...mockTask, authorUrl: 'https://youtube.com/playlist?list=PL123', platform: 'YouTube' };
    mockVideoUrlFetcher.getVideoCount.mockResolvedValue(55); // > 50 batch size
    mockVideoUrlFetcher.getVideoUrlsIncremental
        .mockResolvedValue(Array(50).fill('http://vid'));

    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({});

    // Warning: processTask creates a promise that waits 1000ms. 
    // We can't await processTask directly because it will hang waiting for timers if we strictly use fake timers without advancing them?
    // Actually, if we use fake timers, the promise `setTimeout` will effectively pause until we advance.
    // But we are `await`ing processTask. We need to advance timers "while" awaiting?
    // This is tricky with `await`.
    // Easier approach: Mock the delay mechanism or `global.setTimeout`?
    // Or simpler: Mock `TaskProcessor` private method? No.
    
    // Alternative: Just run the promise and advance timers in a loop?
    const promise = taskProcessor.processTask(playlistTask);
    
    // We need to advance time 55 times * 1000ms.
    await vi.runAllTimersAsync(); 
    
    await promise;

    expect(mockVideoUrlFetcher.getVideoCount).toHaveBeenCalled();
    expect(mockVideoUrlFetcher.getVideoUrlsIncremental).toHaveBeenCalledTimes(6); // Called for each batch of 10 processing loop
    
    vi.useRealTimers();
  });
});
