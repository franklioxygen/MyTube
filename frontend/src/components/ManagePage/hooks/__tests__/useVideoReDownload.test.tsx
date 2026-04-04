import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoReDownload } from '../useVideoReDownload';
import { api } from '../../../../utils/apiClient';

const mockShowSnackbar = vi.fn();
const mockT = vi.fn((key: string) => key);

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT }),
}));

vi.mock('../../../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

vi.mock('../../../../utils/apiClient', () => ({
    api: {
        post: vi.fn(),
    },
}));

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return { queryClient, wrapper };
};

const baseVideo = {
    id: 'video-1',
    title: 'Test Video',
    sourceUrl: 'https://example.com/watch?v=123',
} as const;

describe('useVideoReDownload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows an error when the video has no source URL', async () => {
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useVideoReDownload(), { wrapper });

        await act(async () => {
            await result.current.handleReDownload({
                ...baseVideo,
                sourceUrl: '',
            } as any);
        });

        expect(api.post).not.toHaveBeenCalled();
        expect(mockShowSnackbar).toHaveBeenCalledWith('No source URL available', 'error');
    });

    it('prevents duplicate downloads while the same source URL is already downloading', async () => {
        let resolveDownload: ((value: { data: Record<string, never> }) => void) | undefined;
        vi.mocked(api.post).mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveDownload = resolve;
                })
        );

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useVideoReDownload(), { wrapper });

        act(() => {
            void result.current.handleReDownload(baseVideo as any);
        });

        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            await result.current.handleReDownload(baseVideo as any);
        });

        expect(api.post).toHaveBeenCalledTimes(1);
        expect(mockShowSnackbar).toHaveBeenCalledWith('Download already in progress', 'warning');

        await act(async () => {
            resolveDownload?.({ data: {} });
            await Promise.resolve();
        });
    });

    it('shows a success snackbar and invalidates download status when the backend returns a download id', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: { downloadId: 'download-1' } } as any);
        const { queryClient, wrapper } = createWrapper();
        const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const { result } = renderHook(() => useVideoReDownload(), { wrapper });

        await act(async () => {
            await result.current.handleReDownload(baseVideo as any);
        });

        expect(api.post).toHaveBeenCalledWith('/download', {
            youtubeUrl: baseVideo.sourceUrl,
            forceDownload: true,
        });
        expect(mockShowSnackbar).toHaveBeenCalledWith('videoDownloading');
        expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['downloadStatus'] });
    });

    it('shows backend download errors from the API response', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.post).mockRejectedValue({
            response: {
                data: {
                    error: 'Download failed hard',
                },
            },
        });

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useVideoReDownload(), { wrapper });

        await act(async () => {
            await result.current.handleReDownload(baseVideo as any);
        });

        expect(mockShowSnackbar).toHaveBeenCalledWith('Download failed hard', 'error');
        consoleErrorSpy.mockRestore();
    });

    it('falls back to the translated generic error and clears the in-flight item after the cleanup timeout', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.post)
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce({ data: {} } as any);

        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useVideoReDownload(), { wrapper });

        await act(async () => {
            await result.current.handleReDownload(baseVideo as any);
        });

        expect(mockShowSnackbar).toHaveBeenCalledWith('error', 'error');

        await act(async () => {
            vi.advanceTimersByTime(1000);
        });

        await act(async () => {
            await result.current.handleReDownload(baseVideo as any);
        });

        expect(api.post).toHaveBeenCalledTimes(2);
        consoleErrorSpy.mockRestore();
    });
});
