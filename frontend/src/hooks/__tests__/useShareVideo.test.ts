import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShareVideo } from '../useShareVideo';

const mockShowSnackbar = vi.fn();
const mockT = vi.fn((key) => key);

vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar })
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT })
}));

describe('useShareVideo', () => {
    const mockVideo = { id: '1', title: 'Test' };

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset navigator mocks
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });

    it('should use navigator.share if available', async () => {
        const mockShare = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', { value: mockShare, configurable: true });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Test',
            url: expect.any(String)
        }));
    });

    it('should use clipboard API if navigator.share unavailable', async () => {
        const mockWriteText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { 
            value: { writeText: mockWriteText }, 
            configurable: true 
        });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(mockWriteText).toHaveBeenCalled();
        expect(mockShowSnackbar).toHaveBeenCalledWith('linkCopied', 'success');
    });
});
