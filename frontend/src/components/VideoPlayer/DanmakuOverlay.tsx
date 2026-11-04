import { useEffect, useRef } from 'react';
import { layoutDanmaku, visibleDanmaku, type DanmakuEvent } from '../../utils/danmaku';

interface Props {
    events: DanmakuEvent[];
    getTime: () => number;
    opacity: number;
    offset: number;
}

/** Paint plain text against the player's live clock; pausing, seeking and rate changes share that clock. */
export default function DanmakuOverlay({ events, getTime, opacity, offset }: Props) {
    const ref = useRef<HTMLCanvasElement>(null);
    // Read through refs so adjusting these never repeats the track layout, which can cover 100,000 comments.
    const timeRef = useRef(getTime);
    const opacityRef = useRef(opacity);
    const offsetRef = useRef(offset);
    useEffect(() => {
        timeRef.current = getTime;
        opacityRef.current = opacity;
        offsetRef.current = offset;
    }, [getTime, opacity, offset]);
    useEffect(() => {
        const canvas = ref.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        let frame = 0;
        let width = 0, height = 0;
        let previousTime = NaN;
        let previousOpacity = NaN;
        let placed: ReturnType<typeof layoutDanmaku> = [];
        const resize = () => {
            const bounds = canvas.getBoundingClientRect();
            width = bounds.width; height = bounds.height;
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            placed = layoutDanmaku(events, width, height, (text, size) => {
                context.font = `600 ${size}px sans-serif`;
                return context.measureText(text).width;
            });
            previousTime = NaN;
        };
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
        observer?.observe(canvas);
        if (!observer) window.addEventListener('resize', resize);
        resize();
        const draw = () => {
            const time = timeRef.current() - offsetRef.current;
            const alpha = opacityRef.current;
            // A paused player's clock stands still, but a new opacity must still repaint.
            if (time === previousTime && alpha === previousOpacity) { frame = requestAnimationFrame(draw); return; }
            previousTime = time;
            previousOpacity = alpha;
            context.clearRect(0, 0, width, height);
            context.globalAlpha = alpha;
            context.textBaseline = 'top';
            context.textAlign = 'left';
            context.direction = 'ltr';
            context.lineWidth = 3;
            context.strokeStyle = '#000';
            for (const event of visibleDanmaku(placed, time)) {
                context.font = `600 ${event.fontSize}px sans-serif`;
                const x = event.mode === 'scroll' ? width - (time - event.time) * (width + event.width) / 8 : (width - event.width) / 2;
                const y = event.mode === 'bottom' ? height * 0.8 - 32 : event.mode === 'top' ? 8 : 40 + event.lane * 32;
                context.fillStyle = event.color;
                context.strokeText(event.text, x, y, width * 2);
                context.fillText(event.text, x, y, width * 2);
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', resize); context.clearRect(0, 0, width, height); };
    }, [events]);
    return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }} />;
}
