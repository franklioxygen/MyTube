import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A swipe has to clear this much horizontal travel to turn the page. Set above
 * the hero carousel's 48px because a mis-fire here replaces the whole grid, and
 * because the gesture shares the surface with vertical scrolling.
 */
const SWIPE_THRESHOLD_PX = 64;

/** How long the post-swipe click guard stays armed. */
const CLICK_SUPPRESS_MS = 400;

/**
 * True when the gesture began inside something that scrolls sideways itself -
 * a wide table in its TableContainer, say. There the drag is the viewer
 * scrolling that box, not asking for the next page.
 */
const startsInsideHorizontalScroller = (event: React.TouchEvent): boolean => {
    const stopAt = (event.currentTarget as HTMLElement).parentElement;
    let node = event.target as HTMLElement | null;

    while (node && node !== stopAt) {
        if (node.scrollWidth > node.clientWidth) {
            const { overflowX } = window.getComputedStyle(node);
            if (overflowX === 'auto' || overflowX === 'scroll') return true;
        }
        node = node.parentElement;
    }

    return false;
};

interface UsePaginationSwipeNavigationProps {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    /** Pass false where paging is not in play at all, e.g. infinite scroll. */
    enabled?: boolean;
    /**
     * Pass true where the paged surface may scroll sideways itself - a wide
     * table in its TableContainer - so the touch-action lock does not take that
     * scrolling away. The gesture still stands down there, via
     * startsInsideHorizontalScroller.
     */
    keepNativeHorizontalPan?: boolean;
    /**
     * The surface itself, required alongside keepNativeHorizontalPan. Native
     * panning is only worth reserving while the surface is *actually* wider
     * than its box; a table that currently fits should page like anything else.
     */
    surfaceRef?: React.RefObject<HTMLElement | null>;
}

/** Props to spread onto the element the gesture should cover. Empty when off. */
export interface PaginationSwipeHandlers {
    style?: React.CSSProperties;
    onTouchStart?: React.TouchEventHandler;
    onTouchEnd?: React.TouchEventHandler;
    onTouchCancel?: React.TouchEventHandler;
    onClickCapture?: React.MouseEventHandler;
}

/**
 * Horizontal swipes step through a paginated list, the touch counterpart to
 * usePaginationKeyboardNavigation's arrow keys. No device detection: touch
 * events only arrive from a touch screen, so in-car displays and tablets get
 * the gesture while pointer users are untouched.
 */
export const usePaginationSwipeNavigation = ({
    page,
    totalPages,
    onPageChange,
    enabled = true,
    keepNativeHorizontalPan = false,
    surfaceRef
}: UsePaginationSwipeNavigationProps): PaginationSwipeHandlers => {
    // Whether the surface is scrollable sideways right now. touch-action is
    // resolved by the browser before any handler runs, so this cannot be left
    // to startsInsideHorizontalScroller: on a surface parked at touch-action
    // auto the browser may claim a horizontal drag for back/forward navigation
    // and cancel the touch before touchend ever fires.
    const [surfaceOverflows, setSurfaceOverflows] = useState(false);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const suppressClick = useRef(false);
    const suppressClickTimer = useRef<number | null>(null);

    useEffect(() => {
        const node = surfaceRef?.current;
        if (!keepNativeHorizontalPan || !node) {
            return;
        }

        const measure = () => setSurfaceOverflows(node.scrollWidth > node.clientWidth);
        measure();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        // The box and its content can each change width independently.
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        if (node.firstElementChild) {
            observer.observe(node.firstElementChild);
        }

        return () => observer.disconnect();
    }, [keepNativeHorizontalPan, surfaceRef]);

    // Clear the pending suppress-click reset on unmount.
    useEffect(() => () => {
        if (suppressClickTimer.current) window.clearTimeout(suppressClickTimer.current);
    }, []);

    const clearClickSuppression = useCallback(() => {
        suppressClick.current = false;
        if (suppressClickTimer.current) {
            window.clearTimeout(suppressClickTimer.current);
            suppressClickTimer.current = null;
        }
    }, []);

    const handleTouchStart = useCallback((event: React.TouchEvent) => {
        // A new touch means the previous swipe's synthetic click is never
        // coming - browsers fire it immediately on touchend or not at all. Any
        // click after this one is the user's own, so stop guarding rather than
        // eating their first tap on the page they just swiped to.
        clearClickSuppression();

        // Only a single-finger drag pages; pinch-zoom is left to the browser.
        touchStart.current =
            event.touches.length === 1 && !startsInsideHorizontalScroller(event)
                ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
                : null;
    }, [clearClickSuppression]);

    const handleTouchEnd = useCallback((event: React.TouchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;

        const touch = event.changedTouches[0];
        if (!touch) return;

        const horizontalDistance = touch.clientX - start.x;
        const verticalDistance = touch.clientY - start.y;

        // Keep natural page scrolling intact; only a deliberate, mostly
        // horizontal drag turns the page.
        if (
            Math.abs(horizontalDistance) < SWIPE_THRESHOLD_PX ||
            Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
        ) {
            return;
        }

        // The grid is wall-to-wall clickable cards, so swallow the synthetic
        // click some browsers dispatch after a swipe - and auto-clear the flag
        // so it never eats a genuine tap when no such click arrives.
        //
        // Armed for every deliberate swipe, before the range check below: the
        // browser dispatches that click whether or not there was a page to
        // move to, so swiping outwards on the first or last page would
        // otherwise open whichever card the finger started on.
        suppressClick.current = true;
        if (suppressClickTimer.current) window.clearTimeout(suppressClickTimer.current);
        suppressClickTimer.current = window.setTimeout(clearClickSuppression, CLICK_SUPPRESS_MS);

        const nextPage = horizontalDistance < 0 ? page + 1 : page - 1;
        if (nextPage < 1 || nextPage > totalPages) return;

        onPageChange(nextPage);
    }, [clearClickSuppression, onPageChange, page, totalPages]);

    const handleTouchCancel = useCallback(() => {
        touchStart.current = null;
    }, []);

    const handleClickCapture = useCallback((event: React.MouseEvent) => {
        if (!suppressClick.current) return;
        // One swipe swallows at most one click.
        clearClickSuppression();
        event.preventDefault();
        event.stopPropagation();
    }, [clearClickSuppression]);

    if (!enabled || totalPages <= 1) {
        return {};
    }

    return {
        // Vertical scrolling stays with the browser, while horizontal drags
        // reach these handlers instead of an OEM browser's back/forward swipe.
        // pinch-zoom is named explicitly because omitting it would also
        // surrender two-finger zoom, which this hook never wants: a gesture
        // with more than one touch is ignored outright in handleTouchStart.
        // Released only while the surface really is scrolling sideways, so a
        // table that fits pages like every other surface.
        ...(keepNativeHorizontalPan && surfaceOverflows
            ? {}
            : { style: { touchAction: 'pan-y pinch-zoom' } }),
        onTouchStart: handleTouchStart,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: handleTouchCancel,
        onClickCapture: handleClickCapture
    };
};
