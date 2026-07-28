import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBreakpointSynchronizedOpen } from '../useBreakpointSynchronizedOpen';

describe('useBreakpointSynchronizedOpen', () => {
    it('uses desktop-open and mobile-collapsed defaults when the breakpoint changes', () => {
        const { result, rerender } = renderHook(
            ({ isMobile }) => useBreakpointSynchronizedOpen(isMobile),
            { initialProps: { isMobile: false } }
        );

        expect(result.current[0]).toBe(true);

        rerender({ isMobile: true });
        expect(result.current[0]).toBe(false);

        rerender({ isMobile: false });
        expect(result.current[0]).toBe(true);
    });

    it('keeps manual toggles within the current breakpoint', () => {
        const { result } = renderHook(
            ({ isMobile }) => useBreakpointSynchronizedOpen(isMobile),
            { initialProps: { isMobile: false } }
        );

        act(() => {
            result.current[1]((current) => !current);
        });

        expect(result.current[0]).toBe(false);
    });
});
