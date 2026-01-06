import { Box } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import ControlsOverlay from './ControlsOverlay';
import { useFocusPause } from './hooks/useFocusPause';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSubtitles } from './hooks/useSubtitles';
import { useVideoLoading } from './hooks/useVideoLoading';
import { useVideoPlayer } from './hooks/useVideoPlayer';
import { useVolume } from './hooks/useVolume';
import VideoElement from './VideoElement';

interface VideoControlsProps {
    src: string;
    autoPlay?: boolean;
    autoLoop?: boolean;
    pauseOnFocusLoss?: boolean;
    onTimeUpdate?: (currentTime: number) => void;
    onLoadedMetadata?: (duration: number) => void;
    startTime?: number;
    subtitles?: Array<{ language: string; filename: string; path: string }>;
    subtitlesEnabled?: boolean;
    onSubtitlesToggle?: (enabled: boolean) => void;
    onLoopToggle?: (enabled: boolean) => void;
    onEnded?: () => void;
    poster?: string;
}

const VideoControls: React.FC<VideoControlsProps> = ({
    src,
    autoPlay = false,
    autoLoop = false,
    pauseOnFocusLoss = false,
    onTimeUpdate,
    onLoadedMetadata,
    startTime = 0,
    subtitles = [],
    subtitlesEnabled: initialSubtitlesEnabled = true,
    onSubtitlesToggle,
    onLoopToggle,
    onEnded,
    poster
}) => {
    // Core video player logic
    const videoPlayer = useVideoPlayer({
        src,
        autoPlay,
        autoLoop,
        startTime,
        onTimeUpdate,
        onLoadedMetadata
    });

    // Auto-pause on focus loss
    useFocusPause(videoPlayer.videoRef, pauseOnFocusLoss);

    // Fullscreen management
    const fullscreen = useFullscreen(videoPlayer.videoRef);

    // Loading and error states
    const loading = useVideoLoading();

    // Volume control
    const volume = useVolume(videoPlayer.videoRef);

    // Subtitle management
    const subtitlesHook = useSubtitles({
        subtitles,
        initialSubtitlesEnabled,
        videoRef: videoPlayer.videoRef,
        onSubtitlesToggle
    });

    // Memoize seek callbacks to prevent unnecessary re-registration of keyboard listeners
    const handleSeekLeft = useCallback(() => {
        videoPlayer.handleSeek(-10);
    }, [videoPlayer.handleSeek]);

    const handleSeekRight = useCallback(() => {
        videoPlayer.handleSeek(10);
    }, [videoPlayer.handleSeek]);

    // Keyboard shortcuts
    useKeyboardShortcuts({
        onSeekLeft: handleSeekLeft,
        onSeekRight: handleSeekRight
    });

    // Handle video source changes - trigger loading
    useEffect(() => {
        if (src) {
            loading.startLoading();
        } else {
            loading.stopLoading();
            loading.setError(null);
        }
    }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

    // Handle video loading events
    const handleLoadStart = () => {
        loading.startLoading();
        const videoElement = videoPlayer.videoRef.current;
        if (videoElement) {
            videoElement.preload = 'metadata';
        }
    };

    const handleCanPlay = () => {
        loading.stopLoading();
    };

    const handleLoadedData = () => {
        loading.stopLoading();
    };

    const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        loading.stopLoading();
        videoPlayer.handleLoadedMetadata(e);
    };

    // Note: onVolumeChange from video element is handled by the useVolume hook
    // through the useEffect that syncs volume state with the video element

    const handleToggleLoop = () => {
        const newState = videoPlayer.handleToggleLoop();
        if (onLoopToggle) {
            onLoopToggle(newState);
        }
    };

    return (
        <Box
            ref={fullscreen.videoContainerRef}
            sx={{ width: '100%', bgcolor: 'black', borderRadius: { xs: 0, sm: 2 }, overflow: 'hidden', boxShadow: 4, position: 'relative' }}
        >
            <VideoElement
                videoRef={videoPlayer.videoRef}
                src={src}
                poster={poster}
                isLoading={loading.isLoading}
                loadError={loading.loadError}
                subtitles={subtitles}
                onClick={videoPlayer.handlePlayPause}
                onPlay={videoPlayer.handlePlay}
                onPause={videoPlayer.handlePause}
                onEnded={onEnded}
                onTimeUpdate={videoPlayer.handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onError={loading.handleVideoError}
                onLoadStart={handleLoadStart}
                onCanPlay={handleCanPlay}
                onLoadedData={handleLoadedData}
                onSubtitleInit={subtitlesHook.initializeSubtitles}
            />

            <ControlsOverlay
                isFullscreen={fullscreen.isFullscreen}
                controlsVisible={fullscreen.controlsVisible}
                isPlaying={videoPlayer.isPlaying}
                currentTime={videoPlayer.currentTime}
                duration={videoPlayer.duration}
                isDragging={videoPlayer.isDragging}
                volume={volume.volume}
                showVolumeSlider={volume.showVolumeSlider}
                volumeSliderRef={volume.volumeSliderRef}
                subtitles={subtitles}
                subtitlesEnabled={subtitlesHook.subtitlesEnabled}
                isLooping={videoPlayer.isLooping}
                subtitleMenuAnchor={subtitlesHook.subtitleMenuAnchor}
                onPlayPause={videoPlayer.handlePlayPause}
                onSeek={videoPlayer.handleSeek}
                onProgressChange={videoPlayer.handleProgressChange}
                onProgressChangeCommitted={videoPlayer.handleProgressChangeCommitted}
                onProgressMouseDown={videoPlayer.handleProgressMouseDown}
                onVolumeChange={volume.handleVolumeChange}
                onVolumeClick={volume.handleVolumeClick}
                onVolumeMouseEnter={volume.handleVolumeMouseEnter}
                onVolumeMouseLeave={volume.handleVolumeMouseLeave}
                onSliderMouseEnter={volume.handleSliderMouseEnter}
                onSliderMouseLeave={volume.handleSliderMouseLeave}
                onSubtitleClick={subtitlesHook.handleSubtitleClick}
                onCloseSubtitleMenu={subtitlesHook.handleCloseSubtitleMenu}
                onSelectSubtitle={subtitlesHook.handleSelectSubtitle}
                onToggleFullscreen={fullscreen.handleToggleFullscreen}
                onToggleLoop={handleToggleLoop}
                onControlsMouseEnter={fullscreen.handleControlsMouseEnter}
            />
        </Box>
    );
};

export default VideoControls;

