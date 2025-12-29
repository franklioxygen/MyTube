import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../LanguageContext';
import { SnackbarProvider } from '../SnackbarContext';
import { VideoProvider, useVideo } from '../VideoContext';
import { VisitorModeProvider } from '../VisitorModeContext';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <SnackbarProvider>
                <LanguageProvider>
                    <VisitorModeProvider>
                        <VideoProvider>{children}</VideoProvider>
                    </VisitorModeProvider>
                </LanguageProvider>
            </SnackbarProvider>
        </QueryClientProvider>
    );
};

describe('VideoContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Mock global localStorage
        const storageMock: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: vi.fn((key) => storageMock[key] || null),
                setItem: vi.fn((key, value) => {
                    storageMock[key] = value.toString();
                }),
                clear: vi.fn(() => {
                    for (const key in storageMock) delete storageMock[key];
                }),
                removeItem: vi.fn((key) => delete storageMock[key]),
                length: 0,
                key: vi.fn(),
            },
            writable: true
        });

        // Default mocks
        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/videos')) return Promise.resolve({ data: [] });
            if (url.includes('/settings')) return Promise.resolve({ data: { tags: [] } });
            return Promise.resolve({ data: {} });
        });
    });

    it('should fetch videos on mount', async () => {
        const mockVideos = [{ id: '1', title: 'Test Video', author: 'Test Author' }];
        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/videos')) return Promise.resolve({ data: mockVideos });
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useVideo(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.videos).toEqual(mockVideos);
        });
    });

    it('should delete a video', async () => {
        const mockVideos = [{ id: '1', title: 'Video 1' }];
        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/videos')) return Promise.resolve({ data: mockVideos });
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useVideo(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.videos).toHaveLength(1));

        mockedAxios.delete.mockResolvedValueOnce({ data: { success: true } });

        await act(async () => {
            const res = await result.current.deleteVideo('1');
            expect(res.success).toBe(true);
        });

        expect(mockedAxios.delete).toHaveBeenCalledWith(expect.stringContaining('/videos/1'));
    });

    it('should handle search (local)', async () => {
        const mockVideos = [
            { id: '1', title: 'React Tutorial', author: 'User A' },
            { id: '2', title: 'Vue Guide', author: 'User B' }
        ];

        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/videos')) return Promise.resolve({ data: mockVideos });
            if (url.includes('/settings')) return Promise.resolve({ data: { showYoutubeSearch: false } }); // Disable YT search for this test
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useVideo(), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.videos).toHaveLength(2));

        await act(async () => {
            await result.current.handleSearch('React');
        });

        expect(result.current.isSearchMode).toBe(true);
        expect(result.current.localSearchResults).toHaveLength(1);
        expect(result.current.localSearchResults[0].title).toBe('React Tutorial');
    });

    it('should increment view count', async () => {
        const mockVideos = [{ id: '1', title: 'V1', viewCount: 0 }];
        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/videos')) return Promise.resolve({ data: mockVideos });
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useVideo(), { wrapper: createWrapper() });
        await waitFor(() => expect(result.current.videos).toHaveLength(1));

        mockedAxios.post.mockResolvedValueOnce({ data: { success: true, viewCount: 1 } });

        await act(async () => {
            await result.current.incrementView('1');
        });

        // The queryClient setQueryData is synchronous, but we might need to wait for re-render
        // However, useQuery data reference might not update immediately in "videos" since it's from state/memo
        // Let's verify axios call
        expect(mockedAxios.post).toHaveBeenCalledWith(expect.stringContaining('/videos/1/view'));
    });
});
