import { Subtitles, SubtitlesOff } from '@mui/icons-material';
import { IconButton, Menu, MenuItem, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface SubtitleControlProps {
    subtitles: Array<{ language: string; filename: string; path: string }>;
    subtitlesEnabled: boolean;
    subtitleMenuAnchor: HTMLElement | null;
    onSubtitleClick: (event: React.MouseEvent<HTMLElement>) => void;
    onCloseMenu: () => void;
    onSelectSubtitle: (index: number) => void;
    showOnMobile?: boolean;
}

const SubtitleControl: React.FC<SubtitleControlProps> = ({
    subtitles,
    subtitlesEnabled,
    subtitleMenuAnchor,
    onSubtitleClick,
    onCloseMenu,
    onSelectSubtitle,
    showOnMobile = false
}) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    if (!subtitles || subtitles.length === 0) return null;

    return (
        <>
            <Tooltip title={subtitlesEnabled ? 'Subtitles' : 'Subtitles Off'} disableHoverListener={isTouch}>
                <IconButton
                    color={subtitlesEnabled ? "primary" : "default"}
                    onClick={onSubtitleClick}
                    size="small"
                    sx={showOnMobile ? { display: { xs: 'flex', sm: 'none' }, ml: { xs: 0.25, sm: 0.5 } } : {}}
                >
                    {subtitlesEnabled ? <Subtitles /> : <SubtitlesOff />}
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={subtitleMenuAnchor}
                open={Boolean(subtitleMenuAnchor)}
                onClose={onCloseMenu}
            >
                <MenuItem onClick={() => onSelectSubtitle(-1)}>
                    {t('off') || 'Off'}
                </MenuItem>
                {subtitles.map((subtitle, index) => (
                    <MenuItem key={subtitle.language} onClick={() => onSelectSubtitle(index)}>
                        {subtitle.language.toUpperCase()}
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

export default SubtitleControl;

