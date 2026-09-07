/**
 * Tesla's browser (and other in-car Chromium builds) magnifies the whole UI:
 * measured on a Model 3, a 1920x1200 panel reports devicePixelRatio 1.53, so a
 * browser window 1183 physical pixels wide hands the page a CSS viewport of
 * only 773. MUI resolves `sm` and the app renders its phone layout on a screen
 * that is physically huge.
 *
 * Two things do NOT work here, both measured on the car:
 *   - `<meta name="viewport" content="width=1280">` is ignored outright. Blink
 *     only honours viewport meta in mobile viewport mode; the car runs a
 *     desktop-mode Chromium (UA is a plain `X11; Linux x86_64` Chrome).
 *   - Scaling the breakpoints alone gets the columns back but leaves every
 *     element at its magnified size, so the desktop layout arrives absurdly
 *     oversized and overflowing.
 *
 * What works is undoing the magnification: `zoom` on <body> shrinks the content
 * and widens the layout box to match (763px -> 1174px at zoom 0.653). Media
 * queries deliberately do not follow `zoom`, so the theme's breakpoints are
 * scaled by the same factor to keep them in step. Note `zoom` on <html> does
 * nothing - Blink special-cases the root element.
 */

export interface AutomotiveBreakpointValues {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
}

export interface AutomotiveDesktopLayout {
    /** Applied to <body>; < 1 shrinks the magnified UI back down. */
    zoom: number;
    breakpoints: AutomotiveBreakpointValues;
}

/** MUI's stock breakpoints, which the rest of the app is written against. */
export const DEFAULT_BREAKPOINT_VALUES: AutomotiveBreakpointValues = {
    xs: 0,
    sm: 600,
    md: 900,
    lg: 1200,
    xl: 1536
};

const ENABLED_KEY = 'forceAutomotiveDesktopViewport';
const ZOOM_KEY = 'automotiveDesktopZoom';

/**
 * Keeps text legible at arm's length and stops a wild devicePixelRatio from
 * shrinking the UI to nothing.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1;

/**
 * Effective width to aim for: MUI's `lg`, the point where useGridLayout starts
 * laying out desktop columns. Landing on `md` is not enough - several of its
 * column settings carry no `md` entry and fall back to the two-column `sm`.
 */
const DESKTOP_TARGET_WIDTH = 1200;

/**
 * A fractional devicePixelRatio means software magnification - a head unit
 * scaling its UI up for arm's-length reading - and that is what we undo. Whole
 * ratios are hardware pixel density (Retina and friends); dividing those out
 * would shrink text to nothing on a screen that was never oversized.
 *
 * That inference only holds on a desktop user agent, where 1.0 is the norm.
 * Android ships fractional ratios as plain hardware density - its 1.5 / 2.625
 * / 3.5 buckets - so on Android Automotive a 2.625 would otherwise be read as
 * 162% magnification and shrink the UI to the floor for no reason.
 */
const isSoftwareMagnification = (userAgent: string, devicePixelRatio: number): boolean => (
    !/\bAndroid\b/i.test(userAgent) &&
    devicePixelRatio > 1.25 &&
    Math.abs(devicePixelRatio - Math.round(devicePixelRatio)) > 0.02
);

/**
 * Head units that do announce themselves. Tesla's does not - hence the
 * behavioural check below - but Android Automotive and several OEM browsers
 * carry a token, and those never appear in a phone or desktop user agent.
 */
const CAR_BROWSER_USER_AGENT =
    /\b(?:Automotive|CarBrowser|QtCarBrowser|Tesla|Rivian|Lucid|Polestar|MBUX|BYD|NIO|XPeng|Zeekr|Li\s?Auto|Lixiang)\b/i;

/**
 * Tesla's head unit runs desktop Chromium on X11 with no identifying token, so
 * the user agent alone cannot spot it. Desktop Linux plus a touch screen plus
 * software magnification narrows it down, but not far enough on its own: a
 * Linux touch laptop at fractional desktop scaling looks identical, and would
 * have its whole UI shrunk for no reason.
 *
 * `outerWidth === 0` is what separates them. A normal browser window always
 * reports its outer frame - the embedded Claude browser used while developing
 * this reported 400 - while the car, running chromeless in a kiosk shell,
 * reports 0. Measured on the car; if a future firmware starts reporting a real
 * frame, detection quietly stops firing and ?vehicleDesktop=1 still works.
 *
 * Either route only ever leads to a zoom the measurements justify, so a head
 * unit that already has a roomy viewport comes out of this unchanged.
 */
const isLikelyCarDisplay = (
    userAgent: string,
    devicePixelRatio: number,
    maxTouchPoints: number,
    outerWidth: number
): boolean => (
    CAR_BROWSER_USER_AGENT.test(userAgent) ||
    (
        /X11;\s*Linux/i.test(userAgent) &&
        maxTouchPoints > 0 &&
        isSoftwareMagnification(userAgent, devicePixelRatio) &&
        outerWidth === 0
    )
);

