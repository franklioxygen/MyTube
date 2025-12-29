import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudflareStatus } from '../useCloudflareStatus';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Mock QueryClient
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('useCloudflareStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return undefined data when enabled is false', async () => {
        const { result } = renderHook(() => useCloudflareStatus(false), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.status).toBe('pending');
            // When disabled, react-query returns undefined data (unless initialData is set)
            // The hook's internal queryFn check for enabled is dead code because enabled: false prevents queryFn execution.
            expect(result.current.data).toBeUndefined();
        });

        expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should fetch status when enabled', async () => {
        const mockData = {
            isRunning: true,
            tunnelId: '123',
            accountTag: 'abc',
            publicUrl: 'https://example.trycloudflare.com',
        };
        mockedAxios.get.mockResolvedValueOnce({ data: mockData });

        const { result } = renderHook(() => useCloudflareStatus(true), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.data).toEqual(mockData);
        });

        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/settings/cloudflared/status'));
    });

    it('should handle API errors', async () => {
        mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useCloudflareStatus(true), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });
    });
});
