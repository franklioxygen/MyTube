import { sponsorBlockCategory } from '../theme/colors';
import type {
    Settings,
    SponsorBlockCategory,
    SponsorBlockMode,
    SponsorSegment,
} from '../types';
import type { TranslationKey } from './translations';

/**
 * Playback-time SponsorBlock skipping (issue #555): which segments to skip,
 * show or ignore for one file, and when the player should act on them. Pure
 * functions only; the media element side lives in useSponsorSkip.
 */

/** Keep in sync with SPONSORBLOCK_CATEGORIES in backend/src/types/settings.ts. */
export const SPONSORBLOCK_CATEGORIES: readonly SponsorBlockCategory[] = [
    'sponsor',
    'selfpromo',
    'interaction',
    'intro',
    'outro',
    'preview',
    'hook',
    'music_offtopic',
    'filler',
];

export type SponsorBlockCategorySettings = Partial<Record<SponsorBlockCategory, SponsorBlockMode>>;

export const DEFAULT_SPONSORBLOCK_CATEGORIES: SponsorBlockCategorySettings = { sponsor: 'auto' };

export const SPONSORBLOCK_CATEGORY_LABEL_KEYS: Record<SponsorBlockCategory, TranslationKey> = {
    sponsor: 'sponsorBlockCategorySponsor',
    selfpromo: 'sponsorBlockCategorySelfpromo',
    interaction: 'sponsorBlockCategoryInteraction',
    intro: 'sponsorBlockCategoryIntro',
    outro: 'sponsorBlockCategoryOutro',
    preview: 'sponsorBlockCategoryPreview',
    hook: 'sponsorBlockCategoryHook',
    music_offtopic: 'sponsorBlockCategoryMusicOfftopic',
    filler: 'sponsorBlockCategoryFiller',
};

export const SPONSORBLOCK_CATEGORY_DESCRIPTION_KEYS: Record<SponsorBlockCategory, TranslationKey> = {
    sponsor: 'sponsorBlockCategorySponsorDescription',
    selfpromo: 'sponsorBlockCategorySelfpromoDescription',
    interaction: 'sponsorBlockCategoryInteractionDescription',
    intro: 'sponsorBlockCategoryIntroDescription',
    outro: 'sponsorBlockCategoryOutroDescription',
    preview: 'sponsorBlockCategoryPreviewDescription',
    hook: 'sponsorBlockCategoryHookDescription',
    music_offtopic: 'sponsorBlockCategoryMusicOfftopicDescription',
    filler: 'sponsorBlockCategoryFillerDescription',
};

export function resolveSponsorBlockCategories(
    settings?: Pick<Settings, 'sponsorBlockCategories'> | null
): SponsorBlockCategorySettings {
    return settings?.sponsorBlockCategories ?? DEFAULT_SPONSORBLOCK_CATEGORIES;
}

export const isSponsorBlockCategory = (value: string): value is SponsorBlockCategory =>
    (SPONSORBLOCK_CATEGORIES as readonly string[]).includes(value);

/** SponsorBlock records durations to about a second; muxing adds a little more. */
export const DURATION_TOLERANCE_SECONDS = 2;
/** Shorter ranges are not worth a seek. */
export const MIN_SKIP_RANGE_SECONDS = 0.5;
/** Back-to-back segments closer than this are skipped in one jump. */
export const MERGE_GAP_SECONDS = 0.2;
/** Same as useVideoPlayer's END_SEEK_GUARD_SECONDS: seeks stop this far before the end. */
export const END_GUARD_SECONDS = 0.25;
/** Landing this close after a range's start still counts as "at the start". */
export const START_WINDOW_SECONDS = 0.5;

export interface SkipRange {
    /** The member segment UUIDs joined, so it survives a plan rebuild. */
    key: string;
    uuids: string[];
    categories: SponsorBlockCategory[];
    start: number;
    end: number;
    mode: 'auto' | 'manual';
    /** Reaches the last END_GUARD_SECONDS: skipping it means ending playback. */
    toEnd: boolean;
}

export interface SponsorSkipPlan {
    /** Both modes, by start time. Ranges of different modes may overlap. */
    ranges: SkipRange[];
    bands: Array<{ start: number; end: number; color: string }>;
    /** Every segment with a known duration disagrees with this file. */
    durationMismatch: boolean;
}

export const EMPTY_SKIP_PLAN: SponsorSkipPlan = { ranges: [], bands: [], durationMismatch: false };

interface PlannedSegment {
    uuid: string;
    category: SponsorBlockCategory;
    start: number;
    end: number;
    mode: 'auto' | 'manual';
}

