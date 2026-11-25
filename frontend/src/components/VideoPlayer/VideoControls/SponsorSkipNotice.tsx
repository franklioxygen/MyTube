import { SkipNext, Undo } from '@mui/icons-material';
import { Box, Button, Typography, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { overlay } from '../../../theme/colors';
import { SPONSORBLOCK_CATEGORY_LABEL_KEYS } from '../../../utils/sponsorBlock';
import type { SponsorSkipNotice as Notice } from './hooks/useSponsorSkip';

interface SponsorSkipNoticeProps {
    notice: Notice;
    onUndo: () => void;
    onSkip: () => void;
    /** Lifts the notice above the fullscreen control bar while it shows. */
    raised?: boolean;
}

// Clicks on the picture toggle playback (the whole cover does in audio mode),
// so nothing pressed here may reach it.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

/** "Skipped · Undo" after an automatic skip, or "Skip ›" inside a segment (issue #555). */
const SponsorSkipNotice: React.FC<SponsorSkipNoticeProps> = ({ notice, onUndo, onSkip, raised = false }) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    if (!notice) return null;

    const category = notice.range.categories
        .map((item) => t(SPONSORBLOCK_CATEGORY_LABEL_KEYS[item]))
        .join(' / ');
    const buttonSx = {
        color: overlay.white92,
        minHeight: isTouch ? 44 : 32,
        textTransform: 'none',
        fontWeight: 600,
    } as const;

    return (
        <Box
            role="status"
            aria-live="polite"
            onClick={stop}
            onPointerDown={stop}
            onDoubleClick={stop}
            sx={{
                position: 'absolute',
                right: { xs: 8, sm: 16 },
                bottom: raised ? { xs: 132, sm: 120 } : { xs: 8, sm: 16 },
                zIndex: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                pl: notice.kind === 'skipped' ? 1.5 : 0.5,
                pr: 0.5,
                borderRadius: 1,
                bgcolor: overlay.black75,
                color: overlay.white92,
                maxWidth: 'calc(100% - 16px)',
                transition: 'bottom 0.35s ease',
            }}
        >
            {notice.kind === 'skipped' ? (
                <>
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                        {t('sponsorBlockSkipped', { category })}
                    </Typography>
                    <Button size="small" startIcon={<Undo />} onClick={onUndo} sx={buttonSx}>
                        {t('sponsorBlockUndo')}
                    </Button>
                </>
            ) : (
                <Button size="small" endIcon={<SkipNext />} onClick={onSkip} sx={buttonSx}>
                    {t('sponsorBlockSkip', { category })}
                </Button>
            )}
        </Box>
    );
};

export default SponsorSkipNotice;
