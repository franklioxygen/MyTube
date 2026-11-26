import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { SponsorSegment } from '../../../../../types';
import type { SponsorBlockCategorySettings } from '../../../../../utils/sponsorBlock';
import { SKIPPED_NOTICE_MS, useSponsorSkip } from '../useSponsorSkip';

/** Just enough of a media element for the engine, driven by hand. */
class FakeMedia extends EventTarget {
    currentTime = 0;
    seeking = false;
    paused = false;
    playbackRate = 1;
    duration = 100;
    playedRanges: Array<[number, number]> = [];
    get played() {
        const ranges = this.playedRanges;
        return { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] };
    }
}

const sponsor = (overrides: Partial<SponsorSegment> = {}): SponsorSegment => ({
    uuid: 'sponsor-1', category: 'sponsor', actionType: 'skip', start: 10, end: 20, videoDuration: 0, ...overrides,
});

let media: FakeMedia;
let skipTo: Mock<(time: number, options?: { toEnd?: boolean }) => void>;
let restoring: boolean;

const emit = (type: string) => act(() => { media.dispatchEvent(new Event(type)); });
/** One timeupdate after `ms` of playback at `time`. */
const tick = (time: number, ms = 250) => {
    act(() => { vi.advanceTimersByTime(ms); });
    media.currentTime = time;
    emit('timeupdate');
};
/** A seek the way browsers report one: seeking first, seeked later. */
const seek = (time: number) => {
    media.seeking = true;
    media.currentTime = time;
    emit('timeupdate');
    media.seeking = false;
    emit('seeked');
};

function setup(
    segments: SponsorSegment[] | undefined = [sponsor()],
    options: { categories?: SponsorBlockCategorySettings; autoSkip?: boolean; resetKey?: string } = {}
) {
    const mediaRef = { current: media };
    return renderHook(
        (props: { segments?: SponsorSegment[]; resetKey: string }) =>
            useSponsorSkip({
                mediaRef,
                segments: props.segments,
                categories: options.categories ?? { sponsor: 'auto' },
                autoSkip: options.autoSkip ?? true,
                duration: media.duration,
                isDragging: false,
                resetKey: props.resetKey,
                skipTo,
                isStartTimeRestorePending: () => restoring,
            }),
        { initialProps: { segments, resetKey: options.resetKey ?? 'video-a' } }
    );
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    media = new FakeMedia();
    restoring = false;
    // Like the real player: the seek starts at once and lands when the test says.
    skipTo = vi.fn((time: number, options?: { toEnd?: boolean }) => {
        media.seeking = true;
        media.currentTime = options?.toEnd ? media.duration : time;
    });
});
afterEach(() => {
    vi.useRealTimers();
});

const land = () => {
    media.seeking = false;
    emit('seeked');
};

