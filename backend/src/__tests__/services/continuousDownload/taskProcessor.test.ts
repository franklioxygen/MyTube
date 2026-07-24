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
    warn: vi.fn(),
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
      getTaskStatus: vi.fn().mockResolvedValue('active'),
      updateTotalVideos: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
      completeTask: vi.fn().mockResolvedValue(undefined),
      getSubscriptionForTask: vi.fn().mockResolvedValue(null),
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

    // Mock storageService methods needed for waitForDownloadSlot
    (storageService.getSettings as any).mockReturnValue({ maxConcurrentDownloads: 3 });
    (storageService.getDownloadStatus as any).mockReturnValue({ activeDownloads: [] });
  });

  it('should initialize total videos and process all urls for non-incremental task', async () => {
    const videoUrls = ['http://vid1', 'http://vid2'];
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({ 
        videoData: { id: 'v1', title: 'Video 1', videoPath: '/tmp/1', thumbnailPath: '/tmp/t1' } 
    });
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);

    await taskProcessor.processTask({ ...mockTask });

    expect(mockVideoUrlFetcher.getAllVideoUrls).toHaveBeenCalledWith(mockTask.authorUrl, mockTask.platform, null);
    expect(mockTaskRepository.updateTotalVideos).toHaveBeenCalledWith(mockTask.id, 2);
    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledTimes(2);
    expect(mockTaskRepository.getTaskStatus).toHaveBeenCalledTimes(1);
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

  it('passes clean playlist source options to playlist downloads', async () => {
    const playlistTask: ContinuousDownloadTask = {
      ...mockTask,
      collectionId: 'col-1',
      playlistName: 'Travel Playlist - Test Author',
    };
    const videoUrls = ['http://vid1'];
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
      videoData: {
        id: 'v1',
        title: 'Video 1',
        videoPath: '/videos/Test Author/Travel Playlist/Video 1.mp4',
        thumbnailPath: '/videos/Test Author/Travel Playlist/Video 1.jpg',
      },
    });

    await taskProcessor.processTask(playlistTask);

    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
      'http://vid1',
      expect.objectContaining({
        downloadId: expect.any(String),
        subscriptionYtdlpConfig: null,
        filenameTemplateSourceOptions: expect.objectContaining({
          sourceCustomName: 'Test Author',
          sourceCollectionName: 'Travel Playlist',
          sourceCollectionType: 'playlist',
          mediaPlaylistIndex: 1,
        }),
      })
    );
  });

  it('uses linked subscription source options for playlist task downloads', async () => {
    const playlistTask: ContinuousDownloadTask = {
      ...mockTask,
      collectionId: 'col-1',
      playlistName: 'Travel Playlist - Test Author',
    };
    mockTaskRepository.getSubscriptionForTask.mockResolvedValue({
      id: 'sub-1',
      author: 'Renamed Subscription Label',
      authorUrl: playlistTask.authorUrl,
      interval: 60,
      downloadCount: 0,
      createdAt: Date.now(),
      platform: 'YouTube',
      playlistId: 'PL123',
      playlistTitle: 'Travel Playlist',
      channelName: 'Test Author',
      subscriptionType: 'playlist',
      collectionId: 'col-1',
    });
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(['http://vid1']);
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
      videoData: {
        id: 'v1',
        title: 'Video 1',
        videoPath: '/videos/Test Author/Travel Playlist/Video 1.mp4',
        thumbnailPath: '/videos/Test Author/Travel Playlist/Video 1.jpg',
      },
    });

    await taskProcessor.processTask(playlistTask);

    expect(mockTaskRepository.getSubscriptionForTask).toHaveBeenCalledWith(
      playlistTask
    );
    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
      'http://vid1',
      expect.objectContaining({
        downloadId: expect.any(String),
        subscriptionYtdlpConfig: null,
        filenameTemplateSourceOptions: expect.objectContaining({
          sourceCustomName: 'Test Author',
          sourceCollectionName: 'Travel Playlist',
          sourceCollectionId: 'PL123',
          sourceCollectionType: 'playlist',
          mediaPlaylistIndex: 1,
        }),
      })
    );
  });

  it('passes filenameTemplate only for exactly linked subscription tasks', async () => {
    const filenameTemplate = '{{ source_custom_name }}/{{ title }}.{{ ext }}';
    const playlistTask: ContinuousDownloadTask = {
      ...mockTask,
      authorUrl: 'https://youtube.com/playlist?list=PL123',
      collectionId: 'col-1',
      playlistName: 'Travel Playlist - Test Author',
      subscriptionId: 'sub-1',
      totalVideos: 1,
    };
    mockTaskRepository.getSubscriptionForTask.mockResolvedValue({
      id: 'sub-1',
      author: 'Renamed Subscription Label',
      authorUrl: playlistTask.authorUrl,
      interval: 60,
      downloadCount: 0,
      createdAt: Date.now(),
      platform: 'YouTube',
      playlistId: 'PL123',
      playlistTitle: 'Travel Playlist',
      channelName: 'Test Author',
      subscriptionType: 'playlist',
      collectionId: 'col-1',
      filenameTemplate,
    });
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
      videoData: {
        id: 'v1',
        title: 'Video 1',
        videoPath: '/videos/Test Author/Travel Playlist/Video 1.mp4',
        thumbnailPath: '/videos/Test Author/Travel Playlist/Video 1.jpg',
      },
    });

    await taskProcessor.processTask(playlistTask, ['http://vid1']);

    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
      'http://vid1',
      expect.objectContaining({
        subscriptionFilenameTemplate: filenameTemplate,
      })
    );
  });

  it('does not apply fallback subscription filenameTemplate to standalone playlist tasks', async () => {
    const playlistTask: ContinuousDownloadTask = {
      ...mockTask,
      authorUrl: 'https://youtube.com/playlist?list=PL123',
      collectionId: 'col-1',
      playlistName: 'Travel Playlist - Test Author',
      totalVideos: 1,
    };
    mockTaskRepository.getSubscriptionForTask.mockResolvedValue({
      id: 'sub-1',
      author: 'Renamed Subscription Label',
      authorUrl: playlistTask.authorUrl,
      interval: 60,
      downloadCount: 0,
      createdAt: Date.now(),
      platform: 'YouTube',
      playlistId: 'PL123',
      playlistTitle: 'Travel Playlist',
      channelName: 'Test Author',
      subscriptionType: 'playlist',
      collectionId: 'col-1',
      ytdlpConfig: '--cookies /tmp/cookies.txt',
      filenameTemplate: '{{ source_custom_name }}/{{ title }}.{{ ext }}',
    });
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
      videoData: {
        id: 'v1',
        title: 'Video 1',
        videoPath: '/videos/Test Author/Travel Playlist/Video 1.mp4',
        thumbnailPath: '/videos/Test Author/Travel Playlist/Video 1.jpg',
      },
    });

    await taskProcessor.processTask(playlistTask, ['http://vid1']);

    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
      'http://vid1',
      expect.objectContaining({
        subscriptionYtdlpConfig: '--cookies /tmp/cookies.txt',
        subscriptionFilenameTemplate: null,
        filenameTemplateSourceOptions: expect.objectContaining({
          sourceCustomName: 'Test Author',
          sourceCollectionName: 'Travel Playlist',
          sourceCollectionId: 'PL123',
          sourceCollectionType: 'playlist',
        }),
      })
    );
  });

  it('uses the channel subscription source options for Shorts bulk tasks', async () => {
    // Shorts tasks are created with author "<channel> (Shorts)" and a /shorts
    // authorUrl; resolving the owning subscription must give them the same
    // source options as regular channel subscription checks.
    const shortsTask: ContinuousDownloadTask = {
      ...mockTask,
      author: 'Test Author (Shorts)',
      authorUrl: 'https://youtube.com/channel/test/shorts',
      subscriptionId: 'sub-1',
    };
    mockTaskRepository.getSubscriptionForTask.mockResolvedValue({
      id: 'sub-1',
      author: 'Test Author',
      authorUrl: 'https://youtube.com/channel/test',
      interval: 60,
      downloadCount: 0,
      createdAt: Date.now(),
      platform: 'YouTube',
      subscriptionType: 'author',
    });
    mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(['http://short1']);
    (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
    (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
      videoData: {
        id: 's1',
        title: 'Short 1',
        videoPath: '/videos/Test Author/Test Author/Short 1.mp4',
        thumbnailPath: '/videos/Test Author/Test Author/Short 1.jpg',
      },
    });

    await taskProcessor.processTask(shortsTask);

    expect(mockTaskRepository.getSubscriptionForTask).toHaveBeenCalledWith(
      shortsTask
    );
    expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
      'http://short1',
      expect.objectContaining({
        downloadId: expect.any(String),
        subscriptionYtdlpConfig: null,
        filenameTemplateSourceOptions: expect.objectContaining({
          sourceCustomName: 'Test Author',
          sourceCollectionName: 'Test Author',
          sourceCollectionType: 'channel',
          mediaPlaylistIndex: 1,
        }),
      })
    );
  });

  it('should stop processing if task is cancelled', async () => {
     // Return cancelled logic:
     // If we return 'cancelled' immediately, the loop breaks at check #1.
     // Then validation check at the end should also see 'cancelled' and not complete.
     
     // Override the default mock implementation to always return cancelled for this test
     mockTaskRepository.getTaskStatus.mockResolvedValue('cancelled');
     mockTaskRepository.getTaskById.mockResolvedValue({ ...mockTask, status: 'cancelled' });

     const videoUrls = ['http://vid1', 'http://vid2'];
     mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);

     await taskProcessor.processTask({ ...mockTask });

     expect(mockTaskRepository.completeTask).not.toHaveBeenCalled();
  });

  it('continues and clears the flag when an interruption signal is stale (quick pause→resume)', async () => {
     // Simulate a pause that was immediately followed by a resume: the in-memory
     // interruption flag is set, but the DB status is back to "active".
     const videoUrls = ['http://vid1', 'http://vid2'];
     mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
     (storageService.getVideoBySourceUrl as any).mockReturnValue(null);
     (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
       videoData: { id: 'v1', title: 'V', videoPath: '/tmp/1', thumbnailPath: '/tmp/t1' },
     });
     mockTaskRepository.getTaskStatus.mockResolvedValue('active');

     taskProcessor.signalInterruption(mockTask.id);

     await taskProcessor.processTask({ ...mockTask });

     // Loop confirmed against the DB, saw "active", dropped the stale flag, and
     // finished normally instead of leaving the task active with no worker.
     expect(taskProcessor.isTaskInterrupted(mockTask.id)).toBe(false);
     expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledTimes(2);
     expect(mockTaskRepository.completeTask).toHaveBeenCalledWith(mockTask.id);
  });

  it('stops when an interruption signal is confirmed by a non-active DB status', async () => {
     const videoUrls = ['http://vid1', 'http://vid2'];
     mockVideoUrlFetcher.getAllVideoUrls.mockResolvedValue(videoUrls);
     mockTaskRepository.getTaskStatus.mockResolvedValue('paused');
     mockTaskRepository.getTaskById.mockResolvedValue({ ...mockTask, status: 'paused' });

     taskProcessor.signalInterruption(mockTask.id);

     await taskProcessor.processTask({ ...mockTask });

     expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
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
    expect(mockVideoUrlFetcher.getVideoUrlsIncremental).toHaveBeenCalledTimes(2); // Called for batch 0-50, then 50-55
    
    vi.useRealTimers();
  });
});
