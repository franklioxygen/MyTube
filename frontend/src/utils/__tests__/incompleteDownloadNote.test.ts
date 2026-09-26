import { describe, expect, it } from 'vitest';
import {
    parseIncompleteDownloadNote,
    summarizeIncompleteDownloadGaps,
} from '../incompleteDownloadNote';

const stored = (note: object) => JSON.stringify({ kind: 'incomplete_download', ...note });

describe('parseIncompleteDownloadNote', () => {
    it('reads the note the backend stores', () => {
        expect(parseIncompleteDownloadNote(stored({
            skippedFragments: 2,
            gaps: [{ stream: 'audio', atSeconds: 4476.2, gapSeconds: 4.04 }],
        }))).toEqual({
            skippedFragments: 2,
            gaps: [{ stream: 'audio', atSeconds: 4476.2, gapSeconds: 4.04 }],
        });
    });

    it('keeps the fragment count when the gaps could not be located', () => {
        expect(parseIncompleteDownloadNote(stored({ skippedFragments: 3, gaps: [] })))
            .toEqual({ skippedFragments: 3, gaps: [] });
    });

    it('drops malformed gaps rather than the whole note', () => {
        expect(parseIncompleteDownloadNote(stored({
            skippedFragments: 1,
            gaps: [null, { stream: 'subtitle', atSeconds: 1, gapSeconds: 1 }, { stream: 'video', atSeconds: 'x' }],
        }))).toEqual({ skippedFragments: 1, gaps: [] });
    });

    it.each([
        ['no error', undefined],
        ['an ordinary error message', 'yt-dlp process exited with code 1'],
        ['JSON of another kind', JSON.stringify({ kind: 'other', skippedFragments: 1 })],
        ['a note without a count', JSON.stringify({ kind: 'incomplete_download' })],
        ['truncated JSON', '{"kind":"incomplete_download",'],
    ])('ignores %s', (_label, raw) => {
        expect(parseIncompleteDownloadNote(raw)).toBeUndefined();
    });
});

describe('summarizeIncompleteDownloadGaps', () => {
    it('gives one line per stream, video first, with the total and where', () => {
        expect(summarizeIncompleteDownloadGaps({
            skippedFragments: 2,
            gaps: [
                { stream: 'audio', atSeconds: 4476.2, gapSeconds: 4.04 },
                { stream: 'video', atSeconds: 4476.1, gapSeconds: 4.0 },
            ],
        })).toEqual([
            { labelKey: 'incompleteDownloadVideoGap', seconds: 4.0, positions: '1:14:36' },
            { labelKey: 'incompleteDownloadAudioGap', seconds: 4.04, positions: '1:14:36' },
        ]);
    });

    it('lists the first five positions of a burst and counts the rest', () => {
        const burst = Array.from({ length: 8 }, (_, i) => ({
            stream: 'audio' as const, atSeconds: 2656 + 60 * i, gapSeconds: 2,
        }));

        expect(summarizeIncompleteDownloadGaps({ skippedFragments: 8, gaps: burst })).toEqual([{
            labelKey: 'incompleteDownloadAudioGap',
            seconds: 16,
            positions: '44:16, 45:16, 46:16, 47:16, 48:16 +3',
        }]);
    });

    it('has nothing to list when the gaps could not be located', () => {
        expect(summarizeIncompleteDownloadGaps({ skippedFragments: 1, gaps: [] })).toEqual([]);
    });
});
