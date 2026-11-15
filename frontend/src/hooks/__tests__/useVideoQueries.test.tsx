import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('useVideoQueries', () => {
    beforeEach(() => {
        get.mockReset();
        get.mockImplementation(async (url: string) => ({ data: remote(url.split('/').pop()!) }));
    });

    it('re-reads a cached remote detail on every switch to it', async () => {
        // The app's defaults: queries stay fresh for five minutes.
        const client = new QueryClient({ defaultOptions: { queries: { ...defaultQueryConfig, retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        // The player stays mounted while /video/:id changes.
        const { result, rerender } = renderHook(
            ({ id }) => useVideoQueries({ videoId: id, videos: [], showComments: false }),
            { wrapper, initialProps: { id: 'fed_1' } },
        );
        await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true));

        rerender({ id: 'fed_2' });
        await waitFor(() => expect(result.current.video?.id).toBe('fed_2'));
        rerender({ id: 'fed_1' });

        // Back on a cached remote item: fetched again before it counts as fresh.
        await waitFor(() => expect(get.mock.calls.filter(([url]) => url === '/videos/fed_1')).toHaveLength(2));
        await waitFor(() => expect(result.current.isFetchedAfterMount).toBe(true));
    });
});
