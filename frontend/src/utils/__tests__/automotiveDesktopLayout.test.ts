import { describe, expect, it } from 'vitest';
import { resolveAutomotiveDesktopLayout } from '../automotiveDesktopLayout';

const createMemoryStorage = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        removeItem: (key: string) => {
            values.delete(key);
        },
        setItem: (key: string, value: string) => {
            values.set(key, String(value));
        },
    };
};

/**
 * Embedded browsers can expose a Storage object whose methods all throw - and a
 * head unit is exactly where that happens, and where the query-string escape
 * hatch matters most.
 */
const createHostileStorage = (): Storage => ({
    get length(): number {
        throw new Error('storage unavailable');
    },
    clear: () => { throw new Error('storage unavailable'); },
    getItem: () => { throw new Error('storage unavailable'); },
    key: () => { throw new Error('storage unavailable'); },
    removeItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
});

/** Measured on the car: Tesla head unit, 1920x1200 panel, 2026 software. */
const TESLA = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    devicePixelRatio: 1.5299999713897705,
    maxTouchPoints: 5,
    innerWidth: 773,
    // The car really does report 0 - it runs chromeless in a kiosk shell.
    outerWidth: 0
};

/**
 * The near-miss: same desktop-Linux UA, same touch screen, same fractional
 * ratio from desktop scaling. Only the real window frame tells it apart.
 */
const LINUX_TOUCH_LAPTOP = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    devicePixelRatio: 1.5,
    maxTouchPoints: 10,
    innerWidth: 1280,
    outerWidth: 1280
};

const MAC_DESKTOP = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    devicePixelRatio: 2,
    maxTouchPoints: 0,
    innerWidth: 1440,
    outerWidth: 1440
};

const ANDROID_PHONE = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
    devicePixelRatio: 2.625,
    maxTouchPoints: 5,
    innerWidth: 412,
    outerWidth: 412
};

const WINDOWS_TOUCH_LAPTOP = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    devicePixelRatio: 1.5,
    maxTouchPoints: 10,
    innerWidth: 1280,
    outerWidth: 1280
};

const resolve = (device: typeof TESLA, href = 'https://example.com/', storage = createMemoryStorage()) =>
    resolveAutomotiveDesktopLayout({ ...device, href, storage });

