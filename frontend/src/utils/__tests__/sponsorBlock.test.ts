import { describe, expect, it } from 'vitest';
import type { SponsorSegment } from '../../types';
import { buildSkipPlan, decideSkip, type SkipRange } from '../sponsorBlock';

const segment = (overrides: Partial<SponsorSegment> = {}): SponsorSegment => ({
    uuid: 'u1',
    category: 'sponsor',
    actionType: 'skip',
    start: 10,
    end: 20,
    videoDuration: 0,
    ...overrides,
});
const plan = (
    segments: SponsorSegment[],
    categories = { sponsor: 'auto' as const },
    options = { duration: 100, autoSkip: true }
) => buildSkipPlan(segments, categories, options);

describe('buildSkipPlan', () => {
    it('keeps only skip segments of categories that are not off', () => {
        const result = plan(
            [
                segment({ uuid: 'sponsor' }),
                segment({ uuid: 'intro', category: 'intro', start: 0, end: 5 }),
                segment({ uuid: 'muted', actionType: 'mute', start: 30, end: 40 }),
                segment({ uuid: 'highlight', category: 'poi_highlight', actionType: 'poi', start: 50, end: 50 }),
            ],
            { sponsor: 'auto', intro: 'off' } as never
        );
        expect(result.ranges.map((range) => range.uuids)).toEqual([['sponsor']]);
        expect(result.bands).toHaveLength(1);
    });

    it('turns automatic categories into skip buttons when this device paused auto-skip', () => {
        const result = plan([segment()], { sponsor: 'auto' }, { duration: 100, autoSkip: false });
        expect(result.ranges[0].mode).toBe('manual');
    });

    it('merges back-to-back segments of one mode into a single jump', () => {
        const result = plan(
            [
                segment({ uuid: 'a', start: 10, end: 20 }),
                segment({ uuid: 'b', category: 'selfpromo', start: 20.1, end: 30 }),
                segment({ uuid: 'c', start: 31, end: 40 }),
            ],
            { sponsor: 'auto', selfpromo: 'auto' } as never
        );
        expect(result.ranges.map(({ key, start, end, categories }) => ({ key, start, end, categories }))).toEqual([
            { key: 'a|b', start: 10, end: 30, categories: ['sponsor', 'selfpromo'] },
            { key: 'c', start: 31, end: 40, categories: ['sponsor'] },
        ]);
    });

    it('drops ranges too short to be worth a seek but still paints them', () => {
        const result = plan([segment({ start: 10, end: 10.3 })]);
        expect(result.ranges).toEqual([]);
        expect(result.bands).toHaveLength(1);
    });

    it('marks a range that reaches the end so the skip can end playback', () => {
        const result = plan([segment({ start: 90, end: 99.9 })]);
        expect(result.ranges[0].toEnd).toBe(true);
        expect(plan([segment({ start: 50, end: 60 })]).ranges[0].toEnd).toBe(false);
    });

    it('clamps segments that run past the end of the file', () => {
        const result = plan([segment({ start: 95, end: 130 })]);
        expect(result.ranges[0]).toMatchObject({ start: 95, end: 100, toEnd: true });
    });

    describe('when the file length disagrees with SponsorBlock', () => {
        it('uses nothing if every known duration is off (the file was trimmed)', () => {
            const result = plan([
                segment({ uuid: 'a', videoDuration: 130 }),
                segment({ uuid: 'b', start: 40, end: 50, videoDuration: 0 }),
            ]);
            expect(result).toMatchObject({ ranges: [], bands: [], durationMismatch: true });
        });

        it('keeps matching and unknown-duration segments and drops stale ones', () => {
            const result = plan([
                segment({ uuid: 'match', videoDuration: 101.5 }),
                segment({ uuid: 'stale', start: 40, end: 50, videoDuration: 140 }),
                segment({ uuid: 'unknown', start: 60, end: 70, videoDuration: 0 }),
            ]);
            expect(result.durationMismatch).toBe(false);
            expect(result.ranges.map((range) => range.key)).toEqual(['match', 'unknown']);
        });

        it('trusts segments when no duration is known', () => {
            expect(plan([segment({ videoDuration: 0 })]).ranges).toHaveLength(1);
        });
    });

    it('plans nothing until the duration is known', () => {
        expect(plan([segment()], { sponsor: 'auto' }, { duration: Number.NaN, autoSkip: true }).ranges).toEqual([]);
        expect(plan([segment()], { sponsor: 'auto' }, { duration: 0, autoSkip: true }).ranges).toEqual([]);
    });
});

describe('decideSkip', () => {
    const auto: SkipRange = {
        key: 'a', uuids: ['a'], categories: ['sponsor'], start: 10, end: 20, mode: 'auto', toEnd: false,
    };
    const manual: SkipRange = { ...auto, key: 'm', uuids: ['m'], categories: ['intro'], start: 30, end: 40, mode: 'manual' };
    const free = { isHandled: () => false, isUndone: () => false };

    it('skips when playback walks into an automatic range', () => {
        expect(decideSkip([auto], { time: 10.2, previousTime: 9.9, natural: true }, free)).toEqual({ kind: 'skip', range: auto });
    });

    it('skips when the playhead lands at the start of one', () => {
        expect(decideSkip([auto], { time: 10.1, previousTime: 3, natural: false }, free).kind).toBe('skip');
    });

    it('only offers a button when the viewer lands in the middle', () => {
        expect(decideSkip([auto], { time: 15, previousTime: 3, natural: false }, free)).toEqual({ kind: 'prompt', range: auto });
        // Playing on from there is not walking in.
        expect(decideSkip([auto], { time: 15.25, previousTime: 15, natural: true }, free).kind).toBe('prompt');
    });

    it('offers a button for manual and undone ranges', () => {
        expect(decideSkip([manual], { time: 30.1, previousTime: 29.9, natural: true }, free).kind).toBe('prompt');
        const undone = { ...free, isUndone: () => true };
        expect(decideSkip([auto], { time: 10.1, previousTime: 9.9, natural: true }, undone).kind).toBe('prompt');
    });

    it('ignores a range the player has just skipped', () => {
        const handled = { ...free, isHandled: () => true };
        expect(decideSkip([auto], { time: 10.1, previousTime: 3, natural: false }, handled).kind).toBe('none');
    });

    it('does nothing outside every range', () => {
        expect(decideSkip([auto, manual], { time: 25, previousTime: 24.8, natural: true }, free).kind).toBe('none');
    });
});
