import { Fullscreen, FullscreenExit } from '@mui/icons-material';
import { IconButton, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface FullscreenControlProps {
    isFullscreen: boolean;
    onToggle: () => void;
}

const FullscreenControl: React.FC<FullscreenControlProps> = ({
    isFullscreen,
    onToggle
}) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    return (
        <Tooltip title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')} disableHoverListener={isTouch}>
            <IconButton
                onClick={onToggle}
                size="small"
            >
                {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
            </IconButton>
        </Tooltip>
    );
};

export default FullscreenControl;

