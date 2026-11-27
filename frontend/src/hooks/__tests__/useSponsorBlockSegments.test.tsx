import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNAVAILABLE_RETRY_MS, useSponsorBlockSegments } from '../useSponsorBlockSegments';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../utils/apiClient', () => ({ api: { get: state.get } }));

const segment = { uuid: 'u1', category: 'sponsor', actionType: 'skip', start: 10, end: 20, videoDuration: 0 };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.get.mockReset();
    client = new QueryClient();
});
afterEach(() => {
    client.clear();
    vi.useRealTimers();
});

describe('useSponsorBlockSegments', () => {
    it('asks again while the server could not look the video up, then stops', async () => {
        state.get
            .mockResolvedValueOnce({ data: { status: 'unavailable', segments: [] } })
            .mockResolvedValueOnce({ data: { status: 'ready', segments: [segment] } });
        const { result } = renderHook(() => useSponsorBlockSegments('v1'), { wrapper });
        await waitFor(() => expect(result.current.data?.status).toBe('unavailable'));

        await act(async () => { await vi.advanceTimersByTimeAsync(UNAVAILABLE_RETRY_MS); });
        await waitFor(() => expect(result.current.data?.status).toBe('ready'));
        await act(async () => { await vi.advanceTimersByTimeAsync(UNAVAILABLE_RETRY_MS * 3); });
        expect(state.get).toHaveBeenCalledTimes(2);
    });

    it('does not ask again once it has an answer', async () => {
        state.get.mockResolvedValue({ data: { status: 'none', segments: [] } });
        const { result } = renderHook(() => useSponsorBlockSegments('v1'), { wrapper });
        await waitFor(() => expect(result.current.data?.status).toBe('none'));
        await act(async () => { await vi.advanceTimersByTimeAsync(UNAVAILABLE_RETRY_MS * 3); });
        expect(state.get).toHaveBeenCalledTimes(1);
    });
});
