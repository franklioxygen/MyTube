import { Box, Stack, useMediaQuery } from '@mui/material';
import React from 'react';
import type { PlayerSeekIntervals } from '../../../utils/playerSeekIntervals';
import LiveTranslationControlButton from './LiveTranslationControlButton';
import SeekButton, { SeekDirection, SeekTier } from './SeekButton';
import SpeedControl from './SpeedControl';

interface PlaybackControlsProps {
    isPlaying: boolean;
    onPlayPause: () => void;
    onSeek: (seconds: number) => void;
    playbackRate: number;
    onPlaybackRateChange: (rate: number) => void;
    isFullscreen?: boolean;
    seekIntervals: PlayerSeekIntervals;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
    onSeek,
    playbackRate,
    onPlaybackRateChange,
    isFullscreen = false,
    seekIntervals,
}) => {
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const seekButtons: Array<{
        direction: SeekDirection;
        tier: SeekTier;
        seconds: number;
    }> = [
        { direction: 'backward', tier: 'long', seconds: seekIntervals.longSeconds },
        { direction: 'backward', tier: 'medium', seconds: seekIntervals.mediumSeconds },
        { direction: 'backward', tier: 'short', seconds: seekIntervals.shortSeconds },
        { direction: 'forward', tier: 'short', seconds: seekIntervals.shortSeconds },
        { direction: 'forward', tier: 'medium', seconds: seekIntervals.mediumSeconds },
        { direction: 'forward', tier: 'long', seconds: seekIntervals.longSeconds },
    ];

    return (
        <Stack
            direction="row"
            spacing={0.5}
            justifyContent="center"
            alignItems="center"
            sx={{ width: '100%', flexWrap: 'wrap' }}
        >
            {/* Live Translate trigger (desktop only; mobile shows it in the bottom row) */}
            <LiveTranslationControlButton
                sx={{ display: { xs: 'none', sm: 'inline-flex' }, padding: '8px' }}
            />
            {seekButtons.map(({ direction, tier, seconds }) => (
                <SeekButton
                    key={`${direction}-${tier}`}
                    direction={direction}
                    tier={tier}
                    seconds={seconds}
                    onSeek={onSeek}
                    disableTooltip={isTouch}
                />
            ))}
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
