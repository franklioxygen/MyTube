import { IconButton, Menu, MenuItem, Tooltip, Typography, useMediaQuery } from '@mui/material';
import React, { useState } from 'react';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

interface SpeedControlProps {
    playbackRate: number;
    onPlaybackRateChange: (rate: number) => void;
    isFullscreen?: boolean;
}

const SpeedControl: React.FC<SpeedControlProps> = ({
    playbackRate,
    onPlaybackRateChange,
    isFullscreen = false
}) => {
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [speedMenuAnchor, setSpeedMenuAnchor] = useState<HTMLElement | null>(null);

    const handleSpeedClick = (event: React.MouseEvent<HTMLElement>) => {
        setSpeedMenuAnchor(event.currentTarget);
    };

    const handleCloseSpeedMenu = () => {
        setSpeedMenuAnchor(null);
    };

    const handleSelectSpeed = (rate: number) => {
        onPlaybackRateChange(rate);
        handleCloseSpeedMenu();
    };

    return (
        <>
            <Tooltip title="Playback Speed" disableHoverListener={isTouch}>
                <IconButton
                    onClick={handleSpeedClick}
                    size="small"
                    color={playbackRate !== 1 ? 'primary' : 'default'}
                    sx={{ padding: { xs: '10px', sm: '8px' } }}
                >
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem', lineHeight: 1, width: '1.5rem', height: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {playbackRate}x
                    </Typography>
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={speedMenuAnchor}
                open={Boolean(speedMenuAnchor)}
                onClose={handleCloseSpeedMenu}
                container={isFullscreen ? document.fullscreenElement as HTMLElement : undefined}
            >
                {SPEED_OPTIONS.map((rate) => (
                    <MenuItem
                        key={rate}
                        onClick={() => handleSelectSpeed(rate)}
                        selected={rate === playbackRate}
                    >
                        {rate}x
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

export default SpeedControl;
