import { Pause, PlayArrow } from '@mui/icons-material';
import { Box, IconButton, Stack, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import CinemaModeControl from './CinemaModeControl';
import FullscreenControl from './FullscreenControl';
import LoopControl from './LoopControl';
import PlaybackControls from './PlaybackControls';
import ProgressBar from './ProgressBar';
import SubtitleControl from './SubtitleControl';
import VolumeControl from './VolumeControl';

interface ControlsOverlayProps {
    isFullscreen: boolean;
    controlsVisible: boolean;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    isDragging: boolean;
    volume: number;
    showVolumeSlider: boolean;
    volumeSliderRef: React.RefObject<HTMLDivElement | null>;
    subtitles: Array<{ language: string; filename: string; path: string }>;
    subtitlesEnabled: boolean;
    isLooping: boolean;
    subtitleMenuAnchor: HTMLElement | null;
    onPlayPause: () => void;
    onSeek: (seconds: number) => void;
    onProgressChange: (value: number) => void;
    onProgressChangeCommitted: (value: number) => void;
    onProgressMouseDown: () => void;
    onVolumeChange: (value: number) => void;
    onVolumeClick: () => void;
    onVolumeMouseEnter: () => void;
    onVolumeMouseLeave: () => void;
    onSliderMouseEnter: () => void;
    onSliderMouseLeave: () => void;
    onSubtitleClick: (event: React.MouseEvent<HTMLElement>) => void;
    onCloseSubtitleMenu: () => void;
    onSelectSubtitle: (index: number) => void;
    onToggleFullscreen: () => void;
    onToggleLoop: () => void;
    onControlsMouseEnter: () => void;
    isCinemaMode?: boolean;
    onToggleCinemaMode?: () => void;
    onUploadSubtitle?: (file: File) => void;
    onDeleteSubtitle?: (index: number) => void | Promise<void>;
}

const ControlsOverlay: React.FC<ControlsOverlayProps> = ({
    isFullscreen,
    controlsVisible,
    isPlaying,
    currentTime,
    duration,
    // isDragging,
    volume,
    showVolumeSlider,
    volumeSliderRef,
    subtitles,
    subtitlesEnabled,
    isLooping,
    subtitleMenuAnchor,
    onPlayPause,
    onSeek,
    onProgressChange,
    onProgressChangeCommitted,
    onProgressMouseDown,
    onVolumeChange,
    onVolumeClick,
    onVolumeMouseEnter,
    onVolumeMouseLeave,
    onSliderMouseEnter,
    onSliderMouseLeave,
    onSubtitleClick,
    onCloseSubtitleMenu,
    onSelectSubtitle,
    onToggleFullscreen,
    onToggleLoop,
    onControlsMouseEnter,
    isCinemaMode = false,
    onToggleCinemaMode,
    onUploadSubtitle,
    onDeleteSubtitle
}) => {
    const theme = useTheme();
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    return (
        <Box
            sx={{
                p: 1,
                bgcolor: theme.palette.mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
                opacity: isFullscreen
                    ? (controlsVisible ? 0.3 : 0)
                    : 1,
                visibility: isFullscreen && !controlsVisible ? 'hidden' : 'visible',
                transition: 'opacity 0.3s, visibility 0.3s, background-color 0.3s',
                pointerEvents: isFullscreen && !controlsVisible ? 'none' : 'auto',
                '&:hover': {
                    opacity: isFullscreen && controlsVisible ? 1 : (isFullscreen ? 0 : 1)
                }
            }}
            onMouseEnter={onControlsMouseEnter}
        >
            {/* Progress Bar */}
            <Box sx={{ px: { xs: 0.5, sm: 2 }, mb: 1 }}>
                <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} alignItems="center">
                    {/* Left Side: Volume and Play */}
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mr: { xs: 0.5, sm: 1 } }}>
                        <VolumeControl
                            volume={volume}
                            showVolumeSlider={showVolumeSlider}
                            volumeSliderRef={volumeSliderRef}
                            onVolumeChange={onVolumeChange}
                            onVolumeClick={onVolumeClick}
                            onMouseEnter={onVolumeMouseEnter}
                            onMouseLeave={onVolumeMouseLeave}
                            onSliderMouseEnter={onSliderMouseEnter}
                            onSliderMouseLeave={onSliderMouseLeave}
                        />

                        {/* Play/Pause */}
                        <Tooltip title={isPlaying ? t('paused') : t('playing')} disableHoverListener={isTouch}>
                            <IconButton
                                color={isPlaying ? "secondary" : "primary"}
                                onClick={onPlayPause}
                                size="small"
                            >
                                {isPlaying ? <Pause /> : <PlayArrow />}
                            </IconButton>
                        </Tooltip>
                    </Stack>

                    <ProgressBar
                        currentTime={currentTime}
                        duration={duration}
                        onProgressChange={onProgressChange}
                        onProgressChangeCommitted={onProgressChangeCommitted}
                        onProgressMouseDown={onProgressMouseDown}
                    />

                    {/* Subtitle Button (Mobile only, next to progress bar) */}
                    <SubtitleControl
                        subtitles={subtitles}
                        subtitlesEnabled={subtitlesEnabled}
                        subtitleMenuAnchor={subtitleMenuAnchor}
                        onSubtitleClick={onSubtitleClick}
                        onCloseMenu={onCloseSubtitleMenu}
                        onSelectSubtitle={onSelectSubtitle}
                        showOnMobile={true}
                        onUploadSubtitle={onUploadSubtitle}
                        onDeleteSubtitle={onDeleteSubtitle}
                    />

                    {/* Right Side: Fullscreen, Cinema Mode (large screens only), Subtitle, Loop (Desktop only) */}
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 1, display: { xs: 'none', sm: 'flex' } }}>
                        <FullscreenControl
                            isFullscreen={isFullscreen}
                            onToggle={onToggleFullscreen}
                        />

                        {/* Cinema Mode - only on large screens (lg and above) */}
                        {onToggleCinemaMode && (
                            <Box sx={{ display: { xs: 'none', sm: 'none', lg: 'block' } }}>
                                <CinemaModeControl
                                    isCinemaMode={isCinemaMode}
                                    onToggle={onToggleCinemaMode}
                                />
                            </Box>
                        )}

                        <SubtitleControl
                            subtitles={subtitles}
                            subtitlesEnabled={subtitlesEnabled}
                            subtitleMenuAnchor={subtitleMenuAnchor}
                            onSubtitleClick={onSubtitleClick}
                            onCloseMenu={onCloseSubtitleMenu}
                            onSelectSubtitle={onSelectSubtitle}
                            onUploadSubtitle={onUploadSubtitle}
                            onDeleteSubtitle={onDeleteSubtitle}
                        />

                        <LoopControl
                            isLooping={isLooping}
                            onToggle={onToggleLoop}
                        />
                    </Stack>
                </Stack>
            </Box>

            {/* Seek Controls */}
            <PlaybackControls
                isPlaying={isPlaying}
                onPlayPause={onPlayPause}
                onSeek={onSeek}
            />

            {/* Mobile: Fullscreen, Loop */}
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ display: { xs: 'flex', sm: 'none' }, ml: 1, justifyContent: 'center', mt: 1 }}>
                <FullscreenControl
                    isFullscreen={isFullscreen}
                    onToggle={onToggleFullscreen}
                />

                <LoopControl
                    isLooping={isLooping}
                    onToggle={onToggleLoop}
                />
            </Stack>
        </Box>
    );
};

export default ControlsOverlay;

