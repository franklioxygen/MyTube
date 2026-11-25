import { Campaign } from '@mui/icons-material';
import { Box, IconButton, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface SponsorBlockControlProps {
    autoSkip: boolean;
    durationMismatch: boolean;
    onToggle: () => void;
}

/** Turns automatic SponsorBlock skipping on or off for this device (issue #555). */
const SponsorBlockControl: React.FC<SponsorBlockControlProps> = ({ autoSkip, durationMismatch, onToggle }) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const state = t(autoSkip ? 'sponsorBlockAutoSkipOn' : 'sponsorBlockAutoSkipOff');

    return (
        <Tooltip
            disableHoverListener={isTouch}
            title={
                <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <span>{state}</span>
                    {durationMismatch && <span>{t('sponsorBlockDurationMismatch')}</span>}
                    <span>{t('sponsorBlockAttribution')}</span>
                </Box>
            }
        >
            <IconButton
                color={autoSkip && !durationMismatch ? 'primary' : 'default'}
                onClick={onToggle}
                size="small"
                aria-label={state}
                aria-pressed={autoSkip}
            >
                <Campaign />
            </IconButton>
        </Tooltip>
    );
};

export default SponsorBlockControl;
