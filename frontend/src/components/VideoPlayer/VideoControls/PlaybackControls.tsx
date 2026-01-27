import {
    FastForward,
    FastRewind,
    Forward10,
    KeyboardDoubleArrowLeft,
    KeyboardDoubleArrowRight,
    Replay10
} from '@mui/icons-material';
import { IconButton, Stack, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';

interface PlaybackControlsProps {
    isPlaying: boolean;
    onPlayPause: () => void;
    onSeek: (seconds: number) => void;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
    onSeek
}) => {
    // Unused translation hook
    // const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    return (
        <Stack
            direction="row"
            spacing={0.5}
            justifyContent="center"
            alignItems="center"
            sx={{ width: '100%', flexWrap: 'wrap' }}
        >
            <Tooltip title="-10m" disableHoverListener={isTouch}>
                <IconButton
                    onClick={() => onSeek(-600)}
                    size="small"
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <KeyboardDoubleArrowLeft />
                </IconButton>
            </Tooltip>
            <Tooltip title="-1m" disableHoverListener={isTouch}>
                <IconButton
                    onClick={() => onSeek(-60)}
                    size="small"
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <FastRewind />
                </IconButton>
            </Tooltip>
            <Tooltip title="-10s" disableHoverListener={isTouch}>
                <IconButton
                    onClick={() => onSeek(-10)}
                    size="small"
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <Replay10 />
                </IconButton>
            </Tooltip>
            <Tooltip title="+10s" disableHoverListener={isTouch}>
                <IconButton
                    onClick={() => onSeek(10)}
                    size="small"
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <Forward10 />
                </IconButton>
            </Tooltip>
            <Tooltip title="+1m" disableHoverListener={isTouch}>
                <IconButton
                    onClick={() => onSeek(60)}
                    size="small"
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <FastForward />
                </IconButton>
            </Tooltip>
            <Tooltip title="+10m" disableHoverListener={isTouch}>
                <IconButton
                    onClick={() => onSeek(600)}
                    size="small"
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <KeyboardDoubleArrowRight />
                </IconButton>
            </Tooltip>
        </Stack>
    );
};

export default PlaybackControls;

