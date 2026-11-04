export interface DanmakuEvent {
    time: number;
    text: string;
    mode: 'scroll' | 'top' | 'bottom';
    color: string;
    fontSize: number;
}
export interface DanmakuTrack {
    status: 'none' | 'ready' | 'empty' | 'error';
    loading: boolean;
    revision?: string;
    eventCount: number;
    ignoredCount: number;
    lastError?: string;
}

export interface DanmakuPlacement extends DanmakuEvent { end: number; lane: number; width: number }

// Below this much room the settings popover cannot show its header and display controls.
const MIN_PANEL_ROOM = 280;
// The viewport margin MUI keeps around a popover, plus the gap to its trigger.
const PANEL_INSET = 24;

/**
 * Where the settings popover opens relative to its trigger. Below is preferred because it keeps
 * the picture in view while adjusting it; fullscreen controls sit at the screen edge and leave no
 * room there. The height is capped to the chosen side so the panel never covers its trigger.
 */
export function danmakuPanelPlacement(anchorTop: number, anchorBottom: number, viewportHeight: number) {
    const below = viewportHeight - anchorBottom;
    const opensUp = below < MIN_PANEL_ROOM && anchorTop > below;
    return { opensUp, maxHeight: (opensUp ? anchorTop : below) - PANEL_INSET };
}

/** Allocate bounded, non-overlapping lanes once per viewport/track, using content time. */
export function layoutDanmaku(events: DanmakuEvent[], width: number, height: number,
    measure: (text: string, size: number) => number): DanmakuPlacement[] {
    const lanes = Math.min(10, Math.max(1, Math.floor(height * 0.6 / 32) - 2));
    const scroll: Array<DanmakuPlacement | undefined> = Array(lanes);
    const fixed = { top: [0], bottom: [0] };
    const result: DanmakuPlacement[] = [];
    // A small screen and dense source must not make preprocessing or rendering unbounded.
    for (const event of events.slice(0, 100_000)) {
        const fontSize = Math.min(28, Math.max(14, event.fontSize));
        const textWidth = Math.min(width * 2, measure(event.text, fontSize));
        const duration = event.mode === 'scroll' ? 8 : 4;
        let lane: number;
        if (event.mode === 'scroll') {
            const speed = (width + textWidth) / duration;
            lane = scroll.findIndex(previous => {
                if (!previous || previous.end <= event.time) return true;
                const previousSpeed = (width + previous.width) / 8;
                const elapsed = event.time - previous.time;
                const gap = previousSpeed * elapsed - previous.width;
                // New text must enter behind its predecessor and never catch it before exit.
                return gap > 20 && (speed <= previousSpeed || gap - 20 >= (speed - previousSpeed) * (previous.end - event.time));
            });
        } else {
            lane = fixed[event.mode].findIndex(end => end <= event.time);
        }
        if (lane < 0) continue;
        const placed = { ...event, fontSize, width: textWidth, lane, end: event.time + duration };
        result.push(placed);
        if (event.mode === 'scroll') scroll[lane] = placed;
        else fixed[event.mode][lane] = placed.end;
    }
    return result;
}

/** Binary search avoids scanning a long video's entire timeline on every animation frame. */
export function visibleDanmaku(events: DanmakuPlacement[], time: number): DanmakuPlacement[] {
    let low = 0, high = events.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (events[middle].time < time - 8) low = middle + 1;
        else high = middle;
    }
    const visible: DanmakuPlacement[] = [];
    for (let index = low; index < events.length && events[index].time <= time; index++) {
        if (events[index].end > time) visible.push(events[index]);
        if (visible.length >= 36) break;
    }
    return visible;
}
