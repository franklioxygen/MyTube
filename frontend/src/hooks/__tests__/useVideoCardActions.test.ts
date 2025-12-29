import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoCardActions } from '../useVideoCardActions';

// Mocks
const mockShowSnackbar = vi.fn();
const mockUpdateVideo = vi.fn();
const mockT = vi.fn((key) => key);

vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar })
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT })
}));

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({ updateVideo: mockUpdateVideo })
}));

describe('useVideoCardActions', () => {
    const mockVideo = {
        id: '1',
        title: 'Test Video',
        visibility: 1
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delete video successfully', async () => {
        const mockOnDelete = vi.fn().mockResolvedValue(true);
        const { result } = renderHook(() => useVideoCardActions({
            video: mockVideo as any,
            onDeleteVideo: mockOnDelete,
            showDeleteButton: true
        }));

        await act(async () => {
            await result.current.confirmDelete();
        });

        expect(mockOnDelete).toHaveBeenCalledWith('1');
    });

    it('should toggle visibility (hide)', async () => {
        mockUpdateVideo.mockResolvedValue({ success: true });
        
        const { result } = renderHook(() => useVideoCardActions({
            video: { ...mockVideo, visibility: 1 } as any
        }));

        await act(async () => {
            await result.current.handleToggleVisibility();
        });

        expect(mockUpdateVideo).toHaveBeenCalledWith('1', { visibility: 0 });
        expect(mockShowSnackbar).toHaveBeenCalledWith('hideVideo', 'success');
    });

    it('should toggle visibility (show)', async () => {
        mockUpdateVideo.mockResolvedValue({ success: true });
        
        const { result } = renderHook(() => useVideoCardActions({
            video: { ...mockVideo, visibility: 0 } as any
        }));

        await act(async () => {
            await result.current.handleToggleVisibility();
        });

        expect(mockUpdateVideo).toHaveBeenCalledWith('1', { visibility: 1 });
        expect(mockShowSnackbar).toHaveBeenCalledWith('showVideo', 'success');
    });

    it('should handle update error', async () => {
        mockUpdateVideo.mockResolvedValue({ success: false });
        
        const { result } = renderHook(() => useVideoCardActions({
            video: mockVideo as any
        }));

        await act(async () => {
            await result.current.handleToggleVisibility();
        });

        expect(mockShowSnackbar).toHaveBeenCalledWith('error', 'error');
    });
});
