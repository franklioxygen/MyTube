import { formatDuration } from './formatUtils';

/**
 * A download saved although yt-dlp left fragments out. The backend stores this
 * as JSON in the history row's `error` - data rather than a sentence - so it can
 * be worded here, in the viewer's language.
 */
export interface IncompleteDownloadGap {
    stream: 'video' | 'audio';
    atSeconds: number;
    gapSeconds: number;
}

export interface IncompleteDownloadNote {
    skippedFragments: number;
    /** Empty when the gaps could not be located. */
    gaps: IncompleteDownloadGap[];
}

export interface IncompleteDownloadGapSummary {
    labelKey: 'incompleteDownloadVideoGap' | 'incompleteDownloadAudioGap';
    /** Total missing from this stream. */
    seconds: number;
    /** Where, as timestamps; the first few, then a count of the rest. */
    positions: string;
}

const MAX_LISTED_POSITIONS = 5;

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export function parseIncompleteDownloadNote(
    raw: string | undefined,
): IncompleteDownloadNote | undefined {
    if (!raw || !raw.startsWith('{')) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object') return undefined;
    const note = parsed as Record<string, unknown>;
    if (note.kind !== 'incomplete_download' || !isFiniteNumber(note.skippedFragments)) {
        return undefined;
    }
    const gaps = Array.isArray(note.gaps)
        ? note.gaps.filter(
            (gap): gap is IncompleteDownloadGap =>
                Boolean(gap) &&
                (gap.stream === 'video' || gap.stream === 'audio') &&
                isFiniteNumber(gap.atSeconds) &&
                isFiniteNumber(gap.gapSeconds),
        )
        : [];
    return { skippedFragments: note.skippedFragments, gaps };
}

/** One line per stream that lost content, video first. */
export function summarizeIncompleteDownloadGaps(
    note: IncompleteDownloadNote,
): IncompleteDownloadGapSummary[] {
    return (['video', 'audio'] as const).flatMap((stream) => {
        const gaps = note.gaps.filter((gap) => gap.stream === stream);
        if (gaps.length === 0) return [];
        const listed = gaps
            .slice(0, MAX_LISTED_POSITIONS)
            .map((gap) => formatDuration(Math.floor(gap.atSeconds)))
            .join(', ');
        const rest = gaps.length - MAX_LISTED_POSITIONS;
        return [{
            labelKey: stream === 'video' ? 'incompleteDownloadVideoGap' : 'incompleteDownloadAudioGap',
            seconds: gaps.reduce((sum, gap) => sum + gap.gapSeconds, 0),
            positions: rest > 0 ? `${listed} +${rest}` : listed,
        }];
    });
}
