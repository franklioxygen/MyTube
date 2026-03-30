import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadProvider, useDownload } from '../DownloadContext';

const mockShowSnackbar = vi.fn();
const mockHandleSearch = vi.fn();
const mockSetVideos = vi.fn();
const mockFetchVideos = vi.fn();
const mockFetchCollections = vi.fn();

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

let mockIsAuthenticated = true;
let mockSettingsData: any = {};

vi.mock('../../utils/apiClient', () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    post: (...args: any[]) => mockApiPost(...args),
  },
  getErrorMessage: vi.fn(() => 'network'),
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('../LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

vi.mock('../VideoContext', () => ({
  useVideo: () => ({
    fetchVideos: mockFetchVideos,
    handleSearch: (...args: any[]) => mockHandleSearch(...args),
    setVideos: (...args: any[]) => mockSetVideos(...args),
  }),
}));

vi.mock('../CollectionContext', () => ({
  useCollection: () => ({
    fetchCollections: (...args: any[]) => mockFetchCollections(...args),
  }),
}));

vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ data: mockSettingsData }),
}));

vi.mock('../../components/AlertModal', () => ({
  default: ({ open, title, message, onClose }: any) =>
    open ? (
      <div data-testid="duplicate-alert">
        <div>{title}</div>
        <div>{message}</div>
        <button onClick={onClose}>duplicate-close</button>
      </div>
    ) : null,
}));

vi.mock('../../components/ChannelSubscribeChoiceModal', () => ({
  default: ({ open, onClose, onChooseVideos, onChoosePlaylists }: any) =>
    open ? (
      <div data-testid="channel-choice-modal">
        <button onClick={onChooseVideos}>choose-videos</button>
        <button onClick={onChoosePlaylists}>choose-playlists</button>
        <button onClick={onClose}>close-channel-choice</button>
      </div>
    ) : null,
}));

vi.mock('../../components/SubscribeModal', () => ({
  default: ({ open, onClose, onConfirm, enableDownloadOrder, source }: any) =>
    open ? (
      <div data-testid="subscribe-modal">
        <div>{enableDownloadOrder ? 'mode-video' : 'mode-playlist'}</div>
        <div>{`source-${source || 'none'}`}</div>
        <button onClick={() => onConfirm(30, true, false, 'viewsDesc')}>confirm-subscribe</button>
        <button onClick={onClose}>close-subscribe</button>
      </div>
    ) : null,
}));

