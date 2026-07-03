import { Box, Typography } from '@mui/material';
import React, { useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { neutral, overlay } from '../../../theme/colors';
import { getBackendUrl } from '../../../utils/apiUrl';
import { getSubtitleLanguageLabel } from '../../../utils/formatUtils';
import { getMediaCrossOriginAttr } from '../../../utils/mediaOrigin';

type GlobalVideoCounterScope = typeof globalThis & {
    __videoControlCounter?: number;
};

type NetworkInformationLike = {
    effectiveType?: string;
    saveData?: boolean;
};

type NavigatorWithConnection = Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
};

const isLikelyMobileUserAgent = (): boolean =>
    /iPhone|iPod|Android.*Mobile|Mobi/i.test(navigator.userAgent);

const computePreloadStrategy = (): 'auto' | 'metadata' | 'none' => {
    const navigatorWithConnection = navigator as NavigatorWithConnection;
    const connection =
        navigatorWithConnection.connection ||
        navigatorWithConnection.mozConnection ||
        navigatorWithConnection.webkitConnection;

    if (connection) {
        const type = connection.effectiveType; // 'slow-2g', '2g', '3g', '4g'
        const saveData = connection.saveData;

        if (saveData) {
            return 'none'; // Save data mode -> minimal loading
        }
        if (type === '4g') {
            return 'auto'; // Good connection -> auto preload
        }
        return 'metadata'; // Slower connection -> metadata only
    }

    // Browsers without the Network Information API (Safari, Firefox).
    // Desktop gets 'auto': read-ahead buffering is what makes timeline
    // seeks land in already-buffered data — critical for Safari, whose
    // native WebM pipeline downloads linearly and cannot byte-range
    // seek. Mobile stays conservative to avoid burning cellular data.
    return isLikelyMobileUserAgent() ? 'metadata' : 'auto';
};

interface VideoElementProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    src: string;
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
}

const VideoElement: React.FC<VideoElementProps> = ({
    videoRef,
    src,
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
    onSubtitleInit
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

    // Computed once per mount: the connection info the strategy depends on
    // does not change mid-playback, and a lazy initializer guarantees the
    // <video> element never starts loading with a downgraded placeholder.
    const [preloadStrategy] = React.useState<'auto' | 'metadata' | 'none'>(
        computePreloadStrategy
    );
    const [mobileAspectRatio, setMobileAspectRatio] = React.useState<string>('16/9');

    React.useEffect(() => {
        // Reset to default ratio while new source metadata is loading
        setMobileAspectRatio('16/9');
    }, [src]);

    return (
        <Box
            sx={{
                ...(isFullscreen
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

            <video
                id={videoId}
                ref={videoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
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
                        srcLang={subtitle.language}
                        label={getSubtitleLanguageLabel(subtitle.language, subtitle.path)}
                    />
                ))}
                Your browser does not support the video tag.
            </video>
        </Box>
    );
};

export default VideoElement;
