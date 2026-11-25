import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SponsorSegment } from '../../../../types';
import {
    buildSkipPlan,
    decideSkip,
    EMPTY_SKIP_PLAN,
    type SkipRange,
    type SponsorBlockCategorySettings,
    type SponsorSkipPlan,
} from '../../../../utils/sponsorBlock';

/** How long "Skipped · Undo" stays up. */
export const SKIPPED_NOTICE_MS = 5000;
// A playback sample counts as playing on only when it moved forward by about
// what the elapsed time allows at the current rate; useVideoProgress uses the
// same rule. Throttled timers deliver late samples, hence the floor and slack.
const BASE_STEP_SECONDS = 1;
const STEP_SLACK_SECONDS = 0.5;
const SAMPLED_EVENTS = ['timeupdate', 'seeked', 'play'] as const;

/**
 * What the player shows over the picture. Both parts can be up at once: a
 * skip that lands inside a manual range (sponsor, then an outro shown as a
 * button) must still offer Undo for the skip.
 */
export type SponsorSkipNotice = {
    /** The last automatic or manual skip, undoable for a few seconds. */
    skipped?: SkipRange;
    /** A range the playhead is in that can be skipped by hand. */
    prompt?: SkipRange;
} | null;

const withNotice = (skipped?: SkipRange, prompt?: SkipRange): SponsorSkipNotice =>
    skipped || prompt ? { skipped, prompt } : null;

interface UseSponsorSkipOptions {
    videoRef: RefObject<HTMLVideoElement | null>;
    segments?: readonly SponsorSegment[];
    categories: SponsorBlockCategorySettings;
    /** The per-device switch; off turns automatic categories into skip buttons. */
    autoSkip: boolean;
    duration: number;
    isDragging: boolean;
    /** Changes when another video loads; skip and undo state start over. */
    resetKey: string;
    skipTo?: (time: number, options?: { toEnd?: boolean }) => void;
    isStartTimeRestorePending?: () => boolean;
}

/**
 * The position we "came from" when there is no earlier sample, typically
 * because segments arrived after playback started. If the played range we are
 * in began at or before a range's start, playback walked into it; if it began
 * inside (a resume, a seek), it did not.
 */
function playedRunStart(video: HTMLVideoElement, time: number): number | null {
    const played = video.played;
    if (!played) return null;
    for (let index = 0; index < played.length; index += 1) {
        if (played.start(index) <= time && time <= played.end(index) + STEP_SLACK_SECONDS) {
            return played.start(index);
        }
    }
    return null;
}

/**
 * Skips SponsorBlock ranges during playback (issue #555). It watches the media
 * element itself and seeks through skipTo, so a skip is an ordinary seek to
 * everything else (progress, statistics, live translation). Does nothing when
 * there are no segments.
 */
