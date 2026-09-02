import { Box, useTheme } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    GESTURE_DOT_CENTERS,
    GESTURE_DOT_RADIUS,
    GESTURE_VIEW_BOX,
    dotsAlongSegment,
    findDotAtPoint,
    toViewBoxPoint,
    type Point,
} from '../../utils/gestureGeometry';
import { appendDot, canonicalizePattern } from '../../utils/gesturePattern';

export type GesturePatternOutcome = 'idle' | 'error' | 'success';

export interface GesturePatternProps {
    /**
     * Enrolment flashes an invalid draw long enough to be noticed and redrawn.
     * Verification clears almost immediately: on a login screen the drawn path
     * is a credential, and leaving it on screen is a shoulder-surfing gift.
     */
    mode: 'enroll' | 'verify';
    disabled?: boolean;
    /** Parent-driven result styling, e.g. a wrong gesture reported by the server. */
    outcome?: GesturePatternOutcome;
    /** Called once per release, only with a pattern that passes validation. */
    onComplete: (pattern: number[]) => void;
    ariaLabel: string;
    /** Visible instructions, referenced by aria-describedby. */
    instructions?: string;
    /** Parent announcements: step, attempts remaining, lock, success. */
    liveMessage?: string;
    /** Announced when a draw is released with fewer than three dots. */
    minimumDotsMessage?: string;
}

const ERROR_FLASH_MS = { enroll: 600, verify: 200 } as const;