describe('useSponsorSkip', () => {
    it('skips a range when playback walks into it and offers undo', () => {
        const { result } = setup();
        tick(9.5);
        tick(9.75);
        tick(10.0);
        expect(skipTo).toHaveBeenCalledExactlyOnceWith(20, { toEnd: false });
        expect(result.current.notice).toMatchObject({ skipped: { key: 'sponsor-1' } });
        // The S key undoes it.
        act(() => result.current.shortcut?.());
        expect(skipTo).toHaveBeenLastCalledWith(10);
    });

    it('never reacts to its own seek', () => {
        const { result } = setup();
        tick(9.75);
        tick(10.1);
        // Safari can report the old position, not seeking, before the seek lands.
        media.seeking = false;
        media.currentTime = 10.1;
        emit('timeupdate');
        expect(result.current.notice?.skipped?.key).toBe('sponsor-1');
        media.currentTime = 20;
        land();
        tick(20.25);
        expect(skipTo).toHaveBeenCalledTimes(1);
    });

    it('only offers a button when the viewer seeks into the middle', () => {
        const { result } = setup();
        tick(5);
        tick(5.25);
        seek(15);
        tick(15.25);
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.notice).toMatchObject({ prompt: { key: 'sponsor-1' } });
        act(() => result.current.skipNow());
        expect(skipTo).toHaveBeenCalledWith(20, { toEnd: false });
    });

    it('does not count a sample taken after seeking flipped but before the event', () => {
        const { result } = setup();
        tick(9.5);
        tick(9.75);
        // A short seek into the middle looks like one playback step by size alone.
        act(() => { vi.advanceTimersByTime(100); });
        media.seeking = true;
        media.currentTime = 10.7;
        emit('timeupdate');
        media.seeking = false;
        tick(10.8, 100);
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.notice?.prompt?.key).toBe('sponsor-1');
    });

    it('counts a seek reported only by its seeking event as a seek', () => {
        const { result } = setup();
        tick(9.5);
        tick(9.75);
        // A buffered seek can finish before anything is sampled mid-seek.
        act(() => { vi.advanceTimersByTime(100); });
        media.currentTime = 10.7;
        emit('seeking');
        emit('timeupdate');
        emit('seeked');
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.notice?.prompt?.key).toBe('sponsor-1');
    });

    it('skips an intro at 0 when playback starts there', () => {
        setup([sponsor({ uuid: 'intro', category: 'intro', start: 0, end: 30 })], { categories: { intro: 'auto' } });
        emit('play');
        expect(skipTo).toHaveBeenCalledWith(30, { toEnd: false });
    });

    it('skips once playing resumes after the viewer jumped to a start while paused', () => {
        setup();
        tick(50);
        media.paused = true;
        seek(10);
        expect(skipTo).not.toHaveBeenCalled();
        media.paused = false;
        emit('play');
        expect(skipTo).toHaveBeenCalledWith(20, { toEnd: false });
    });

    it('does not skip a range again after the viewer undid it', () => {
        const { result } = setup();
        tick(9.75);
        tick(10.1);
        land();
        act(() => result.current.undo());
        expect(skipTo).toHaveBeenLastCalledWith(10);
        land();
        tick(10.25);
        tick(10.5);
        expect(skipTo).toHaveBeenCalledTimes(2);
        expect(result.current.notice?.prompt?.key).toBe('sponsor-1');
    });

    it('forgets undone ranges when another video loads', () => {
        const { result, rerender } = setup();
        tick(9.75);
        tick(10.1);
        land();
        act(() => result.current.undo());
        land();
        rerender({ segments: [sponsor()], resetKey: 'video-b' });
        expect(result.current.notice).toBeNull();
        seek(5);
        tick(5.25);
        tick(10.0);
        expect(skipTo).toHaveBeenCalledTimes(3);
    });

    it('does not bring back an Undo after switching to another video and back', () => {
        const { result, rerender } = setup();
        tick(9.75);
        tick(10.1);
        land();
        expect(result.current.notice?.skipped?.key).toBe('sponsor-1');
        rerender({ segments: [], resetKey: 'video-b' });
        rerender({ segments: [sponsor()], resetKey: 'video-a' });
        expect(result.current.notice).toBeNull();
    });

    it('keeps Undo when a skip lands inside a range shown as a button', () => {
        const { result } = setup(
            [sponsor({ start: 50, end: 60 }), sponsor({ uuid: 'outro-1', category: 'outro', start: 60, end: 80 })],
            { categories: { sponsor: 'auto', outro: 'manual' } }
        );
        tick(49.75);
        tick(50.1);
        land();
        expect(result.current.notice).toMatchObject({ skipped: { key: 'sponsor-1' }, prompt: { key: 'outro-1' } });
        // With both up, the S key takes the button rather than the Undo.
        expect(result.current.shortcut).toBe(result.current.skipNow);
        // Undo is offered for its usual time; the button stays while inside.
        act(() => { vi.advanceTimersByTime(SKIPPED_NOTICE_MS); });
        expect(result.current.notice?.skipped).toBeUndefined();
        expect(result.current.notice?.prompt?.key).toBe('outro-1');
    });

    it('skips a range that reaches the end all the way to the end', () => {
        setup([sponsor({ start: 90, end: 100 })]);
        tick(89.75);
        tick(90.0);
        expect(skipTo).toHaveBeenCalledWith(100, { toEnd: true });
    });

    it('leaves the playhead alone while a resume position is being applied', () => {
        setup();
        restoring = true;
        seek(10);
        emit('play');
        tick(10.25);
        expect(skipTo).not.toHaveBeenCalled();
    });

    it('treats segments that arrive mid-playback as walked into when playback ran through the start', () => {
        const { rerender } = setup([]);
        media.playedRanges = [[0, 12]];
        rerender({ segments: [sponsor()], resetKey: 'video-a' });
        tick(12);
        expect(skipTo).toHaveBeenCalledWith(20, { toEnd: false });
    });

    it('does not skip when playback resumed inside the range before segments arrived', () => {
        const { result, rerender } = setup([]);
        media.playedRanges = [[15, 16]];
        rerender({ segments: [sponsor()], resetKey: 'video-a' });
        tick(16);
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.notice?.prompt?.key).toBe('sponsor-1');
    });

    it('does not take earlier playback for the current run when segments arrive late', () => {
        const { result, rerender } = setup([]);
        tick(17.75);
        tick(18);
        // Played through 18, then back to 15: played still reads one range from 0.
        seek(15);
        media.playedRanges = [[0, 18]];
        rerender({ segments: [sponsor()], resetKey: 'video-a' });
        tick(15.25);
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.notice?.prompt?.key).toBe('sponsor-1');
    });

    it('shows only a button when this device paused automatic skipping', () => {
        const { result } = setup([sponsor()], { autoSkip: false });
        tick(9.75);
        tick(10.1);
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.notice?.prompt?.key).toBe('sponsor-1');
    });

    it('hides the skipped notice after a few seconds', () => {
        const { result } = setup();
        tick(9.75);
        tick(10.1);
        land();
        act(() => { vi.advanceTimersByTime(SKIPPED_NOTICE_MS); });
        expect(result.current.notice).toBeNull();
    });

    it('does nothing without segments', () => {
        const { result } = setup([]);
        emit('play');
        tick(10.1);
        expect(skipTo).not.toHaveBeenCalled();
        expect(result.current.plan.ranges).toEqual([]);
        expect(result.current.shortcut).toBeUndefined();
    });
});
