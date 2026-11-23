import { describe, expect, it } from 'vitest';
import { rebaseTagEdit } from '../tagEditRebase';

describe('rebaseTagEdit', () => {
    it('applies additions and removals to the confirmed list', () => {
        expect(rebaseTagEdit(['new', 'x'], ['old', 'x'], ['old', 'x', 'y'])).toEqual(['new', 'x', 'y']);
        expect(rebaseTagEdit(['new', 'x'], ['old', 'x'], ['old'])).toEqual(['new']);
    });

    it('skips an addition the confirmed list already has in another case', () => {
        expect(rebaseTagEdit(['Music'], [], ['music'])).toEqual(['Music']);
    });

    it('carries a deletion of a stale old name over to its rename', () => {
        expect(rebaseTagEdit(['new', 'x'], ['old', 'x'], ['x'], [['old', 'new']])).toEqual(['x']);
    });

    it('leaves the new name alone once the page already showed it', () => {
        // "old" was recreated after the rename synced, then deleted.
        expect(
            rebaseTagEdit(['new', 'old', 'x'], ['new', 'old', 'x'], ['new', 'x'], [['old', 'new']])
        ).toEqual(['new', 'x']);
    });
});
