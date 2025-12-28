import { Loop } from '@mui/icons-material';
import { IconButton, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface LoopControlProps {
    isLooping: boolean;
    onToggle: () => void;
}

const LoopControl: React.FC<LoopControlProps> = ({
    isLooping,
    onToggle
}) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    return (
        <Tooltip title={`${t('loop')} ${isLooping ? t('on') : t('off')}`} disableHoverListener={isTouch}>
            <IconButton
                color={isLooping ? "primary" : "default"}
                onClick={onToggle}
                size="small"
            >
                <Loop />
            </IconButton>
        </Tooltip>
    );
};

export default LoopControl;

