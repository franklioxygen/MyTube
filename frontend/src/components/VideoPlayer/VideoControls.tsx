import {
    FastForward,
    FastRewind,
    Forward10,
    Fullscreen,
    FullscreenExit,
    KeyboardDoubleArrowLeft,
    KeyboardDoubleArrowRight,
    Loop,
    Pause,
    PlayArrow,
    Replay10,
    Subtitles,
    SubtitlesOff
} from '@mui/icons-material';
import {
    Box,
    Button,
    Menu,
    MenuItem,
    Stack,
    Tooltip,
    useMediaQuery,
    useTheme
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

interface VideoControlsProps {
    src: string;
    autoPlay?: boolean;
    autoLoop?: boolean;
    onTimeUpdate?: (currentTime: number) => void;
    onLoadedMetadata?: (duration: number) => void;
    startTime?: number;
    subtitles?: Array<{ language: string; filename: string; path: string }>;
    subtitlesEnabled?: boolean;
    onSubtitlesToggle?: (enabled: boolean) => void;
    onLoopToggle?: (enabled: boolean) => void;
    onEnded?: () => void;
}

const VideoControls: React.FC<VideoControlsProps> = ({
    src,
    autoPlay = false,
    autoLoop = false,
    onTimeUpdate,
    onLoadedMetadata,
    startTime = 0,
    subtitles = [],
    subtitlesEnabled: initialSubtitlesEnabled = true,
    onSubtitlesToggle,
    onLoopToggle,
    onEnded
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { t } = useLanguage();

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isLooping, setIsLooping] = useState<boolean>(autoLoop);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(initialSubtitlesEnabled && subtitles.length > 0);

    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);

    useEffect(() => {
        if (videoRef.current) {
            if (autoPlay) {
                videoRef.current.autoplay = true;
                // We don't set isPlaying(true) here immediately because autoplay might be blocked
                // The onPlay event handler will handle the state update
            }
            if (autoLoop) {
                videoRef.current.loop = true;
                setIsLooping(true);
            }
        }
    }, [autoPlay, autoLoop]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        const handleWebkitBeginFullscreen = () => {
            setIsFullscreen(true);
        };

        const handleWebkitEndFullscreen = () => {
            setIsFullscreen(false);
        };

        const videoElement = videoRef.current;

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        if (videoElement) {
            videoElement.addEventListener('webkitbeginfullscreen', handleWebkitBeginFullscreen);
            videoElement.addEventListener('webkitendfullscreen', handleWebkitEndFullscreen);
        }

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            if (videoElement) {
                videoElement.removeEventListener('webkitbeginfullscreen', handleWebkitBeginFullscreen);
                videoElement.removeEventListener('webkitendfullscreen', handleWebkitEndFullscreen);
            }
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input or textarea
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.key === 'ArrowLeft') {
                handleSeek(-10);
            } else if (e.key === 'ArrowRight') {
                handleSeek(10);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // Sync subtitle tracks when preference changes or subtitles become available
    useEffect(() => {
        if (videoRef.current && subtitles.length > 0) {
            const tracks = videoRef.current.textTracks;
            // If enabled, show the first track by default if none selected, or keep current
            // Actually, let's just respect the boolean for now.
            // If we want to support specific language selection persistence, we'd need more state.
            // For now, just show the first one if enabled.

            const newState = initialSubtitlesEnabled;
            setSubtitlesEnabled(newState);

            // Hide all first
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].mode = 'hidden';
            }

            // If enabled, show the first one (or the one matching browser lang if we were fancy, but let's stick to simple)
            if (newState && tracks.length > 0) {
                tracks[0].mode = 'showing';
            }
        }
    }, [initialSubtitlesEnabled, subtitles]);

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleToggleLoop = () => {
        if (videoRef.current) {
            const newState = !isLooping;
            videoRef.current.loop = newState;
            setIsLooping(newState);

            // Call the callback to save preference to database
            if (onLoopToggle) {
                onLoopToggle(newState);
            }
        }
    };

    const handleToggleFullscreen = () => {
        const videoContainer = videoRef.current?.parentElement;
        const videoElement = videoRef.current;

        if (!videoContainer || !videoElement) return;

        if (!document.fullscreenElement) {
            // Try standard fullscreen first (for Desktop, Android, iPad)
            if (videoContainer.requestFullscreen) {
                videoContainer.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            }
            // Fallback for iPhone Safari
            else if ((videoElement as any).webkitEnterFullscreen) {
                (videoElement as any).webkitEnterFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    const handleSeek = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    };

    const handleSubtitleClick = (event: React.MouseEvent<HTMLElement>) => {
        setSubtitleMenuAnchor(event.currentTarget);
    };

    const handleCloseSubtitleMenu = () => {
        setSubtitleMenuAnchor(null);
    };

    const handleSelectSubtitle = (index: number) => {
        if (videoRef.current) {
            const tracks = videoRef.current.textTracks;

            // Hide all tracks first
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].mode = 'hidden';
            }

            if (index >= 0 && index < tracks.length) {
                tracks[index].mode = 'showing';
                setSubtitlesEnabled(true);
                if (onSubtitlesToggle) onSubtitlesToggle(true);
            } else {
                setSubtitlesEnabled(false);
                if (onSubtitlesToggle) onSubtitlesToggle(false);
            }
        }
        handleCloseSubtitleMenu();
    };

    return (
        <Box sx={{ width: '100%', bgcolor: 'black', borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden', boxShadow: 4, position: 'relative' }}>
            {/* Global style for centering subtitles */}
            <style>
                {`
                    video::cue {
                        text-align: center !important;
                        line-height: 1.5;
                        background-color: rgba(0, 0, 0, 0.8);
                    }
                    
                    video::-webkit-media-text-track-display {
                        text-align: center !important;
                    }
                    
                    video::-webkit-media-text-track-container {
                        text-align: center !important;
                        display: flex;
                        justify-content: center;
                        align-items: flex-end;
                    }
                    
                    video::cue-region {
                        text-align: center !important;
                    }
                `}
            </style>

            <video
                ref={videoRef}
                style={{ width: '100%', aspectRatio: '16/9', display: 'block' }}
                controls={true} // Enable native controls as requested
                // The original code had `controls` attribute on the video tag, which enables native controls.
                // But it also rendered custom controls below it.
                // Let's keep it consistent with original: native controls enabled.

                src={src}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={onEnded}
                onTimeUpdate={(e) => onTimeUpdate && onTimeUpdate(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                    if (startTime > 0) {
                        e.currentTarget.currentTime = startTime;
                    }
                    if (onLoadedMetadata) {
                        onLoadedMetadata(e.currentTarget.duration);
                    }

                    // Initialize subtitle tracks based on preference
                    const tracks = e.currentTarget.textTracks;
                    const shouldShow = initialSubtitlesEnabled && subtitles.length > 0;

                    for (let i = 0; i < tracks.length; i++) {
                        tracks[i].mode = 'hidden';
                    }

                    if (shouldShow && tracks.length > 0) {
                        tracks[0].mode = 'showing';
                    }
                }}
                playsInline
                crossOrigin="anonymous"
            >
                {subtitles && subtitles.map((subtitle) => (
                    <track
                        key={subtitle.language}
                        kind="subtitles"
                        src={`${import.meta.env.VITE_BACKEND_URL}${subtitle.path}`}
                        srcLang={subtitle.language}
                        label={subtitle.language.toUpperCase()}
                    />
                ))}
                Your browser does not support the video tag.
            </video>

            {/* Custom Controls Area */}
            <Box sx={{
                p: 1,
                bgcolor: theme.palette.mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
                opacity: isFullscreen ? 0.3 : 1,
                transition: 'opacity 0.3s, background-color 0.3s',
                '&:hover': { opacity: 1 }
            }}>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems="center"
                    justifyContent="center"
                    spacing={{ xs: 2, sm: 2 }}
                >
                    {/* Row 1 on Mobile: Play/Pause and Loop */}
                    <Stack direction="row" spacing={2} justifyContent="center" width={{ xs: '100%', sm: 'auto' }}>
                        <Tooltip title={isPlaying ? t('paused') : t('playing')}>
                            <Button
                                variant={isPlaying ? "outlined" : "contained"}
                                color={isPlaying ? "secondary" : "primary"}
                                onClick={handlePlayPause}
                                fullWidth={isMobile}
                            >
                                {isPlaying ? <Pause /> : <PlayArrow />}
                            </Button>
                        </Tooltip>

                        <Tooltip title={`${t('loop')} ${isLooping ? t('on') : t('off')}`}>
                            <Button
                                variant={isLooping ? "contained" : "outlined"}
                                color="secondary"
                                onClick={handleToggleLoop}
                                fullWidth={isMobile}
                            >
                                <Loop />
                            </Button>
                        </Tooltip>

                        <Tooltip title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}>
                            <Button
                                variant="outlined"
                                onClick={handleToggleFullscreen}
                                fullWidth={isMobile}
                            >
                                {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                            </Button>
                        </Tooltip>

                        {subtitles && subtitles.length > 0 && (
                            <>
                                <Tooltip title={subtitlesEnabled ? 'Subtitles' : 'Subtitles Off'}>
                                    <Button
                                        variant={subtitlesEnabled ? "contained" : "outlined"}
                                        onClick={handleSubtitleClick}
                                        fullWidth={isMobile}
                                    >
                                        {subtitlesEnabled ? <Subtitles /> : <SubtitlesOff />}
                                    </Button>
                                </Tooltip>
                                <Menu
                                    anchorEl={subtitleMenuAnchor}
                                    open={Boolean(subtitleMenuAnchor)}
                                    onClose={handleCloseSubtitleMenu}
                                >
                                    <MenuItem onClick={() => handleSelectSubtitle(-1)}>
                                        {t('off') || 'Off'}
                                    </MenuItem>
                                    {subtitles.map((subtitle, index) => (
                                        <MenuItem key={subtitle.language} onClick={() => handleSelectSubtitle(index)}>
                                            {subtitle.language.toUpperCase()}
                                        </MenuItem>
                                    ))}
                                </Menu>
                            </>
                        )}
                    </Stack>

                    {/* Row 2 on Mobile: Seek Controls */}
                    <Stack direction="row" spacing={0.4} justifyContent="center" width={{ xs: '100%', sm: 'auto' }}>
                        <Tooltip title="-10m">
                            <Button variant="outlined" onClick={() => handleSeek(-600)}>
                                <KeyboardDoubleArrowLeft />
                            </Button>
                        </Tooltip>
                        <Tooltip title="-1m">
                            <Button variant="outlined" onClick={() => handleSeek(-60)}>
                                <FastRewind />
                            </Button>
                        </Tooltip>
                        <Tooltip title="-10s">
                            <Button variant="outlined" onClick={() => handleSeek(-10)}>
                                <Replay10 />
                            </Button>
                        </Tooltip>
                        <Tooltip title="+10s">
                            <Button variant="outlined" onClick={() => handleSeek(10)}>
                                <Forward10 />
                            </Button>
                        </Tooltip>
                        <Tooltip title="+1m">
                            <Button variant="outlined" onClick={() => handleSeek(60)}>
                                <FastForward />
                            </Button>
                        </Tooltip>
                        <Tooltip title="+10m">
                            <Button variant="outlined" onClick={() => handleSeek(600)}>
                                <KeyboardDoubleArrowRight />
                            </Button>
                        </Tooltip>
                    </Stack>
                </Stack>
            </Box>
        </Box>
    );
};

export default VideoControls;
