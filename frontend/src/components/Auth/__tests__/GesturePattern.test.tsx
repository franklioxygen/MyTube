import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import GesturePattern from '../GesturePattern';
import { GESTURE_DOT_CENTERS } from '../../../utils/gestureGeometry';

// The SVG is 300 viewBox units wide; giving it a 300px rect makes client
// coordinates and viewBox units the same number, so the tests can talk in dots.
const stubRect = (svg: Element) => {
    svg.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
};

const getSvg = (): Element => {
    const svg = screen.getByTestId('gesture-pattern').querySelector('svg');
    if (!svg) throw new Error('grid not rendered');
    stubRect(svg);
    return svg;
};

const at = (dot: number) => ({
    clientX: GESTURE_DOT_CENTERS[dot].x,
    clientY: GESTURE_DOT_CENTERS[dot].y,
});

const PRIMARY = { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' as const };

const draw = (svg: Element, dots: number[], options: { release?: boolean } = {}) => {
    const { release = true } = options;
    fireEvent.pointerDown(svg, { ...PRIMARY, ...at(dots[0]) });
    for (const dot of dots.slice(1)) {
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(dot) });
    }
    if (release) {
        fireEvent.pointerUp(svg, { ...PRIMARY, ...at(dots[dots.length - 1]) });
    }
};

const selectedDots = (): number[] =>
    GESTURE_DOT_CENTERS.map((_, index) => index).filter(
        (index) =>
            screen.getByTestId(`gesture-dot-${index}`).getAttribute('data-selected') === 'true'
    );

let onComplete: Mock<(pattern: number[]) => void>;

const renderGrid = (props: Partial<React.ComponentProps<typeof GesturePattern>> = {}) =>
    render(
        <GesturePattern
            mode="enroll"
            ariaLabel="Gesture grid"
            onComplete={onComplete}
            minimumDotsMessage="Draw a gesture connecting at least 3 dots."
            {...props}
        />
    );

beforeEach(() => {
    onComplete = vi.fn<(pattern: number[]) => void>();
});

describe('starting a stroke', () => {
    it('starts only on a dot', () => {
        renderGrid();
        const svg = getSvg();

        fireEvent.pointerDown(svg, { ...PRIMARY, clientX: 100, clientY: 100 });
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(4) });
        fireEvent.pointerUp(svg, { ...PRIMARY, ...at(4) });

        expect(selectedDots()).toEqual([]);
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('ignores a secondary pointer, so a second finger cannot draw', () => {
        renderGrid();
        const svg = getSvg();

        fireEvent.pointerDown(svg, { pointerId: 2, isPrimary: false, button: 0, ...at(0) });

        expect(selectedDots()).toEqual([]);
    });

    it('ignores a non-primary mouse button', () => {
        renderGrid();
        const svg = getSvg();

        fireEvent.pointerDown(svg, { ...PRIMARY, button: 2, ...at(0) });

        expect(selectedDots()).toEqual([]);
    });

    it('ignores moves from a different pointer once a stroke owns the grid', () => {
        renderGrid();
        const svg = getSvg();

        fireEvent.pointerDown(svg, { ...PRIMARY, ...at(0) });
        fireEvent.pointerMove(svg, { pointerId: 9, isPrimary: false, ...at(8) });

        expect(selectedDots()).toEqual([0]);
    });
});

describe('building a pattern', () => {
    it('selects dots in the order they are visited', () => {
        renderGrid();
        draw(getSvg(), [0, 3, 6], { release: false });

        expect(selectedDots()).toEqual([0, 3, 6]);
    });

    it('draws one line per completed segment plus a live segment', () => {
        renderGrid();
        const svg = getSvg();
        draw(svg, [0, 3, 6], { release: false });

        expect(svg.querySelectorAll('line')).toHaveLength(3);
        expect(screen.getByTestId('gesture-live-segment')).toBeTruthy();
    });

    it('picks up the crossed dot on a fast swipe', () => {
        renderGrid();
        // One move straight from 0 to 2, never sampling 1.
        draw(getSvg(), [0, 2], { release: false });

        expect(selectedDots()).toEqual([0, 1, 2]);
    });

    it('matches the backend midpoint fixture for a multi-segment path', () => {
        renderGrid();
        const svg = getSvg();
        fireEvent.pointerDown(svg, { ...PRIMARY, ...at(0) });
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(8) });
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(2) });
        fireEvent.pointerUp(svg, { ...PRIMARY, ...at(2) });

        expect(onComplete).toHaveBeenCalledWith([0, 4, 8, 5, 2]);
    });

    it('ignores re-entering a dot that is already selected', () => {
        renderGrid();
        const svg = getSvg();
        fireEvent.pointerDown(svg, { ...PRIMARY, ...at(0) });
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(3) });
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(0) });
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(6) });
        fireEvent.pointerUp(svg, { ...PRIMARY, ...at(6) });

        expect(onComplete).toHaveBeenCalledWith([0, 3, 6]);
    });
});

