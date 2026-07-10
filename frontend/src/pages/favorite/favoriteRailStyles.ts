import type { SxProps, Theme } from '@mui/material';

/**
 * Shared horizontal-scroller style for every favorites rail.
 *
 * Rails scroll horizontally on ALL breakpoints — the phone experience is a
 * swipeable row of compact cards (like a streaming app), not a stack of giant
 * full-width cards. On mobile the scroller bleeds to the screen edges so cards
 * peek in from the right, signalling "there's more to swipe".
 */
export const railScrollerSx: SxProps<Theme> = {
    display: 'flex',
    flexWrap: 'nowrap',
    gap: { xs: 1.5, md: 2 },
    overflowX: 'auto',
    pb: 1,
    scrollSnapType: 'x mandatory',
    // Full-bleed on mobile, aligned to the content grid on desktop.
    mx: { xs: -2, md: 0 },
    px: { xs: 2, md: 0 },
    scrollPaddingInlineStart: { xs: '16px', md: 0 },
    WebkitOverflowScrolling: 'touch',
    '&::-webkit-scrollbar': { height: 6 },
    '&::-webkit-scrollbar-thumb': { borderRadius: 3, backgroundColor: 'action.selected' },
    '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
};
