import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionProvider } from '../CollectionContext';
import { DownloadProvider, useDownload } from '../DownloadContext';
import { LanguageProvider } from '../LanguageContext';
import { SnackbarProvider } from '../SnackbarContext';
import { VideoProvider } from '../VideoContext';

// Mock AuthContext
vi.mock('../AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        loginRequired: false,
        checkingAuth: false,
        userRole: 'admin',
        login: vi.fn(),
        logout: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Create a wrapper with all necessary providers
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <SnackbarProvider>
                <LanguageProvider>
                    <VideoProvider>
                        <CollectionProvider>
                            <DownloadProvider>{children}</DownloadProvider>
                        </CollectionProvider>
                    </VideoProvider>
                </LanguageProvider>
            </SnackbarProvider>
        </QueryClientProvider>
    );
};

describe('DownloadContext', () => {
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

        // Setup default mocks for initialization
        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/download-status')) {
                return Promise.resolve({ data: { activeDownloads: [], queuedDownloads: [] } });
            }
            if (url.includes('/videos')) {
                return Promise.resolve({ data: [] });
            }
            if (url.includes('/settings')) {
                return Promise.resolve({ data: {} });
            }
            if (url.includes('/collections')) {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: {} });
        });
    });

    it('should initialize with empty downloads', async () => {
        const { result } = renderHook(() => useDownload(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.activeDownloads).toEqual([]);
            expect(result.current.queuedDownloads).toEqual([]);
        });
    });

    it('should handle single video submission', async () => {
        mockedAxios.post.mockResolvedValueOnce({ data: { downloadId: '123' } });

        const { result } = renderHook(() => useDownload(), { wrapper: createWrapper() });

        await act(async () => {
            const res = await result.current.handleVideoSubmit('https://youtube.com/watch?v=123');
            expect(res.success).toBe(true);
        });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/download'),
            expect.objectContaining({ youtubeUrl: 'https://youtube.com/watch?v=123' })
        );
    });

    it('should detect playlist and set modal state', async () => {
        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/check-playlist')) {
                return Promise.resolve({
                    data: { success: true, title: 'My Playlist', videoCount: 10 }
                });
            }
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useDownload(), { wrapper: createWrapper() });
        const playlistUrl = 'https://youtube.com/playlist?list=PL123';

        await act(async () => {
            await result.current.handleVideoSubmit(playlistUrl);
        });

        expect(result.current.showBilibiliPartsModal).toBe(true);
        expect(result.current.bilibiliPartsInfo.type).toBe('playlist');
    });

    it('should handle playlist download confirmation', async () => {
        const { result } = renderHook(() => useDownload(), { wrapper: createWrapper() });

        mockedAxios.get.mockImplementation((url) => {
            if (url.includes('/check-playlist')) {
                return Promise.resolve({
                    data: { success: true, title: 'PL', videoCount: 5 }
                });
            }
            return Promise.resolve({ data: {} });
        });

        await act(async () => {
            await result.current.handleVideoSubmit('https://youtube.com/playlist?list=PL123');
        });

        mockedAxios.post.mockResolvedValueOnce({ data: { success: true } });

        await act(async () => {
            await result.current.handleDownloadAllBilibiliParts('My Playlist');
        });

        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/subscriptions/tasks/playlist'),
            expect.anything()
        );
    });
});
