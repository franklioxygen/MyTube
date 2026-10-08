import { describe, expect, it } from 'vitest';
import { splitDescriptionTimestamps } from '../descriptionTimestamps';

const timestamps = (description: string, durationSeconds = 0) =>
    splitDescriptionTimestamps(description, durationSeconds).filter(
        (part) => typeof part !== 'string'
    );

const rejoin = (description: string, durationSeconds = 0) =>
    splitDescriptionTimestamps(description, durationSeconds)
        .map((part) => (typeof part === 'string' ? part : part.text))
        .join('');

describe('splitDescriptionTimestamps', () => {
    it('turns each line of a chapter list into a timestamp', () => {
        const description = '0:00 - Intro\n1:55 - Grobi Merz\n10:24 - Simone Winfrey\n1:02:03 - Finale';

        expect(timestamps(description)).toEqual([
            { text: '0:00', seconds: 0 },
            { text: '1:55', seconds: 115 },
            { text: '10:24', seconds: 624 },
            { text: '1:02:03', seconds: 3723 },
        ]);
    });

    it('keeps every character of the description, in order', () => {
        const description = 'Chapters:\n0:00 Intro (see 1:55)\nThanks!';

        expect(splitDescriptionTimestamps(description)).toEqual([
            'Chapters:\n',
            { text: '0:00', seconds: 0 },
            ' Intro (see ',
            { text: '1:55', seconds: 115 },
            ')\nThanks!',
        ]);
        expect(rejoin(description)).toBe(description);
    });

    it('reads minutes past 59 the way long videos often write them', () => {
        const description = '99:59 Part two\n100:00 Part three\n120:34 Finale\n2024:12 not a time';

        // Three hours long: the first three are in range, the last overshoots.
        expect(timestamps(description, 3 * 3600)).toEqual([
            { text: '99:59', seconds: 5999 },
            { text: '100:00', seconds: 6000 },
            { text: '120:34', seconds: 7234 },
        ]);
    });

    it('finds timestamps pasted from a rendered page, e.g. [0:00](#0-00)', () => {
        expect(timestamps('[5:20](#5-20) - Matthias Hofmann')).toEqual([
            { text: '5:20', seconds: 320 },
        ]);
    });

    it('ignores things that only look like times', () => {
        // A ratio, a time of day glued to "am", a version tag, an invalid
        // seconds field, a single-digit minute after an hour, and a run with
        // too many fields.
        expect(timestamps('16:9 at 10:30am, v1:23, 1:75, 1:2:03, 12:34:56:78')).toEqual([]);
    });

    it('still reads a timestamp followed by a colon and a label', () => {
        expect(timestamps('0:00: Intro')).toEqual([{ text: '0:00', seconds: 0 }]);
    });

    it('drops timestamps at or past the end of the video', () => {
        const description = '0:00 Intro\n9:59 Outro\n10:00 End\n19:30 Doors open';

        expect(timestamps(description, 600)).toEqual([
            { text: '0:00', seconds: 0 },
            { text: '9:59', seconds: 599 },
        ]);
        expect(rejoin(description, 600)).toBe(description);
    });

    it('returns plain text unchanged when there is nothing to link', () => {
        expect(splitDescriptionTimestamps('No chapters here.')).toEqual(['No chapters here.']);
    });
});
