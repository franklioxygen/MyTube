import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoProvider, useVideo } from '../VideoContext';

const mockShowSnackbar = vi.fn();
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();

let mockUserRole = 'admin';
let mockIsAuthenticated = true;

vi.mock('../../utils/apiClient', () => ({
  api: {
    get: (...args: any[]) => mockApiGet(...args),
    post: (...args: any[]) => mockApiPost(...args),
    put: (...args: any[]) => mockApiPut(...args),
    delete: (...args: any[]) => mockApiDelete(...args),
  },
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ userRole: mockUserRole, isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('../LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../SnackbarContext', () => ({
  useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <VideoProvider>{children}</VideoProvider>
    </QueryClientProvider>
  );

  return { wrapper, queryClient };
};

describe('VideoContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUserRole = 'admin';
    mockIsAuthenticated = true;

    mockApiGet.mockImplementation((url: string, config?: any) => {
      if (url === '/videos') {
        return Promise.resolve({
          data: [
            { id: 'v1', title: 'React Tutorial', author: 'Alice', visibility: 1, tags: ['react', 'frontend'] },
            { id: 'v2', title: 'Vue Guide', author: 'Bob', visibility: 0, tags: ['vue'] },
          ],
        });
      }
      if (url === '/settings') {
        return Promise.resolve({ data: { tags: ['react', 'vue'], showYoutubeSearch: true } });
      }
      if (url === '/search') {
        const q = config?.params?.query;
        if (q === 'react') {
          return Promise.resolve({ data: { results: [{ id: 'yt1' }, { id: 'yt2' }] } });
        }
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    mockApiPost.mockImplementation((url: string) => {
      if (url.endsWith('/view')) {
        return Promise.resolve({ data: { success: true, viewCount: 9 } });
      }
      if (url.includes('/refresh-thumbnail')) {
        return Promise.resolve({ data: { success: true, thumbnailUrl: '/images/new.jpg?ts=1' } });
      }
      if (url.includes('/upload-thumbnail')) {
        return Promise.resolve({ data: { success: true, thumbnailUrl: '/images/up.jpg?ts=2' } });
      }
      return Promise.resolve({ data: { success: true } });
    });

    mockApiPut.mockResolvedValue({ data: { success: true } });
    mockApiDelete.mockResolvedValue({ data: { success: true } });
  });

  it('throws when useVideo is called outside provider', () => {
    expect(() => renderHook(() => useVideo())).toThrow('useVideo must be used within a VideoProvider');
  });

  it('loads videos and settings, and exposes base context values', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    expect(result.current.availableTags).toEqual(['react', 'vue']);
    expect(result.current.showYoutubeSearch).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('filters invisible videos when user is visitor', async () => {
    mockUserRole = 'visitor';

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(1);
    });

    expect(result.current.videos[0].id).toBe('v1');
  });

  it('searchLocalVideos supports AND-matching across title/author/tags', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    const hits = result.current.searchLocalVideos('react alice');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('v1');
  });

  it('handleSearch returns validation error for empty query and resets state', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    const searchResult = await result.current.handleSearch('   ');
    expect(searchResult).toEqual({ success: false, error: 'pleaseEnterSearchTerm' });
    expect(result.current.isSearchMode).toBe(false);
    expect(result.current.searchTerm).toBe('');
    expect(result.current.searchResults).toEqual([]);
  });

  it('handleSearch combines local + youtube results when enabled', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    await act(async () => {
      const res = await result.current.handleSearch('react');
      expect(res).toEqual({ success: true });
    });

    expect(result.current.isSearchMode).toBe(true);
    expect(result.current.searchTerm).toBe('react');
    expect(result.current.localSearchResults).toHaveLength(1);
    expect(result.current.searchResults).toEqual([{ id: 'yt1' }, { id: 'yt2' }]);
    expect(result.current.youtubeLoading).toBe(false);
  });

  it('handleSearch skips youtube fetch when showYoutubeSearch is false', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/videos') {
        return Promise.resolve({ data: [{ id: 'v1', title: 'Only Local', author: 'Alice', visibility: 1 }] });
      }
      if (url === '/settings') {
        return Promise.resolve({ data: { tags: [], showYoutubeSearch: false } });
      }
      if (url === '/search') {
        throw new Error('should not call /search when disabled');
      }
      return Promise.resolve({ data: {} });
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.showYoutubeSearch).toBe(false);
    });

    await act(async () => {
      const res = await result.current.handleSearch('only');
      expect(res).toEqual({ success: true });
    });

    expect(result.current.localSearchResults).toHaveLength(1);
    expect(result.current.searchResults).toEqual([]);
    const searchCalls = mockApiGet.mock.calls.filter((c: any[]) => c[0] === '/search');
    expect(searchCalls).toHaveLength(0);
  });

  it('handleSearch falls back to local results when youtube search errors', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/videos') {
        return Promise.resolve({ data: [{ id: 'v1', title: 'React basics', author: 'Alice', visibility: 1 }] });
      }
      if (url === '/settings') {
        return Promise.resolve({ data: { tags: [], showYoutubeSearch: true } });
      }
      if (url === '/search') {
        return Promise.reject(new Error('youtube down'));
      }
      return Promise.resolve({ data: {} });
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(1);
    });

    let res: any;
    await act(async () => {
      res = await result.current.handleSearch('react');
    });
    expect(res).toEqual({ success: true });
    await waitFor(() => {
      expect(result.current.localSearchResults).toHaveLength(1);
    });
    expect(result.current.searchResults).toEqual([]);
  });

  it('loadMoreSearchResults appends non-duplicate results and handles errors', async () => {
    let searchCount = 0;
    mockApiGet.mockImplementation((url: string, config?: any) => {
      if (url === '/videos') {
        return Promise.resolve({ data: [{ id: 'v1', title: 'React', author: 'Alice', visibility: 1 }] });
      }
      if (url === '/settings') {
        return Promise.resolve({ data: { tags: [], showYoutubeSearch: true } });
      }
      if (url === '/search') {
        searchCount += 1;
        if (searchCount === 1) {
          return Promise.resolve({ data: { results: [{ id: 'yt1' }, { id: 'yt2' }] } });
        }
        if (searchCount === 2) {
          expect(config?.params?.offset).toBe(3);
          return Promise.resolve({ data: { results: [{ id: 'yt2' }, { id: 'yt3' }] } });
        }
        return Promise.reject(new Error('load more failed'));
      }
      return Promise.resolve({ data: {} });
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await act(async () => {
      await result.current.handleSearch('react');
    });

    expect(result.current.searchResults).toEqual([{ id: 'yt1' }, { id: 'yt2' }]);

    await act(async () => {
      await result.current.loadMoreSearchResults();
    });

    expect(result.current.searchResults).toEqual([{ id: 'yt1' }, { id: 'yt2' }, { id: 'yt3' }]);

    await act(async () => {
      await result.current.loadMoreSearchResults();
    });

    expect(mockShowSnackbar).toHaveBeenCalledWith('failedToSearch');
    expect(result.current.loadingMore).toBe(false);
  });

  it('deleteVideo respects snackbar option and reports failures', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    const ok = await result.current.deleteVideo('v1');
    expect(ok).toEqual({ success: true });
    expect(mockShowSnackbar).toHaveBeenCalledWith('videoRemovedSuccessfully');

    mockApiDelete.mockRejectedValueOnce(new Error('delete fail'));
    const failed = await result.current.deleteVideo('v2', { showSnackbar: false });
    expect(failed).toEqual({ success: false, error: 'failedToDeleteVideo' });
  });

  it('deleteVideos handles partial failures', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    mockApiDelete
      .mockResolvedValueOnce({ data: { success: true } })
      .mockRejectedValueOnce(new Error('boom'));

    const res = await result.current.deleteVideos(['v1', 'v2']);
    expect(res).toEqual({ success: false });
    expect(mockShowSnackbar).toHaveBeenCalledWith('deleteFilteredVideosSuccess (1 failed)');
  });

  it('refreshThumbnail handles success and fail responses', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    const ok = await result.current.refreshThumbnail('v1');
    expect(ok).toEqual({ success: true });
    expect(mockShowSnackbar).toHaveBeenCalledWith('thumbnailRefreshed');

    mockApiPost.mockResolvedValueOnce({ data: { success: false } });
    const fail = await result.current.refreshThumbnail('v1');
    expect(fail).toEqual({ success: false, error: 'thumbnailRefreshFailed' });
  });

  it('uploadThumbnail posts multipart form data', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    const file = new File(['x'], 'thumb.png', { type: 'image/png' });
    await result.current.uploadThumbnail('v1', file);

    const [url, formData, config] = mockApiPost.mock.calls.find((c: any[]) => c[0].includes('/upload-thumbnail'));
    expect(url).toContain('/videos/v1/upload-thumbnail');
    expect(formData).toBeInstanceOf(FormData);
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
    expect(mockShowSnackbar).toHaveBeenCalledWith('thumbnailUploaded');
  });

  it('updateVideo and incrementView handle success and failure paths', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    const updateOk = await result.current.updateVideo('v1', { title: 'Updated title' });
    expect(updateOk).toEqual({ success: true });
    expect(mockShowSnackbar).toHaveBeenCalledWith('videoUpdated');

    mockApiPut.mockResolvedValueOnce({ data: { success: false } });
    const updateFail = await result.current.updateVideo('v1', { title: 'nope' });
    expect(updateFail).toEqual({ success: false, error: 'videoUpdateFailed' });

    const viewOk = await result.current.incrementView('v1');
    expect(viewOk).toEqual({ success: true });

    mockApiPost.mockRejectedValueOnce(new Error('view fail'));
    const viewFail = await result.current.incrementView('v1');
    expect(viewFail).toEqual({ success: false, error: 'Failed to increment view' });
  });

  it('supports setVideos, tag toggling, and resetSearch state cleanup', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useVideo(), { wrapper });

    await waitFor(() => {
      expect(result.current.videos).toHaveLength(2);
    });

    act(() => {
      result.current.setVideos((prev) => [{ id: 'v3', title: 'new', author: 'Zed', visibility: 1 }, ...prev]);
    });

    await waitFor(() => {
      expect(result.current.videos[0].id).toBe('v3');
    });

    act(() => {
      result.current.handleTagToggle('react');
      result.current.handleTagToggle('vue');
      result.current.handleTagToggle('react');
    });

    expect(result.current.selectedTags).toEqual(['vue']);

    await act(async () => {
      await result.current.handleSearch('react');
    });

    expect(result.current.isSearchMode).toBe(true);

    act(() => {
      result.current.resetSearch();
    });

    expect(result.current.isSearchMode).toBe(false);
    expect(result.current.searchTerm).toBe('');
    expect(result.current.searchResults).toEqual([]);
  });
});
