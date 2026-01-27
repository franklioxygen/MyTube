import { VolumeDown, VolumeOff, VolumeUp } from '@mui/icons-material';
import { Box, IconButton, Slider, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import React from 'react';

interface VolumeControlProps {
    volume: number;
    showVolumeSlider: boolean;
    volumeSliderRef: React.RefObject<HTMLDivElement | null>;
    onVolumeChange: (value: number) => void;
    onVolumeClick: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onSliderMouseEnter: () => void;
    onSliderMouseLeave: () => void;
}

const VolumeControl: React.FC<VolumeControlProps> = ({
    volume,
    showVolumeSlider,
    volumeSliderRef,
    onVolumeChange,
    onVolumeClick,
    onMouseEnter,
    onMouseLeave,
    onSliderMouseEnter,
    onSliderMouseLeave
}) => {
    const theme = useTheme();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    const getVolumeIcon = () => {
        if (volume === 0) return <VolumeOff />;
        if (volume < 0.5) return <VolumeDown />;
        return <VolumeUp />;
    };

    return (
        <Box
            ref={volumeSliderRef}
            sx={{
                position: 'relative',
                display: { xs: 'none', md: 'flex' },
                alignItems: 'center'
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <Tooltip title={volume === 0 ? 'Unmute' : 'Mute'} disableHoverListener={isTouch}>
                <IconButton
                    onClick={onVolumeClick}
                    size="small"
                >
                    {getVolumeIcon()}
                </IconButton>
            </Tooltip>
            {showVolumeSlider && (
                <Box
                    sx={{
                        position: 'absolute',
                        bottom: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        mb: 0.5,
                        width: '40px',
                        bgcolor: theme.palette.mode === 'dark' ? '#2a2a2a' : '#fff',
                        p: 1,
                        borderRadius: 1,
                        boxShadow: 2,
                        zIndex: 1000,
                        display: 'flex',
                        justifyContent: 'center',
                        pointerEvents: 'auto'
                    }}
                    onMouseEnter={onSliderMouseEnter}
                    onMouseLeave={onSliderMouseLeave}
                >
                    <Slider
                        orientation="vertical"
                        value={volume * 100}
                        onChange={(_event, newValue) => {
                            const value = Array.isArray(newValue) ? newValue[0] : newValue;
                            onVolumeChange(value);
                        }}
                        min={0}
                        max={100}
                        size="small"
                        sx={{
                            height: '80px',
                            '& .MuiSlider-thumb': {
                                width: 12,
                                height: 12,
                            },
                            '& .MuiSlider-track': {
                                width: 4,
                            },
                            '& .MuiSlider-rail': {
                                width: 4,
                            }
                        }}
                    />
                </Box>
            )}
        </Box>
    );
};

export default VolumeControl;

