import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickyButton } from '../useStickyButton';

type MockObserver = {
    callback: IntersectionObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
};

const createRef = (top: number) => ({
    current: {
        getBoundingClientRect: vi.fn(() => ({
            top,
        })),
    } as unknown as HTMLDivElement,
});

describe('useStickyButton', () => {
    let mockObserver: MockObserver | null;

    beforeEach(() => {
        mockObserver = null;
        window.innerHeight = 800;
        class MockIntersectionObserver {
            constructor(callback: IntersectionObserverCallback) {
                mockObserver = {
                    callback,
                    disconnect: vi.fn(),
                    observe: vi.fn(),
                };
            }

            disconnect() {
                mockObserver?.disconnect();
            }

            observe(target: Element) {
                mockObserver?.observe(target);
            }

            takeRecords() {
                return [];
            }

            unobserve() { }

            root = null;
            rootMargin = '0px';
            thresholds = [0];
        }

        window.IntersectionObserver = MockIntersectionObserver as unknown as typeof window.IntersectionObserver;
    });

    it('marks the button sticky immediately when the target starts below the viewport', () => {
        const observerTarget = createRef(900);

        const { result } = renderHook(() => useStickyButton(observerTarget));

        expect(result.current).toBe(true);
        expect(mockObserver?.observe).toHaveBeenCalledWith(observerTarget.current);
    });

    it('updates when the intersection observer reports the target entering the viewport', () => {
        const observerTarget = createRef(900);

        const { result } = renderHook(() => useStickyButton(observerTarget));

        expect(result.current).toBe(true);

        act(() => {
            mockObserver?.callback(
                [
                    {
                        isIntersecting: true,
                        boundingClientRect: { top: 700 } as DOMRectReadOnly,
                        rootBounds: { bottom: 800 } as DOMRectReadOnly,
                    } as IntersectionObserverEntry,
                ],
                mockObserver as unknown as IntersectionObserver,
            );
        });

        expect(result.current).toBe(false);
    });

    it('falls back to scroll and resize listeners when IntersectionObserver is unavailable', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        // @ts-expect-error test fallback path
        delete window.IntersectionObserver;

        const observerTarget = createRef(900);
        const { result, unmount } = renderHook(() => useStickyButton(observerTarget));

        expect(result.current).toBe(true);
        expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
        expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

        unmount();

        expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});
