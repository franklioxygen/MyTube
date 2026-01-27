import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoHoverPreview } from '../useVideoHoverPreview';

// Mocks
vi.mock('@mui/material', () => ({
    useTheme: () => ({ breakpoints: { down: () => 'sm' } }),
    useMediaQuery: (query: string) => query === 'mobile-query' // Simulate desktop usually unless specified
}));

describe('useVideoHoverPreview', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should set hovered state after delay on desktop', () => {
        const { result } = renderHook(() => useVideoHoverPreview({ videoPath: 'path.mp4' }));
        
        act(() => {
            result.current.handleMouseEnter();
        });

        expect(result.current.isHovered).toBe(false);

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current.isHovered).toBe(true);
    });

    it('should clear timeout and state on mouse leave', () => {
        const { result } = renderHook(() => useVideoHoverPreview({ videoPath: 'path.mp4' }));
        
        // Mock video ref
        // @ts-expect-error - Mocking legacy video properties for testing
        result.current.videoRef.current = {
            pause: vi.fn(),
            load: vi.fn(),
            removeAttribute: vi.fn(),
            src: 'blob:...'
        };

        act(() => {
            result.current.handleMouseEnter();
            // Leave before timeout finishes
            result.current.handleMouseLeave();
        });

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current.isHovered).toBe(false);
        // @ts-expect-error - Checking mock call
        expect(result.current.videoRef.current.pause).toHaveBeenCalled();
    });
});
