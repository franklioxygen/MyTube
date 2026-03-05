import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeaderScrollState } from '../useHeaderScrollState';

describe('useHeaderScrollState', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'scrollY', {
            configurable: true,
            value: 0,
            writable: true,
        });
    });

    it('returns false and does not bind scroll listener when detection is disabled', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

        const { result } = renderHook(() => useHeaderScrollState(false, false, false));

        expect(result.current).toBe(false);
        const hasScrollListener = addEventListenerSpy.mock.calls.some(([event]) => event === 'scroll');
        expect(hasScrollListener).toBe(false);

        addEventListenerSpy.mockRestore();
    });

    it('tracks scrolled state on mobile and removes listener on unmount', async () => {
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

        const { result, unmount } = renderHook(() => useHeaderScrollState(true, false, false));

        await waitFor(() => expect(result.current).toBe(false));

        act(() => {
            Object.defineProperty(window, 'scrollY', {
                configurable: true,
                value: 120,
                writable: true,
            });
            window.dispatchEvent(new Event('scroll'));
        });
        await waitFor(() => expect(result.current).toBe(true));

        act(() => {
            Object.defineProperty(window, 'scrollY', {
                configurable: true,
                value: 10,
                writable: true,
            });
            window.dispatchEvent(new Event('scroll'));
        });
        await waitFor(() => expect(result.current).toBe(false));

        unmount();
        const removedScrollListener = removeEventListenerSpy.mock.calls.some(([event]) => event === 'scroll');
        expect(removedScrollListener).toBe(true);

        removeEventListenerSpy.mockRestore();
    });

    it('enables scroll detection on desktop when infinite scroll is active on home page', async () => {
        Object.defineProperty(window, 'scrollY', {
            configurable: true,
            value: 80,
            writable: true,
        });

        const { result } = renderHook(() => useHeaderScrollState(false, true, true));
        await waitFor(() => expect(result.current).toBe(true));
    });
});
