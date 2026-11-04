import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DanmakuEvent } from '../../../utils/danmaku';
import DanmakuOverlay from '../DanmakuOverlay';

const events: DanmakuEvent[] = [{ time: 1, text: 'Comment', mode: 'scroll', color: '#ffffff', fontSize: 25 }];
// The player's clock does not move, as while paused.
const pausedAt = (seconds: number) => () => seconds;

describe('DanmakuOverlay', () => {
    let frames: FrameRequestCallback[];
    let paintedAlphas: number[];
    let context: {
        globalAlpha: number;
        clearRect: ReturnType<typeof vi.fn>;
        setTransform: ReturnType<typeof vi.fn>;
        strokeText: ReturnType<typeof vi.fn>;
        fillText: ReturnType<typeof vi.fn>;
        measureText: ReturnType<typeof vi.fn>;
    };
    const nextFrame = () => {
        const pending = frames;
        frames = [];
        pending.forEach(frame => frame(0));
    };

    beforeEach(() => {
        frames = [];
        paintedAlphas = [];
        context = {
            globalAlpha: 1,
            clearRect: vi.fn(),
            setTransform: vi.fn(),
            strokeText: vi.fn(),
            fillText: vi.fn(() => { paintedAlphas.push(context.globalAlpha); }),
            measureText: vi.fn(() => ({ width: 50 })),
        };
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
        vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 360 } as DOMRect);
        vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not lay the track out again when opacity or offset changes', () => {
        const view = render(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.8} offset={0} />);
        const measured = context.measureText.mock.calls.length;
        expect(measured).toBeGreaterThan(0);

        view.rerender(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.5} offset={0} />);
        view.rerender(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.5} offset={3} />);
        nextFrame();

        expect(context.measureText).toHaveBeenCalledTimes(measured);
    });

    it('lays the track out again for different comments', () => {
        const view = render(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.8} offset={0} />);
        const measured = context.measureText.mock.calls.length;

        view.rerender(<DanmakuOverlay events={[{ ...events[0], text: 'Other' }]} getTime={pausedAt(2)} opacity={0.8} offset={0} />);

        expect(context.measureText.mock.calls.length).toBeGreaterThan(measured);
    });

    it('repaints a new opacity while paused, and otherwise leaves a still frame alone', () => {
        const view = render(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.8} offset={0} />);
        nextFrame();
        nextFrame();
        expect(paintedAlphas).toEqual([0.8]);

        view.rerender(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.5} offset={0} />);
        nextFrame();

        expect(paintedAlphas).toEqual([0.8, 0.5]);
    });

    it('applies a new offset while paused', () => {
        const view = render(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.8} offset={0} />);
        nextFrame();
        expect(context.fillText).toHaveBeenCalledTimes(1);

        // Delaying by five seconds puts the comment, due at one second, in the future.
        view.rerender(<DanmakuOverlay events={events} getTime={pausedAt(2)} opacity={0.8} offset={5} />);
        context.clearRect.mockClear();
        nextFrame();

        expect(context.clearRect).toHaveBeenCalledTimes(1);
        expect(context.fillText).toHaveBeenCalledTimes(1);
    });
});
