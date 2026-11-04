import { describe, expect, it } from 'vitest';
import { danmakuPanelPlacement, layoutDanmaku, visibleDanmaku, type DanmakuEvent } from '../danmaku';
const event = (time: number, mode: DanmakuEvent['mode'] = 'scroll', text = 'Comment'): DanmakuEvent => ({ time, mode, text, fontSize: 25, color: '#ffffff' });
const measure = (text: string) => text.length * 12;
describe('danmaku content timeline', () => {
    it('supports paused, resumed, backward and forward seeks without an accumulated animation clock', () => {
        const layout = layoutDanmaku([event(1), event(20), event(40, 'top')], 640, 360, measure);
        expect(visibleDanmaku(layout, 2).map(item => item.time)).toEqual([1]);
        expect(visibleDanmaku(layout, 2)).toEqual(visibleDanmaku(layout, 2));
        expect(visibleDanmaku(layout, 21).map(item => item.time)).toEqual([20]);
        expect(visibleDanmaku(layout, 41).map(item => item.time)).toEqual([40]);
        expect(visibleDanmaku(layout, 2).map(item => item.time)).toEqual([1]);
        expect(visibleDanmaku(layout, 200)).toEqual([]);
    });
    it('drops excess density rather than overlapping concurrent comments in the same lane', () => {
        const layout = layoutDanmaku(Array.from({ length: 5000 }, () => event(1)), 390, 220, measure);
        expect(layout.length).toBeLessThanOrEqual(3);
        expect(new Set(layout.map(item => item.lane)).size).toBe(layout.length);
    });
    it('does not place a faster long comment where it would catch its predecessor', () => {
        const layout = layoutDanmaku([event(0, 'scroll', 'x'), event(1, 'scroll', 'a'.repeat(100))], 390, 180, measure);
        expect(layout).toHaveLength(1);
    });
    it('keeps top and bottom comments fixed for four content seconds and frees the lane afterwards', () => {
        const layout = layoutDanmaku([event(0, 'top'), event(0, 'bottom'), event(1, 'top'), event(4, 'top')], 640, 360, measure);
        expect(layout).toHaveLength(3);
        expect(visibleDanmaku(layout, 3).map(item => item.mode)).toEqual(['top', 'bottom']);
        expect(visibleDanmaku(layout, 4).map(item => item.mode)).toEqual(['top']);
    });
});
describe('danmaku settings popover placement', () => {
    it('opens below while there is room, capped so it stays on screen', () => {
        expect(danmakuPanelPlacement(382, 418, 800)).toEqual({ opensUp: false, maxHeight: 358 });
    });
    it('opens above controls at the bottom of the screen, capped so it cannot cover them', () => {
        expect(danmakuPanelPlacement(752, 788, 800)).toEqual({ opensUp: true, maxHeight: 728 });
    });
    it('stays below when neither side has room and above is the smaller one', () => {
        expect(danmakuPanelPlacement(100, 136, 360)).toEqual({ opensUp: false, maxHeight: 200 });
    });
});
