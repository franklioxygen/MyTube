import {
    FastForward,
    FastRewind,
    Forward10,
    KeyboardDoubleArrowLeft,
    KeyboardDoubleArrowRight,
    Replay10
} from '@mui/icons-material';
import { Box, IconButton, Stack, Tooltip, useMediaQuery } from '@mui/material';
import React from 'react';
import SpeedControl from './SpeedControl';

interface PlaybackControlsProps {
    isPlaying: boolean;
    onPlayPause: () => void;
    onSeek: (seconds: number) => void;
    playbackRate: number;
    onPlaybackRateChange: (rate: number) => void;
    isFullscreen?: boolean;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
    onSeek,
    playbackRate,
    onPlaybackRateChange,
    isFullscreen = false
}) => {
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
            <Box sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
                <SpeedControl
                    playbackRate={playbackRate}
                    onPlaybackRateChange={onPlaybackRateChange}
                    isFullscreen={isFullscreen}
                />
            </Box>
        </Stack>
    );
};

export default PlaybackControls;
