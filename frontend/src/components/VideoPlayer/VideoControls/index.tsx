import { Box } from '@mui/material';
import React, { useCallback, useEffect } from 'react';
import { useLiveTranslationControl } from '../../../contexts/LiveTranslationContext';
import { neutral } from '../../../theme/colors';
import { useStatisticsWatchTracker } from '../../../hooks/useStatisticsWatchTracker';
import {
    DEFAULT_PLAYER_SEEK_INTERVALS,
    PlayerSeekIntervals,
} from '../../../utils/playerSeekIntervals';
import { SPEED_OPTIONS } from '../../../utils/constants';
import ControlsOverlay from './ControlsOverlay';
import { useFocusPause } from './hooks/useFocusPause';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSubtitles } from './hooks/useSubtitles';
import { useVideoLoading } from './hooks/useVideoLoading';
import { useVideoPlayer } from './hooks/useVideoPlayer';
import { useVolume } from './hooks/useVolume';
import VideoElement from './VideoElement';
import { viewportHeight, viewportWidth } from '../../../utils/viewportUnits';

interface VideoControlsProps {
    src: string;
    mediaPath?: string | null;
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
    isCinemaMode?: boolean;
    onToggleCinemaMode?: () => void;
    onUploadSubtitle?: (file: File) => Promise<void>;
    onDeleteSubtitle?: (index: number) => void | Promise<void>;
    statisticsVideoId?: string | null;
    statisticsPlatform?: string | null;
    statisticsRelatedEventId?: string | null;
    statisticsAutoplayFromVideoId?: string | null;
    onVideoElementReady?: (videoElement: HTMLVideoElement | null) => void;
    liveSubtitle?: { available: boolean; label: string; track: TextTrack | null };
    audioMode?: boolean;
    seekIntervals?: PlayerSeekIntervals;
    /** Provided only when D Mode can run here; omitted otherwise. */
    onEnterCompatibilityMode?: () => void;
    /** Up Next navigation, bound to shift+N / shift+P. */
    onNextVideo?: () => void;
    onPreviousVideo?: () => void;
}

