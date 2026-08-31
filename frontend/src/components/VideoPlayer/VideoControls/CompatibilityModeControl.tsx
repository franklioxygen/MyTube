import { DirectionsCar } from '@mui/icons-material';
import { IconButton, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface CompatibilityModeControlProps {
    onEnter: () => void;
}

/** Switches the player into D Mode, the canvas + WebCodecs playback path. */
const CompatibilityModeControl: React.FC<CompatibilityModeControlProps> = ({
    onEnter,
}) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    const handleClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        onEnter();
    };

    return (
        <Tooltip title={t('compatibilityModeEnter')} disableHoverListener={isTouch}>
            <IconButton
                onClick={handleClick}
                size="small"
                aria-label={t('compatibilityModeEnter')}
            >
                <DirectionsCar />
            </IconButton>
        </Tooltip>
    );
};

export default CompatibilityModeControl;
