import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../../types';
import { useVideoMutations } from '../useVideoMutations';

const mockPost = vi.fn();
const mockPut = vi.fn();
vi.mock('../../utils/apiClient', () => ({
    api: {
        post: (...args: unknown[]) => mockPost(...args),
        put: (...args: unknown[]) => mockPut(...args),
    },
}));
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));
vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({ deleteVideo: vi.fn() }),
}));

describe('useVideoMutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPost.mockResolvedValue({ data: { success: true } });
        mockPut.mockResolvedValue({ data: { success: true } });
    });

    it('syncs the shared videos list cache when a rating changes', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        // Seed both the single-video cache and the shared list the Favorites
        // Featured/Top Rated views are derived from.
        queryClient.setQueryData(['video', 'v1'], { id: 'v1', title: 'One', rating: 0 } as Video);
        queryClient.setQueryData(['videos'], [
            { id: 'v1', title: 'One', rating: 0 },
            { id: 'v2', title: 'Two', rating: 5 },
        ] as Video[]);

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useVideoMutations({ videoId: 'v1' }), { wrapper });

        await act(async () => {
            await result.current.ratingMutation.mutateAsync(5);
        });

        await waitFor(() => {
            const list = queryClient.getQueryData<Video[]>(['videos']);
            expect(list?.find((video) => video.id === 'v1')?.rating).toBe(5);
        });
        // Other entries are untouched.
        const list = queryClient.getQueryData<Video[]>(['videos']);
        expect(list?.find((video) => video.id === 'v2')?.rating).toBe(5);
        expect(queryClient.getQueryData<Video>(['video', 'v1'])?.rating).toBe(5);
    });

    it('writes a suggestion update to the video it targeted, even after navigating', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        queryClient.setQueryData(['video', 'a'], { id: 'a', tags: [], autoTags: ['live'] } as unknown as Video);
        queryClient.setQueryData(['video', 'b'], { id: 'b', tags: ['other'], autoTags: [] } as unknown as Video);
        queryClient.setQueryData(['videos'], [
            { id: 'a', tags: [] },
            { id: 'b', tags: ['other'] },
        ] as unknown as Video[]);
        let resolvePut: (value: unknown) => void = () => undefined;
        mockPut.mockReturnValueOnce(new Promise((resolve) => { resolvePut = resolve; }));

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result, rerender } = renderHook(
            ({ videoId }) => useVideoMutations({ videoId }),
            { wrapper, initialProps: { videoId: 'a' } }
        );

        let pending: Promise<unknown> = Promise.resolve();
        act(() => {
            pending = result.current.autoTagsMutation.mutateAsync({ videoId: 'a', tags: ['live'], autoTags: [] });
        });
        // The user opens video b before the response arrives.
        rerender({ videoId: 'b' });
        await act(async () => {
            resolvePut({ data: { success: true } });
            await pending;
        });

        expect(mockPut).toHaveBeenCalledWith('/videos/a', { tags: ['live'], autoTags: [] });
        expect(queryClient.getQueryData(['video', 'a'])).toEqual({ id: 'a', tags: ['live'], autoTags: [] });
        expect(queryClient.getQueryData(['video', 'b'])).toEqual({ id: 'b', tags: ['other'], autoTags: [] });
        // The shared list behind home and the tag filters sees the promotion.
        expect(queryClient.getQueryData(['videos'])).toEqual([
            { id: 'a', tags: ['live'] },
            { id: 'b', tags: ['other'] },
        ]);
        // ...and is refetched, so an older list read cannot undo it.
        expect(queryClient.getQueryState(['videos'])?.isInvalidated).toBe(true);
    });
});
