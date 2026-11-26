import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../../types';
import { defaultQueryConfig } from '../../utils/queryConfig';
import { useVideoQueries } from '../useVideoQueries';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../utils/apiClient', () => ({ api: { get } }));

const remote = (id: string) => ({
    id,
    title: id,
    origin: { kind: 'remote', instanceId: 'peer', instanceName: 'NAS' },
    capabilities: { canPlay: true },
});

// The app's defaults: queries stay fresh for five minutes.
const setup = (initialId: string, videos: Video[] = []) => {
    const client = new QueryClient({ defaultOptions: { queries: { ...defaultQueryConfig, retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    // The player stays mounted while /video/:id changes.
    const hook = renderHook(
        ({ id }) => useVideoQueries({ videoId: id, videos, showComments: false }),
        { wrapper, initialProps: { id: initialId } },
    );
    return { client, ...hook };
};

describe('useVideoQueries', () => {
    beforeEach(() => {
        get.mockReset();
        get.mockImplementation(async (url: string) => ({ data: remote(url.split('/').pop()!) }));
    });

    it('counts a cached native detail as settled without a fresh request', async () => {
        get.mockImplementation(async (url: string) => ({ data: { id: url.split('/').pop(), title: 'native' } }));
        const { result, rerender } = setup('v1');
        await waitFor(() => expect(result.current.hasSettledDetail).toBe(true));
        rerender({ id: 'v2' });
        await waitFor(() => expect(result.current.hasSettledDetail).toBe(true));

        // Back within the stale time: nothing is fetched, and the cached detail stands.
        rerender({ id: 'v1' });
        expect(result.current.isDetailFresh).toBe(false);
        expect(result.current.hasSettledDetail).toBe(true);
        expect(get).toHaveBeenCalledTimes(2);
    });

    it('does not count the list row as a settled detail', async () => {
        let respond!: () => void;
        get.mockImplementation(
            (url: string) => new Promise((resolve) => {
                respond = () => resolve({ data: { id: url.split('/').pop(), title: 'native' } });
            }),
        );
        const { result } = setup('v1', [{ id: 'v1', title: 'row' } as Video]);
        expect(result.current.video?.title).toBe('row');
        expect(result.current.hasSettledDetail).toBe(false);
        await act(async () => { respond(); });
        await waitFor(() => expect(result.current.hasSettledDetail).toBe(true));
    });

    it('does not count the list row as settled while its request waits to go online', () => {
        onlineManager.setOnline(false);
        try {
            const { result } = setup('v1', [{ id: 'v1', title: 'row' } as Video]);
            // Paused, not fetching: only the row says the detail is not in yet.
            expect(result.current.video?.title).toBe('row');
            expect(result.current.hasSettledDetail).toBe(false);
            expect(get).not.toHaveBeenCalled();
        } finally {
            onlineManager.setOnline(true);
        }
    });

    it('re-reads a cached remote detail on every switch to it', async () => {
        const { result, rerender } = setup('fed_1');
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));

        rerender({ id: 'fed_2' });
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));
        rerender({ id: 'fed_1' });

        // Back on a cached remote item: not fresh until it is fetched again.
        expect(result.current.isDetailFresh).toBe(false);
        await waitFor(() => expect(get.mock.calls.filter(([url]) => url === '/videos/fed_1')).toHaveLength(2));
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));
    });

    it('does not count a cache update during a pending request as fresh', async () => {
        const { client, result, rerender } = setup('fed_1');
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));
        rerender({ id: 'fed_2' });
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));

        let respond!: () => void;
        get.mockImplementationOnce(
            (url: string) => new Promise((resolve) => {
                respond = () => resolve({ data: remote(url.split('/').pop()!) });
            }),
        );
        rerender({ id: 'fed_1' });
        await waitFor(() => expect(get.mock.calls.filter(([url]) => url === '/videos/fed_1')).toHaveLength(2));

        // A progress flush writes the cached detail while the request waits.
        act(() => {
            client.setQueryData(['video', 'fed_1'], (old: object | undefined) => (old ? { ...old, progress: 42 } : old));
        });
        expect(result.current.isDetailFresh).toBe(false);

        act(() => respond());
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));
        // Later cache updates keep it fresh, so playback is not cut off.
        act(() => {
            client.setQueryData(['video', 'fed_1'], (old: object | undefined) => (old ? { ...old, progress: 43 } : old));
        });
        expect(result.current.isDetailFresh).toBe(true);
    });

    it('counts a request still in flight when the user switches away and back', async () => {
        let respond!: () => void;
        get.mockImplementationOnce(
            (url: string) => new Promise((resolve) => {
                respond = () => resolve({ data: remote(url.split('/').pop()!) });
            }),
        );
        const { result, rerender } = setup('fed_1');
        await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

        rerender({ id: 'fed_2' });
        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));
        // Back while the first request for fed_1 is still pending: it is reused.
        rerender({ id: 'fed_1' });
        act(() => respond());

        await waitFor(() => expect(result.current.isDetailFresh).toBe(true));
        expect(result.current.video?.id).toBe('fed_1');
    });
});
