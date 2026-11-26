import { useCallback, useState } from 'react';

// Per-device "pause automatic skipping"; storage can be unavailable.
const SPONSORBLOCK_AUTO_SKIP_KEY = 'sponsorBlockAutoSkip';
const readAutoSkip = (): boolean => {
    try {
        return localStorage.getItem(SPONSORBLOCK_AUTO_SKIP_KEY) !== 'off';
    } catch {
        return true;
    }
};
const writeAutoSkip = (enabled: boolean): void => {
    try {
        localStorage.setItem(SPONSORBLOCK_AUTO_SKIP_KEY, enabled ? 'on' : 'off');
    } catch {
        /* The choice still holds for this page. */
    }
};

/** The SponsorBlock switch on the player itself (issue #555), shared by both players. */
export function useSponsorAutoSkip(): { autoSkip: boolean; toggleAutoSkip: () => void } {
    const [autoSkip, setAutoSkip] = useState(readAutoSkip);
    const toggleAutoSkip = useCallback(() => {
        const next = !autoSkip;
        writeAutoSkip(next);
        setAutoSkip(next);
    }, [autoSkip]);
    return { autoSkip, toggleAutoSkip };
}