const VideoControls: React.FC<VideoControlsProps> = ({
    src,
    mediaPath,
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
    poster,
    isCinemaMode = false,
    onToggleCinemaMode,
    onUploadSubtitle,
    onDeleteSubtitle,
    statisticsVideoId = null,
    statisticsPlatform = null,
    statisticsRelatedEventId = null,
    statisticsAutoplayFromVideoId = null,
    onVideoElementReady,
    liveSubtitle,
    audioMode = false,
    seekIntervals = DEFAULT_PLAYER_SEEK_INTERVALS,
    onEnterCompatibilityMode,
    onNextVideo,
    onPreviousVideo,
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

    // Expose the underlying <video> element to the parent (live translation
    // needs direct access for Web Audio capture). Report null only when the
    // element unmounts or the callback is replaced, not for same-element src changes.
    useEffect(() => {
        if (!onVideoElementReady) {
            return;
        }
        onVideoElementReady(videoPlayer.videoRef.current);
        return () => onVideoElementReady(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onVideoElementReady]);

    // Auto-pause on focus loss
    useFocusPause(videoPlayer.videoRef, pauseOnFocusLoss);

    // Statistics: track qualified-playback chunks for the watch-time metric.
    useStatisticsWatchTracker({
        videoRef: videoPlayer.videoRef,
        videoId: statisticsVideoId,
        platform: statisticsPlatform,
        relatedEventId: statisticsRelatedEventId,
        autoplayFromVideoId: statisticsAutoplayFromVideoId,
    });

    // Fullscreen management
    const {
        isFullscreen,
        controlsVisible,
        videoContainerRef,
        handleToggleFullscreen,
        handleControlsMouseEnter,
    } = useFullscreen(videoPlayer.videoRef);

    // Loading and error states
    const loading = useVideoLoading();

    // Volume control
    const volume = useVolume(videoPlayer.videoRef);

    // In subtitle-only live translation, force-show the live track even when the
    // user normally has file subtitles disabled — translated speech is suppressed.
    const { isActive: liveTranslationActive, originalAudioWithSubtitles } =
        useLiveTranslationControl();
    const forceLiveSubtitleOnAvailable =
        originalAudioWithSubtitles && liveTranslationActive;

    // Subtitle management
    const subtitlesHook = useSubtitles({
        subtitles,
        initialSubtitlesEnabled,
        videoRef: videoPlayer.videoRef,
        onSubtitlesToggle,
        liveSubtitle,
        forceLiveSubtitleOnAvailable,
    });

    // Memoize seek callbacks to prevent unnecessary re-registration of keyboard listeners
    const { handleSeek } = videoPlayer;

    const handleSeekLeft = useCallback(() => {
        handleSeek(-seekIntervals.shortSeconds);
    }, [handleSeek, seekIntervals.shortSeconds]);

    const handleSeekRight = useCallback(() => {
        handleSeek(seekIntervals.shortSeconds);
    }, [handleSeek, seekIntervals.shortSeconds]);

    const handleSeekBack = useCallback(() => {
        handleSeek(-seekIntervals.mediumSeconds);
    }, [handleSeek, seekIntervals.mediumSeconds]);

    const handleSeekForward = useCallback(() => {
        handleSeek(seekIntervals.mediumSeconds);
    }, [handleSeek, seekIntervals.mediumSeconds]);

    // Volume moves in the same 5% steps YouTube uses. handleVolumeChange takes
    // a 0-100 slider value, while volume itself is the element's 0-1 scale.
    const { handleVolumeChange } = volume;
    const currentVolume = volume.volume;

    const stepVolume = useCallback((delta: number) => {
        handleVolumeChange(
            Math.round(Math.max(0, Math.min(100, currentVolume * 100 + delta)))
        );
    }, [currentVolume, handleVolumeChange]);

    const handleVolumeUp = useCallback(() => stepVolume(5), [stepVolume]);
    const handleVolumeDown = useCallback(() => stepVolume(-5), [stepVolume]);

    // Cinema mode leaves fullscreen on the way in - the two are alternative
    // ways to make the player big, and staying in both leaves nothing visible
    // to switch back with. Shared with the control button below.
    //
    // Audio mode has no cinema layout and hides the control, so leave the
    // toggle unbound there: flipping state nothing can show would surface on
    // the next video reached through Up Next, which shares this route.
    const handleToggleCinemaMode = onToggleCinemaMode && !audioMode
        ? () => {
              onToggleCinemaMode();
              if (isFullscreen) {
                  handleToggleFullscreen();
              }
          }
        : undefined;

    // Step through the same ladder the speed menu offers rather than a free
    // multiplier, so keyboard and menu can never disagree about the rate.
    const { handlePlaybackRateChange } = videoPlayer;
    const currentPlaybackRate = videoPlayer.playbackRate;

    const stepPlaybackRate = useCallback((direction: -1 | 1) => {
        const currentIndex = SPEED_OPTIONS.indexOf(currentPlaybackRate);
        const fromIndex = currentIndex === -1
            ? SPEED_OPTIONS.indexOf(1)
            : currentIndex;
        const nextIndex = Math.max(
            0,
            Math.min(SPEED_OPTIONS.length - 1, fromIndex + direction)
        );
        handlePlaybackRateChange(SPEED_OPTIONS[nextIndex]);
    }, [currentPlaybackRate, handlePlaybackRateChange]);

    const handleSpeedUp = useCallback(() => stepPlaybackRate(1), [stepPlaybackRate]);
    const handleSpeedDown = useCallback(() => stepPlaybackRate(-1), [stepPlaybackRate]);

    const { handleProgressChangeCommitted } = videoPlayer;
    const currentDuration = videoPlayer.duration;

    const handleSeekToFraction = useCallback((fraction: number) => {
        if (currentDuration <= 0 || !isFinite(currentDuration)) return;
        handleProgressChangeCommitted(currentDuration * fraction);
    }, [currentDuration, handleProgressChangeCommitted]);

    // Keyboard shortcuts
    useKeyboardShortcuts({
        onPlayPause: videoPlayer.handlePlayPause,
        onSeekLeft: handleSeekLeft,
        onSeekRight: handleSeekRight,
        onSeekBack: handleSeekBack,
        onSeekForward: handleSeekForward,
        onVolumeUp: handleVolumeUp,
        onVolumeDown: handleVolumeDown,
        onToggleMute: volume.handleVolumeClick,
        onToggleFullscreen: handleToggleFullscreen,
        onToggleCinemaMode: handleToggleCinemaMode,
        onToggleSubtitles: subtitlesHook.handleToggleSubtitles,
        onSpeedUp: handleSpeedUp,
        onSpeedDown: handleSpeedDown,
        onSeekToFraction: handleSeekToFraction,
        onFrameStep: videoPlayer.handleFrameStep,
        onNextVideo,
        onPreviousVideo,
    });

    // Handle video source changes - trigger loading
    useEffect(() => {
        if (src) {
            loading.startLoading();
        } else {
            loading.stopLoading();
            loading.setError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    // Handle video loading events. preload is owned by VideoElement's
    // adaptive strategy; forcing 'metadata' here disabled read-ahead
    // buffering in every browser and made seeks outside the buffer stall
    // (worst on Safari, whose WebM pipeline cannot byte-range seek).
    const handleLoadStart = () => {
        loading.startLoading();
    };

    const handleCanPlay = () => {
        loading.stopLoading();
        // Call videoPlayer's canPlay handler to update duration if available
        videoPlayer.handleCanPlay();
    };

    const handleLoadedData = () => {
        loading.stopLoading();
    };

    const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        loading.stopLoading();
        videoPlayer.handleLoadedMetadata(e);
    };

    // Handle progress event - hide loading once we have buffered data
    // This is especially important for large files where metadata loading takes time
    const handleProgress = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const videoElement = e.currentTarget;
        // Check if we have any buffered data
        if (videoElement.buffered.length > 0) {
            // If we have buffered data, we can hide the loading indicator
            // even if metadata isn't fully loaded yet
            loading.stopLoading();
        }
    };

    // Handle waiting event - show loading when video is buffering during playback
    const handleWaiting = () => {
        // Only show loading if video is playing (not during initial load)
        if (videoPlayer.isPlaying) {
            loading.startLoading();
        }
    };

    // Handle canplaythrough - video has buffered enough to play through
    const handleCanPlayThrough = () => {
        loading.stopLoading();
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
            ref={videoContainerRef}
            sx={{
                width: '100%',
                bgcolor: neutral.black,
                borderRadius: { xs: 0, sm: 2 },
                overflow: 'hidden',
                boxShadow: 4,
                position: 'relative',
                ...(isFullscreen && {
                    width: viewportWidth(),
                    height: viewportHeight(),
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 0
                })
            }}
        >
            <Box sx={{ position: 'relative', flex: isFullscreen ? 1 : undefined, minHeight: isFullscreen ? 0 : undefined }}>
                <VideoElement
                    videoRef={videoPlayer.videoRef}
                    src={src}
                    mediaPath={mediaPath}
                    poster={poster}
                    isLoading={loading.isLoading}
                    loadError={loading.loadError}
                    isFullscreen={isFullscreen}
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
                    onProgress={handleProgress}
                    onWaiting={handleWaiting}
                    onCanPlayThrough={handleCanPlayThrough}
                    onSeeking={videoPlayer.handleSeeking}
                    onSeeked={videoPlayer.handleSeeked}
                    onSubtitleInit={subtitlesHook.initializeSubtitles}
                    audioMode={audioMode}
                    isPlaying={videoPlayer.isPlaying}
                />

                <Box
                    sx={{
                        ...(isFullscreen
                            ? {
                                  position: 'absolute',
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 20
                              }
                            : { flexShrink: 0 })
                    }}
                >
                    <ControlsOverlay
                        isFullscreen={isFullscreen}
                        controlsVisible={controlsVisible}
                        isPlaying={videoPlayer.isPlaying}
                        currentTime={videoPlayer.currentTime}
                        duration={videoPlayer.duration}
                        isDragging={videoPlayer.isDragging}
                        volume={volume.volume}
                        showVolumeSlider={volume.showVolumeSlider}
                        volumeSliderRef={volume.volumeSliderRef}
                        subtitles={subtitles}
                        subtitlesEnabled={subtitlesHook.subtitlesEnabled}
                        selectedSubtitleIndices={subtitlesHook.selectedSubtitleIndices}
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
                        liveSubtitleAvailable={subtitlesHook.liveSubtitleAvailable}
                        liveSubtitleLabel={subtitlesHook.liveSubtitleLabel}
                        liveSubtitleSelected={subtitlesHook.liveSubtitleSelected}
                        onSelectLiveSubtitle={subtitlesHook.handleSelectLiveSubtitle}
                        onToggleFullscreen={handleToggleFullscreen}
                        onToggleLoop={handleToggleLoop}
                        onControlsMouseEnter={handleControlsMouseEnter}
                        playbackRate={videoPlayer.playbackRate}
                        onPlaybackRateChange={videoPlayer.handlePlaybackRateChange}
                        seekIntervals={seekIntervals}
                        isCinemaMode={isCinemaMode}
                        onToggleCinemaMode={handleToggleCinemaMode}
                        onUploadSubtitle={onUploadSubtitle}
                        onDeleteSubtitle={onDeleteSubtitle}
                        isAudio={audioMode}
                        onEnterCompatibilityMode={onEnterCompatibilityMode}
                    />
                </Box>
            </Box>
        </Box>
    );
};

export default VideoControls;
