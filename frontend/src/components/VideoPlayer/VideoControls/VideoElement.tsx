import { Box, IconButton, Typography } from '@mui/material';
import { Pause, PlayArrow } from '@mui/icons-material';
import React, { useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { neutral, overlay } from '../../../theme/colors';
import { getBackendUrl } from '../../../utils/apiUrl';
import { getSubtitleLanguageLabel, getSubtitleTrackLanguage } from '../../../utils/formatUtils';
import { getMediaCrossOriginAttr } from '../../../utils/mediaOrigin';
import { computePreloadStrategy } from '../../../utils/preloadStrategy';

type GlobalVideoCounterScope = typeof globalThis & {
    __videoControlCounter?: number;
};

interface VideoElementProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    src: string;
    mediaPath?: string | null;
    poster?: string;
    isLoading: boolean;
    loadError: string | null;
    isFullscreen?: boolean;
    subtitles: Array<{ language: string; filename: string; path: string }>;
    onClick: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded?: () => void;
    onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onError: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onLoadStart: () => void;
    onCanPlay: () => void;
    onLoadedData: () => void;
    onProgress?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onWaiting?: () => void;
    onCanPlayThrough?: () => void;
    onSeeking?: () => void;
    onSeeked?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onSubtitleInit: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    audioMode?: boolean;
    isPlaying?: boolean;
}

const VideoElement: React.FC<VideoElementProps> = ({
    videoRef,
    src,
    mediaPath,
    poster,
    isLoading,
    loadError,
    isFullscreen = false,
    subtitles,
    onClick,
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate,
    onLoadedMetadata,
    onError,
    onLoadStart,
    onCanPlay,
    onLoadedData,
    onProgress,
    onWaiting,
    onCanPlayThrough,
    onSeeking,
    onSeeked,
    onSubtitleInit,
    audioMode = false,
    isPlaying = false,
}) => {
    const { t } = useLanguage();
    // Use useMemo to generate a stable unique ID per component instance
    // Using Date.now() and a simple counter is safe for non-cryptographic purposes
    const videoId = useMemo(() => {
        const globalScope = globalThis as GlobalVideoCounterScope;
        const counter = (globalScope.__videoControlCounter || 0) + 1;
        globalScope.__videoControlCounter = counter;
        return `video-controls-${Date.now()}-${counter}`;
    }, []);

    // Compute during render so the <video> element never starts loading
    // with a downgraded placeholder, and recalculate when the media changes.
    const preloadStrategy = useMemo<'auto' | 'metadata' | 'none'>(
        () => computePreloadStrategy({ src, mediaPath }),
        [src, mediaPath]
    );
    const [mobileAspectRatio, setMobileAspectRatio] = React.useState<string>('16/9');

    React.useEffect(() => {
        // Reset to default ratio while new source metadata is loading
        setMobileAspectRatio('16/9');
    }, [src]);

    return (
        <Box
            sx={{
                ...(audioMode
                    ? {
                          maxWidth: { xs: '100%', sm: 480 },
                          width: '100%',
                          aspectRatio: '1 / 1',
                          position: 'relative',
                          display: 'block',
                          mx: 'auto',
                      }
                    : isFullscreen
                    ? {
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          minHeight: 0
                      }
                    : {
                          maxHeight: 'calc(100vh - 180px)',
                          width: '100%',
                          aspectRatio: {
                              xs: mobileAspectRatio,
                              sm: '16/9'
                          },
                          position: 'relative',
                          display: 'block'
                      })
            }}
        >
            {/* Scoped style for centering subtitles */}
            <style>
                {`
                    #${videoId}::cue {
                        text-align: center !important;
                        line-height: 1.5;
                        background-color: ${overlay.black80};
                    }
                    
                    #${videoId}::-webkit-media-text-track-display {
                        text-align: center !important;
                    }
                    
                    #${videoId}::-webkit-media-text-track-container {
                        text-align: center !important;
                        display: flex;
                        justify-content: center;
                        align-items: flex-end;
                    }
                    
                    #${videoId}::cue-region {
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
                        bgcolor: overlay.black70,
                        borderRadius: 2,
                        p: 2,
                        color: neutral.white
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
                        bgcolor: overlay.error90,
                        borderRadius: 2,
                        p: 2,
                        color: neutral.white,
                        maxWidth: '80%',
                        textAlign: 'center'
                    }}
                >
                    <Typography variant="body2">{loadError}</Typography>
                </Box>
            )}

            {audioMode && (
                <Box
                    onClick={onClick}
                    role="button"
                    aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        background: `linear-gradient(135deg, #161b2d 0%, #3b1d5a 55%, #0f766e 100%)`,
                        cursor: 'pointer',
                    }}
                >
                    {poster ? (
                        <Box
                            component="img"
                            src={poster}
                            alt=""
                            sx={{ width: '72%', height: '72%', objectFit: 'cover', borderRadius: 3, boxShadow: 8 }}
                        />
                    ) : (
                        <Typography variant="h1" color="primary.contrastText" aria-hidden>
                            ♪
                        </Typography>
                    )}
                    <IconButton
                        aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                        onClick={(event) => { event.stopPropagation(); onClick(); }}
                        sx={{ position: 'absolute', bgcolor: 'background.paper', color: 'primary.main', '&:hover': { bgcolor: 'background.paper' } }}
                    >
                        {isPlaying ? <Pause /> : <PlayArrow />}
                    </IconButton>
                </Box>
            )}

            <video
                id={videoId}
                ref={videoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: audioMode ? 'none' : 'block',
                    cursor: 'pointer'
                }}
                controls={false}
                src={src}
                preload={preloadStrategy}
                onClick={onClick}
                onPlay={onPlay}
                onPause={onPause}
                onEnded={onEnded}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={(e) => {
                    const { videoWidth, videoHeight } = e.currentTarget;
                    if (videoWidth > 0 && videoHeight > 0) {
                        setMobileAspectRatio(`${videoWidth}/${videoHeight}`);
                    }
                    onLoadedMetadata(e);
                    onSubtitleInit(e);
                }}
                onError={onError}
                onLoadStart={onLoadStart}
                onCanPlay={onCanPlay}
                onLoadedData={onLoadedData}
                onProgress={onProgress}
                onWaiting={onWaiting}
                onCanPlayThrough={onCanPlayThrough}
                onSeeking={onSeeking}
                onSeeked={onSeeked}
                playsInline
                crossOrigin={getMediaCrossOriginAttr(src)}
                poster={poster}
            >
                {subtitles && subtitles.map((subtitle, index) => (
                    <track
                        key={`${subtitle.language}-${index}`}
                        kind="subtitles"
                        src={`${getBackendUrl()}${subtitle.path}`}
                        srcLang={getSubtitleTrackLanguage(subtitle.language, subtitle.path)}
                        label={getSubtitleLanguageLabel(subtitle.language, subtitle.path)}
                    />
                ))}
                Your browser does not support the video tag.
            </video>
        </Box>
    );
};

export default VideoElement;