export function useSponsorSkip({
    videoRef,
    segments,
    categories,
    autoSkip,
    duration,
    isDragging,
    resetKey,
    skipTo,
    isStartTimeRestorePending,
}: UseSponsorSkipOptions): {
    plan: SponsorSkipPlan;
    notice: SponsorSkipNotice;
    undo: () => void;
    skipNow: () => void;
} {
    const plan = useMemo(
        () =>
            segments && segments.length > 0
                ? buildSkipPlan(segments, categories, { duration, autoSkip })
                : EMPTY_SKIP_PLAN,
        [segments, categories, duration, autoSkip]
    );
    const hasRanges = plan.ranges.length > 0;

    // The notice belongs to the video it was raised for: another video, or no
    // ranges left, shows none without an effect having to clear it.
    const resetKeyRef = useRef(resetKey);
    const [noticeState, setNoticeState] = useState<{ owner: string; notice: SponsorSkipNotice }>(
        () => ({ owner: resetKey, notice: null })
    );
    const notice = hasRanges && noticeState.owner === resetKey ? noticeState.notice : null;
    const setNotice = useCallback(
        (update: SponsorSkipNotice | ((current: SponsorSkipNotice) => SponsorSkipNotice)) => {
            setNoticeState((state) => {
                const owner = resetKeyRef.current;
                const current = state.owner === owner ? state.notice : null;
                const next = typeof update === 'function' ? update(current) : update;
                return state.owner === owner && next === current ? state : { owner, notice: next };
            });
        },
        []
    );

    // Keyed by segment UUID and range key, so rebuilding the plan (duration
    // settles, the device switch flips) keeps what the viewer did.
    const undoneRef = useRef(new Set<string>());
    const handledRef = useRef(new Set<string>());
    const previousTimeRef = useRef<number | null>(null);
    const previousAtRef = useRef(0);
    const seekPendingRef = useRef(false);

    const latestRef = useRef({ plan, isDragging, skipTo, isStartTimeRestorePending });
    useEffect(() => {
        latestRef.current = { plan, isDragging, skipTo, isStartTimeRestorePending };
    }, [plan, isDragging, skipTo, isStartTimeRestorePending]);

    useEffect(() => {
        resetKeyRef.current = resetKey;
        undoneRef.current.clear();
        handledRef.current.clear();
        previousTimeRef.current = null;
        seekPendingRef.current = false;
    }, [resetKey]);

    const performSkip = useCallback((range: SkipRange) => {
        const seek = latestRef.current.skipTo;
        if (!seek) return;
        // Handled until the playhead leaves it, so a sample from before our
        // seek lands (Safari can report the old position) cannot skip it again.
        handledRef.current.add(range.key);
        previousTimeRef.current = null;
        seek(range.end, { toEnd: range.toEnd });
        // Where the skip lands decides the prompt; the next sample sets it.
        setNotice(withNotice(range));
    }, [setNotice]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !hasRanges) return;

        const isHandled = (range: SkipRange) => handledRef.current.has(range.key);
        const isUndone = (range: SkipRange) =>
            range.uuids.some((uuid) => undoneRef.current.has(uuid));

        const sample = (event: Event) => {
            const { plan: currentPlan, isDragging: dragging, isStartTimeRestorePending: restoring } =
                latestRef.current;
            const now = performance.now();
            if (dragging || restoring?.()) {
                previousTimeRef.current = null;
                return;
            }
            // `seeking` flips as soon as currentTime is written, while the
            // event is still queued: a sample in between is not playback.
            if (video.seeking) {
                seekPendingRef.current = true;
                return;
            }

            const time = video.currentTime;
            let previousTime = previousTimeRef.current;
            let natural = false;
            if (event.type === 'timeupdate' && !seekPendingRef.current) {
                if (previousTime === null) {
                    const runStart = playedRunStart(video, time);
                    if (runStart !== null) {
                        // Just before the run, so a range starting with it counts as walked into.
                        previousTime = runStart - 0.001;
                        natural = true;
                    }
                } else {
                    const step = time - previousTime;
                    const elapsed = (now - previousAtRef.current) / 1000;
                    const maxStep = Math.max(
                        BASE_STEP_SECONDS,
                        elapsed * video.playbackRate + STEP_SLACK_SECONDS
                    );
                    natural = step >= 0 && step <= maxStep;
                }
            }
            seekPendingRef.current = false;
            previousTimeRef.current = time;
            previousAtRef.current = now;

            // Leaving a range makes it skippable again: seeking back before it, a loop.
            for (const key of handledRef.current) {
                const range = currentPlan.ranges.find((item) => item.key === key);
                if (!range || time < range.start || time >= range.end) handledRef.current.delete(key);
            }

            const decision = decideSkip(
                currentPlan.ranges,
                { time, previousTime, natural },
                { isHandled, isUndone }
            );
            if (decision.kind === 'skip' && !video.paused) {
                performSkip(decision.range);
                return;
            }
            // Only the prompt follows the playhead; an undoable skip stays up.
            const prompt = decision.kind === 'prompt' ? decision.range : undefined;
            setNotice((current) =>
                current?.prompt?.key === prompt?.key ? current : withNotice(current?.skipped, prompt)
            );
        };

        for (const type of SAMPLED_EVENTS) video.addEventListener(type, sample);
        return () => {
            for (const type of SAMPLED_EVENTS) video.removeEventListener(type, sample);
        };
    }, [videoRef, hasRanges, performSkip, setNotice]);

    const skipped = notice?.skipped;
    useEffect(() => {
        if (!skipped) return;
        const timer = window.setTimeout(() => {
            setNotice((current) =>
                current?.skipped === skipped ? withNotice(undefined, current.prompt) : current
            );
        }, SKIPPED_NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [skipped, setNotice]);

    const undo = useCallback(() => {
        if (!skipped) return;
        for (const uuid of skipped.uuids) undoneRef.current.add(uuid);
        handledRef.current.delete(skipped.key);
        previousTimeRef.current = null;
        latestRef.current.skipTo?.(skipped.start);
        // Landing back at the start raises this range's own skip button.
        setNotice(null);
    }, [skipped, setNotice]);

    const prompt = notice?.prompt;
    const skipNow = useCallback(() => {
        if (prompt) performSkip(prompt);
    }, [prompt, performSkip]);

    return { plan, notice, undo, skipNow };
}
