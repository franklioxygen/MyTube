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
    Replay10
} from '@mui/icons-material';
import {
    Box,
    Button,
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
}

const VideoControls: React.FC<VideoControlsProps> = ({
    src,
    autoPlay = false,
    autoLoop = false,
    onTimeUpdate,
    onLoadedMetadata,
    startTime = 0
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { t } = useLanguage();

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isLooping, setIsLooping] = useState<boolean>(autoLoop);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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
            videoRef.current.loop = !isLooping;
            setIsLooping(!isLooping);
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

    return (
        <Box sx={{ width: '100%', bgcolor: 'black', borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden', boxShadow: 4, position: 'relative' }}>
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
                onTimeUpdate={(e) => onTimeUpdate && onTimeUpdate(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                    if (startTime > 0) {
                        e.currentTarget.currentTime = startTime;
                    }
                    if (onLoadedMetadata) {
                        onLoadedMetadata(e.currentTarget.duration);
                    }
                }}
                playsInline
            >
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
                                variant="contained"
                                color={isPlaying ? "warning" : "primary"}
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
                    </Stack>

                    {/* Row 2 on Mobile: Seek Controls */}
                    <Stack direction="row" spacing={1} justifyContent="center" width={{ xs: '100%', sm: 'auto' }}>
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