describe('automotiveDesktopLayout', () => {
    it('spots the car head unit without any user-agent token', () => {
        expect(resolve(TESLA)).not.toBeNull();
    });

    it('undoes the head unit magnification without over-shrinking', () => {
        const layout = resolve(TESLA)!;

        // 1/1.53 would leave the window 11px shy of a desktop layout, so it
        // shrinks just far enough to clear it - and no further.
        expect(layout.zoom).toBeLessThanOrEqual(1 / TESLA.devicePixelRatio);
        expect(layout.zoom).toBeGreaterThan(0.6);
    });

    it('lands the car viewport on lg, where the desktop columns live', () => {
        const { breakpoints } = resolve(TESLA)!;

        expect(TESLA.innerWidth).toBeGreaterThanOrEqual(breakpoints.lg);
        expect(TESLA.innerWidth).toBeLessThan(breakpoints.xl);
    });

    it('gives the car an effective width of a desktop window', () => {
        const layout = resolve(TESLA)!;

        expect(Math.round(TESLA.innerWidth / layout.zoom)).toBeGreaterThanOrEqual(1200);
    });

    it('keeps the scaled breakpoints ascending', () => {
        const { breakpoints } = resolve(TESLA)!;

        expect(breakpoints.xs).toBeLessThan(breakpoints.sm);
        expect(breakpoints.sm).toBeLessThan(breakpoints.md);
        expect(breakpoints.md).toBeLessThan(breakpoints.lg);
        expect(breakpoints.lg).toBeLessThan(breakpoints.xl);
    });

    it('leaves ordinary desktops alone', () => {
        expect(resolve(MAC_DESKTOP)).toBeNull();
    });

    it('leaves phones alone', () => {
        expect(resolve(ANDROID_PHONE)).toBeNull();
    });

    it('leaves a HiDPI Windows touch laptop alone', () => {
        expect(resolve(WINDOWS_TOUCH_LAPTOP)).toBeNull();
    });

    it('lets an unrecognised head unit opt in by query string', () => {
        expect(resolve(MAC_DESKTOP, 'https://example.com/?vehicleDesktop=1')).not.toBeNull();
    });

    it('lets the car opt back out by query string', () => {
        expect(resolve(TESLA, 'https://example.com/?vehicleDesktop=0')).toBeNull();
    });

    it('remembers both choices on later visits', () => {
        const optedIn = createMemoryStorage();
        resolve(MAC_DESKTOP, 'https://example.com/?vehicleDesktop=1', optedIn);
        expect(resolve(MAC_DESKTOP, 'https://example.com/', optedIn)).not.toBeNull();

        const optedOut = createMemoryStorage();
        resolve(TESLA, 'https://example.com/?vehicleDesktop=0', optedOut);
        expect(resolve(TESLA, 'https://example.com/', optedOut)).toBeNull();
    });

    it('honours a hand-tuned zoom and remembers it', () => {
        const storage = createMemoryStorage();

        expect(resolve(TESLA, 'https://example.com/?vehicleZoom=0.8', storage)!.zoom).toBe(0.8);
        expect(resolve(TESLA, 'https://example.com/', storage)!.zoom).toBe(0.8);
    });

    it('clamps a hand-tuned zoom to something legible', () => {
        expect(resolve(TESLA, 'https://example.com/?vehicleZoom=0.05')!.zoom).toBe(0.5);
        expect(resolve(TESLA, 'https://example.com/?vehicleZoom=4')!.zoom).toBe(1);
    });

    it('never magnifies, only shrinks', () => {
        const wideCar = { ...TESLA, innerWidth: 1600 };

        expect(resolve(wideCar)!.zoom).toBeLessThanOrEqual(1);
    });
    it('spots an Android Automotive head unit by its token', () => {
        const androidAutomotive = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Automotive) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            devicePixelRatio: 2,
            maxTouchPoints: 5,
            innerWidth: 900,
            outerWidth: 1200
        };

        expect(resolve(androidAutomotive)).not.toBeNull();
    });

    it('does not divide out plain hardware pixel density', () => {
        // devicePixelRatio 2 here is Retina-style density, not magnification.
        // Undoing it would halve the text on a screen that was never oversized.
        const hidpiHeadUnit = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Automotive) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            devicePixelRatio: 2,
            maxTouchPoints: 5,
            innerWidth: 900,
            outerWidth: 1200
        };

        // Only the shrink needed to reach a desktop layout: 900/1200.
        expect(resolve(hidpiHeadUnit)!.zoom).toBeCloseTo(0.75, 3);
    });

    it('leaves a head unit that already has a roomy viewport unchanged', () => {
        const roomyHeadUnit = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Automotive) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            devicePixelRatio: 2,
            maxTouchPoints: 5,
            innerWidth: 1440,
            outerWidth: 1440
        };
        const layout = resolve(roomyHeadUnit)!;

        // zoom 1 with unscaled breakpoints is a no-op, so detection costs
        // nothing on a car that never had the problem.
        expect(layout.zoom).toBe(1);
        expect(layout.breakpoints.lg).toBe(1200);
    });

    it('scales any magnified head unit, not just the measured one', () => {
        const otherCar = {
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
            devicePixelRatio: 1.75,
            maxTouchPoints: 10,
            innerWidth: 640,
            outerWidth: 0
        };
        const layout = resolve(otherCar)!;

        expect(layout).not.toBeNull();
        expect(layout.zoom).not.toBe(resolve(TESLA)!.zoom);
        expect(640).toBeGreaterThanOrEqual(layout.breakpoints.lg);
    });

    it('does not mistake a Linux touch laptop for a head unit', () => {
        // Desktop scaling on a touch laptop looks exactly like a magnified
        // head unit, right up to the window frame it reports.
        expect(resolve(LINUX_TOUCH_LAPTOP)).toBeNull();
    });

    it('still lets that laptop opt in deliberately', () => {
        expect(resolve(LINUX_TOUCH_LAPTOP, 'https://example.com/?vehicleDesktop=1')).not.toBeNull();
    });

    it('honours ?vehicleDesktop=1 even when storage throws', () => {
        expect(resolve(MAC_DESKTOP, 'https://example.com/?vehicleDesktop=1', createHostileStorage()))
            .not.toBeNull();
    });

    it('honours ?vehicleDesktop=0 even when storage throws', () => {
        expect(resolve(TESLA, 'https://example.com/?vehicleDesktop=0', createHostileStorage()))
            .toBeNull();
    });

    it('honours ?vehicleZoom even when storage throws', () => {
        expect(resolve(TESLA, 'https://example.com/?vehicleZoom=0.8', createHostileStorage())!.zoom)
            .toBe(0.8);
    });

    it("lets this load's URL win over what storage remembers", () => {
        const storage = createMemoryStorage();
        resolve(TESLA, 'https://example.com/?vehicleDesktop=1&vehicleZoom=0.9', storage);

        // Same visit, new URL: the query string is the more recent instruction.
        expect(resolve(TESLA, 'https://example.com/?vehicleZoom=0.7', storage)!.zoom).toBe(0.7);
        expect(resolve(TESLA, 'https://example.com/?vehicleDesktop=0', storage)).toBeNull();
    });

    it('reads a fractional Android ratio as hardware density, not magnification', () => {
        // 2.625 is one of Android's standard density buckets. Treating it as
        // 162% magnification would divide it out and hit the zoom floor,
        // shrinking a perfectly normal screen to half size.
        const androidAutomotive = {
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Automotive) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            devicePixelRatio: 2.625,
            maxTouchPoints: 5,
            innerWidth: 900,
            outerWidth: 900
        };

        // Only the shrink needed to reach the desktop target: 900/1200.
        expect(resolve(androidAutomotive)!.zoom).toBeCloseTo(0.75, 3);
    });

    it('still undoes magnification on the desktop-UA head unit', () => {
        // The same fractional-ratio inference must survive for the car it was
        // measured on, where 1.53 really is magnification.
        expect(resolve(TESLA)!.zoom).toBeLessThanOrEqual(1 / TESLA.devicePixelRatio);
    });
});
