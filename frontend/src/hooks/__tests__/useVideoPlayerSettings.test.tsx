import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoPlayerSettings } from '../useVideoPlayerSettings';

// Mock dependencies
vi.mock('axios');
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        userRole: 'admin',
        login: vi.fn(),
        logout: vi.fn(),
    }),
}));

const mockShowSnackbar = vi.fn();
vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

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

describe('useVideoPlayerSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('should return default settings when API call is pending/fails', async () => {
        (axios.get as any).mockResolvedValue({ data: {} });

        const { result } = renderHook(() => useVideoPlayerSettings(), { wrapper });

        expect(result.current.autoPlay).toBe(false);
        expect(result.current.autoLoop).toBe(false);
        expect(result.current.subtitlesEnabled).toBe(true);
    });

    it('should return settings from API', async () => {
        (axios.get as any).mockResolvedValue({
            data: {
                defaultAutoPlay: true,
                defaultAutoLoop: true,
                subtitlesEnabled: false,
                tags: ['tag1', 'tag2'],
            },
        });

        const { result } = renderHook(() => useVideoPlayerSettings(), { wrapper });

        await waitFor(() => expect(result.current.autoPlay).toBe(true));
        expect(result.current.autoLoop).toBe(true);
        expect(result.current.subtitlesEnabled).toBe(false);
        expect(result.current.availableTags).toEqual(['tag1', 'tag2']);
    });

    it('should toggle subtitles and update settings', async () => {
        // Initial fetch
        (axios.get as any).mockResolvedValue({
            data: { subtitlesEnabled: true },
        });
        // Mutation response
        (axios.post as any).mockResolvedValue({
            data: { success: true, settings: { subtitlesEnabled: false } },
        });

        const { result } = renderHook(() => useVideoPlayerSettings(), { wrapper });

        await waitFor(() => expect(result.current.subtitlesEnabled).toBe(true));

        act(() => {
            result.current.handleSubtitlesToggle(false);
        });

        await waitFor(() => expect(result.current.subtitlesEnabled).toBe(false));
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/settings'), expect.objectContaining({
            subtitlesEnabled: false
        }));
    });

    it('should toggle loop and update settings', async () => {
        // Initial fetch
        (axios.get as any).mockResolvedValue({
            data: { defaultAutoLoop: false },
        });
        // Mutation response
        (axios.post as any).mockResolvedValue({
            data: { success: true, settings: { defaultAutoLoop: true } },
        });

        const { result } = renderHook(() => useVideoPlayerSettings(), { wrapper });

        await waitFor(() => expect(result.current.autoLoop).toBe(false));

        act(() => {
            result.current.handleLoopToggle(true);
        });

        await waitFor(() => expect(result.current.autoLoop).toBe(true));
        expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/settings'), expect.objectContaining({
            defaultAutoLoop: true
        }));
    });

    it('should show snackbar on error', async () => {
        (axios.get as any).mockResolvedValue({ data: {} });
        (axios.post as any).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useVideoPlayerSettings(), { wrapper });

        act(() => {
            // We need to catch the promise rejection here because it propagates
            result.current.handleLoopToggle(true).catch(() => { });
        });

        await waitFor(() => expect(mockShowSnackbar).toHaveBeenCalledWith('error', 'error'));
    });
});
