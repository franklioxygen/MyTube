import { describe, expect, it } from 'vitest';
import { cancelAutomotiveZoom, viewportHeight, viewportWidth } from '../viewportUnits';

/** Resolve a calc() the way the browser would, for a given variable value. */
const evaluate = (expression: string, zoom: number | null, viewport: number) => {
    const substituted = expression.replace(
        /var\(--automotive-zoom,\s*1\)/g,
        String(zoom ?? 1)
    );
    const match = /^calc\((\d+)(vh|vw) \/ ([\d.]+)\)$/.exec(substituted)
        ?? /^calc\(([\d.]+) \/ ([\d.]+)\)$/.exec(substituted);
    if (!match) throw new Error(`unparsed: ${substituted}`);
    return match.length === 4 && match[2]
        ? (Number(match[1]) / 100) * viewport / Number(match[3])
        : Number(match[1]) / Number(match[2]);
};

describe('viewportUnits', () => {
    it('divides the viewport term by the published zoom', () => {
        // 601px viewport at zoom 0.644 must lay out at 933 so it renders at 601.
        expect(evaluate(viewportHeight(), 0.644, 601)).toBeCloseTo(933, 0);
        expect(evaluate(viewportWidth(), 0.644, 773)).toBeCloseTo(1200, 0);
    });

    it('takes a percentage', () => {
        expect(evaluate(viewportHeight(50), 0.644, 601)).toBeCloseTo(466.6, 0);
        expect(evaluate(viewportHeight(80), 0.644, 601)).toBeCloseTo(746.6, 0);
    });

    it('is a no-op wherever the variable is unset', () => {
        // Ordinary browsers must land on exactly the plain viewport unit.
        expect(evaluate(viewportHeight(), null, 900)).toBe(900);
        expect(evaluate(viewportWidth(), null, 1440)).toBe(1440);
        expect(evaluate(viewportHeight(50), null, 900)).toBe(450);
    });

    it('cancels the zoom to exactly its reciprocal', () => {
        // A fullscreen element inherits the root zoom; this puts it back at 1:1
        // so portalled menus and viewport coordinates agree again.
        expect(evaluate(cancelAutomotiveZoom, 0.644, 0)).toBeCloseTo(1 / 0.644, 5);
    });

    it('cancels to 1 in an ordinary browser, which is the CSS default', () => {
        expect(evaluate(cancelAutomotiveZoom, null, 0)).toBe(1);
    });
});