function mergeRanges(segments: PlannedSegment[], duration: number): SkipRange[] {
    const ranges: SkipRange[] = [];
    let current: SkipRange | null = null;
    for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
        if (current && segment.start <= current.end + MERGE_GAP_SECONDS) {
            current.end = Math.max(current.end, segment.end);
            current.uuids.push(segment.uuid);
            if (!current.categories.includes(segment.category)) current.categories.push(segment.category);
            continue;
        }
        current = {
            key: '',
            uuids: [segment.uuid],
            categories: [segment.category],
            start: segment.start,
            end: segment.end,
            mode: segment.mode,
            toEnd: false,
        };
        ranges.push(current);
    }
    return ranges
        .filter((range) => range.end - range.start >= MIN_SKIP_RANGE_SECONDS)
        .map((range) => ({
            ...range,
            key: range.uuids.join('|'),
            toEnd: range.end >= duration - END_GUARD_SECONDS,
        }));
}

/**
 * Decides what to do with a video's segments for the file actually playing.
 * `autoSkip: false` (the per-device switch) turns every automatic category
 * into a skip button instead.
 */
export function buildSkipPlan(
    segments: readonly SponsorSegment[],
    categories: SponsorBlockCategorySettings,
    options: { duration: number; autoSkip: boolean }
): SponsorSkipPlan {
    const { duration, autoSkip } = options;
    if (!(duration > 0) || !Number.isFinite(duration)) return EMPTY_SKIP_PLAN;

    const candidates = segments.filter(
        (segment) =>
            segment.actionType === 'skip' &&
            isSponsorBlockCategory(segment.category) &&
            (categories[segment.category] ?? 'off') !== 'off'
    );

    // A file trimmed by yt-dlp (--sponsorblock-remove, --download-sections)
    // has a shorter timeline, and skipping by the source's times would cut
    // into the video itself. Segments with a known duration tell us which
    // version of the video they were made for, whether or not their category
    // is skipped here.
    const matches = (segment: SponsorSegment) =>
        Math.abs(segment.videoDuration - duration) <= DURATION_TOLERANCE_SECONDS;
    const known = segments.filter((segment) => segment.videoDuration > 0);
    let kept = candidates;
    let durationMismatch = false;
    if (candidates.length > 0 && known.length > 0) {
        if (known.some(matches)) {
            kept = candidates.filter((segment) => segment.videoDuration === 0 || matches(segment));
        } else {
            kept = [];
            durationMismatch = true;
        }
    }

    const planned: PlannedSegment[] = kept
        .map((segment) => {
            const category = segment.category as SponsorBlockCategory;
            const mode: 'auto' | 'manual' =
                categories[category] === 'auto' && autoSkip ? 'auto' : 'manual';
            return {
                uuid: segment.uuid,
                category,
                start: Math.min(Math.max(segment.start, 0), duration),
                end: Math.min(Math.max(segment.end, 0), duration),
                mode,
            };
        })
        .filter((segment) => segment.end > segment.start);

    const ranges = [
        ...mergeRanges(planned.filter((segment) => segment.mode === 'auto'), duration),
        ...mergeRanges(planned.filter((segment) => segment.mode === 'manual'), duration),
    ].sort((a, b) => a.start - b.start);

    return {
        ranges,
        bands: planned.map((segment) => ({
            start: segment.start,
            end: segment.end,
            color: sponsorBlockCategory[segment.category],
        })),
        durationMismatch,
    };
}

export type SkipDecision =
    | { kind: 'skip'; range: SkipRange }
    | { kind: 'prompt'; range: SkipRange }
    | { kind: 'none' };

/**
 * One playback sample. `natural` means the playhead got here by playing a
 * small step forward; anything else (a seek, a load, pressing play) is a
 * landing.
 *
 * An automatic range is skipped when playback walks into it, or when a
 * landing puts the playhead at its very start (an intro at 0, a loop, Home).
 * Landing in the middle of one is the viewer choosing to watch it, so it only
 * gets a skip button, as do manual ranges and ranges the viewer undid.
 *
 * A handled range is one the player just skipped and has not left yet; it is
 * ignored entirely, so a skip can never trigger itself again.
 */
export function decideSkip(
    ranges: readonly SkipRange[],
    sample: { time: number; previousTime: number | null; natural: boolean },
    state: { isHandled: (range: SkipRange) => boolean; isUndone: (range: SkipRange) => boolean }
): SkipDecision {
    const { time, previousTime, natural } = sample;
    const inside = ranges.filter(
        (range) => range.start <= time && time < range.end && !state.isHandled(range)
    );
    if (inside.length === 0) return { kind: 'none' };

    const auto = inside.find((range) => range.mode === 'auto' && !state.isUndone(range));
    if (auto) {
        const walkedIn = natural && previousTime !== null && previousTime < auto.start;
        const landedAtStart = !natural && time < auto.start + START_WINDOW_SECONDS;
        if (walkedIn || landedAtStart) return { kind: 'skip', range: auto };
    }
    // Offer the range that reaches furthest, so one press clears all of it.
    const furthest = inside.reduce((best, range) => (range.end > best.end ? range : best));
    return { kind: 'prompt', range: furthest };
}
