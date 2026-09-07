import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePaginationSwipeNavigation } from '../usePaginationSwipeNavigation';

function setupHook(overrides: Parameters<typeof usePaginationSwipeNavigation>[0] extends never
    ? never
    : Partial<Parameters<typeof usePaginationSwipeNavigation>[0]> = {}) {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => usePaginationSwipeNavigation({
        page: 1,
        totalPages: 3,
        onPageChange,
        ...overrides
    }));
    return { result, onPageChange };
}

/**
 * A root the handlers are attached to, holding a box that may or may not scroll
 * sideways, holding the node the finger actually lands on.
 */
function buildTree({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
    const root = document.createElement('div');
    const box = document.createElement('div');
    const child = document.createElement('div');
    box.style.overflowX = 'auto';
    box.appendChild(child);
    root.appendChild(box);
    document.body.appendChild(root);
    Object.defineProperty(box, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(box, 'clientWidth', { value: clientWidth, configurable: true });
    return { root, child };
}

function swipe(
    handlers: ReturnType<typeof usePaginationSwipeNavigation>,
    tree: ReturnType<typeof buildTree>,
    { from, to }: { from: number; to: number }
) {
    act(() => {
        handlers.onTouchStart?.({
            currentTarget: tree.root,
            target: tree.child,
            touches: [{ clientX: from, clientY: 100 }]
        } as any);
        handlers.onTouchEnd?.({ changedTouches: [{ clientX: to, clientY: 100 }] } as any);
    });
}

function swipeLeft(handlers: ReturnType<typeof usePaginationSwipeNavigation>, tree: ReturnType<typeof buildTree>) {
    swipe(handlers, tree, { from: 300, to: 200 });
}

function swipeRight(handlers: ReturnType<typeof usePaginationSwipeNavigation>, tree: ReturnType<typeof buildTree>) {
    swipe(handlers, tree, { from: 200, to: 300 });
}

/** Returns whether the hook swallowed the browser's post-swipe click. */
function clickWasSwallowed(handlers: ReturnType<typeof usePaginationSwipeNavigation>) {
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => {
        handlers.onClickCapture?.(click as any);
    });
    return click.preventDefault.mock.calls.length > 0;
}

describe('usePaginationSwipeNavigation', () => {
    it('stands down when the gesture starts in a box that scrolls sideways', () => {
        const { result, onPageChange } = setupHook();
        swipeLeft(result.current, buildTree({ scrollWidth: 800, clientWidth: 400 }));
        expect(onPageChange).not.toHaveBeenCalled();
    });

    it('pages when that box is not actually overflowing', () => {
        const { result, onPageChange } = setupHook();
        swipeLeft(result.current, buildTree({ scrollWidth: 400, clientWidth: 400 }));
        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('locks horizontal panning by default', () => {
        const { result } = setupHook();
        expect(result.current.style).toEqual({ touchAction: 'pan-y pinch-zoom' });
    });

    it('leaves two-finger zoom to the browser', () => {
        // The handler ignores multi-touch anyway, so taking pinch-zoom away
        // would cost accessibility for nothing.
        const { result } = setupHook();
        expect(result.current.style?.touchAction).toContain('pinch-zoom');
    });

    it('ignores a two-finger gesture instead of paging on it', () => {
        const { result, onPageChange } = setupHook();
        const tree = buildTree({ scrollWidth: 400, clientWidth: 400 });

        act(() => {
            result.current.onTouchStart?.({
                currentTarget: tree.root,
                target: tree.child,
                touches: [{ clientX: 300, clientY: 100 }, { clientX: 340, clientY: 120 }]
            } as any);
            result.current.onTouchEnd?.({ changedTouches: [{ clientX: 200, clientY: 100 }] } as any);
        });

        expect(onPageChange).not.toHaveBeenCalled();
        expect(clickWasSwallowed(result.current)).toBe(false);
    });

    it('swallows the click after a swipe that turns the page', () => {
        const { result } = setupHook();
        swipeLeft(result.current, buildTree({ scrollWidth: 400, clientWidth: 400 }));
        expect(clickWasSwallowed(result.current)).toBe(true);
    });

    it('swallows the click when the swipe runs off the end of the pagination', () => {
        // Swiping right on page 1 has nowhere to go, but the browser still
        // dispatches the click - onto whichever card the finger started on.
        const { result, onPageChange } = setupHook({ page: 1 });
        swipeRight(result.current, buildTree({ scrollWidth: 400, clientWidth: 400 }));

        expect(onPageChange).not.toHaveBeenCalled();
        expect(clickWasSwallowed(result.current)).toBe(true);
    });

    it('swallows the click when swiping past the last page', () => {
        const { result, onPageChange } = setupHook({ page: 3, totalPages: 3 });
        swipeLeft(result.current, buildTree({ scrollWidth: 400, clientWidth: 400 }));

        expect(onPageChange).not.toHaveBeenCalled();
        expect(clickWasSwallowed(result.current)).toBe(true);
    });

    it('leaves a genuine tap alone', () => {
        const { result } = setupHook();
        expect(clickWasSwallowed(result.current)).toBe(false);
    });

    it('leaves the click alone when the drag was too short to be a swipe', () => {
        const { result, onPageChange } = setupHook();
        swipe(result.current, buildTree({ scrollWidth: 400, clientWidth: 400 }), { from: 300, to: 280 });

        expect(onPageChange).not.toHaveBeenCalled();
        expect(clickWasSwallowed(result.current)).toBe(false);
    });

    it('stops guarding once the next touch begins', () => {
        // Browsers that already swallow the post-swipe click leave the guard
        // armed with nothing to consume it. The user's next tap must not
        // become the casualty.
        const { result } = setupHook();
        const tree = buildTree({ scrollWidth: 400, clientWidth: 400 });
        swipeLeft(result.current, tree);

        act(() => {
            result.current.onTouchStart?.({
                currentTarget: tree.root,
                target: tree.child,
                touches: [{ clientX: 150, clientY: 100 }]
            } as any);
        });

        expect(clickWasSwallowed(result.current)).toBe(false);
    });

    it('still swallows the click of the swipe that armed it', () => {
        // The guard has to survive from touchend to the synthetic click that
        // follows it; only a fresh touch clears it.
        const { result } = setupHook();
        swipeLeft(result.current, buildTree({ scrollWidth: 400, clientWidth: 400 }));

        expect(clickWasSwallowed(result.current)).toBe(true);
    });

    /** A surface that reports a fixed overflow state, as a table would. */
    function surfaceRefWith({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
        const node = document.createElement('div');
        Object.defineProperty(node, 'scrollWidth', { value: scrollWidth, configurable: true });
        Object.defineProperty(node, 'clientWidth', { value: clientWidth, configurable: true });
        document.body.appendChild(node);
        const ref = createRef<HTMLElement>();
        (ref as { current: HTMLElement | null }).current = node;
        return ref;
    }

    it('releases horizontal panning only while the table really overflows', () => {
        const { result } = setupHook({
            keepNativeHorizontalPan: true,
            surfaceRef: surfaceRefWith({ scrollWidth: 900, clientWidth: 400 })
        });

        expect(result.current.style).toBeUndefined();
    });

    it('locks horizontal gestures on a table that currently fits', () => {
        // Left at touch-action auto, the browser can claim the drag for
        // back/forward navigation and cancel the touch before touchend, so the
        // JS-side check never gets a say.
        const { result } = setupHook({
            keepNativeHorizontalPan: true,
            surfaceRef: surfaceRefWith({ scrollWidth: 400, clientWidth: 400 })
        });

        expect(result.current.style).toEqual({ touchAction: 'pan-y pinch-zoom' });
    });

    it('keeps the lock when no surface is given to measure', () => {
        const { result } = setupHook({ keepNativeHorizontalPan: true });

        expect(result.current.style).toEqual({ touchAction: 'pan-y pinch-zoom' });
    });
});
