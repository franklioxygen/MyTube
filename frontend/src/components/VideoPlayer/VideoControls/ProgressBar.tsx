import { Slider, Stack, Typography, useTheme } from '@mui/material';
import React from 'react';
import { brand, overlay, shadow } from '../../../theme/colors';

interface ProgressBarProps {
    currentTime: number;
    duration: number;
    isFullscreen?: boolean;
    onProgressChange: (value: number) => void;
    onProgressChangeCommitted: (value: number) => void;
    onProgressMouseDown: () => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
    currentTime,
    duration,
    isFullscreen = false,
    onProgressChange,
    onProgressChangeCommitted,
    onProgressMouseDown
}) => {
    const theme = useTheme();
    const sliderColor = isFullscreen ? brand.primaryDark : theme.palette.primary.main;
    const textColor = isFullscreen ? overlay.white92 : 'text.primary';
    const railColor = isFullscreen ? overlay.white32 : undefined;
    const hasDuration = duration > 0 && isFinite(duration);
    const sliderValue = hasDuration
        ? Math.max(0, Math.min(currentTime, duration))
        : 0;

    const formatTime = (seconds: number): string => {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ minWidth: { xs: '35px', sm: '45px' }, textAlign: 'right', fontSize: '0.75rem', color: textColor }}>
                {formatTime(currentTime)}
            </Typography>
            <Slider
                min={0}
                max={hasDuration ? duration : 0}
                step={0.1}
                value={sliderValue}
                onChange={(_event, newValue) => {
                    const value = Array.isArray(newValue) ? newValue[0] : newValue;
                    onProgressChange(value);
                }}
                onChangeCommitted={(_event, newValue) => {
                    const value = Array.isArray(newValue) ? newValue[0] : newValue;
                    onProgressChangeCommitted(value);
                }}
                onMouseDown={onProgressMouseDown}
                disabled={!hasDuration}
                size="small"
                sx={{
                    flex: 1,
                    minWidth: 0,
                    color: sliderColor,
                    transition: 'all 0.2s ease',
                    '& .MuiSlider-thumb': {
                        width: 12,
                        height: 12,
                        transition: 'width 0.2s, height 0.2s',
                        ...(isFullscreen && {
                            boxShadow: shadow.focusRing
                        }),
                        '&:hover': {
                            width: 16,
                            height: 16,
                        }
                    },
                    '& .MuiSlider-track': {
                        height: 4,
                        transition: 'height 0.2s ease',
                    },
                    '& .MuiSlider-rail': {
                        height: 4,
                        transition: 'height 0.2s ease',
                        ...(railColor && {
                            color: railColor,
                            opacity: 1
                        })
                    },
                    '&:hover': {
                        '& .MuiSlider-track': {
                            height: 8,
                        },
                        '& .MuiSlider-rail': {
                            height: 8,
                        }
                    }
                }}
            />
            <Typography variant="caption" sx={{ minWidth: { xs: '35px', sm: '45px' }, textAlign: 'left', fontSize: '0.75rem', color: textColor }}>
                {formatTime(duration)}
            </Typography>
        </Stack>
    );
};

export default ProgressBar;
