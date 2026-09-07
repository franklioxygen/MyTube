import { describe, expect, it } from 'vitest';
import getTheme from '../theme';
import { DEFAULT_BREAKPOINT_VALUES } from '../utils/automotiveDesktopLayout';

/** What the measured Tesla resolves to: zoom 0.644 against a 773px viewport. */
const CAR_BREAKPOINTS = { xs: 0, sm: 386, md: 579, lg: 772, xl: 989 };

describe('theme sizing under scaled in-car breakpoints', () => {
    it('builds media queries from the scaled thresholds', () => {
        // The car's 773px viewport has to resolve to lg, where the desktop
        // columns live.
        const { breakpoints } = getTheme('dark', CAR_BREAKPOINTS);

        expect(breakpoints.up('lg')).toContain(`${CAR_BREAKPOINTS.lg}px`);
        expect(breakpoints.up('md')).toContain(`${CAR_BREAKPOINTS.md}px`);
        expect(breakpoints.down('sm')).toContain('385.95px');
    });

    it('keeps the pixel values stock, so Container and Dialog stay full width', () => {
        // These same numbers are what MUI emits as Container/Dialog max-widths.
        // Scaling them would cap a maxWidth="lg" page at 772px while the zoomed
        // root has ~1200 layout pixels to fill.
        const { breakpoints } = getTheme('dark', CAR_BREAKPOINTS);

        expect(breakpoints.values).toMatchObject(DEFAULT_BREAKPOINT_VALUES);
    });

    it('keeps the two in step: a container caps above the query that reveals it', () => {
        const { breakpoints } = getTheme('dark', CAR_BREAKPOINTS);

        // maxWidth="lg" applies from the scaled lg query upwards, then caps at
        // the stock 1200 - which the zoomed root can actually reach.
        expect(breakpoints.up('lg')).toContain(`${CAR_BREAKPOINTS.lg}px`);
        expect(breakpoints.values.lg).toBe(DEFAULT_BREAKPOINT_VALUES.lg);
        expect(breakpoints.values.lg).toBeGreaterThan(CAR_BREAKPOINTS.lg);
    });

    it('leaves the existing component styling alone', () => {
        const overrides = getTheme('dark', CAR_BREAKPOINTS).components?.MuiDialog?.styleOverrides;

        expect(overrides?.paper).toMatchObject({ borderRadius: 16 });
    });

    it('touches none of this on an ordinary browser', () => {
        const { breakpoints } = getTheme('dark');

        expect(breakpoints.values).toMatchObject(DEFAULT_BREAKPOINT_VALUES);
        expect(breakpoints.up('lg')).toContain(`${DEFAULT_BREAKPOINT_VALUES.lg}px`);
    });
});
