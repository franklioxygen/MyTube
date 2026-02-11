import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        // Reset navigator mocks
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
    });

    afterEach(() => {
        errorSpy.mockRestore();
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

    it('should log error when navigator.share fails', async () => {
        const mockShare = vi.fn().mockRejectedValue(new Error('share failed'));
        Object.defineProperty(navigator, 'share', { value: mockShare, configurable: true });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(mockShare).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
    });

    it('should show copyFailed when clipboard write fails', async () => {
        const mockWriteText = vi.fn().mockRejectedValue(new Error('copy failed'));
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: mockWriteText },
            configurable: true
        });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(mockShowSnackbar).toHaveBeenCalledWith('copyFailed', 'error');
        expect(errorSpy).toHaveBeenCalled();
    });

    it('should fallback to execCommand and show success', async () => {
        const execCommand = vi.fn().mockReturnValue(true);
        Object.defineProperty(document, 'execCommand', {
            value: execCommand,
            configurable: true
        });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(mockShowSnackbar).toHaveBeenCalledWith('linkCopied', 'success');
    });

    it('should fallback to execCommand and show failure when copy fails', async () => {
        const execCommand = vi.fn().mockReturnValue(false);
        Object.defineProperty(document, 'execCommand', {
            value: execCommand,
            configurable: true
        });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(mockShowSnackbar).toHaveBeenCalledWith('copyFailed', 'error');
    });

    it('should fallback to execCommand and show failure on exception', async () => {
        const execCommand = vi.fn(() => {
            throw new Error('copy exception');
        });
        Object.defineProperty(document, 'execCommand', {
            value: execCommand,
            configurable: true
        });

        const { result } = renderHook(() => useShareVideo(mockVideo as any));
        await result.current.handleShare();

        expect(mockShowSnackbar).toHaveBeenCalledWith('copyFailed', 'error');
        expect(errorSpy).toHaveBeenCalled();
    });
});