const GesturePatternSurface: React.FC<GesturePatternProps> = ({
    mode,
    disabled = false,
    outcome = 'idle',
    onComplete,
    ariaLabel,
    instructions,
    liveMessage,
    minimumDotsMessage,
}) => {
    const theme = useTheme();
    const svgRef = useRef<SVGSVGElement | null>(null);
    // The stroke is driven from refs so coalesced pointer samples inside one
    // handler all see the dots added by their predecessors; state only mirrors
    // it for rendering.
    const patternRef = useRef<number[]>([]);
    const lastPointRef = useRef<Point | null>(null);
    const pointerIdRef = useRef<number | null>(null);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [pattern, setPattern] = useState<number[]>([]);
    const [livePoint, setLivePoint] = useState<Point | null>(null);
    const [invalidLength, setInvalidLength] = useState(false);

    const instructionsId = React.useId();
    const effectiveOutcome: GesturePatternOutcome = invalidLength ? 'error' : outcome;

    const clearStroke = useCallback(() => {
        patternRef.current = [];
        lastPointRef.current = null;
        pointerIdRef.current = null;
        setPattern([]);
        setLivePoint(null);
    }, []);

    useEffect(() => () => {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    }, []);

    // A stroke must never survive the surface it was drawn on going away.
    useEffect(() => {
        const abandon = () => {
            if (pointerIdRef.current !== null || patternRef.current.length > 0) {
                clearStroke();
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') abandon();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') abandon();
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', abandon);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', abandon);
        };
    }, [clearStroke]);

    const pointFromEvent = (clientX: number, clientY: number): Point | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        // Read the rect per event: this is what makes resize and orientation
        // changes free, rather than something to recompute and invalidate.
        return toViewBoxPoint(svg.getBoundingClientRect(), clientX, clientY);
    };

    const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
        if (disabled || pointerIdRef.current !== null) return;
        // Secondary pointers and non-primary mouse buttons are not drawing.
        if (!event.isPrimary) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        const point = pointFromEvent(event.clientX, event.clientY);
        if (!point) return;
        const dot = findDotAtPoint(point);
        if (dot === null) return;

        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        setInvalidLength(false);

        pointerIdRef.current = event.pointerId;
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // jsdom and some pens do not implement capture; drawing still works.
        }

        patternRef.current = appendDot([], dot);
        lastPointRef.current = point;
        setPattern(patternRef.current);
        setLivePoint(point);
    };

    const extendTo = (point: Point) => {
        const from = lastPointRef.current;
        if (!from) return;

        const crossed = dotsAlongSegment(from, point, (index) =>
            patternRef.current.includes(index)
        );
        for (const dot of crossed) {
            // appendDot also inserts an Android-style skipped midpoint, so a
            // coarsely sampled curve that misses a dot geometrically is still
            // caught by the collinearity rule.
            patternRef.current = appendDot(patternRef.current, dot);
        }
        lastPointRef.current = point;
    };

    const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        if (pointerIdRef.current === null || event.pointerId !== pointerIdRef.current) {
            return;
        }

        const native = event.nativeEvent;
        const samples =
            typeof native.getCoalescedEvents === 'function'
                ? native.getCoalescedEvents()
                : [native];

        for (const sample of samples.length > 0 ? samples : [native]) {
            const point = pointFromEvent(sample.clientX, sample.clientY);
            if (point) extendTo(point);
        }

        setPattern([...patternRef.current]);
        setLivePoint(lastPointRef.current);
    };

    const finishStroke = (event: React.PointerEvent<SVGSVGElement>, submit: boolean) => {
        if (pointerIdRef.current === null || event.pointerId !== pointerIdRef.current) {
            return;
        }

        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Already released, or never captured.
        }

        const drawn = patternRef.current;
        clearStroke();

        if (!submit || drawn.length === 0) return;

        const canonical = canonicalizePattern(drawn);
        if (!canonical.ok) {
            // Too short to be a gesture. This is validation, not a completed
            // draw: the parent never sees it and no attempt is spent.
            setInvalidLength(true);
            flashTimerRef.current = setTimeout(
                () => setInvalidLength(false),
                ERROR_FLASH_MS[mode]
            );
            return;
        }

        onComplete(canonical.pattern);
    };

    const outcomeColor =
        effectiveOutcome === 'error'
            ? theme.palette.error.main
            : effectiveOutcome === 'success'
              ? theme.palette.success.main
              : theme.palette.primary.main;

    const liveText = invalidLength ? minimumDotsMessage ?? '' : liveMessage ?? '';
    // The parent renders its own messages; only our validation error is ours to draw.
    const showOwnMessage = invalidLength && liveText.length > 0;

    return (
        <Box
            role="group"
            aria-label={ariaLabel}
            aria-describedby={instructions ? instructionsId : undefined}
            data-testid="gesture-pattern"
            data-mode={mode}
            data-outcome={effectiveOutcome}
            sx={{ width: '100%', maxWidth: 320, mx: 'auto' }}
        >
            <Box
                component="svg"
                ref={svgRef}
                viewBox={`0 0 ${GESTURE_VIEW_BOX} ${GESTURE_VIEW_BOX}`}
                role="presentation"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => finishStroke(event, true)}
                onPointerCancel={(event) => finishStroke(event, false)}
                onLostPointerCapture={(event) => finishStroke(event, false)}
                sx={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    display: 'block',
                    borderRadius: 2,
                    // Only the grid opts out of panning, so the page still
                    // scrolls normally everywhere else.
                    touchAction: 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                    outlineOffset: 2,
                    '&:focus-visible': {
                        outline: `2px solid ${theme.palette.primary.main}`,
                    },
                    '@media (prefers-reduced-motion: no-preference)': {
                        transition: 'opacity 120ms ease',
                    },
                }}
            >
                {pattern.slice(0, -1).map((dot, index) => {
                    const from = GESTURE_DOT_CENTERS[dot];
                    const to = GESTURE_DOT_CENTERS[pattern[index + 1]];
                    return (
                        <line
                            key={`${dot}-${pattern[index + 1]}`}
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={outcomeColor}
                            strokeWidth={5}
                            strokeLinecap="round"
                        />
                    );
                })}

                {livePoint && pattern.length > 0 && (
                    <line
                        data-testid="gesture-live-segment"
                        x1={GESTURE_DOT_CENTERS[pattern[pattern.length - 1]].x}
                        y1={GESTURE_DOT_CENTERS[pattern[pattern.length - 1]].y}
                        x2={livePoint.x}
                        y2={livePoint.y}
                        stroke={outcomeColor}
                        strokeWidth={5}
                        strokeLinecap="round"
                        opacity={0.6}
                    />
                )}

                {GESTURE_DOT_CENTERS.map((center, index) => {
                    const selected = pattern.includes(index);
                    return (
                        <circle
                            key={index}
                            data-testid={`gesture-dot-${index}`}
                            data-selected={selected ? 'true' : 'false'}
                            cx={center.x}
                            cy={center.y}
                            r={selected ? GESTURE_DOT_RADIUS + 3 : GESTURE_DOT_RADIUS}
                            fill={selected ? outcomeColor : theme.palette.text.disabled}
                            stroke={selected ? outcomeColor : 'transparent'}
                            strokeWidth={selected ? 8 : 0}
                            strokeOpacity={0.25}
                        />
                    );
                })}
            </Box>

            {instructions && (
                <Box
                    id={instructionsId}
                    sx={{
                        mt: 1,
                        textAlign: 'center',
                        color: 'text.secondary',
                        fontSize: '0.875rem',
                    }}
                >
                    {instructions}
                </Box>
            )}

            {/*
              One announcer, but only one renderer.

              This region always announces, so an error is never carried by
              colour alone. It is only DRAWN for the component's own validation
              (a draw with too few dots), which the parent never hears about
              because onComplete is not called for it. A message that came from
              the parent via liveMessage is already on screen in the parent's
              own alert, so drawing it here too would show the same warning
              twice under the grid.
            */}
            <Box
                aria-live="polite"
                role="status"
                data-testid="gesture-live-region"
                data-rendered={showOwnMessage ? 'true' : 'false'}
                sx={
                    showOwnMessage
                        ? { mt: 1, textAlign: 'center', color: 'error.main', fontSize: '0.875rem' }
                        : {
                              position: 'absolute',
                              width: 1,
                              height: 1,
                              overflow: 'hidden',
                              clip: 'rect(0 0 0 0)',
                              whiteSpace: 'nowrap',
                          }
                }
            >
                {liveText}
            </Box>
        </Box>
    );
};

const GesturePattern: React.FC<GesturePatternProps> = (props) => (
    // Changing disabled state remounts the drawing surface. That immediately
    // discards refs and render state, so an in-flight stroke can never resume
    // after a request finishes.
    <GesturePatternSurface key={props.disabled ? 'disabled' : 'enabled'} {...props} />
);

export default GesturePattern;