const clampZoom = (zoom: number): number => (
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
);

const readParams = (href: string): URLSearchParams | null => {
    try {
        return new URL(href).searchParams;
    } catch {
        return null;
    }
};

const readStorage = (storage: Storage, key: string): string | null => {
    try {
        return storage.getItem(key);
    } catch {
        // Storage can be unavailable in some embedded browsers.
        return null;
    }
};

const writeStorage = (storage: Storage, key: string, value: string | null): void => {
    try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
    } catch {
        // Storage can be unavailable in some embedded browsers.
    }
};

/**
 * `?vehicleDesktop=1` forces the desktop layout on (`=0` off) for a head unit
 * the sniffing misses; `?vehicleZoom=0.75` overrides how far the UI is shrunk,
 * for tuning legibility from the driver's seat. Both are remembered, so the
 * URL only has to be typed once.
 */
const resolveOverrides = (href: string, storage: Storage): {
    enabled: boolean | null;
    zoom: number | null;
} => {
    const params = readParams(href);

    // What this load asked for, kept separate from what storage remembers.
    // Head units are exactly where localStorage tends to be unavailable or
    // throwing, and they are also where the query-string escape hatch matters
    // most - so the URL has to work on its own, with storage only carrying the
    // choice forward to later visits.
    let requestedEnabled: boolean | null = null;
    let requestedZoom: number | null = null;

    if (params) {
        const requested = params.get('vehicleDesktop');
        if (requested === '1') requestedEnabled = true;
        if (requested === '0') requestedEnabled = false;
        if (requestedEnabled !== null) {
            writeStorage(storage, ENABLED_KEY, String(requestedEnabled));
        }

        const zoomParam = params.get('vehicleZoom');
        if (zoomParam !== null) {
            const parsedZoom = Number(zoomParam);
            if (Number.isFinite(parsedZoom) && parsedZoom > 0) {
                requestedZoom = clampZoom(parsedZoom);
                writeStorage(storage, ZOOM_KEY, String(requestedZoom));
            }
        }
    }

    const stored = readStorage(storage, ENABLED_KEY);
    const storedZoom = Number(readStorage(storage, ZOOM_KEY));

    return {
        enabled: requestedEnabled ??
            (stored === 'true' ? true : stored === 'false' ? false : null),
        zoom: requestedZoom ??
            (Number.isFinite(storedZoom) && storedZoom > 0 ? storedZoom : null)
    };
};

interface ResolveInput {
    userAgent: string;
    href: string;
    storage: Storage;
    devicePixelRatio: number;
    maxTouchPoints: number;
    innerWidth: number;
    /** 0 on a chromeless kiosk shell such as a head unit; never 0 in a window. */
    outerWidth: number;
}

/**
 * The zoom and breakpoints an in-car display needs, or null for every ordinary
 * browser - which keeps MUI's stock behaviour untouched.
 */
export const resolveAutomotiveDesktopLayout = ({
    userAgent,
    href,
    storage,
    devicePixelRatio,
    maxTouchPoints,
    innerWidth,
    outerWidth
}: ResolveInput): AutomotiveDesktopLayout | null => {
    const { enabled, zoom: overriddenZoom } = resolveOverrides(href, storage);
    const detected = isLikelyCarDisplay(userAgent, devicePixelRatio, maxTouchPoints, outerWidth);

    if (enabled === false || (enabled !== true && !detected)) {
        return null;
    }

    // Undoing the head unit's magnification is the first target: at
    // devicePixelRatio 1.53 the UI is 53% oversized, so 1/1.53 puts it back at
    // native scale. Where that still leaves the window short of a desktop
    // layout - the measured car lands 11px shy of `lg` - shrink the rest of the
    // way, since a desktop layout is the whole point. A head unit whose ratio
    // is plain hardware density has nothing to undo, so it only gets the
    // second half.
    const nativeZoom = isSoftwareMagnification(userAgent, devicePixelRatio)
        ? 1 / devicePixelRatio
        : 1;
    const desktopZoom = innerWidth > 0 ? innerWidth / DESKTOP_TARGET_WIDTH : nativeZoom;
    const zoom = clampZoom(overriddenZoom ?? Math.min(nativeZoom, desktopZoom));

    // Floor rather than round: the target width lands the car exactly on `lg`,
    // and rounding up by a pixel would drop it back to `md`.
    return {
        zoom,
        breakpoints: {
            xs: 0,
            sm: Math.floor(DEFAULT_BREAKPOINT_VALUES.sm * zoom),
            md: Math.floor(DEFAULT_BREAKPOINT_VALUES.md * zoom),
            lg: Math.floor(DEFAULT_BREAKPOINT_VALUES.lg * zoom),
            xl: Math.floor(DEFAULT_BREAKPOINT_VALUES.xl * zoom)
        }
    };
};
