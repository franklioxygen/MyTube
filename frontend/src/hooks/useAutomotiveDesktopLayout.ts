import { useCallback, useEffect, useState } from 'react';
import {
    AutomotiveDesktopLayout,
    resolveAutomotiveDesktopLayout
} from '../utils/automotiveDesktopLayout';

/**
 * Resolves the in-car display workaround and applies its zoom to the app root.
 * Returns the matching breakpoints for the theme, or undefined in every
 * ordinary browser. See automotiveDesktopLayout for why both halves are needed.
 */
export const useAutomotiveDesktopLayout = (): AutomotiveDesktopLayout | undefined => {
    // Also consumes ?vehicleDesktop / ?vehicleZoom and remembers them, which is
    // idempotent - the URL says the same thing on every re-read.
    const resolveNow = useCallback((): AutomotiveDesktopLayout | undefined => {
        try {
            return resolveAutomotiveDesktopLayout({
                userAgent: window.navigator.userAgent,
                href: window.location.href,
                storage: window.localStorage,
                devicePixelRatio: window.devicePixelRatio,
                maxTouchPoints: window.navigator.maxTouchPoints,
                innerWidth: window.innerWidth,
                outerWidth: window.outerWidth
            }) ?? undefined;
        } catch {
            return undefined;
        }
    }, []);

    const [layout, setLayout] = useState<AutomotiveDesktopLayout | undefined>(resolveNow);

    // The zoom is derived from the viewport width, so rotating the display or
    // entering split-screen has to re-derive it: a unit that started at 1440px
    // needs no zoom, but at 900px needs 0.75 to still reach a desktop layout.
    // Whether this *is* a head unit does not depend on width, so a browser that
    // resolved to undefined stays that way and never subscribes.
    const isAutomotive = layout !== undefined;

    useEffect(() => {
        if (!isAutomotive) {
            return;
        }

        const handleViewportChange = () => {
            setLayout((previous) => {
                const next = resolveNow();
                // Hold the identity steady when the numbers have not moved, so
                // a stream of resize events does not rebuild the theme.
                return previous && next && previous.zoom === next.zoom ? previous : next;
            });
        };

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('orientationchange', handleViewportChange);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('orientationchange', handleViewportChange);
        };
    }, [isAutomotive, resolveNow]);

    useEffect(() => {
        if (!layout) {
            return;
        }

        // zoom on <html> is special-cased away by Blink, so it goes on the app
        // root. Deliberately not <body>: MUI portals its menus and dialogs
        // there, and a `fixed` element inside a zoomed ancestor has its left/top
        // scaled too - measured, a probe at left:600px renders at 386px - which
        // put the sort menu 319px off its anchor. Outside the zoom, portals
        // share the viewport's coordinate system, the one
        // getBoundingClientRect reports, so anchoring stays exact.
        //
        // The trade-off: portalled overlays keep the head unit's original
        // scale, so they read ~1.5x larger than the app behind them. There is
        // no way to have both - an element's own `zoom` scales its position as
        // well, so correcting the size always moves the anchor - and oversized
        // menus are the friendlier half of that bargain on a touch screen.
        const root = document.getElementById('root');
        if (!root) {
            return;
        }

        const previousZoom = root.style.zoom;
        root.style.zoom = String(layout.zoom);

        // Viewport units do not follow `zoom`, so inside the zoomed root a
        // `100vh` box renders at 100vh * zoom - on the measured car that left
        // 214px of dead space below the footer. Publishing the factor lets
        // full-height rules divide it back out with
        // calc(100vh / var(--automotive-zoom)), and CSS recomputes that on
        // resize by itself. Unset elsewhere, so the fallback of 1 applies.
        //
        // It goes on the root and not on <html>: custom properties inherit, and
        // from <html> it would reach the portals under <body> too, which sit
        // outside the zoom and would then be scaled down for no reason.
        // Verified: the variable reads as unset on <body>.
        root.style.setProperty('--automotive-zoom', String(layout.zoom));

        return () => {
            root.style.zoom = previousZoom;
            root.style.removeProperty('--automotive-zoom');
        };
    }, [layout]);

    return layout;
};
