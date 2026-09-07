import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAutomotiveDesktopLayout } from '../useAutomotiveDesktopLayout';

// jsdom has no `zoom` style property, so an unset value reads back as
// undefined where a browser would give ''. Assertions below use toBeFalsy.
const define = (target: object, key: string, value: unknown) => {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
};

/** The car, as measured: see automotiveDesktopLayout for where these come from. */
const pretendToBeTheCar = () => {
    define(window.navigator, 'userAgent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    define(window.navigator, 'maxTouchPoints', 5);
    define(window, 'devicePixelRatio', 1.5299999713897705);
    define(window, 'innerWidth', 773);
    define(window, 'outerWidth', 0);
};

const pretendToBeALaptop = () => {
    define(window.navigator, 'userAgent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    define(window.navigator, 'maxTouchPoints', 0);
    define(window, 'devicePixelRatio', 2);
    define(window, 'innerWidth', 1440);
    define(window, 'outerWidth', 1440);
};

/** Android Automotive: whole-number DPR, so the zoom follows the width alone. */
const pretendToBeAnAndroidHeadUnit = (innerWidth: number) => {
    define(window.navigator, 'userAgent', 'Mozilla/5.0 (Linux; Android 14; Automotive) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    define(window.navigator, 'maxTouchPoints', 5);
    define(window, 'devicePixelRatio', 2);
    define(window, 'innerWidth', innerWidth);
    define(window, 'outerWidth', innerWidth);
};

const resizeTo = (innerWidth: number) => {
    define(window, 'innerWidth', innerWidth);
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
};

const mountRoot = () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    return root;
};

afterEach(() => {
    document.getElementById('root')?.remove();
    window.localStorage.clear();
});

describe('useAutomotiveDesktopLayout', () => {
    it('zooms the app root back down on a head unit', () => {
        pretendToBeTheCar();
        const root = mountRoot();

        const { result } = renderHook(() => useAutomotiveDesktopLayout());

        expect(result.current).toBeDefined();
        expect(Number(root.style.zoom)).toBeCloseTo(result.current!.zoom, 5);
    });

    it('publishes the zoom so viewport units can divide it back out', () => {
        // Without this, a 100vh box renders at 100vh * zoom and leaves dead
        // space below the footer - 214px of it on the measured car.
        pretendToBeTheCar();
        const root = mountRoot();

        const { result } = renderHook(() => useAutomotiveDesktopLayout());

        expect(root.style.getPropertyValue('--automotive-zoom'))
            .toBe(String(result.current!.zoom));
    });

    it('puts the root back when it unmounts', () => {
        pretendToBeTheCar();
        const root = mountRoot();

        const { unmount } = renderHook(() => useAutomotiveDesktopLayout());
        unmount();

        expect(root.style.zoom).toBeFalsy();
        expect(root.style.getPropertyValue('--automotive-zoom')).toBeFalsy();
    });

    it('touches nothing on an ordinary browser', () => {
        pretendToBeALaptop();
        const root = mountRoot();

        const { result } = renderHook(() => useAutomotiveDesktopLayout());

        expect(result.current).toBeUndefined();
        expect(root.style.zoom).toBeFalsy();
        expect(root.style.getPropertyValue('--automotive-zoom')).toBeFalsy();
    });

    it('re-derives the zoom when the display is resized', () => {
        // Mounted wide enough to need no zoom; split-screen halves it and the
        // desktop layout has to be earned back rather than lost.
        pretendToBeAnAndroidHeadUnit(1440);
        const root = mountRoot();

        const { result } = renderHook(() => useAutomotiveDesktopLayout());
        expect(result.current!.zoom).toBe(1);

        resizeTo(900);

        expect(result.current!.zoom).toBeCloseTo(0.75, 3);
        expect(Number(root.style.zoom)).toBeCloseTo(0.75, 3);
        expect(900).toBeGreaterThanOrEqual(result.current!.breakpoints.lg);
    });

    it('holds its identity steady when a resize changes nothing', () => {
        // Otherwise every resize event rebuilds the MUI theme.
        pretendToBeTheCar();
        mountRoot();

        const { result } = renderHook(() => useAutomotiveDesktopLayout());
        const before = result.current;

        resizeTo(773);

        expect(result.current).toBe(before);
    });

    it('never subscribes on an ordinary browser', () => {
        pretendToBeALaptop();
        const root = mountRoot();

        const { result } = renderHook(() => useAutomotiveDesktopLayout());
        resizeTo(700);

        expect(result.current).toBeUndefined();
        expect(root.style.zoom).toBeFalsy();
    });
});