vi.mock('../../components/ConfirmationModal', () => ({
  default: ({ isOpen, title, onClose, onConfirm }: any) =>
    isOpen ? (
      <div data-testid={`confirmation-${title}`}>
        <button onClick={onConfirm}>{`confirm-${title}`}</button>
        <button onClick={onClose}>{`close-${title}`}</button>
      </div>
    ) : null,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DownloadProvider>{children}</DownloadProvider>
    </QueryClientProvider>
  );

  return { wrapper, queryClient };
};

describe('DownloadContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockIsAuthenticated = true;
    mockSettingsData = {};

    const storage: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => storage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage[key] = String(value);
        }),
        removeItem: vi.fn((key: string) => {
          delete storage[key];
        }),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      },
      writable: true,
    });

    vi.spyOn(global, 'setTimeout');

    mockHandleSearch.mockResolvedValue({ success: true, source: 'search' });

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/download-status') {
        return Promise.resolve({ data: { activeDownloads: [], queuedDownloads: [] } });
      }
      if (url === '/check-playlist') {
        return Promise.resolve({ data: { success: false } });
      }
      if (url === '/check-bilibili-collection') {
        return Promise.resolve({ data: { success: false, type: 'none' } });
      }
      if (url === '/check-bilibili-parts') {
        return Promise.resolve({ data: { success: false, videosNumber: 1 } });
      }
      return Promise.resolve({ data: {} });
    });

    mockApiPost.mockImplementation((url: string) => {
      if (url === '/download') {
        return Promise.resolve({ data: { downloadId: 'dl-1' } });
      }
      if (url === '/downloads/channel-playlists') {
        return Promise.resolve({ data: { message: 'channel playlists queued' } });
      }
      if (url === '/subscriptions') {
        return Promise.resolve({ data: { success: true } });
      }
      if (url === '/subscriptions/channel-playlists') {
        return Promise.resolve({ data: { subscribedCount: 2, skippedCount: 1, errorCount: 0 } });
      }
      if (url === '/subscriptions/tasks/playlist') {
        return Promise.resolve({ data: { success: true } });
      }
      if (url === '/subscriptions/playlist') {
        return Promise.resolve({ data: { success: true, collectionId: 'c1' } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it('throws when useDownload is called outside provider', () => {
    expect(() => renderHook(() => useDownload())).toThrow(
      'useDownload must be used within a DownloadProvider'
    );
  });

  it('removes stale download status from localStorage on init', async () => {
    const stale = {
      activeDownloads: [{ id: 'a1' }],
      queuedDownloads: [{ id: 'q1' }],
      timestamp: 1000,
    };
    (window.localStorage.getItem as any).mockReturnValue(JSON.stringify(stale));
    vi.spyOn(Date, 'now').mockReturnValue(1000 + 5 * 60 * 1000 + 1);

    const { wrapper } = createWrapper();
    renderHook(() => useDownload(), { wrapper });

    await waitFor(() => {
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('mytube_download_status');
    });
  });

  it('removes invalid localStorage payload when parsing fails', async () => {
    (window.localStorage.getItem as any).mockReturnValue('{bad json');

    const { wrapper } = createWrapper();
    renderHook(() => useDownload(), { wrapper });

    await waitFor(() => {
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('mytube_download_status');
    });
  });

  it('handles normal video download flow and status invalidation', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDownload(), { wrapper });

    const response = await result.current.handleVideoSubmit('https://youtube.com/watch?v=abc');

    expect(response).toEqual({ success: true });
    expect(mockApiPost).toHaveBeenCalledWith('/download', {
      youtubeUrl: 'https://youtube.com/watch?v=abc',
      forceDownload: false,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['downloadStatus'] });
    expect(mockShowSnackbar).toHaveBeenCalledWith('videoDownloading');
  });

  it('handles skipped downloads and invalidates download history', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDownload(), { wrapper });

    mockApiPost.mockResolvedValueOnce({
      data: { skipped: true, previouslyDeleted: true },
    });

    const deletedResult = await result.current.handleVideoSubmit('https://youtube.com/watch?v=del');
    expect(deletedResult).toEqual({ success: true, skipped: true });
    expect(mockShowSnackbar).toHaveBeenCalledWith('videoSkippedDeleted', 'warning');

    mockApiPost.mockResolvedValueOnce({
      data: { skipped: true, previouslyDeleted: false },
    });

    const existsResult = await result.current.handleVideoSubmit('https://youtube.com/watch?v=exists');
    expect(existsResult).toEqual({ success: true, skipped: true });
    expect(mockShowSnackbar).toHaveBeenCalledWith('videoSkippedExists', 'warning');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['downloadHistory'] });
  });

  it('handles direct video response by prepending with setVideos', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    const immediateVideo = { id: 'v-immediate', title: 'Immediate video' };
    mockApiPost.mockResolvedValueOnce({ data: { video: immediateVideo } });

    const submitResult = await result.current.handleVideoSubmit('https://youtube.com/watch?v=instant');
    expect(submitResult).toEqual({ success: true });
    expect(mockSetVideos).toHaveBeenCalled();

    const updater = mockSetVideos.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    expect(updater([{ id: 'old' }])).toEqual([immediateVideo, { id: 'old' }]);
  });

  it('routes search-term API errors to handleSearch', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    mockApiPost.mockRejectedValueOnce({
      response: { data: { isSearchTerm: true, searchTerm: 'cats' } },
    });

    const submitResult = await result.current.handleVideoSubmit('cats');

    expect(mockHandleSearch).toHaveBeenCalledWith('cats');
    expect(submitResult).toEqual({ success: true, source: 'search' });
  });

  it('returns a normal download error when search-term metadata is absent', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    mockApiPost.mockRejectedValueOnce({
      response: { data: { error: 'download failed hard' } },
    });

    const submitResult = await result.current.handleVideoSubmit('https://youtube.com/watch?v=bad');
    expect(submitResult).toEqual({ success: false, error: 'download failed hard' });
  });

  it('handles YouTube channel playlists flow and confirmation modal callbacks', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    let submitResult: any;
    await act(async () => {
      submitResult = await result.current.handleVideoSubmit('https://www.youtube.com/@some-channel/playlists');
    });
    expect(submitResult).toEqual({ success: true });

    await waitFor(() => {
      expect(screen.getByTestId('confirmation-downloadAll')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('confirm-downloadAll'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/downloads/channel-playlists', {
        url: 'https://www.youtube.com/@some-channel/playlists',
      });
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith('channel playlists queued');

    // Open again and test close callback branch
    await act(async () => {
      await result.current.handleVideoSubmit('https://www.youtube.com/@some-channel/playlists');
    });
    fireEvent.click(screen.getByText('close-downloadAll'));
    await waitFor(() => {
      expect(screen.queryByTestId('confirmation-downloadAll')).not.toBeInTheDocument();
    });
  });

  it('handles YouTube channel subscribe choice and video subscription duplicate conflict', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    await act(async () => {
      await result.current.handleVideoSubmit('https://www.youtube.com/@my-channel');
    });
    await waitFor(() => {
      expect(screen.getByTestId('channel-choice-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('choose-videos'));
    expect(await screen.findByTestId('subscribe-modal')).toBeInTheDocument();
    expect(await screen.findByText('mode-video')).toBeInTheDocument();

    // success path
    fireEvent.click(screen.getByText('confirm-subscribe'));
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/subscriptions', {
        url: 'https://www.youtube.com/@my-channel',
        interval: 30,
        downloadAllPrevious: true,
        downloadShorts: false,
        downloadOrder: 'viewsDesc',
      });
    });
    expect(mockShowSnackbar).toHaveBeenCalledWith('subscribedSuccessfully');

    // 409 duplicate path -> opens duplicate alert
    await act(async () => {
      await result.current.handleVideoSubmit('https://www.youtube.com/@my-channel-dup');
    });
    fireEvent.click(screen.getByText('choose-videos'));

    mockApiPost.mockRejectedValueOnce({ response: { status: 409 } });
    fireEvent.click(screen.getByText('confirm-subscribe'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-alert')).toBeInTheDocument();
    });
  });

  it('handles subscribe playlists mode and appends /playlists when missing', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDownload(), { wrapper });

    await act(async () => {
      await result.current.handleVideoSubmit('https://www.youtube.com/@playlist-channel');
    });
    await waitFor(() => {
      expect(screen.getByTestId('channel-choice-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('choose-playlists'));

    expect(await screen.findByText('mode-playlist')).toBeInTheDocument();
    fireEvent.click(screen.getByText('confirm-subscribe'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/channel-playlists', {
        url: 'https://www.youtube.com/@playlist-channel/playlists',
        interval: 30,
        downloadAllPrevious: true,
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
  });

  it('opens the subscribe modal directly for pasted Twitch channel URLs', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    await act(async () => {
      await result.current.handleVideoSubmit('https://www.twitch.tv/SomeStreamer/videos');
    });

    await waitFor(() => {
      expect(screen.getByTestId('subscribe-modal')).toBeInTheDocument();
    });
    expect(screen.getByText('mode-video')).toBeInTheDocument();
    expect(screen.getByText('source-twitch')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-choice-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('confirm-subscribe'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/subscriptions', {
        url: 'https://www.twitch.tv/somestreamer',
        interval: 30,
        downloadAllPrevious: true,
        downloadShorts: false,
        downloadOrder: 'viewsDesc',
      });
    });
  });

  it('does not treat Twitch clip URLs as channel subscriptions', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    await act(async () => {
      await result.current.handleVideoSubmit('https://clips.twitch.tv/FunnyClipSlug');
    });

    expect(screen.queryByTestId('subscribe-modal')).not.toBeInTheDocument();
    expect(mockApiPost).toHaveBeenCalledWith('/download', {
      youtubeUrl: 'https://clips.twitch.tv/FunnyClipSlug',
      forceDownload: false,
    });
  });

  it('shows the backend Twitch subscription validation message on failure', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    await act(async () => {
      await result.current.handleVideoSubmit('https://www.twitch.tv/AnotherStreamer');
    });

    await waitFor(() => {
      expect(screen.getByTestId('subscribe-modal')).toBeInTheDocument();
    });

    mockApiPost.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { error: 'Twitch client credentials are required for Twitch API requests.' },
      },
    });

    fireEvent.click(screen.getByText('confirm-subscribe'));

    await waitFor(() => {
      expect(mockShowSnackbar).toHaveBeenCalledWith(
        'Twitch client credentials are required for Twitch API requests.',
        'error'
      );
    });
  });

  it('handles Bilibili collection/parts checks and download-all paths', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/download-status') {
        return Promise.resolve({ data: { activeDownloads: [], queuedDownloads: [] } });
      }
      if (url === '/check-bilibili-collection') {
        return Promise.resolve({
          data: {
            success: true,
            type: 'collection',
            title: 'B Collection',
            count: 12,
            id: 'cid',
            mid: 'mid-1',
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    let collectionResult: any;
    await act(async () => {
      collectionResult = await result.current.handleVideoSubmit('https://www.bilibili.com/video/BV1abc');
    });
    expect(collectionResult).toEqual({ success: true });
    await waitFor(() => {
      expect(result.current.showBilibiliPartsModal).toBe(true);
      expect(result.current.bilibiliPartsInfo.type).toBe('collection');
    });

    const subscribeResult = await result.current.handleDownloadAllBilibiliParts('My B Collection', { interval: 60 });
    expect(subscribeResult).toEqual({ success: true });
    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/playlist', {
      playlistUrl: 'https://www.bilibili.com/video/BV1abc',
      interval: 60,
      collectionName: 'My B Collection',
      downloadAll: true,
      collectionInfo: {
        type: 'collection',
        id: 'cid',
        mid: 'mid-1',
        title: 'B Collection',
        count: 12,
      },
    });
    expect(mockFetchCollections).toHaveBeenCalled();

    // parts flow + current part flow
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/download-status') {
        return Promise.resolve({ data: { activeDownloads: [], queuedDownloads: [] } });
      }
      if (url === '/check-bilibili-collection') {
        return Promise.resolve({ data: { success: true, type: 'none' } });
      }
      if (url === '/check-bilibili-parts') {
        return Promise.resolve({ data: { success: true, videosNumber: 3, title: 'Multi part' } });
      }
      return Promise.resolve({ data: {} });
    });

    await act(async () => {
      await result.current.handleVideoSubmit('https://www.bilibili.com/video/BV2xyz');
    });
    expect(result.current.bilibiliPartsInfo.type).toBe('parts');

    mockApiPost.mockResolvedValueOnce({ data: { success: true } });
    const partsDownloadResult = await result.current.handleDownloadAllBilibiliParts('My parts');
    expect(partsDownloadResult).toEqual({ success: true });
    expect(mockApiPost).toHaveBeenCalledWith('/download', {
      youtubeUrl: 'https://www.bilibili.com/video/BV2xyz',
      downloadAllParts: true,
      downloadCollection: false,
      collectionInfo: null,
      collectionName: 'My parts',
    });

    mockApiGet.mockClear();
    mockApiPost.mockResolvedValueOnce({ data: { downloadId: 'single-part' } });
    let currentPartResult: any;
    await act(async () => {
      currentPartResult = await result.current.handleDownloadCurrentBilibiliPart();
    });
    expect(currentPartResult).toEqual({ success: true });

    const getCalls = mockApiGet.mock.calls.map((c: any[]) => c[0]);
    expect(getCalls).not.toContain('/check-bilibili-collection');
    expect(getCalls).not.toContain('/check-bilibili-parts');
  });

  it('returns error object when handleDownloadAllBilibiliParts fails', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    mockApiGet.mockImplementation((url: string) => {
      if (url === '/download-status') {
        return Promise.resolve({ data: { activeDownloads: [], queuedDownloads: [] } });
      }
      if (url === '/check-playlist') {
        return Promise.resolve({ data: { success: true, title: 'PL', videoCount: 8 } });
      }
      return Promise.resolve({ data: {} });
    });

    await act(async () => {
      await result.current.handleVideoSubmit('https://youtube.com/playlist?list=PL123');
    });

    mockApiPost.mockRejectedValueOnce({ response: { data: { error: 'bilibili flow failed' } } });
    const errorResult = await result.current.handleDownloadAllBilibiliParts('broken');

    expect(errorResult).toEqual({ success: false, error: 'bilibili flow failed' });
  });

  it('opens subscribe modal directly for Bilibili space URLs', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDownload(), { wrapper });

    let submitResult: any;
    await act(async () => {
      submitResult = await result.current.handleVideoSubmit('https://space.bilibili.com/4652742');
    });
    expect(submitResult).toEqual({ success: true });

    await waitFor(() => {
      expect(screen.getByTestId('subscribe-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('close-subscribe'));
    await waitFor(() => {
      expect(screen.queryByTestId('subscribe-modal')).not.toBeInTheDocument();
    });
  });
});