describe('completing a stroke', () => {
    it('calls onComplete exactly once per release, with the canonical sequence', () => {
        renderGrid();
        draw(getSvg(), [0, 1, 2]);

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith([0, 1, 2]);
    });

    it('clears the grid after completing, leaving no path on screen', () => {
        renderGrid();
        draw(getSvg(), [0, 1, 2]);

        expect(selectedDots()).toEqual([]);
    });

    it('validates a too-short draw instead of completing it', () => {
        renderGrid();
        draw(getSvg(), [0, 4]);

        expect(onComplete).not.toHaveBeenCalled();
        expect(screen.getByTestId('gesture-pattern').getAttribute('data-outcome')).toBe('error');
        // Not colour alone: the reason is rendered and announced.
        const live = screen.getByTestId('gesture-live-region');
        expect(live.getAttribute('data-rendered')).toBe('true');
        expect(live.textContent).toBe('Draw a gesture connecting at least 3 dots.');
    });

    it('treats a two-dot draw that crosses a midpoint as valid', () => {
        renderGrid();
        draw(getSvg(), [0, 2]);

        expect(onComplete).toHaveBeenCalledWith([0, 1, 2]);
    });
});

describe('abandoning a stroke', () => {
    it('clears on pointer cancel without completing', () => {
        renderGrid();
        const svg = getSvg();
        draw(svg, [0, 1, 2], { release: false });

        fireEvent.pointerCancel(svg, { ...PRIMARY, ...at(2) });

        expect(onComplete).not.toHaveBeenCalled();
        expect(selectedDots()).toEqual([]);
    });

    it('clears on lost pointer capture without completing', () => {
        renderGrid();
        const svg = getSvg();
        draw(svg, [0, 1, 2], { release: false });

        fireEvent.lostPointerCapture(svg, { ...PRIMARY, ...at(2) });

        expect(onComplete).not.toHaveBeenCalled();
        expect(selectedDots()).toEqual([]);
    });

    it('clears on Escape without completing', () => {
        renderGrid();
        draw(getSvg(), [0, 1, 2], { release: false });

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onComplete).not.toHaveBeenCalled();
        expect(selectedDots()).toEqual([]);
    });

    it('clears when the tab is hidden', () => {
        renderGrid();
        draw(getSvg(), [0, 1, 2], { release: false });

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
        });
        fireEvent(document, new Event('visibilitychange'));

        expect(selectedDots()).toEqual([]);
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });
    });

    it('does not complete a stroke that outlives unmount', () => {
        const { unmount } = renderGrid();
        draw(getSvg(), [0, 1, 2], { release: false });

        unmount();

        expect(onComplete).not.toHaveBeenCalled();
    });
});

describe('disabled state', () => {
    it('rejects new input while disabled', () => {
        renderGrid({ disabled: true });
        draw(getSvg(), [0, 1, 2]);

        expect(onComplete).not.toHaveBeenCalled();
        expect(selectedDots()).toEqual([]);
    });

    it('drops an in-progress stroke when it becomes disabled mid-draw', () => {
        const { rerender } = renderGrid();
        draw(getSvg(), [0, 1, 2], { release: false });

        rerender(
            <GesturePattern
                mode="enroll"
                ariaLabel="Gesture grid"
                onComplete={onComplete}
                disabled
            />
        );

        expect(selectedDots()).toEqual([]);
        expect(onComplete).not.toHaveBeenCalled();
    });
});

describe('accessibility', () => {
    it('exposes a labelled group described by its instructions', () => {
        renderGrid({ instructions: 'Press and hold to draw.' });

        const group = screen.getByRole('group', { name: 'Gesture grid' });
        const describedBy = group.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)?.textContent).toBe(
            'Press and hold to draw.'
        );
    });

    it('announces parent messages through a polite live region', () => {
        renderGrid({ liveMessage: 'Incorrect gesture. 2 attempts remaining.' });

        const live = screen.getByTestId('gesture-live-region');
        expect(live.getAttribute('aria-live')).toBe('polite');
        expect(live.textContent).toBe('Incorrect gesture. 2 attempts remaining.');
    });

    it('does not make the nine dots individually focusable', () => {
        renderGrid();

        // Nine silent tab stops would make the form worse without offering a
        // coherent keyboard drawing interaction.
        for (let index = 0; index < 9; index += 1) {
            expect(
                screen.getByTestId(`gesture-dot-${index}`).hasAttribute('tabindex')
            ).toBe(false);
        }
    });

    it('reflects a parent-reported error outcome', () => {
        renderGrid({ outcome: 'error', liveMessage: 'Incorrect gesture.' });

        expect(screen.getByTestId('gesture-pattern').getAttribute('data-outcome')).toBe('error');
        expect(screen.getByTestId('gesture-live-region').textContent).toBe('Incorrect gesture.');
    });

    it('announces a parent message without drawing it a second time', () => {
        renderGrid({ outcome: 'error', liveMessage: 'Incorrect gesture. 2 attempts remaining.' });

        // The parent already shows this in its own alert. Drawing it here too
        // put two identical warnings under the grid.
        const live = screen.getByTestId('gesture-live-region');
        expect(live.getAttribute('data-rendered')).toBe('false');
        expect(live.textContent).toBe('Incorrect gesture. 2 attempts remaining.');
    });

    it('draws its own validation message, which the parent never sees', () => {
        renderGrid();
        draw(getSvg(), [0, 4]);

        // onComplete is not called for a too-short draw, so nothing else can
        // render this for us.
        const live = screen.getByTestId('gesture-live-region');
        expect(live.getAttribute('data-rendered')).toBe('true');
        expect(live.textContent).toBe('Draw a gesture connecting at least 3 dots.');
    });
});
