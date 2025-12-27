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
    SubtitlesOff,
    VolumeDown,
    VolumeOff,
    VolumeUp
} from '@mui/icons-material';
import {
    Box,
    IconButton,
    Menu,
    MenuItem,
    Slider,
    Stack,
    Tooltip,
    Typography,
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
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isLooping, setIsLooping] = useState<boolean>(autoLoop);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(initialSubtitlesEnabled && subtitles.length > 0);
    const [currentTime, setCurrentTime] = useState<number>(0);
    const [duration, setDuration] = useState<number>(0);
    const [volume, setVolume] = useState<number>(1);
    const [previousVolume, setPreviousVolume] = useState<number>(1);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);
    const volumeSliderRef = useRef<HTMLDivElement>(null);
    const volumeSliderHideTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [controlsVisible, setControlsVisible] = useState<boolean>(true);
    const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
    const videoContainerRef = useRef<HTMLDivElement>(null);

    const [subtitleMenuAnchor, setSubtitleMenuAnchor] = useState<null | HTMLElement>(null);
    const wasPlayingBeforeHidden = useRef<boolean>(false);
    const videoSrcRef = useRef<string>('');
    const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Handle Page Visibility API for mobile browsers
    useEffect(() => {
        const handleVisibilityChange = () => {
            const videoElement = videoRef.current;
            if (!videoElement) return;

            if (document.hidden) {
                // Page is hidden (user switched apps)
                wasPlayingBeforeHidden.current = !videoElement.paused;
                if (wasPlayingBeforeHidden.current) {
                    videoElement.pause();
                }
            } else {
                // Page is visible again
                // Wait a bit for the page to fully restore before resuming
                setTimeout(() => {
                    if (wasPlayingBeforeHidden.current && videoElement && !document.hidden) {
                        videoElement.play().catch(err => {
                            console.error('Error resuming playback:', err);
                            setIsPlaying(false);
                        });
                    }
                }, 100);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    // Memory management: Clean up video source when component unmounts or src changes
    useEffect(() => {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        // Store previous src for cleanup
        const previousSrc = videoSrcRef.current;
        videoSrcRef.current = src;

        // Clean up previous source to free memory
        if (previousSrc && previousSrc !== src) {
            // Clear previous source
            videoElement.pause();
            videoElement.src = '';
            videoElement.load();
            setIsLoading(false);
            setLoadError(null);
        }

        // Set new source with memory optimization
        if (src) {
            setIsLoading(true);
            setLoadError(null);
            
            // Clear any existing timeout
            if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
            }

            // Set a timeout for loading (30 seconds for large files)
            loadTimeoutRef.current = setTimeout(() => {
                if (videoElement.readyState < 2) { // HAVE_CURRENT_DATA
                    console.warn('Video loading is taking too long');
                    setLoadError('Video is taking too long to load. Please try again or check your connection.');
                    setIsLoading(false);
                }
            }, 30000);

            // Use preload="metadata" for large files to reduce initial memory usage
            videoElement.preload = 'metadata';
            videoElement.src = src;
            
            // For mobile browsers, try to load the video
            const handleCanPlay = () => {
                setIsLoading(false);
                if (loadTimeoutRef.current) {
                    clearTimeout(loadTimeoutRef.current);
                    loadTimeoutRef.current = null;
                }
            };

            const handleLoadedData = () => {
                setIsLoading(false);
                if (loadTimeoutRef.current) {
                    clearTimeout(loadTimeoutRef.current);
                    loadTimeoutRef.current = null;
                }
            };

            const handleError = () => {
                setIsLoading(false);
                setLoadError('Failed to load video. Please try refreshing the page.');
                if (loadTimeoutRef.current) {
                    clearTimeout(loadTimeoutRef.current);
                    loadTimeoutRef.current = null;
                }
            };

            videoElement.addEventListener('canplay', handleCanPlay);
            videoElement.addEventListener('loadeddata', handleLoadedData);
            videoElement.addEventListener('error', handleError);

            return () => {
                videoElement.removeEventListener('canplay', handleCanPlay);
                videoElement.removeEventListener('loadeddata', handleLoadedData);
                videoElement.removeEventListener('error', handleError);
                if (loadTimeoutRef.current) {
                    clearTimeout(loadTimeoutRef.current);
                }
            };
        }

        return () => {
            // Cleanup on unmount
            if (videoElement) {
                videoElement.pause();
                videoElement.src = '';
                videoElement.load();
            }
            if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
            }
        };
    }, [src]);

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
            // Initialize volume
            videoRef.current.volume = volume;
        }
    }, [autoPlay, autoLoop, volume]);

    // Listen for duration changes (in case duration becomes available after metadata load)
    useEffect(() => {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        const handleDurationChange = () => {
            const videoDuration = videoElement.duration;
            // Update duration for display
            setDuration(videoDuration);
        };

        videoElement.addEventListener('durationchange', handleDurationChange);
        return () => {
            videoElement.removeEventListener('durationchange', handleDurationChange);
        };
    }, []);

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

    // Handle controls visibility in fullscreen mode
    useEffect(() => {
        const startHideTimer = () => {
            if (hideControlsTimerRef.current) {
                clearTimeout(hideControlsTimerRef.current);
            }
            
            if (isFullscreen) {
                // Show controls first
                setControlsVisible(true);
                
                // After 5 seconds, hide completely
                hideControlsTimerRef.current = setTimeout(() => {
                    setControlsVisible(false);
                }, 5000);
            } else {
                // Always show controls when not in fullscreen
                setControlsVisible(true);
                if (hideControlsTimerRef.current) {
                    clearTimeout(hideControlsTimerRef.current);
                }
            }
        };

        startHideTimer();

        return () => {
            if (hideControlsTimerRef.current) {
                clearTimeout(hideControlsTimerRef.current);
            }
        };
    }, [isFullscreen]);

    // Handle mouse movement to show controls in fullscreen
    useEffect(() => {
        if (!isFullscreen) return;

        const handleMouseMove = () => {
            setControlsVisible(true);
            
            // Reset timer on mouse move
            if (hideControlsTimerRef.current) {
                clearTimeout(hideControlsTimerRef.current);
            }
            
            // Hide again after 5 seconds of no movement
            hideControlsTimerRef.current = setTimeout(() => {
                setControlsVisible(false);
            }, 5000);
        };

        const container = videoContainerRef.current;
        if (container) {
            container.addEventListener('mousemove', handleMouseMove);
            return () => {
                container.removeEventListener('mousemove', handleMouseMove);
            };
        }
    }, [isFullscreen]);

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

    const handleProgressChange = (_event: Event, newValue: number | number[]) => {
        if (!videoRef.current || duration <= 0 || !isFinite(duration)) return;
        const value = Array.isArray(newValue) ? newValue[0] : newValue;
        const newTime = (value / 100) * duration;
        setCurrentTime(newTime);
    };

    const handleProgressChangeCommitted = (_event: Event | React.SyntheticEvent, newValue: number | number[]) => {
        if (videoRef.current && duration > 0 && isFinite(duration)) {
            const value = Array.isArray(newValue) ? newValue[0] : newValue;
            const newTime = (value / 100) * duration;
            videoRef.current.currentTime = newTime;
            setCurrentTime(newTime);
            setIsDragging(false);
        }
    };

    const handleProgressMouseDown = () => {
        setIsDragging(true);
    };

    const handleVolumeChange = (_event: Event, newValue: number | number[]) => {
        if (videoRef.current) {
            const value = Array.isArray(newValue) ? newValue[0] : newValue;
            const volumeValue = value / 100;
            videoRef.current.volume = volumeValue;
            setVolume(volumeValue);
        }
    };

    const handleVolumeClick = () => {
        if (videoRef.current) {
            if (volume > 0) {
                // Mute: save current volume and set to 0
                setPreviousVolume(volume);
                videoRef.current.volume = 0;
                setVolume(0);
            } else {
                // Unmute: restore previous volume
                const volumeToRestore = previousVolume > 0 ? previousVolume : 1;
                videoRef.current.volume = volumeToRestore;
                setVolume(volumeToRestore);
            }
        }
    };

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

    const getVolumeIcon = () => {
        if (volume === 0) return <VolumeOff />;
        if (volume < 0.5) return <VolumeDown />;
        return <VolumeUp />;
    };

    // Close volume slider when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (volumeSliderRef.current && !volumeSliderRef.current.contains(event.target as Node)) {
                if (volumeSliderHideTimerRef.current) {
                    clearTimeout(volumeSliderHideTimerRef.current);
                }
                setShowVolumeSlider(false);
            }
        };

        if (showVolumeSlider) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showVolumeSlider]);

    // Handle wheel event on volume control with native listener to properly prevent default
    useEffect(() => {
        const handleWheel = (event: WheelEvent) => {
            if (volumeSliderRef.current && volumeSliderRef.current.contains(event.target as Node)) {
                event.preventDefault();
                event.stopPropagation();
                if (videoRef.current) {
                    const delta = event.deltaY > 0 ? 0.05 : -0.05; // Scroll down decreases, scroll up increases
                    const newVolume = Math.max(0, Math.min(1, volume + delta));
                    videoRef.current.volume = newVolume;
                    setVolume(newVolume);
                    // Update previousVolume if not muted
                    if (newVolume > 0) {
                        setPreviousVolume(newVolume);
                    }
                }
            }
        };

        const container = volumeSliderRef.current;
        if (container) {
            container.addEventListener('wheel', handleWheel, { passive: false });
            return () => {
                container.removeEventListener('wheel', handleWheel);
            };
        }
    }, [volume, videoRef]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (volumeSliderHideTimerRef.current) {
                clearTimeout(volumeSliderHideTimerRef.current);
            }
        };
    }, []);

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
        <Box 
            ref={videoContainerRef}
            sx={{ width: '100%', bgcolor: 'black', borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden', boxShadow: 4, position: 'relative' }}
        >
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

            {/* Loading indicator */}
            {isLoading && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                        bgcolor: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: 2,
                        p: 2,
                        color: 'white'
                    }}
                >
                    <Typography variant="body2">{t('loadingVideo') || 'Loading video...'}</Typography>
                </Box>
            )}

            {/* Error message */}
            {loadError && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                        bgcolor: 'rgba(211, 47, 47, 0.9)',
                        borderRadius: 2,
                        p: 2,
                        color: 'white',
                        maxWidth: '80%',
                        textAlign: 'center'
                    }}
                >
                    <Typography variant="body2">{loadError}</Typography>
                </Box>
            )}

            <video
                ref={videoRef}
                style={{ width: '100%', aspectRatio: '16/9', display: 'block', cursor: 'pointer' }}
                controls={false}
                src={src}
                preload="metadata"
                onClick={handlePlayPause}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={onEnded}
                onTimeUpdate={(e) => {
                    const time = e.currentTarget.currentTime;
                    if (!isDragging) {
                        setCurrentTime(time);
                    }
                    if (onTimeUpdate) {
                        onTimeUpdate(time);
                    }
                }}
                onLoadedMetadata={(e) => {
                    const videoDuration = e.currentTarget.duration;
                    // Set duration for display (even if 0 or NaN, formatTime will handle it)
                    setDuration(videoDuration);
                    if (startTime > 0) {
                        e.currentTarget.currentTime = startTime;
                        setCurrentTime(startTime);
                    }
                    if (onLoadedMetadata) {
                        onLoadedMetadata(videoDuration);
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
                onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume);
                }}
                onError={(e) => {
                    console.error('Video error:', e);
                    setIsLoading(false);
                    const videoElement = e.currentTarget;
                    if (videoElement.error) {
                        console.error('Video error code:', videoElement.error.code);
                        console.error('Video error message:', videoElement.error.message);
                        // Provide user-friendly error messages
                        let errorMessage = 'Failed to load video.';
                        switch (videoElement.error?.code) {
                            case 1: // MEDIA_ERR_ABORTED
                                errorMessage = 'Video loading was aborted.';
                                break;
                            case 2: // MEDIA_ERR_NETWORK
                                errorMessage = 'Network error while loading video. Please check your connection.';
                                break;
                            case 3: // MEDIA_ERR_DECODE
                                errorMessage = 'Video decoding error. The file may be corrupted.';
                                break;
                            case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
                                errorMessage = 'Video format not supported.';
                                break;
                        }
                        setLoadError(errorMessage);
                    }
                    if (loadTimeoutRef.current) {
                        clearTimeout(loadTimeoutRef.current);
                        loadTimeoutRef.current = null;
                    }
                }}
                onLoadStart={() => {
                    setIsLoading(true);
                    setLoadError(null);
                    // Optimize for large files: use streaming when available
                    const videoElement = videoRef.current;
                    if (videoElement) {
                        // For large files, we want to load progressively
                        videoElement.preload = 'metadata';
                    }
                }}
                onCanPlay={() => {
                    setIsLoading(false);
                    if (loadTimeoutRef.current) {
                        clearTimeout(loadTimeoutRef.current);
                        loadTimeoutRef.current = null;
                    }
                }}
                onLoadedData={() => {
                    setIsLoading(false);
                    if (loadTimeoutRef.current) {
                        clearTimeout(loadTimeoutRef.current);
                        loadTimeoutRef.current = null;
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
                onMouseEnter={() => {
                    if (isFullscreen) {
                        setControlsVisible(true);
                        if (hideControlsTimerRef.current) {
                            clearTimeout(hideControlsTimerRef.current);
                        }
                        hideControlsTimerRef.current = setTimeout(() => {
                            setControlsVisible(false);
                        }, 5000);
                    }
                }}
            >
                {/* Progress Bar */}
                <Box sx={{ px: { xs: 0.5, sm: 2 }, mb: 1 }}>
                    <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} alignItems="center">
                        {/* Left Side: Volume and Play */}
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mr: { xs: 0.5, sm: 1 } }}>
                            {/* Volume Control (Hidden on mobile/tablet, shown on desktop) */}
                            <Box 
                                ref={volumeSliderRef} 
                                sx={{ 
                                    position: 'relative', 
                                    display: { xs: 'none', md: 'flex' }, 
                                    alignItems: 'center' 
                                }}
                                onMouseEnter={() => {
                                    if (volumeSliderHideTimerRef.current) {
                                        clearTimeout(volumeSliderHideTimerRef.current);
                                    }
                                    setShowVolumeSlider(true);
                                }}
                                onMouseLeave={() => {
                                    // Add a small delay to allow moving cursor to slider
                                    volumeSliderHideTimerRef.current = setTimeout(() => {
                                        setShowVolumeSlider(false);
                                    }, 200);
                                }}
                            >
                                <Tooltip title={volume === 0 ? 'Unmute' : 'Mute'} disableHoverListener={isTouch}>
                                    <IconButton
                                        onClick={handleVolumeClick}
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
                                        onMouseEnter={() => {
                                            if (volumeSliderHideTimerRef.current) {
                                                clearTimeout(volumeSliderHideTimerRef.current);
                                            }
                                        }}
                                        onMouseLeave={() => {
                                            volumeSliderHideTimerRef.current = setTimeout(() => {
                                                setShowVolumeSlider(false);
                                            }, 200);
                                        }}
                                    >
                                        <Slider
                                            orientation="vertical"
                                            value={volume * 100}
                                            onChange={handleVolumeChange}
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

                            {/* Play/Pause */}
                            <Tooltip title={isPlaying ? t('paused') : t('playing')} disableHoverListener={isTouch}>
                                <IconButton
                                    color={isPlaying ? "secondary" : "primary"}
                                    onClick={handlePlayPause}
                                    size="small"
                                >
                                    {isPlaying ? <Pause /> : <PlayArrow />}
                                </IconButton>
                            </Tooltip>
                        </Stack>
                        
                        <Typography variant="caption" sx={{ minWidth: { xs: '35px', sm: '45px' }, textAlign: 'right', fontSize: '0.75rem' }}>
                            {formatTime(currentTime)}
                        </Typography>
                        <Slider
                            value={duration > 0 && isFinite(duration) ? (currentTime / duration) * 100 : 0}
                            onChange={handleProgressChange}
                            onChangeCommitted={handleProgressChangeCommitted}
                            onMouseDown={handleProgressMouseDown}
                            disabled={duration <= 0 || !isFinite(duration)}
                            size="small"
                            sx={{
                                flex: 1,
                                color: theme.palette.primary.main,
                                transition: 'all 0.2s ease',
                                '& .MuiSlider-thumb': {
                                    width: 12,
                                    height: 12,
                                    transition: 'width 0.2s, height 0.2s',
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
                        <Typography variant="caption" sx={{ minWidth: { xs: '35px', sm: '45px' }, textAlign: 'left', fontSize: '0.75rem' }}>
                            {formatTime(duration)}
                        </Typography>

                        {/* Subtitle Button (Mobile only, next to progress bar) */}
                        {subtitles && subtitles.length > 0 && (
                            <>
                                <Tooltip title={subtitlesEnabled ? 'Subtitles' : 'Subtitles Off'} disableHoverListener={isTouch}>
                                    <IconButton
                                        color={subtitlesEnabled ? "primary" : "default"}
                                        onClick={handleSubtitleClick}
                                        size="small"
                                        sx={{ display: { xs: 'flex', sm: 'none' }, ml: { xs: 0.25, sm: 0.5 } }}
                                    >
                                        {subtitlesEnabled ? <Subtitles /> : <SubtitlesOff />}
                                    </IconButton>
                                </Tooltip>
                            </>
                        )}

                        {/* Right Side: Fullscreen, Subtitle, Loop (Desktop only) */}
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 1, display: { xs: 'none', sm: 'flex' } }}>
                            {/* Fullscreen */}
                            <Tooltip title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')} disableHoverListener={isTouch}>
                                <IconButton
                                    onClick={handleToggleFullscreen}
                                    size="small"
                                >
                                    {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                                </IconButton>
                            </Tooltip>

                            {/* Subtitle */}
                            {subtitles && subtitles.length > 0 && (
                                <>
                                    <Tooltip title={subtitlesEnabled ? 'Subtitles' : 'Subtitles Off'} disableHoverListener={isTouch}>
                                        <IconButton
                                            color={subtitlesEnabled ? "primary" : "default"}
                                            onClick={handleSubtitleClick}
                                            size="small"
                                        >
                                            {subtitlesEnabled ? <Subtitles /> : <SubtitlesOff />}
                                        </IconButton>
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

                            {/* Loop */}
                            <Tooltip title={`${t('loop')} ${isLooping ? t('on') : t('off')}`} disableHoverListener={isTouch}>
                                <IconButton
                                    color={isLooping ? "primary" : "default"}
                                    onClick={handleToggleLoop}
                                    size="small"
                                >
                                    <Loop />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    </Stack>
                </Box>

                {/* Seek Controls */}
                <Stack
                    direction="row"
                    spacing={0.5}
                    justifyContent="center"
                    alignItems="center"
                    sx={{ width: '100%', flexWrap: 'wrap' }}
                >
                        <Tooltip title="-10m" disableHoverListener={isTouch}>
                            <IconButton 
                                onClick={() => handleSeek(-600)} 
                                size="small"
                                sx={{ padding: { xs: '10px', sm: '8px' } }}
                            >
                                <KeyboardDoubleArrowLeft />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="-1m" disableHoverListener={isTouch}>
                            <IconButton 
                                onClick={() => handleSeek(-60)} 
                                size="small"
                                sx={{ padding: { xs: '10px', sm: '8px' } }}
                            >
                                <FastRewind />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="-10s" disableHoverListener={isTouch}>
                            <IconButton 
                                onClick={() => handleSeek(-10)} 
                                size="small"
                                sx={{ padding: { xs: '10px', sm: '8px' } }}
                            >
                                <Replay10 />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="+10s" disableHoverListener={isTouch}>
                            <IconButton 
                                onClick={() => handleSeek(10)} 
                                size="small"
                                sx={{ padding: { xs: '10px', sm: '8px' } }}
                            >
                                <Forward10 />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="+1m" disableHoverListener={isTouch}>
                            <IconButton 
                                onClick={() => handleSeek(60)} 
                                size="small"
                                sx={{ padding: { xs: '10px', sm: '8px' } }}
                            >
                                <FastForward />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="+10m" disableHoverListener={isTouch}>
                            <IconButton 
                                onClick={() => handleSeek(600)} 
                                size="small"
                                sx={{ padding: { xs: '10px', sm: '8px' } }}
                            >
                                <KeyboardDoubleArrowRight />
                            </IconButton>
                        </Tooltip>

                        {/* Mobile: Fullscreen, Loop */}
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ display: { xs: 'flex', sm: 'none' }, ml: 1 }}>
                            {/* Fullscreen */}
                            <Tooltip title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')} disableHoverListener={isTouch}>
                                <IconButton
                                    onClick={handleToggleFullscreen}
                                    size="small"
                                >
                                    {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
                                </IconButton>
                            </Tooltip>

                            {/* Loop */}
                            <Tooltip title={`${t('loop')} ${isLooping ? t('on') : t('off')}`} disableHoverListener={isTouch}>
                                <IconButton
                                    color={isLooping ? "primary" : "default"}
                                    onClick={handleToggleLoop}
                                    size="small"
                                >
                                    <Loop />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    </Stack>
            </Box>
        </Box>
    );
};

export default VideoControls;
