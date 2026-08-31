/**
 * Failure reporting drawn into the playback canvas.
 *
 * Compatibility mode is the only playback path on the car display, so a failure
 * is terminal — there is no other player to hand off to. The message is painted
 * into the canvas that was already showing the video rather than mounted as a
 * DOM overlay, and the canvas keeps whatever backing-store size it already had:
 * the picture must not resize or jump at the moment playback stops.
 */

import { neutral, overlay } from '../../../theme/colors';

export interface FailureNotice {
    title: string;
    detail?: string | null;
    hint?: string | null;
}

/** Backing-store size used before the first frame sets a real one. */
export const INITIAL_CANVAS_WIDTH = 1280;
export const INITIAL_CANVAS_HEIGHT = 720;

const FONT_STACK =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Break `text` into lines that each measure at most `maxWidth`.
 *
 * `measure` is injected so the wrapping can be exercised without a real 2D
 * context. Words longer than `maxWidth` are left on their own line rather than
 * split — codec identifiers and file paths stay readable that way.
 */
export function wrapLines(
    text: string,
    maxWidth: number,
    measure: (line: string) => number
): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return [];
    }

    const lines: string[] = [];
    let current = words[0];

    for (const word of words.slice(1)) {
        const candidate = `${current} ${word}`;
        if (measure(candidate) <= maxWidth) {
            current = candidate;
        } else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);
    return lines;
}

interface Block {
    lines: string[];
    fontSize: number;
    color: string;
    weight: string;
}

/**
 * Paint the notice over the canvas's current contents.
 * Never touches `canvas.width` / `canvas.height`.
 */
export function drawFailureNotice(
    canvas: HTMLCanvasElement,
    notice: FailureNotice
): void {
    const context = canvas.getContext('2d');
    if (!context) {
        return;
    }

    const { width, height } = canvas;
    if (width === 0 || height === 0) {
        return;
    }

    // Type scales with the backing store so the message reads the same whether
    // the canvas is sized for 720p or 4K.
    const unit = Math.max(12, Math.min(width, height) / 24);
    const maxWidth = width * 0.82;

    const blocks: Block[] = [];
    const push = (
        text: string | null | undefined,
        fontSize: number,
        color: string,
        weight: string
    ) => {
        if (!text) return;
        context.font = `${weight} ${fontSize}px ${FONT_STACK}`;
        const lines = wrapLines(text, maxWidth, (line) =>
            context.measureText(line).width
        );
        if (lines.length > 0) {
            blocks.push({ lines, fontSize, color, weight });
        }
    };

    push(notice.title, unit * 1.2, neutral.white, '600');
    push(notice.detail, unit * 0.78, overlay.white70, '400');
    push(notice.hint, unit * 0.72, overlay.white70, '400');

    context.save();
    // Dim whatever was last drawn — the final frame stays faintly visible, so
    // the screen reads as "this stopped" rather than "this went blank".
    context.fillStyle = overlay.black80;
    context.fillRect(0, 0, width, height);

    const lineGap = unit * 0.42;
    const blockGap = unit * 0.7;
    const totalHeight =
        blocks.reduce(
            (sum, block) =>
                sum + block.lines.length * (block.fontSize + lineGap),
            0
        ) +
        Math.max(0, blocks.length - 1) * blockGap;

    context.textAlign = 'center';
    context.textBaseline = 'top';
    let y = (height - totalHeight) / 2;

    for (const block of blocks) {
        context.font = `${block.weight} ${block.fontSize}px ${FONT_STACK}`;
        context.fillStyle = block.color;
        for (const line of block.lines) {
            context.fillText(line, width / 2, y);
            y += block.fontSize + lineGap;
        }
        y += blockGap;
    }

    context.restore();
}
