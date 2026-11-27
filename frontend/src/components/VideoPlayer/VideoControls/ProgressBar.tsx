import { Box, Slider, Stack, Typography, useTheme } from '@mui/material';
import React from 'react';
import { brand, overlay, shadow } from '../../../theme/colors';

export interface ProgressBarSegment {
    start: number;
    end: number;
    color: string;
}

interface ProgressBarProps {
    currentTime: number;
    duration: number;
    isFullscreen?: boolean;
    /** Locks the bar for sources that cannot be repositioned at all. */
    disabled?: boolean;
    /** Ranges painted over the rail, e.g. SponsorBlock segments (issue #555). */
    segments?: ProgressBarSegment[];
    onProgressChange: (value: number) => void;
    onProgressChangeCommitted: (value: number) => void;
    onProgressMouseDown: () => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
    currentTime,
    duration,
    isFullscreen = false,
    disabled = false,
    segments,
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
        <Stack
            direction="row"
            spacing={{ xs: 0.5, sm: 1 }}
            alignItems="center"
            // The buttons on either side are tapped repeatedly on touch
            // screens, and a tap that lands just off one of them would
            // otherwise select the elapsed/duration text next to it.
            sx={{ flex: 1, minWidth: 0, userSelect: 'none' }}
        >
            <Typography variant="caption" sx={{ minWidth: { xs: '35px', sm: '45px' }, textAlign: 'right', fontSize: '0.75rem', color: textColor }}>
                {formatTime(currentTime)}
            </Typography>
            {/* Always present, so segments arriving later never remount the
                Slider under a drag in progress. */}
            <Box
                sx={{
                    position: 'relative',
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    // The bands follow the rail's height, which grows on hover.
                    '--progress-band-height': '4px',
                    '&:hover': { '--progress-band-height': '8px' },
                }}
            >
                {hasDuration && segments && segments.length > 0 && (
                    <Box
                        aria-hidden="true"
                        data-testid="progress-segments"
                        sx={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: '50%',
                            height: 'var(--progress-band-height)',
                            transform: 'translateY(-50%)',
                            transition: 'height 0.2s ease',
                            pointerEvents: 'none',
                            zIndex: 1,
                        }}
                    >
                        {segments.map((segment, index) => (
                            <Box
                                key={`${segment.start}-${segment.end}-${index}`}
                                sx={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: `${(segment.start / duration) * 100}%`,
                                    width: `${((segment.end - segment.start) / duration) * 100}%`,
                                    // Short segments would otherwise vanish on a long video.
                                    minWidth: '2px',
                                    bgcolor: segment.color,
                                    opacity: 0.85,
                                }}
                            />
                        ))}
                    </Box>
                )}
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
                    disabled={disabled || !hasDuration}
                    size="small"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        color: sliderColor,
                        transition: 'color 0.2s ease',
                        '& .MuiSlider-thumb': {
                            // Above the segment bands, which sit over the rail.
                            zIndex: 2,
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
            </Box>
            <Typography variant="caption" sx={{ minWidth: { xs: '35px', sm: '45px' }, textAlign: 'left', fontSize: '0.75rem', color: textColor }}>
                {formatTime(duration)}
            </Typography>
        </Stack>
    );
};

export default ProgressBar;
