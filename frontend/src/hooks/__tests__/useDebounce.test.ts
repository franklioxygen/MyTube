import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebounce } from '../useDebounce';

describe('useDebounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return initial value immediately', () => {
        const { result } = renderHook(() => useDebounce('initial', 500));
        expect(result.current).toBe('initial');
    });

    it('should debounce value updates', () => {
        const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
            initialProps: { value: 'initial', delay: 500 },
        });

        // Update value
        rerender({ value: 'updated', delay: 500 });

        // Should still be initial value immediately
        expect(result.current).toBe('initial');

        // Fast forward less than delay
        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(result.current).toBe('initial');

        // Fast forward past delay
        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(result.current).toBe('updated');
    });

    it('should cancel previous timer on new update', () => {
        const { result, rerender } = renderHook(({ value, delay }) => useDebounce(value, delay), {
            initialProps: { value: 'initial', delay: 500 },
        });

        // First update
        rerender({ value: 'update1', delay: 500 });
        
        act(() => {
            vi.advanceTimersByTime(250);
        });
        
        // Second update before first finishes
        rerender({ value: 'update2', delay: 500 });

        // Should still be initial
        expect(result.current).toBe('initial');

        // Complete the TIME of the first update (total 500ms from start)
        // But since we updated at 250ms, the new timer should fire at 750ms total
        act(() => {
            vi.advanceTimersByTime(250);
        });
        
        // Should STILL be initial because the first timer was cleared
        expect(result.current).toBe('initial');

        // Complete the second timer
        act(() => {
            vi.advanceTimersByTime(250);
        });
        
        expect(result.current).toBe('update2');
    });
});
