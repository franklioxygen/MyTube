import { Movie, MovieFilter } from '@mui/icons-material';
import { IconButton, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface CinemaModeControlProps {
    isCinemaMode: boolean;
    onToggle: () => void;
}

const CinemaModeControl: React.FC<CinemaModeControlProps> = ({
    isCinemaMode,
    onToggle
}) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    return (
        <Tooltip title={isCinemaMode ? t('exitCinemaMode') : t('enterCinemaMode')} disableHoverListener={isTouch}>
            <IconButton
                onClick={onToggle}
                size="small"
            >
                {isCinemaMode ? <MovieFilter /> : <Movie />}
            </IconButton>
        </Tooltip>
    );
};

export default CinemaModeControl;
